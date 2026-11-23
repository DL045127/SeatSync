// Database-free unit tests for HTTP translation: the byte-accurate body limit
// (ISSUE-017) and the conflict / unknown-outcome response shapes (ISSUE-013).
// Run via `npm run test:unit`.

import { describe, expect, it } from "vitest";
import { OutcomeUnknown } from "../../src/contracts/errors.ts";
import { readJsonBody, runMutation } from "../../src/app/api/http.ts";
import type { MutationResponse } from "../../src/trips/mutation.ts";

function post(body: string): Request {
  return new Request("http://127.0.0.1/api/trips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("readJsonBody byte limit (ISSUE-017)", () => {
  it("rejects a body whose UTF-8 size exceeds 16 KiB even when its code-unit length does not", () => {
    // 16,100 ASCII spaces + JSON with multibyte labels. The decoded string
    // length is under 16,384 but the byte size is over it.
    const multibyte = "界".repeat(80); // 3 bytes each in UTF-8
    const payload = " ".repeat(16_100) + JSON.stringify({
      name: multibyte,
      destinationLabel: multibyte,
      departAt: "2026-01-01T00:00:00Z",
    });
    expect(new TextEncoder().encode(payload).byteLength).toBeGreaterThan(16 * 1024);
    expect(payload.length).toBeLessThan(16 * 1024);
  });

  it("accepts a body at the byte limit and rejects one over it", async () => {
    const under = JSON.stringify({ pad: "a".repeat(16_000) });
    const okResult = await readJsonBody(post(under));
    expect(okResult).not.toBeInstanceOf(Response);

    const over = JSON.stringify({ pad: "a".repeat(17_000) });
    const overResult = await readJsonBody(post(over));
    expect(overResult).toBeInstanceOf(Response);
    expect((overResult as Response).status).toBe(400);
  });

  it("rejects a multibyte body over the byte limit that is under the code-unit count", async () => {
    const payload = " ".repeat(16_100) + JSON.stringify({
      name: "界".repeat(80),
      destinationLabel: "界".repeat(80),
      departAt: "2026-01-01T00:00:00Z",
    });
    const result = await readJsonBody(post(payload));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });
});

describe("mutation response shapes (ISSUE-013)", () => {
  it("passes through a key-reuse conflict without adding terminal metadata", async () => {
    const conflict: MutationResponse = {
      httpStatus: 409,
      body: {
        error: {
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "This idempotency key was used for a different request.",
          requestId: "req-1",
        },
      },
      replayed: false,
    };
    const response = await runMutation("11111111-1111-4111-8111-111111111111", async () => conflict);
    expect(response.status).toBe(409);
    const parsed = (await response.json()) as { operation?: unknown };
    expect(parsed.operation).toBeUndefined(); // no false not_applied signal
  });

  it("names the pending key on an unknown outcome", async () => {
    const key = "22222222-2222-4222-8222-222222222222";
    const response = await runMutation(key, async () => {
      throw new OutcomeUnknown(new Error("lost ack"));
    });
    expect(response.status).toBe(503);
    const parsed = (await response.json()) as {
      error: { code: string };
      operation: { key: string; outcome: string };
    };
    expect(parsed.error.code).toBe("OUTCOME_UNKNOWN");
    expect(parsed.operation).toEqual({ key, outcome: "unknown" });
  });
});
