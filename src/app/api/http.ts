// HTTP translation shared by the JSON route handlers. It extracts the request
// key, parses the body, invokes a service function, and maps results and typed
// errors to Response objects. No domain decisions live here.

import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  OutcomeUnknown,
  TerminalBusinessError,
  TransientFailure,
  type ApiErrorBody,
} from "../../contracts/errors.ts";
import { NormalizationError } from "../../contracts/normalize.ts";
import { DatasetMismatch } from "../../db/dataset.ts";
import { CommitRejected } from "../../db/transaction.ts";
import type { MutationResponse } from "../../trips/mutation.ts";
import { appPool } from "../../db/pool.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function errorResponse(
  status: number,
  body: ApiErrorBody,
  headers?: Record<string, string>,
): Response {
  return json(body, status, headers);
}

function invalidInput(message: string, fields?: Record<string, string>): Response {
  const body: ApiErrorBody = {
    error: { code: "INVALID_INPUT", message, requestId: randomUUID() },
  };
  if (fields) body.error.fields = fields;
  return errorResponse(400, body);
}

/** Read the request key header; a malformed or missing key is INVALID_INPUT. */
export function readRequestKey(request: Request): string | Response {
  const key = request.headers.get("idempotency-key");
  if (!key || !UUID_RE.test(key)) {
    return invalidInput("A valid Idempotency-Key header is required.");
  }
  return key;
}

/**
 * Parse a JSON body, enforcing the 16 KiB cap in BYTES while reading (ISSUE-017).
 * A declared Content-Length over the limit is rejected immediately; the body is
 * then streamed and aborted as soon as the accumulated byte count exceeds the
 * cap, so a large body is never fully buffered and multibyte content is counted
 * by its UTF-8 size, not its UTF-16 code-unit length.
 */
export async function readJsonBody(request: Request): Promise<unknown | Response> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    return invalidInput("Request body exceeds the 16 KiB limit.");
  }

  const body = request.body;
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (body) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel();
          return invalidInput("Request body exceeds the 16 KiB limit.");
        }
        chunks.push(value);
      }
    }
  } else {
    // Some runtimes expose only text(); fall back and count UTF-8 bytes.
    const text = await request.text();
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > MAX_BODY_BYTES) {
      return invalidInput("Request body exceeds the 16 KiB limit.");
    }
    return parseJson(text);
  }

  const text = new TextDecoder().decode(concat(chunks, total));
  return parseJson(text);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function parseJson(text: string): unknown | Response {
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return invalidInput("Request body is not valid JSON.");
  }
}

/**
 * Validate that a request carries no meaningful body (the preview contract is
 * `{}`). Enforces the 16 KiB byte cap, rejects malformed JSON, and rejects any
 * non-empty object. Returns a 400 Response on violation, otherwise undefined.
 */
export async function readEmptyBody(request: Request): Promise<Response | undefined> {
  // Read the raw bytes so an ABSENT body can be distinguished from whitespace
  // or any other content (ISSUE-025). Enforce the byte cap while reading.
  const body = request.body;
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (body) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel();
          return invalidInput("Request body exceeds the 16 KiB limit.");
        }
        chunks.push(value);
      }
    }
  } else {
    const text = await request.text();
    return classifyEmptyBodyText(text);
  }
  return classifyEmptyBodyText(new TextDecoder().decode(concat(chunks, total)));
}

/**
 * Accept ONLY a genuinely absent body (empty string) or a literal `{}`. A
 * whitespace-only body, a scalar (null/42/"x"), an array ([]), malformed JSON,
 * or a non-empty object are all rejected as invalid input.
 */
function classifyEmptyBodyText(text: string): Response | undefined {
  if (text === "") return undefined; // absent body
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalidInput("Request body is not valid JSON.");
  }
  const isEmptyObject =
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length === 0;
  if (!isEmptyObject) {
    return invalidInput("This endpoint accepts only an empty request body.");
  }
  return undefined;
}

/**
 * Translate a MutationResponse into a Response, including the replay header.
 */
export function respondMutation(result: MutationResponse): Response {
  const headers = result.replayed ? { "idempotency-replayed": "true" } : undefined;
  return json(result.body, result.httpStatus, headers);
}

/**
 * Run a service mutation and map all outcomes. The handler passes the request
 * key so an unknown-outcome response can name the exact pending key (ISSUE-013),
 * and a thunk so normalization and service errors are caught uniformly.
 */
export async function runMutation(
  requestKey: string,
  op: () => Promise<MutationResponse>,
): Promise<Response> {
  try {
    return respondMutation(await op());
  } catch (error) {
    return mapError(error, requestKey);
  }
}

/**
 * Run a non-keyed read/preview operation (no idempotency key, no operation
 * metadata). Maps a TerminalBusinessError to its status/code and transient and
 * unexpected failures like the mutation path.
 */
export async function runPreview(op: () => Promise<{ httpStatus: number; body: unknown }>): Promise<Response> {
  try {
    const result = await op();
    return json(result.body, result.httpStatus);
  } catch (error) {
    if (error instanceof TerminalBusinessError) {
      const body: ApiErrorBody = {
        error: { code: error.code, message: error.message, requestId: randomUUID() },
      };
      if (error.currentVersion !== undefined) body.error.currentVersion = error.currentVersion;
      if (error.fields) body.error.fields = error.fields;
      return errorResponse(error.httpStatus, body);
    }
    // No request key for a preview, so reuse the mutation mapper with an empty
    // key; it never produces operation metadata for these error types.
    return mapError(error, "");
  }
}

function mapError(error: unknown, requestKey: string): Response {
  if (error instanceof NormalizationError || error instanceof ZodError) {
    return invalidInput(
      error instanceof ZodError ? "Request failed validation." : error.message,
    );
  }
  if (error instanceof DatasetMismatch) {
    return errorResponse(503, {
      error: { code: "DATASET_MISMATCH", message: error.message, requestId: randomUUID() },
    });
  }
  if (error instanceof OutcomeUnknown) {
    // ISSUE-013: name the exact pending key so the browser retries the right
    // operation rather than discarding it.
    return errorResponse(503, {
      error: {
        code: "OUTCOME_UNKNOWN",
        message: "The operation outcome is unknown. Retry with the same key.",
        requestId: randomUUID(),
      },
      operation: { key: requestKey.toLowerCase(), outcome: "unknown" },
    });
  }
  if (error instanceof TransientFailure) {
    return errorResponse(503, {
      error: { code: error.code, message: error.message, requestId: randomUUID() },
    });
  }
  if (error instanceof CommitRejected) {
    // A receipt commit the server rejected: nothing applied, key not finalized.
    // Surface as an internal error; the client may retry the same key.
    return errorResponse(500, {
      error: {
        code: "INTERNAL_ERROR",
        message: "The database rejected the transaction. Retry with the same key.",
        requestId: randomUUID(),
      },
    });
  }
  // Unexpected business/invariant failure: outcome not finalized.
  return errorResponse(500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId: randomUUID(),
    },
  });
}

export { appPool };
