// Fixed vectors for the shared normalizer, canonical serializer, and request
// fingerprint. Changing any observed value here is a deliberate compatibility
// change (it would reinterpret stored receipts), not an incidental edit.
// Runs under the database-free `test:matching` command.

import { describe, expect, it } from "vitest";
import {
  NormalizationError,
  canonicalJson,
  normalizeInteger,
  normalizeLabel,
  normalizeTimestamp,
  normalizeUuid,
} from "../../src/contracts/normalize.ts";
import {
  LIMITS,
  normalizeAddDriver,
  normalizeAddRequest,
  normalizeCommit,
  normalizeCreateTrip,
  normalizeEditDriver,
  normalizeWithdrawRequest,
  requestFingerprint,
} from "../../src/contracts/index.ts";

describe("UUID normalization", () => {
  it("lowercases a well-formed UUID", () => {
    expect(normalizeUuid("2F3A4B5C-6D7E-4F80-9A1B-2C3D4E5F6071")).toBe(
      "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6071",
    );
  });
  it("rejects a malformed UUID", () => {
    expect(() => normalizeUuid("not-a-uuid")).toThrow(NormalizationError);
  });
});

describe("label normalization", () => {
  it("applies NFC and trims surrounding whitespace", () => {
    // U+0065 U+0301 (e + combining acute) normalizes to U+00E9.
    expect(normalizeLabel("  cafe\u0301  ", 80)).toBe("caf\u00e9");
  });
  it("counts code points after trimming and NFC", () => {
    expect(() => normalizeLabel("a".repeat(81), 80)).toThrow(NormalizationError);
    expect(normalizeLabel("a".repeat(80), 80)).toHaveLength(80);
  });
  it("rejects an empty or whitespace-only label", () => {
    expect(() => normalizeLabel("   ", 80)).toThrow(NormalizationError);
  });
});

describe("timestamp normalization", () => {
  it("normalizes an offset timestamp to UTC ISO milliseconds", () => {
    expect(normalizeTimestamp("2026-03-01T09:30:00+02:00")).toBe(
      "2026-03-01T07:30:00.000Z",
    );
  });
  it("accepts a trailing Z", () => {
    expect(normalizeTimestamp("2026-03-01T07:30:00Z")).toBe(
      "2026-03-01T07:30:00.000Z",
    );
  });
  it("rejects a timestamp without an explicit offset", () => {
    expect(() => normalizeTimestamp("2026-03-01T07:30:00")).toThrow(NormalizationError);
  });
  it("rejects sub-millisecond precision", () => {
    expect(() => normalizeTimestamp("2026-03-01T07:30:00.1234Z")).toThrow(
      NormalizationError,
    );
  });
  it("rejects an impossible calendar date", () => {
    expect(() => normalizeTimestamp("2026-13-01T00:00:00Z")).toThrow(NormalizationError);
  });

  // ISSUE-008 regression: invalid days must reject, not silently roll over.
  it("rejects Feb 29 in a common year but accepts it in a leap year", () => {
    expect(() => normalizeTimestamp("2026-02-29T12:00:00Z")).toThrow(NormalizationError);
    expect(normalizeTimestamp("2024-02-29T12:00:00Z")).toBe("2024-02-29T12:00:00.000Z");
    // Century rule: 1900 is not a leap year, 2000 is.
    expect(() => normalizeTimestamp("1900-02-29T00:00:00Z")).toThrow(NormalizationError);
    expect(normalizeTimestamp("2000-02-29T00:00:00Z")).toBe("2000-02-29T00:00:00.000Z");
  });

  it("rejects month-end rollovers", () => {
    expect(() => normalizeTimestamp("2026-04-31T00:00:00Z")).toThrow(NormalizationError);
    expect(() => normalizeTimestamp("2026-06-31T00:00:00Z")).toThrow(NormalizationError);
    expect(normalizeTimestamp("2026-04-30T00:00:00Z")).toBe("2026-04-30T00:00:00.000Z");
    expect(normalizeTimestamp("2026-01-31T00:00:00Z")).toBe("2026-01-31T00:00:00.000Z");
  });

  it("rejects an English-language date even with a trailing Z", () => {
    expect(() => normalizeTimestamp("March 1, 2026 12:00:00Z")).toThrow(NormalizationError);
  });

  it("rejects out-of-range time-of-day and offset", () => {
    expect(() => normalizeTimestamp("2026-03-01T24:00:00Z")).toThrow(NormalizationError);
    expect(() => normalizeTimestamp("2026-03-01T12:60:00Z")).toThrow(NormalizationError);
    expect(() => normalizeTimestamp("2026-03-01T12:00:00+30:00")).toThrow(NormalizationError);
  });
});

