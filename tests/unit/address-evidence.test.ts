// L-11 at the unit level: what the commit-time validator (validateEvidence) and the stricter
// reuse validator (validateCandidate) accept and reject. A rejection of a reuse candidate means
// the WHOLE candidate is discarded and the cold path runs, so it must be conservative.

import { describe, expect, test } from "vitest";
import {
  AddressEvidenceError,
  type AddressPoint,
  type AddressRoster,
  type Leg,
  legKey,
  requiredPairs,
  retentionPairs,
  resolveIdentical,
} from "../../src/matching/address.ts";
import { buildEvidence, validateCandidate, validateEvidence } from "../../src/trips/address-evidence.ts";

const POLICY = "policy/1";
const OBSERVED = "2026-11-24T12:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number, lon = n, lat = n * 2): AddressPoint => ({ id: uuid(100 + n), providerRef: `ref-${n}`, lon, lat });

const V = at(1);
const S1 = at(2);
const S2 = at(3);
const Q1 = at(4);
const Q2 = at(5);

/** X1 offers a seat; X2 offers none (dormant); two active passengers. */
function roster(overrides: Partial<AddressRoster> = {}): AddressRoster {
  return {
    venue: V,
    drivers: [
      { id: uuid(11), seatCapacity: 1, active: true, maxDetourMinutes: 30, location: S1 },
      { id: uuid(12), seatCapacity: 0, active: true, maxDetourMinutes: 30, location: S2 },
    ],
    passengers: [
      { id: uuid(21), active: true, location: Q1 },
      { id: uuid(22), active: true, location: Q2 },
    ],
    ...overrides,
  };
}

/** Every retained leg of a roster, observed. */
function retained(r: AddressRoster, seconds = (a: AddressPoint, b: AddressPoint) => 100 + a.lon * 10 + b.lon): Map<string, Leg> {
  const legs = new Map<string, Leg>();
  for (const pair of retentionPairs(r)) {
    legs.set(legKey(pair.from.id, pair.to.id), resolveIdentical(pair) ?? {
      from: pair.from.id, to: pair.to.id, seconds: seconds(pair.from, pair.to), source: "provider", observedAt: OBSERVED,
    });
  }
  return legs;
}

const stored = (r: AddressRoster) => JSON.parse(JSON.stringify(buildEvidence(r, POLICY, retained(r)))) as ReturnType<typeof buildEvidence>;
type Evidence = ReturnType<typeof stored>;
const mutate = (r: AddressRoster, change: (e: Evidence) => void) => {
  const e = stored(r);
  change(e);
  return e;
};

describe("validateEvidence (commit time: the evidence must match the CURRENT roster)", () => {
  const r = roster();

  test("accepts the retained legs, including a dormant driver's, and returns them all", () => {
    const legs = validateEvidence(stored(r), r, POLICY);
    expect(legs.size).toBe(retentionPairs(r).length);
    expect(requiredPairs(r).every((p) => legs.has(legKey(p.from.id, p.to.id)))).toBe(true);
    // The dormant driver's legs ARE stored (they are retained) but were never required.
    expect(legs.has(legKey(S2.id, Q1.id))).toBe(true);
  });

  test("a retained (dormant) leg may be absent: only REQUIRED legs are mandatory", () => {
    const e = mutate(r, (x) => { x.legs = x.legs.filter((l) => !(l.from === S2.id && l.to === Q1.id)); });
    expect(validateEvidence(e, r, POLICY).size).toBe(retentionPairs(r).length - 1);
  });

  test.each<[string, (e: Evidence) => void]>([
    ["a missing REQUIRED leg", (e) => { e.legs = e.legs.filter((l) => !(l.from === S1.id && l.to === Q1.id)); }],
    ["a reversed key (pickup -> driver)", (e) => { const l = e.legs.find((x) => x.from === S1.id && x.to === Q1.id)!; [l.from, l.to] = [l.to, l.from]; }],
    ["a duplicate leg", (e) => { e.legs.push({ ...e.legs[0] }); }],
    ["an unexpected endpoint (a location this roster never had)", (e) => { e.legs.push({ from: uuid(900), to: V.id, seconds: 5, source: "provider", observedAt: OBSERVED }); }],
    ["a leg between two pickups (not a legal role)", (e) => { e.legs.push({ from: Q1.id, to: Q2.id, seconds: 5, source: "provider", observedAt: OBSERVED }); }],
    ["a leg from the venue", (e) => { e.legs.push({ from: V.id, to: Q1.id, seconds: 5, source: "provider", observedAt: OBSERVED }); }],
    ["a negative duration", (e) => { e.legs[0].seconds = -1; }],
    ["a string duration", (e) => { (e.legs[0] as { seconds: unknown }).seconds = "12"; }],
    ["an absurd duration", (e) => { e.legs[0].seconds = 5_000_000; }],
    ["a provider leg with no observation time", (e) => { e.legs.find((l) => l.source === "provider")!.observedAt = null; }],
    ["another policy", (e) => { e.policy = "policy/2"; }],
    ["another trip's venue", (e) => { e.venue.id = uuid(777); }],
    ["a moved venue", (e) => { e.venue.lat += 1; }],
    ["a changed seat count", (e) => { e.drivers[0].seats = 5; }],
    ["a changed dormant driver", (e) => { e.drivers[1].seats = 1; }],
    ["a missing passenger", (e) => { e.passengers.pop(); }],
    ["an unknown field", (e) => { (e as unknown as Record<string, unknown>).surprise = 1; }],
  ])("rejects %s", (_name, change) => {
    expect(() => validateEvidence(mutate(r, change), r, POLICY)).toThrow(AddressEvidenceError);
  });

  test("a leg for a participant who has since been withdrawn is not retained and is rejected", () => {
    const earlier = stored(r);
    const now = roster({ passengers: [{ id: uuid(21), active: true, location: Q1 }, { id: uuid(22), active: false, location: Q2 }] });
    expect(() => validateEvidence(earlier, now, POLICY)).toThrow(AddressEvidenceError);
  });
});

