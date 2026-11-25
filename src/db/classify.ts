// One classification of failures from an UNKEYED database operation (preview
// publication, address search). A keyed mutation has its own classifier because
// it must also decide receipts; this one is for operations that have no
// request key, where a transient database condition must be a retryable 503
// and never a generic 500 (ISSUE-059).

import { TerminalBusinessError, TransientFailure } from "../contracts/errors.ts";
import { isRetryableQueryError, isTransportError } from "./commit-outcome.ts";
import { DatasetMismatch } from "./dataset.ts";
import { CommitOutcomeUnknown, CommitRetryable } from "./transaction.ts";

/**
 * Transient database conditions (lock or statement timeout, serialization,
 * connection loss, a retryable or unknown commit) become a retryable
 * TransientFailure. A dataset mismatch, a terminal business error and an
 * already-typed TransientFailure pass through unchanged, as does anything else
 * (a genuine defect stays an internal error).
 */
export function classifyUnkeyedFailure(error: unknown): unknown {
  if (error instanceof TerminalBusinessError) return error;
  if (error instanceof DatasetMismatch) return error;
  if (error instanceof TransientFailure) return error;
  if (error instanceof CommitRetryable) {
    return new TransientFailure("DATABASE_BUSY", "A serialization conflict occurred; retry.", error);
  }
  if (error instanceof CommitOutcomeUnknown) {
    return new TransientFailure("DATABASE_UNAVAILABLE", "The database is unavailable; retry.", error);
  }
  if (isTransportError(error) || isRetryableQueryError(error)) {
    return new TransientFailure("DATABASE_BUSY", "The database is busy; retry.", error);
  }
  return error;
}
