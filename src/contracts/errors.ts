// API error codes and outcome shapes shared by services and route handlers.
// See docs/ARCHITECTURE.md section 5 "API contract". No SQL or credentials.

export type ErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "STALE_VERSION"
  | "IDEMPOTENCY_KEY_REUSED"
  | "ALGORITHM_CHANGED"
  | "ROSTER_LIMIT"
  | "RESOURCE_INACTIVE"
  | "DATABASE_BUSY"
  | "DATABASE_UNAVAILABLE"
  | "OUTCOME_UNKNOWN"
  | "DATASET_MISMATCH"
  // Address trips (docs/ARCHITECTURE-v2.md sections 3 and 6).
  | "LOCATION_SELECTION_INVALID"
  | "LOCATION_MODE_MISMATCH"
  | "SELECTION_KEY_UNAVAILABLE"
  | "ADDRESS_PROVIDER_UNAVAILABLE"
  | "PREVIEW_BUSY"
  | "ROUTING_QUOTA"
  | "ROUTING_UNAVAILABLE"
  | "RECOVERY_VERSION_CHANGED"
  | "WORKSPACE_CHANGED"
  | "WORKSPACE_REQUIRED"
  | "CROSS_SITE_REQUEST"
  | "INTERNAL_ERROR";

/** The committed outcome of a keyed mutation, as reported to the client. */
export type Outcome = "applied" | "not_applied" | "unknown";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    currentVersion?: number;
    fields?: Record<string, string>;
  };
  operation?: { key: string; outcome: Exclude<Outcome, "applied"> };
}

/**
 * A terminal business failure: the server decided the operation cannot apply
 * and will persist a `not_applied` receipt. Carries the HTTP status and error
 * body to store and replay. Only raise this inside the business savepoint for
 * conditions that must never later succeed under the same key.
 */
export class TerminalBusinessError extends Error {
  readonly httpStatus: number;
  readonly code: ErrorCode;
  readonly currentVersion: number | undefined;
  readonly fields: Record<string, string> | undefined;
  constructor(
    httpStatus: number,
    code: ErrorCode,
    message: string,
    options: {
      currentVersion?: number;
      fields?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "TerminalBusinessError";
    this.httpStatus = httpStatus;
    this.code = code;
    this.currentVersion = options.currentVersion;
    this.fields = options.fields;
  }
}

/**
 * Data this server stored earlier cannot be trusted: a corrupt or hand-edited
 * row, a summary that contradicts itself, a result naming someone outside the
 * trip. It is a SERVER-side failure (HTTP 500) and never a verdict on the
 * request, so it must not be a ZodError (which the HTTP layer reports as a 400).
 */
export class StoredDataError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StoredDataError";
  }
}

/**
 * A transient failure (timeout, lock wait, database unavailable). It does NOT
 * finalize the request key: no terminal receipt is written and a same-key retry
 * may still execute. Mapped to a 503 whose outcome metadata is omitted or
 * `unknown` as appropriate.
 */
export class TransientFailure extends Error {
  readonly code: Extract<
    ErrorCode,
    | "WORKSPACE_CHANGED"
    | "WORKSPACE_REQUIRED"
    | "DATABASE_BUSY"
    | "DATABASE_UNAVAILABLE"
    | "SELECTION_KEY_UNAVAILABLE"
    | "ADDRESS_PROVIDER_UNAVAILABLE"
    | "ROUTING_QUOTA"
    | "ROUTING_UNAVAILABLE"
  >;
  readonly retryAfterSeconds?: number;
  constructor(code: TransientFailure["code"], message: string, cause?: unknown, retryAfterSeconds?: number) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TransientFailure";
    this.retryAfterSeconds = retryAfterSeconds;
    this.code = code;
  }
}

/**
 * The commit acknowledgement was lost; the logical outcome is unknown and the
 * key is not finalized. Resolve by same-key replay on a fresh connection.
 */
export class OutcomeUnknown extends Error {
  constructor(cause?: unknown) {
    super(
      "The operation outcome is unknown; retry with the same key.",
      cause === undefined ? undefined : { cause },
    );
    this.name = "OutcomeUnknown";
  }
}