describe("validateCandidate (reuse: an EARLIER preview offered to a later roster)", () => {
  const r = roster();

  test("accepts an earlier roster's evidence after passengers, drivers and seats changed", () => {
    const earlier = stored(r);
    const later = roster({
      drivers: [
        { id: uuid(11), seatCapacity: 0, active: true, maxDetourMinutes: 30, location: S1 }, // seats changed
        { id: uuid(12), seatCapacity: 2, active: false, maxDetourMinutes: 30, location: S2 }, // since canceled
        { id: uuid(13), seatCapacity: 1, active: true, maxDetourMinutes: 30, location: at(6) }, // a newer driver
      ],
      passengers: [
        { id: uuid(21), active: false, location: Q1 }, // withdrawn
        { id: uuid(22), active: true, location: Q2 },
        { id: uuid(23), active: true, location: at(7) },
      ],
    });
    const legs = validateCandidate(earlier, later, POLICY);
    expect(legs.size).toBe(retentionPairs(r).length); // every stored leg of the earlier preview
    expect(legs.has(legKey(S1.id, Q1.id))).toBe(true);
  });

  test.each<[string, (e: Evidence) => void]>([
    ["another policy", (e) => { e.policy = "policy/2"; }],
    ["another trip's venue", (e) => { e.venue.id = uuid(777); }],
    ["a venue whose coordinates disagree with this trip", (e) => { e.venue.lon += 1; }],
    ["a driver start whose coordinates disagree (same location ID)", (e) => { e.drivers[0].location.lat += 1; }],
    ["a driver this trip does not have", (e) => { e.drivers[0].id = uuid(950); }],
    ["a passenger this trip does not have", (e) => { e.passengers[0].id = uuid(951); }],
    ["a driver recorded with another location", (e) => { e.drivers[0].location = { ...e.drivers[1].location }; }],
    ["a leg that joins an unknown endpoint", (e) => { e.legs.push({ from: uuid(900), to: V.id, seconds: 5, source: "provider", observedAt: OBSERVED }); }],
    ["a reversed key", (e) => { const l = e.legs[0]; [l.from, l.to] = [l.to, l.from]; }],
    ["a duplicate leg", (e) => { e.legs.push({ ...e.legs[0] }); }],
    ["a malformed duration", (e) => { (e.legs[0] as { seconds: unknown }).seconds = "slow"; }],
    ["a negative duration", (e) => { e.legs[0].seconds = -3; }],
    ["a provider leg misclassified as local", (e) => { const l = e.legs.find((x) => x.source === "provider")!; l.source = "identical_endpoint"; l.seconds = 0; l.observedAt = null; }],
    ["a local leg that is not local", (e) => { e.legs[0].source = "identical_endpoint"; }],
    ["a missing schema", (e) => { (e as unknown as Record<string, unknown>).schema = "address-evidence-1"; }],
    ["garbage", () => undefined],
  ])("rejects %s", (name, change) => {
    const candidate = name === "garbage" ? "not evidence" : mutate(r, change);
    expect(() => validateCandidate(candidate, r, POLICY)).toThrow(AddressEvidenceError);
  });

  test("a candidate that names a location this trip never had is refused even if internally consistent", () => {
    const foreign = roster({ venue: at(60, 60, 40), drivers: [{ id: uuid(61), seatCapacity: 1, active: true, maxDetourMinutes: 30, location: at(61, 61, 41) }], passengers: [{ id: uuid(62), active: true, location: at(62, 62, 42) }] });
    expect(() => validateCandidate(stored(foreign), r, POLICY)).toThrow(AddressEvidenceError);
  });
});
