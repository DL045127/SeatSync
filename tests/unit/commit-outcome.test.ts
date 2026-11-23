// Database-free unit tests for the conservative COMMIT-outcome classifier
// (ISSUE-006). These do not need PostgreSQL; run via `npm run test:unit`.

import { describe, expect, it } from "vitest";
import {
  classifyCommitFailure,
  isRetryableQueryError,
  isTransportError,
  sqlState,
} from "../../src/db/commit-outcome.ts";

function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error(`pg ${code}`), { code });
}

describe("classifyCommitFailure", () => {
  it("treats a transport error with no SQLSTATE as unknown", () => {
    expect(classifyCommitFailure(Object.assign(new Error("EPIPE"), { code: "EPIPE" }))).toBe("unknown");
    expect(classifyCommitFailure(new Error("socket hang up"))).toBe("unknown");
  });

  it("treats connection-exception class 08 (incl. 08007) as unknown", () => {
    expect(classifyCommitFailure(pgError("08007"))).toBe("unknown");
    expect(classifyCommitFailure(pgError("08006"))).toBe("unknown");
    expect(classifyCommitFailure(pgError("08003"))).toBe("unknown");
  });

  it("treats an integrity-constraint violation (class 23) as a proven rollback", () => {
    expect(classifyCommitFailure(pgError("23503"))).toBe("rolled-back"); // FK
    expect(classifyCommitFailure(pgError("23505"))).toBe("rolled-back"); // unique
    expect(classifyCommitFailure(pgError("23514"))).toBe("rolled-back"); // check
  });

  it("treats a server-confirmed serialization/deadlock failure as a retryable rollback (ISSUE-006)", () => {
    expect(classifyCommitFailure(pgError("40001"))).toBe("retryable-rollback"); // serialization
    expect(classifyCommitFailure(pgError("40P01"))).toBe("retryable-rollback"); // deadlock
  });

  it("leaves unrelated server codes unknown rather than assuming rollback", () => {
    // An admin shutdown is not proof of this transaction's rollback at commit.
    expect(classifyCommitFailure(pgError("57P01"))).toBe("unknown");
    expect(classifyCommitFailure(pgError("XX000"))).toBe("unknown");
  });

  it("sqlState requires two leading digits, so Node errnos are not mistaken for SQLSTATEs (ISSUE-014/016)", () => {
    expect(sqlState(pgError("23505"))).toBe("23505");
    expect(sqlState(pgError("55P03"))).toBe("55P03");
    // EPIPE / EPERM are five uppercase chars but are NOT SQLSTATEs.
    expect(sqlState(Object.assign(new Error(), { code: "EPIPE" }))).toBeUndefined();
    expect(sqlState(Object.assign(new Error(), { code: "EPERM" }))).toBeUndefined();
    expect(sqlState(Object.assign(new Error(), { code: "ECONNRESET" }))).toBeUndefined();
    expect(sqlState(new Error("no code"))).toBeUndefined();
  });

  it("treats 40003 (statement_completion_unknown) at COMMIT as unknown", () => {
    expect(classifyCommitFailure(pgError("40003"))).toBe("unknown");
  });
});

describe("isTransportError", () => {
  it("recognizes Node transport errnos and pool-acquisition timeouts", () => {
    expect(isTransportError(Object.assign(new Error(), { code: "EPIPE" }))).toBe(true);
    expect(isTransportError(Object.assign(new Error(), { code: "EPERM" }))).toBe(true);
    expect(isTransportError(Object.assign(new Error(), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isTransportError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    // A real SQLSTATE is not a transport error.
    expect(isTransportError(pgError("55P03"))).toBe(false);
    expect(isTransportError(new Error("plain invariant"))).toBe(false);
  });
});

describe("isRetryableQueryError (ISSUE-014)", () => {
  it("treats lock/statement/serialization and connection errors as retryable", () => {
    expect(isRetryableQueryError(pgError("55P03"))).toBe(true); // lock_timeout
    expect(isRetryableQueryError(pgError("57014"))).toBe(true); // statement cancel
    expect(isRetryableQueryError(pgError("40001"))).toBe(true); // serialization
    expect(isRetryableQueryError(pgError("40P01"))).toBe(true); // deadlock
    expect(isRetryableQueryError(pgError("08006"))).toBe(true); // connection exception
    expect(isRetryableQueryError(Object.assign(new Error(), { code: "ECONNRESET" }))).toBe(true);
  });

  it("does NOT treat a plain invariant error or a constraint violation as retryable", () => {
    // An ordinary invariant failure must still terminalize; a constraint
    // violation is a definite rejection, not a transient condition.
    expect(isRetryableQueryError(new Error("invariant"))).toBe(false);
    expect(isRetryableQueryError(pgError("23505"))).toBe(false);
  });
});
