// The shared keyed-mutation helper. Every create/roster/commit mutation runs
// through runKeyedMutation so there is one receipt path and one terminal-outcome
// protocol (docs/ARCHITECTURE.md section 6 "Terminal mutation outcomes").
//
// Order within the transaction is always key -> trip -> child rows. A second
// operation key is never acquired. The business work runs inside a savepoint so
// a terminal domain rejection can be rolled back while the key is still
// finalized with a `not_applied` receipt.

import type { Pool, PoolClient } from "pg";
import {
  OutcomeUnknown,
  TerminalBusinessError,
  TransientFailure,
  type ApiErrorBody,
  type ErrorCode,
} from "../contracts/errors.ts";
import { requestFingerprint, type CanonicalMethod } from "../contracts/index.ts";
import { mutationLockId } from "../db/advisory-lock.ts";
import {
  classifyCommitFailure,
  isRetryableQueryError,
  isTransportError,
} from "../db/commit-outcome.ts";
import { assertDataset, DatasetMismatch } from "../db/dataset.ts";
import { datasetLock } from "../db/local-target.ts";
import {
  CommitOutcomeUnknown,
  CommitRejected,
  CommitRetryable,
} from "../db/transaction.ts";

/** A durably stored receipt row. */
interface ReceiptRow {
  request_key: string;
  request_fingerprint: string;
  outcome: "applied" | "not_applied";
  http_status: number;
  response_json: unknown;
}

/** Result of a successful mutation: the HTTP body and status to return and store. */
export interface AppliedResult {
  httpStatus: number;
  body: unknown;
}

export interface MutationRequest {
  requestKey: string;
  method: CanonicalMethod;
  canonicalRoute: string;
  normalizedBody: unknown;
}

export interface MutationResponse {
  httpStatus: number;
  body: unknown;
  replayed: boolean;
}

/**
 * Optionally lock an existing trip row before the savepoint. Returning a value
 * passes it to the business callback. Returning a TerminalBusinessError-shaped
 * rejection (by throwing) is allowed; a missing trip is a terminal 404 the
 * caller raises. Runs with the key lock held and before SAVEPOINT, so the trip
 * lock survives a rollback to the savepoint (ISSUE-015).
 */
export type LockTrip<L> = (client: PoolClient) => Promise<L>;

/**
 * The business work for a mutation. It runs inside the open transaction with
 * the key lock and (when applicable) the trip row lock already held, inside the
 * savepoint. It returns an AppliedResult on success, or throws
 * TerminalBusinessError for a terminal domain rejection, TransientFailure for a
 * retryable condition, or any other Error for an unexpected invariant failure
 * (which the helper finalizes as a terminal 500 receipt). It must never catch
 * and swallow a connection error.
 */
export type BusinessWork<L> = (ctx: {
  client: PoolClient;
  requestKey: string;
  locked: L;
}) => Promise<AppliedResult>;

const SAVEPOINT = "business_work";

/**
 * Narrow test-only fault hook. Production code never sets it. Tests set a hook
 * to simulate a fault at a labeled point (e.g. just before the success-receipt
 * COMMIT) so C-17's terminal-failure and lost/failed-acknowledgement paths can
 * be exercised with real connections and no public fault-injection route.
 */
export type FaultPoint =
  | "after-business-writes"
  | "before-receipt-insert"
  | "before-failure-receipt-insert"
  | "before-failure-commit"
  | "after-failure-commit"
  | "before-success-commit"
  | "after-success-commit";

let faultHook: ((point: FaultPoint, client: PoolClient) => Promise<void>) | undefined;

/** Install a fault hook; returns a disposer that clears it. Test-only. */
export function __setFaultHook(
  hook: (point: FaultPoint, client: PoolClient) => Promise<void>,
): () => void {
  faultHook = hook;
  return () => {
    faultHook = undefined;
  };
}

async function fault(point: FaultPoint, client: PoolClient): Promise<void> {
  if (faultHook) await faultHook(point, client);
}

export interface KeyedMutationOptions<L> {
  pool: Pool;
  request: MutationRequest;
  /** Lock an existing trip before the savepoint. Omit for creation. */
  lockTrip?: LockTrip<L>;
  work: BusinessWork<L>;
  makeRequestId: () => string;
}