describe("ISSUE-009 regression: mutation contract normalization", () => {
  // The schema is the single validation path, so out-of-bound values are
  // rejected as ZodErrors before reaching the canonicalizing helpers.
  it("rejects a negative version and a fractional capacity in a driver edit", () => {
    expect(() => normalizeEditDriver({ baseVersion: -1, seatCapacity: 2 })).toThrow();
    expect(() => normalizeEditDriver({ baseVersion: 0, seatCapacity: 9.5 })).toThrow();
    expect(() => normalizeEditDriver({ baseVersion: 0, seatCapacity: 9 })).toThrow();
  });

  it("accepts a valid capacity edit and a valid cancel", () => {
    expect(normalizeEditDriver({ baseVersion: 3, seatCapacity: 4 })).toEqual({
      baseVersion: 3,
      seatCapacity: 4,
    });
    expect(normalizeEditDriver({ baseVersion: 3, active: false })).toEqual({
      baseVersion: 3,
      active: false,
    });
  });

  it("aligns the version maximum with PostgreSQL signed integer", () => {
    expect(LIMITS.versionMax).toBe(2 ** 31 - 1);
    expect(normalizeEditDriver({ baseVersion: LIMITS.versionMax, active: false })).toEqual({
      baseVersion: 2 ** 31 - 1,
      active: false,
    });
    expect(() => normalizeEditDriver({ baseVersion: 2 ** 31, active: false })).toThrow();
  });

  it("rejects a fractional version in a withdrawal", () => {
    expect(() => normalizeWithdrawRequest({ baseVersion: 0.5, active: false })).toThrow();
    expect(normalizeWithdrawRequest({ baseVersion: 2, active: false })).toEqual({
      baseVersion: 2,
      active: false,
    });
  });

  it("rejects a malformed commit preview ID", () => {
    expect(() => normalizeCommit({ previewId: "junk" })).toThrow();
  });

  it("lowercases the preview ID so case variants share one fingerprint", () => {
    const upper = normalizeCommit({
      previewId: "2F3A4B5C-6D7E-4F80-9A1B-2C3D4E5F6071",
    });
    const lower = normalizeCommit({
      previewId: "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6071",
    });
    expect(upper).toEqual(lower);
    const route = "/api/trips/abc/match/commit";
    expect(requestFingerprint("POST", route, upper)).toBe(
      requestFingerprint("POST", route, lower),
    );
  });

  it("still rejects unknown fields in mutation bodies", () => {
    expect(() =>
      normalizeEditDriver({ baseVersion: 0, active: false, extra: 1 }),
    ).toThrow();
    expect(() =>
      normalizeCommit({ previewId: "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6071", x: 1 }),
    ).toThrow();
  });

  it("canonicalizes -0 to 0 in a capacity edit", () => {
    const edit = normalizeEditDriver({ baseVersion: -0, seatCapacity: -0 });
    expect(Object.is((edit as { seatCapacity: number }).seatCapacity, 0)).toBe(true);
    expect(Object.is(edit.baseVersion, 0)).toBe(true);
  });
});

describe("ISSUE-009 single validation path", () => {
  const zones = new Set(["north", "east", "south", "west"]);

  // The shape-only schemas are not exported; the normalizers are the only
  // route-facing path. These were the three cases the raw schemas accepted but
  // the helpers rejected, so a route using a helper cannot skip the fix.
  it("normalizers reject what the shape schemas alone would not catch", () => {
    expect(() =>
      normalizeCreateTrip({ name: "n", destinationLabel: "d", departAt: "bad" }),
    ).toThrow();
    expect(() =>
      normalizeAddDriver({ name: "n", zoneId: "nowhere", seatCapacity: 2 }, zones),
    ).toThrow();
    expect(() =>
      normalizeAddRequest({ name: "   ", zoneId: "north" }, zones),
    ).toThrow();
  });

  it("does not export the shape-only schemas", async () => {
    const contracts = await import("../../src/contracts/index.ts");
    for (const name of [
      "createTripSchema",
      "addDriverSchema",
      "addRequestSchema",
      "editDriverSchema",
      "withdrawRequestSchema",
      "commitSchema",
    ]) {
      expect(name in contracts).toBe(false);
    }
  });

  it("the public path yields a self-consistent fingerprint for a valid body", () => {
    // Re-normalizing a normalized body is a no-op, so a client built from the
    // shared contract and the server produce one fingerprint for the mutation.
    const body = normalizeCreateTrip({
      name: "Spring Social",
      destinationLabel: "Student Union",
      departAt: "2026-03-01T09:30:00+02:00",
    });
    const first = requestFingerprint("POST", "/api/trips", body);
    const second = requestFingerprint("POST", "/api/trips", normalizeCreateTrip(body));
    expect(first).toBe(second);
  });
});

