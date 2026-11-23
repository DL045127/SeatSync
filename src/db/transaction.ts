import type { Pool, PoolClient } from "pg";
import { classifyCommitFailure, sqlState } from "./commit-outcome.ts";

/**
 * A COMMIT whose outcome could not be established (acknowledgement lost, or an
 * explicitly unknown resolution such as SQLSTATE 08007). The transaction may
 * have committed or not, and no later rollback attempt can prove otherwise. The
 * caller must discard the connection and resolve by same-key replay.
 */
export class CommitOutcomeUnknown extends Error {
  constructor(cause: unknown) {
    super("Could not confirm the database commit outcome.", { cause });
    this.name = "CommitOutcomeUnknown";
  }
}

/**
 * A COMMIT the server provably rolled back (for example a deferred-constraint
 * violation surfaced at commit time, SQLSTATE class 23). The business effects
 * are known to be undone. This is distinct from a lost or unknown
 * acknowledgement (ISSUE-006): only the shared conservative classifier in
 * ./commit-outcome decides this, never the mere presence of a SQLSTATE.
 */
export class CommitRejected extends Error {
  readonly code: string | undefined;
  constructor(cause: unknown) {
    super("The database rolled the transaction back at commit.", { cause });
    this.name = "CommitRejected";
    this.code = sqlState(cause);
  }
}

/**
 * A COMMIT the server rolled back for a transient, retryable reason (class 40
 * serialization/deadlock). The transaction is known to be undone and the same
 * operation should be retried (ISSUE-006).
 */
export class CommitRetryable extends Error {
  readonly code: string | undefined;
  constructor(cause: unknown) {
    super("The database rolled the transaction back; retry.", { cause });
    this.name = "CommitRetryable";
    this.code = sqlState(cause);
  }
}

/**
 * Narrow test-only fault hook, fired just before this helper's COMMIT.
 * Production code never sets it. Tests use it to inject a lost-acknowledgement
 * or connection error at a read transaction's COMMIT (ISSUE-016) with no public
 * fault route.
 */
let commitFaultHook: ((client: PoolClient) => Promise<void>) | undefined;

/** Install a before-COMMIT fault hook; returns a disposer. Test-only. */
export function __setTransactionCommitFaultHook(
  hook: ((client: PoolClient) => Promise<void>) | undefined,
): () => void {
  commitFaultHook = hook;
  return () => {
    commitFaultHook = undefined;
  };
}

export function withTransaction<T>(
  pool: Pool,
  mode: "read" | "write",
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return runTransaction(pool, mode, work);
}

async function runTransaction<T>(
  pool: Pool,
  mode: "read" | "write",
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  let connectionError: Error | undefined;
  const onError = (error: Error) => { connectionError = error; };
  client.on("error", onError);
  try {
    try {
      await client.query(mode === "read"
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        : "BEGIN ISOLATION LEVEL READ COMMITTED");
    } catch (error) {
      discard = true;
      throw error;
    }

    let result: T;
    try {
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
      result = await work(client);
      if (connectionError) throw connectionError;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
      throw error;
    }

    if (commitFaultHook) {
      // ISSUE-020: if the before-COMMIT hook itself throws, the transaction is
      // still open; roll it back (or discard the client if rollback also fails)
      // so the client is never returned to the pool mid-transaction.
      try {
        await commitFaultHook(client);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
        throw error;
      }
    }

    let command: string;
    try {
      ({ command } = await client.query("COMMIT"));
    } catch (error) {
      // ISSUE-006: classify consistently with the keyed helper into the three
      // outcomes. A proven rollback yields CommitRejected; a server-confirmed
      // serialization/deadlock yields CommitRetryable; a lost or explicitly
      // unknown acknowledgement (incl. class 08 and 40003) yields
      // CommitOutcomeUnknown. In all cases the client is unusable and discarded.
      discard = true;
      const source = connectionError && classifyCommitFailure(connectionError) === "unknown"
        ? connectionError
        : error;
      const outcome = classifyCommitFailure(source);
      if (outcome === "rolled-back") throw new CommitRejected(source);
      if (outcome === "retryable-rollback") throw new CommitRetryable(source);
      throw new CommitOutcomeUnknown(source);
    }
    if (command !== "COMMIT") throw new Error("Database rolled back the transaction.");
    return result;
  } finally {
    client.off("error", onError);
    client.release(discard || connectionError !== undefined);
  }
}
