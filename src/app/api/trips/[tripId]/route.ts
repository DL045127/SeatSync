import { randomUUID } from "node:crypto";
import { appPool } from "../../http.ts";
import { TransientFailure } from "../../../../contracts/errors.ts";
import { NormalizationError } from "../../../../contracts/normalize.ts";
import { DatasetMismatch } from "../../../../db/dataset.ts";
import { isRetryableQueryError } from "../../../../db/commit-outcome.ts";
import {
  CommitOutcomeUnknown,
  CommitRetryable,
} from "../../../../db/transaction.ts";
import { getTripSnapshot } from "../../../../trips/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> },
): Promise<Response> {
  const { tripId } = await params;
  try {
    const snapshot = await getTripSnapshot(appPool(), tripId);
    if (!snapshot) {
      return json(
        { error: { code: "NOT_FOUND", message: "Trip not found.", requestId: randomUUID() } },
        404,
      );
    }
    return json(snapshot, 200);
  } catch (error) {
    if (error instanceof NormalizationError) {
      return json(
        { error: { code: "INVALID_INPUT", message: error.message, requestId: randomUUID() } },
        400,
      );
    }
    if (error instanceof DatasetMismatch) {
      return json(
        { error: { code: "DATASET_MISMATCH", message: error.message, requestId: randomUUID() } },
        503,
      );
    }
    // ISSUE-016: a refused/dropped connection or a timeout during the read is a
    // retryable database condition, not an internal error.
    if (isTransientDbError(error)) {
      return json(
        {
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "The database is unavailable. Retry shortly.",
            requestId: randomUUID(),
          },
        },
        503,
      );
    }
    return json(
      { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", requestId: randomUUID() } },
      500,
    );
  }
}

/**
 * A read-path failure is transient when it is a transport/connection error
 * (including a refused or timed-out pool acquisition), a retryable SQLSTATE, or
 * a typed commit-outcome signal from `withTransaction`. ISSUE-016: a read whose
 * COMMIT acknowledgement is lost surfaces as `CommitOutcomeUnknown`, which has
 * no SQLSTATE or errno; for a READ-ONLY transaction there is nothing to commit,
 * so this is a retryable 503, never a 500. `TransientFailure` (e.g. a refused
 * pool acquisition the mutation path wraps) is likewise retryable.
 */
function isTransientDbError(error: unknown): boolean {
  if (
    error instanceof CommitOutcomeUnknown ||
    error instanceof CommitRetryable ||
    error instanceof TransientFailure
  ) {
    return true;
  }
  return isRetryableQueryError(error);
}
