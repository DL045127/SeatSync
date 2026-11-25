// Database-free checks of the signed selection token (L-04 protocol): framing,
// canonical encoding, tag length, MAC-before-parse, header coverage, scope,
// expiry boundaries and the advisory failure counters.

import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test } from "vitest";
import {
  TOKEN_LIFETIME_MS,
  TOKEN_MAX_BYTES,
  assembleToken,
  keyIdentifier,
  resetSelectionCounters,
  selectionCounters,
  signSegments,
  signSelection,
  verifySelection,
  type SelectionKeyContext,
} from "../../src/locations/selection-token.ts";
import type { SnapshotBody } from "../../src/locations/snapshot.ts";

const master = randomBytes(32);
const generation = randomUUID();
const context: SelectionKeyContext = { master, generation };
const NOW = 1_800_000_000_000;
const TRIP = randomUUID();

const body: SnapshotBody = {
  providerRef: "fx-alpha",
  countryCode: "US",
  label: "GROUPRIDE FIXTURE — Pickup Alpha",
  address: { street: "11 Alpha Court", city: "Fixtureville", state: "TX", postcode: "00001" },
  lon: -97.03,
  lat: 30.02,
  precision: "building",
  attribution: "GroupRide fixture data (fictional places and times)",
};

function sign(overrides: Partial<Parameters<typeof signSelection>[0]> = {}): string {
  return signSelection({
    context,
    purpose: "pickup",
    tripId: TRIP,
    provider: "fixture",
    id: randomUUID(),
    snapshot: body,
    nowMs: NOW,
    ...overrides,
  });
}

const pickup = { purpose: "pickup", tripId: TRIP, provider: "fixture" } as const;
const header = () => ({ v: 1, kid: keyIdentifier(master), gen: generation });
const payload = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  iat: NOW,
  exp: NOW + TOKEN_LIFETIME_MS,
  purpose: "pickup",
  tripId: TRIP,
  provider: "fixture",
  snapshot: body,
  ...overrides,
});
const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");

beforeEach(resetSelectionCounters);

describe("signing and verification", () => {
  test("a fresh token verifies and returns its allowlisted payload", () => {
    const id = randomUUID();
    const result = verifySelection(sign({ id }), context, NOW + 1, pickup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.id).toBe(id);
      expect(result.payload.snapshot.label).toBe(body.label);
      expect(result.payload.exp - result.payload.iat).toBe(TOKEN_LIFETIME_MS);
    }
  });

  test("the token is three canonical unpadded base64url segments within 4 KiB", () => {
    const token = sign();
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(parts[2], "base64url")).toHaveLength(32);
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(TOKEN_MAX_BYTES);
  });

  test("a payload the verifier would reject is refused at issuance, not offered", () => {
    expect(() => sign({ snapshot: { ...body, label: "x".repeat(121) } })).toThrow();
  });
});