describe("ISSUE-012 regression: timestamp normalization is idempotent", () => {
  const accepted = [
    "0000-01-01T00:00:00Z",
    "9999-12-31T23:59:59.999Z",
    "2026-03-01T09:30:00+02:00",
    "2026-11-22T09:30Z", // minute precision: seconds are optional
    "2026-07-04T12:00:00.5-05:00",
  ];

  it("re-normalizing any accepted value returns the same string", () => {
    for (const value of accepted) {
      const once = normalizeTimestamp(value);
      expect(normalizeTimestamp(once)).toBe(once);
    }
  });

  it("the whole create-trip body survives a second normalization", () => {
    const body = normalizeCreateTrip({
      name: "Spring Social",
      destinationLabel: "Student Union",
      departAt: "2026-03-01T09:30:00+02:00",
    });
    expect(normalizeCreateTrip(body)).toEqual(body);
  });

  it("rejects an input whose UTC conversion exceeds a four-digit year", () => {
    // 9999-12-31T23:30:00-01:00 would be +010000-01-01T00:30:00.000Z.
    expect(() => normalizeTimestamp("9999-12-31T23:30:00-01:00")).toThrow(
      NormalizationError,
    );
  });

  it("accepts minute-precision timestamps without a seconds field", () => {
    expect(normalizeTimestamp("2026-11-22T09:30Z")).toBe("2026-11-22T09:30:00.000Z");
  });
});

describe("integer normalization", () => {
  it("maps -0 to 0 and enforces inclusive bounds", () => {
    expect(Object.is(normalizeInteger(-0, 0, 8), 0)).toBe(true);
    expect(normalizeInteger(8, 0, 8)).toBe(8);
    expect(() => normalizeInteger(9, 0, 8)).toThrow(NormalizationError);
    expect(() => normalizeInteger(1.5, 0, 8)).toThrow(NormalizationError);
    expect(() => normalizeInteger(Number.NaN, 0, 8)).toThrow(NormalizationError);
  });
});

describe("canonical JSON", () => {
  it("sorts object keys lexicographically and preserves array order", () => {
    expect(canonicalJson({ b: 1, a: [3, 1, 2], c: { z: 1, y: 2 } })).toBe(
      '{"a":[3,1,2],"b":1,"c":{"y":2,"z":1}}',
    );
  });
  it("serializes -0 as 0", () => {
    expect(canonicalJson(-0)).toBe("0");
  });
  it("rejects a nonfinite number", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(NormalizationError);
  });
});

describe("request fingerprint", () => {
  const zones = new Set(["north", "east", "south", "west"]);

  it("is a stable SHA-256 hex vector", () => {
    // Normalization collapses the +02:00 offset to the UTC instant below, so
    // the fingerprint is pinned to this exact hex. Regenerating it requires a
    // deliberate compatibility decision.
    const body = normalizeCreateTrip({
      name: "Spring Social",
      destinationLabel: "Student Union",
      departAt: "2026-03-01T09:30:00+02:00",
    });
    expect(body.departAt).toBe("2026-03-01T07:30:00.000Z");
    expect(requestFingerprint("POST", "/api/trips", body)).toBe(
      "3d70b8bc140aea1fcf72abcfaf4b3788f339dc86289825ef2a026caff37d8885",
    );
  });

  it("is insensitive to key order in the raw body", () => {
    const a = normalizeAddDriver(
      { name: "Alex", zoneId: "north", seatCapacity: 3 },
      zones,
    );
    const b = normalizeAddDriver(
      { seatCapacity: 3, zoneId: "north", name: "Alex" },
      zones,
    );
    expect(requestFingerprint("POST", "/api/trips/x/drivers", a)).toBe(
      requestFingerprint("POST", "/api/trips/x/drivers", b),
    );
  });

  it("changes when the method or route changes", () => {
    const body = normalizeAddDriver(
      { name: "Alex", zoneId: "north", seatCapacity: 3 },
      zones,
    );
    const post = requestFingerprint("POST", "/api/trips/x/drivers", body);
    const patch = requestFingerprint("PATCH", "/api/trips/x/drivers", body);
    const other = requestFingerprint("POST", "/api/trips/y/drivers", body);
    expect(post).not.toBe(patch);
    expect(post).not.toBe(other);
  });
});