/**
 * Run a keyed mutation end to end following architecture section 6:
 * dataset guard → key advisory lock → receipt replay/conflict → trip row lock
 * (before the savepoint) → SAVEPOINT business_work → business work → terminal
 * receipt and COMMIT. `makeRequestId` produces the per-attempt request id used
 * only in error bodies (never in the fingerprint).
 */
export async function runKeyedMutation<L = undefined>(
  options: KeyedMutationOptions<L>,
): Promise<MutationResponse> {
  const { pool, request, lockTrip, work, makeRequestId } = options;
  const fingerprint = requestFingerprint(
    request.method,
    request.canonicalRoute,
    request.normalizedBody,
  );

  // ISSUE-016: a refused or timed-out pool acquisition is a retryable database
  // condition, not an internal error. Classify it before any client exists.
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new TransientFailure("DATABASE_UNAVAILABLE", "The database is unavailable.", error);
  }
  let discard = false;
  let connectionError: Error | undefined;
  // Set once a receipt COMMIT has returned successfully. After that point the
  // outcome is durably committed, so any later fault (e.g. a lost result
  // delivery) is reported as unknown-to-the-client, resolvable by same-key
  // replay, never as a fresh internal failure.
  let committed = false;
  const onError = (error: Error) => { connectionError = error; };
  client.on("error", onError);

  try {
    await beginWrite(client);

    // Step 1: dataset guard under the shared lock, then the key lock. The key
    // lock is a transaction-scoped advisory lock so a hash collision only
    // serializes unrelated keys.
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      mutationLockId(request.requestKey),
    ]);

    // Step 2: read the receipt after holding the lock. Replay a terminal
    // result, or reject a differing fingerprint as key reuse.
    const existing = await readReceipt(client, request.requestKey);
    if (existing) {
      const replay = resolveReplay(existing, fingerprint, request.requestKey, makeRequestId);
      await commitOrClassify(client, () => { connectionError = undefined; });
      committed = true;
      return replay;
    }

    // ISSUE-015: acquire the existing trip row lock BEFORE the savepoint, so a
    // ROLLBACK TO SAVEPOINT while finalizing a failure receipt does not release
    // it and let a concurrent writer pass the version check. A terminal error
    // thrown while locking (e.g. trip not found) is finalized directly: no
    // business writes happened yet, so no savepoint rollback is needed.
    let locked: L;
    try {
      locked = (lockTrip ? await lockTrip(client) : undefined) as L;
      if (connectionError) throw connectionError;
    } catch (error) {
      if (error instanceof TerminalBusinessError && !connectionError) {
        const body = errorBody(error, request.requestKey, makeRequestId());
        await insertReceipt(client, {
          requestKey: request.requestKey,
          fingerprint,
          outcome: "not_applied",
          httpStatus: error.httpStatus,
          responseJson: body,
        });
        await commitOrClassify(client);
        committed = true;
        return { httpStatus: error.httpStatus, body, replayed: false };
      }
      throw error;
    }

    // Step 3: business work inside a savepoint.
    await client.query(`SAVEPOINT ${SAVEPOINT}`);
    let applied: AppliedResult;
    try {
      applied = await work({ client, requestKey: request.requestKey, locked });
      await fault("after-business-writes", client);
      if (connectionError) throw connectionError;
    } catch (error) {
      // Step 4: a terminal business rejection OR an unexpected internal
      // invariant failure (ISSUE-014) is finalized: roll back to the savepoint
      // (the key and trip locks, taken earlier, survive), persist a terminal
      // receipt, and commit. Transient, connection, receipt-write, and commit
      // failures are NOT finalized and rethrow for the outer catch.
      const terminal = toTerminal(error, connectionError);
      if (!terminal) throw error;
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      if (connectionError) throw connectionError;
      const body = errorBody(terminal, request.requestKey, makeRequestId());
      await fault("before-failure-receipt-insert", client);
      await insertReceipt(client, {
        requestKey: request.requestKey,
        fingerprint,
        outcome: "not_applied",
        httpStatus: terminal.httpStatus,
        responseJson: body,
      });
      await fault("before-failure-commit", client);
      await commitOrClassify(client);
      committed = true;
      // The failure-receipt COMMIT has returned successfully. A fault here
      // simulates the server committing the not_applied receipt but the client
      // losing the delivered result; the receipt is durable and resolves by
      // replay (ISSUE-019 / C-17 lost-acknowledgement of a committed failure).
      await fault("after-failure-commit", client);
      return { httpStatus: terminal.httpStatus, body, replayed: false };
    }

    // Success: persist the applied receipt atomically with the business writes.
    await fault("before-receipt-insert", client);
    await insertReceipt(client, {
      requestKey: request.requestKey,
      fingerprint,
      outcome: "applied",
      httpStatus: applied.httpStatus,
      responseJson: applied.body,
    });
    await fault("before-success-commit", client);
    await commitOrClassify(client);
    committed = true;
    // The COMMIT has returned successfully. A fault here simulates the server
    // committing but the client losing the delivered result (the receipt is
    // durable and must resolve by replay).
    await fault("after-success-commit", client);
    return { httpStatus: applied.httpStatus, body: applied.body, replayed: false };
  } catch (error) {
    discard = true;
    // If a receipt already committed, the outcome is durable; a later fault
    // (lost result delivery) is unknown-to-the-client and resolves by replay.
    if (committed) throw new OutcomeUnknown(error);
    await safeRollback(client);
    throw classifyFailure(error, connectionError);
  } finally {
    client.off("error", onError);
    client.release(discard || connectionError !== undefined);
  }
}