describe("rejection reasons for client-supplied bytes (a returned reason, never a throw)", () => {
  const token = sign();
  const [h, p, t] = token.split(".");

  test.each([
    ["not a string", 42, ["type"]],
    ["empty", "", ["framing"]],
    ["two segments", `${h}.${p}`, ["framing"]],
    ["four segments", `${h}.${p}.${t}.x`, ["framing"]],
    ["empty header", `.${p}.${t}`, ["framing"]],
    ["padded base64", `${h}=.${p}.${t}`, ["framing"]],
    ["regular base64 character", `${h}+.${p}.${t}`, ["framing"]],
    ["short tag", `${h}.${p}.${t.slice(0, 20)}`, ["tag"]],
    ["long tag", `${h}.${p}.${t}AAAA`, ["tag"]],
    ["wrong MAC", `${h}.${p}.${Buffer.alloc(32, 1).toString("base64url")}`, ["mac"]],
    ["oversize", `${h}.${p}.${t}`.padEnd(TOKEN_MAX_BYTES + 1, "A"), ["oversize"]],
  ])("%s", (_name, input, reasons) => {
    const result = verifySelection(input, context, NOW + 1, pickup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(reasons).toContain(result.reason);
  });

  test("tampering with the header or payload breaks the MAC", () => {
    const flip = (segment: string) => {
      const bytes = Buffer.from(segment, "base64url");
      bytes[bytes.length - 2] ^= 1;
      return bytes.toString("base64url");
    };
    for (const tampered of [`${flip(h)}.${p}.${t}`, `${h}.${flip(p)}.${t}`]) {
      expect(verifySelection(tampered, context, NOW + 1, pickup)).toEqual({ ok: false, reason: "mac" });
    }
  });

  test("a validly signed envelope that is not JSON is rejected without a parser exception", () => {
    const notJson = signSegments(context, encode("{not json"), encode(JSON.stringify(payload())));
    expect(verifySelection(notJson, context, NOW + 1, pickup)).toEqual({ ok: false, reason: "decode" });
    const payloadNotJson = signSegments(context, encode(JSON.stringify(header())), encode("\u0000\u0001 garbage"));
    expect(verifySelection(payloadNotJson, context, NOW + 1, pickup)).toEqual({ ok: false, reason: "decode" });
  });

  test("a validly signed envelope with bad contents is a specific generic rejection", () => {
    const cases: Array<[string, unknown, unknown, string]> = [
      ["unsupported version", { ...header(), v: 2 }, payload(), "version"],
      ["header with an extra field", { ...header(), extra: 1 }, payload(), "schema"],
      ["payload missing its snapshot", header(), Object.fromEntries(Object.entries(payload()).filter(([k]) => k !== "snapshot")), "schema"],
      ["payload with an unknown field", header(), payload({ surprise: true }), "schema"],
      ["snapshot with a non-US-style country", header(), payload({ snapshot: { ...body, countryCode: "us" } }), "schema"],
      ["snapshot with a city-level precision", header(), payload({ snapshot: { ...body, precision: "city" } }), "schema"],
      ["wrong key identifier", { ...header(), kid: "AAAAAAAAAAAAAAAAAAAAAA" }, payload(), "key"],
      ["wrong generation in the header", { ...header(), gen: randomUUID() }, payload(), "generation"],
      ["lifetime over 30 minutes", header(), payload({ exp: NOW + TOKEN_LIFETIME_MS + 1 }), "lifetime"],
      ["expiry before issue", header(), payload({ exp: NOW - 1 }), "lifetime"],
    ];
    for (const [name, h2, p2, reason] of cases) {
      const result = verifySelection(assembleToken(context, h2, p2), context, NOW + 1, pickup);
      expect(result, name).toEqual({ ok: false, reason });
    }
  });
});

describe("lifetime, scope and provider", () => {
  const token = sign();

  test("valid from issue until expiry (exclusive)", () => {
    const exp = NOW + TOKEN_LIFETIME_MS;
    expect(verifySelection(token, context, NOW - 1, pickup)).toEqual({ ok: false, reason: "not_yet_valid" });
    expect(verifySelection(token, context, NOW, pickup).ok).toBe(true);
    expect(verifySelection(token, context, exp - 1, pickup).ok).toBe(true);
    expect(verifySelection(token, context, exp, pickup)).toEqual({ ok: false, reason: "expired" });
    expect(verifySelection(token, context, exp + 1, pickup)).toEqual({ ok: false, reason: "expired" });
  });

  test("purpose, trip scope and provider must match", () => {
    expect(verifySelection(token, context, NOW + 1, { ...pickup, purpose: "driver_start" }))
      .toEqual({ ok: false, reason: "purpose" });
    expect(verifySelection(token, context, NOW + 1, { ...pickup, tripId: randomUUID() }))
      .toEqual({ ok: false, reason: "scope" });
    expect(verifySelection(token, context, NOW + 1, { ...pickup, tripId: null }))
      .toEqual({ ok: false, reason: "scope" });
    expect(verifySelection(token, context, NOW + 1, { ...pickup, provider: "geoapify" }))
      .toEqual({ ok: false, reason: "provider" });
  });

  test("a venue token has null trip scope and cannot serve as a pickup", () => {
    const venue = sign({ purpose: "venue", tripId: null });
    expect(verifySelection(venue, context, NOW + 1, { purpose: "venue", tripId: null }).ok).toBe(true);
    expect(verifySelection(venue, context, NOW + 1, pickup)).toEqual({ ok: false, reason: "purpose" });
  });

  test("the same token is reusable by independent callers until expiry", () => {
    for (let i = 0; i < 3; i += 1) expect(verifySelection(token, context, NOW + 5, pickup).ok).toBe(true);
  });
});

describe("a different generation or secret is just a failed MAC, with advisory counters", () => {
  const token = sign();

  test("another generation fails the MAC and counts as a claimed generation mismatch", () => {
    const later: SelectionKeyContext = { master, generation: randomUUID() };
    expect(verifySelection(token, later, NOW + 1, pickup)).toEqual({ ok: false, reason: "mac" });
    expect(selectionCounters.mac_failure_claimed_generation_mismatch).toBe(1);
    expect(selectionCounters.mac_failure_claimed_key_mismatch).toBe(0);
  });

  test("another master secret fails the MAC and counts as a claimed key mismatch", () => {
    const other: SelectionKeyContext = { master: randomBytes(32), generation };
    expect(verifySelection(token, other, NOW + 1, pickup)).toEqual({ ok: false, reason: "mac" });
    expect(selectionCounters.mac_failure_claimed_key_mismatch).toBe(1);
  });

  test("the hints are advisory: a forged header cannot select a key or change the outcome", () => {
    const [, p, t] = token.split(".");
    const forged = `${encode(JSON.stringify({ v: 1, kid: "x", gen: "y" }))}.${p}.${t}`;
    expect(verifySelection(forged, context, NOW + 1, pickup)).toEqual({ ok: false, reason: "mac" });
    // The same public result as any other bad MAC; only a counter differs.
    expect(verifySelection(`${encode("junk")}.${p}.${t}`, context, NOW + 1, pickup)).toEqual({ ok: false, reason: "mac" });
    expect(selectionCounters.mac_failure_other).toBe(1);
  });

  test("an unparseable header never throws while labelling a failure", () => {
    const [, p, t] = token.split(".");
    expect(() => verifySelection(`${"A".repeat(600)}.${p}.${t}`, context, NOW + 1, pickup)).not.toThrow();
  });
});

describe("each database has its own key context", () => {
  test("resetting the TEST database (a new generation) leaves a DEMO token valid and kills the test token", () => {
    const demo: SelectionKeyContext = { master: randomBytes(32), generation: randomUUID() };
    const testBefore: SelectionKeyContext = { master: randomBytes(32), generation: randomUUID() };
    const demoToken = signSelection({ context: demo, purpose: "pickup", tripId: TRIP, provider: "fixture", id: randomUUID(), snapshot: body, nowMs: NOW });
    const testToken = signSelection({ context: testBefore, purpose: "pickup", tripId: TRIP, provider: "fixture", id: randomUUID(), snapshot: body, nowMs: NOW });
    // A committed reset of the test database replaces ONLY its generation. The master secret file is untouched.
    const testAfter: SelectionKeyContext = { master: testBefore.master, generation: randomUUID() };
    expect(verifySelection(testToken, testBefore, NOW + 1, pickup).ok).toBe(true);
    expect(verifySelection(testToken, testAfter, NOW + 1, pickup)).toEqual({ ok: false, reason: "mac" });
    expect(verifySelection(demoToken, demo, NOW + 1, pickup).ok).toBe(true);
    // And the two targets can never accept each other's tokens.
    expect(verifySelection(demoToken, testAfter, NOW + 1, pickup).ok).toBe(false);
  });
});
