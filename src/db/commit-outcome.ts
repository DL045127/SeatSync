// One conservative classifier for the outcome of a failed COMMIT, shared by the
// low-level transaction helper and the mutation helper (ISSUE-006).
//
// The default is UNKNOWN: a COMMIT whose acknowledgement we did not clearly
// receive could have committed or rolled back on the server, and no later
// rollback attempt proves otherwise. We only downgrade to a proven ROLLBACK
// when the error is a server-returned SQLSTATE that establishes the server
// evaluated and refused to commit — a constraint violation surfaced at commit
// time (including deferred constraints). Connection-exception class `08`
// (including 08007 "transaction resolution unknown") and transport errors with
// no SQLSTATE are explicitly left UNKNOWN.

// A COMMIT failure is one of:
//  - "retryable-rollback": the server confirmed a rollback that is safe and
//    expected to retry (serialization / deadlock failures, class 40). The key
//    is NOT finalized; the same operation should run again.
//  - "rolled-back": the server confirmed a rollback from a definite rejection
//    (integrity-constraint class 23) that will not succeed on retry.
//  - "unknown": the outcome could not be established (lost acknowledgement, or
//    an explicitly unknown resolution such as class 08 incl. 08007, or a
//    transport error with no SQLSTATE). Resolve by same-key replay.
export type CommitOutcome = "retryable-rollback" | "rolled-back" | "unknown";

/**
 * Extract a server SQLSTATE. A PostgreSQL SQLSTATE is five characters whose
 * first two (the class) are DIGITS; positions 3-5 may be digits or uppercase
 * letters. Node transport errnos such as EPIPE/EPERM/ECONN are also five
 * uppercase characters but start with letters, so requiring two leading digits
 * keeps them from being mistaken for SQLSTATEs (ISSUE-014/016).
 */
export function sqlState(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9]{2}[0-9A-Z]{3}$/.test(code)) return code;
  }
  return undefined;
}

/**
 * A transport/connection error has a Node errno string (ECONNRESET, EPIPE,
 * EPERM, ETIMEDOUT, ...) rather than a SQLSTATE, or is a pg-pool acquisition
 * timeout with no code but a recognizable message. These are retryable.
 */
export function isTransportError(error: unknown): boolean {
  if (sqlState(error) !== undefined) return false;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) return true;
  const message = error instanceof Error ? error.message : "";
  return /timeout exceeded when trying to connect|Connection terminated|socket hang up/i.test(message);
}

// Class 40: transaction rollback. 40001 serialization_failure and 40P01
// deadlock_detected are server-confirmed rollbacks that should be retried.
const RETRYABLE_ROLLBACK_CODES = new Set(["40001", "40P01", "40000"]);

// SQLSTATE classes/codes that prove the server evaluated the COMMIT and rolled
// it back from a definite rejection. Integrity-constraint violations are class
// 23. This is an allowlist: anything not here stays unknown.
const ROLLBACK_PROVEN_CLASSES = new Set(["23"]);
const ROLLBACK_PROVEN_CODES = new Set([
  "40002", // transaction_integrity_constraint_violation (deferred constraint at COMMIT)
  "27000", // triggered_data_change_violation
]);

/**
 * Classify a COMMIT failure conservatively. Transport errors, class 08 (incl.
 * 08007), 40003 (statement_completion_unknown), and a missing SQLSTATE are
 * "unknown". A class-40 serialization/deadlock failure is a confirmed,
 * retryable rollback. A class-23 (or allowlisted) violation is a confirmed
 * non-retryable rollback. Everything else stays "unknown".
 */
export function classifyCommitFailure(error: unknown): CommitOutcome {
  const code = sqlState(error);
  if (code === undefined) return "unknown"; // transport/connection error
  if (code.startsWith("08")) return "unknown"; // connection exception, incl. 08007
  if (code === "40003") return "unknown"; // statement_completion_unknown
  if (RETRYABLE_ROLLBACK_CODES.has(code)) return "retryable-rollback";
  if (ROLLBACK_PROVEN_CODES.has(code)) return "rolled-back";
  // 40002/40003 handled above; other class-40 codes are retryable rollbacks.
  if (code.slice(0, 2) === "40") return "retryable-rollback";
  if (ROLLBACK_PROVEN_CLASSES.has(code.slice(0, 2))) return "rolled-back";
  return "unknown";
}

/**
 * Whether a query error is a transient, retryable database condition rather
 * than a terminal business failure. Used before converting an unexpected
 * business-callback error into a terminal receipt (ISSUE-014) and to map
 * read-path failures. Transport errors are retryable; a plain Error with no
 * code is an internal failure, not transient.
 */
export function isRetryableQueryError(error: unknown): boolean {
  if (isTransportError(error)) return true;
  const code = sqlState(error);
  if (code === undefined) return false; // a coded SQLSTATE handled below, else internal
  if (code.startsWith("08")) return true; // connection exception
  if (code === "55P03") return true; // lock_not_available (lock_timeout)
  if (code === "57014") return true; // query_canceled (statement_timeout)
  if (code === "40001" || code === "40P01" || code === "40003") return true; // serialization / deadlock / completion unknown
  if (code === "57P01" || code === "57P02" || code === "57P03") return true; // admin shutdown / crash / cannot connect now
  return false;
}