/**
 * Decide whether a business-callback error should be finalized as a terminal
 * receipt. TerminalBusinessError is finalized as given. An unexpected Error
 * (invariant violation, ISSUE-014) is finalized as a terminal 500. A
 * TransientFailure, a lost/unknown-commit signal, or a live connection error is
 * NOT finalized (returns undefined) so the key stays open for retry.
 */
function toTerminal(
  error: unknown,
  connectionError: Error | undefined,
): TerminalBusinessError | undefined {
  if (error instanceof TerminalBusinessError) return error;
  if (error instanceof TransientFailure) return undefined;
  if (error instanceof OutcomeUnknown) return undefined;
  if (
    error instanceof CommitOutcomeUnknown ||
    error instanceof CommitRejected ||
    error instanceof CommitRetryable
  ) {
    return undefined;
  }
  // A connection-level failure means we cannot trust the savepoint rollback or
  // the receipt write; do not finalize.
  if (connectionError) return undefined;
  // ISSUE-014: a retryable database error raised inside the business callback
  // (lock timeout 55P03, statement cancellation 57014, serialization 40001,
  // transport errors) must NOT become a terminal receipt; the key stays open
  // for retry.
  if (isRetryableQueryError(error)) return undefined;
  // An unexpected internal error with no connection fault: finalize as 500 with
  // a generic public message (never leak the raw error text).
  return new TerminalBusinessError(500, "INTERNAL_ERROR", "An unexpected internal error occurred.");
}

async function beginWrite(client: PoolClient): Promise<void> {
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  await client.query("SET LOCAL lock_timeout = '2s'");
  await client.query("SET LOCAL statement_timeout = '5s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
}

/**
 * COMMIT and classify a failed acknowledgement. A server-rejected commit
 * (SQLSTATE present) means a definite rollback and surfaces as an internal
 * error here, because the receipt write itself failing is not a normal business
 * rejection; a lost acknowledgement surfaces as OutcomeUnknown. Both discard the
 * connection via the caller's finally.
 */
async function commitOrClassify(
  client: PoolClient,
  onSuccess?: () => void,
): Promise<void> {
  let command: string;
  try {
    ({ command } = await client.query("COMMIT"));
  } catch (error) {
    if (error instanceof CommitRejected) throw error;
    if (error instanceof CommitRetryable) {
      throw new TransientFailure("DATABASE_BUSY", "A serialization conflict occurred; retry.", error);
    }
    if (error instanceof CommitOutcomeUnknown) throw new OutcomeUnknown(error);
    // ISSUE-006: classify conservatively. A server-confirmed serialization or
    // deadlock rollback (class 40) is retryable and does NOT finalize the key.
    // A definite rollback (class 23) is CommitRejected. Everything else
    // (incl. 40003 statement_completion_unknown and class 08) is an unknown
    // outcome needing same-key recovery.
    const outcome = classifyCommitFailure(error);
    if (outcome === "retryable-rollback") {
      throw new TransientFailure("DATABASE_BUSY", "A serialization conflict occurred; retry.", error);
    }
    throw outcome === "rolled-back"
      ? new CommitRejected(error)
      : new OutcomeUnknown(error);
  }
  if (command !== "COMMIT") throw new OutcomeUnknown(new Error("Unexpected COMMIT reply."));
  onSuccess?.();
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The connection is already being discarded.
  }
}

/**
 * Map a thrown failure to the error surfaced to callers. Typed outcomes pass
 * through. A DatasetMismatch is preserved (ISSUE-016). Timeouts, lock waits,
 * serialization failures, and transport/connection failures (including a
 * refused pool acquisition, which has no SQLSTATE) become a retryable
 * TransientFailure rather than an internal error.
 */
function classifyFailure(error: unknown, connectionError: Error | undefined): unknown {
  if (error instanceof OutcomeUnknown) return error;
  if (error instanceof TransientFailure) return error;
  if (error instanceof TerminalBusinessError) return error;
  if (error instanceof DatasetMismatch) return error; // preserve readiness error
  if (error instanceof CommitOutcomeUnknown) return new OutcomeUnknown(error);
  if (error instanceof CommitRetryable) {
    return new TransientFailure("DATABASE_BUSY", "A serialization conflict occurred; retry.", error);
  }
  if (error instanceof CommitRejected) {
    // A receipt commit the server rolled back: nothing applied and the key was
    // not finalized. Surface as internal; the client may retry the same key.
    return error;
  }
  // Transport errors (incl. a refused pool connect) and retryable SQLSTATEs are
  // not finalized and map to a retryable 503. The shared classifier correctly
  // distinguishes a Node errno (EPIPE/EPERM) from a real SQLSTATE (ISSUE-016).
  if (isTransportError(error) || isTransportError(connectionError)) {
    return new TransientFailure("DATABASE_UNAVAILABLE", "The database is unavailable.", error);
  }
  if (isRetryableQueryError(error) || isRetryableQueryError(connectionError)) {
    return new TransientFailure("DATABASE_BUSY", "The database is busy; retry.", error);
  }
  return error;
}

async function readReceipt(
  client: PoolClient,
  requestKey: string,
): Promise<ReceiptRow | undefined> {
  const result = await client.query<ReceiptRow>(
    `SELECT request_key, request_fingerprint, outcome, http_status, response_json
       FROM mutation_receipts WHERE request_key = $1`,
    [requestKey],
  );
  return result.rows[0];
}

async function insertReceipt(
  client: PoolClient,
  r: {
    requestKey: string;
    fingerprint: string;
    outcome: "applied" | "not_applied";
    httpStatus: number;
    responseJson: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO mutation_receipts
       (request_key, request_fingerprint, outcome, http_status, response_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [r.requestKey, r.fingerprint, r.outcome, r.httpStatus, JSON.stringify(r.responseJson)],
  );
}

/**
 * Resolve a replay: a matching fingerprint replays the original status/body;
 * a differing fingerprint is a key-reuse conflict that must not overwrite the
 * stored receipt or claim the original was not applied.
 */
function resolveReplay(
  existing: ReceiptRow,
  fingerprint: string,
  requestKey: string,
  makeRequestId: () => string,
): MutationResponse {
  if (existing.request_fingerprint !== fingerprint) {
    // ISSUE-013: a key-reuse conflict must NOT attach terminal operation
    // metadata. The original operation's outcome is untouched, and a false
    // `not_applied` here could make the browser clear a live pending operation.
    const body: ApiErrorBody = {
      error: {
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "This idempotency key was used for a different request.",
        requestId: makeRequestId(),
      },
    };
    return { httpStatus: 409, body, replayed: false };
  }
  return { httpStatus: existing.http_status, body: existing.response_json, replayed: true };
}

function errorBody(
  error: TerminalBusinessError,
  requestKey: string,
  requestId: string,
): ApiErrorBody {
  const body: ApiErrorBody = {
    error: { code: error.code as ErrorCode, message: error.message, requestId },
    operation: { key: requestKey, outcome: "not_applied" },
  };
  if (error.currentVersion !== undefined) body.error.currentVersion = error.currentVersion;
  if (error.fields) body.error.fields = error.fields;
  return body;
}
