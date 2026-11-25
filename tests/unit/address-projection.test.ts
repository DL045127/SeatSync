// Pure address projection and evidence validation. The expected answers come
// from the two hand-derived fixtures in docs/ARCHITECTURE-v2.md section 8 and
// from direct arithmetic, not from the projector under test.

import { describe, expect, test } from "vitest";
import { computeMatch, greedyMatch, minCostFlowMatch } from "../../src/matching/index.ts";
import {
  AddressEvidenceError,
  type AddressPoint,
  type AddressRoster,
  type Leg,
  detourSeconds,
  legKey,
  projectAddressMatchInput,
  requiredPairs,
  resolveIdentical,
} from "../../src/matching/address.ts";
import { buildEvidence, validateEvidence } from "../../src/trips/address-evidence.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const point = (n: number, lon = n, lat = n): AddressPoint => ({ id: uuid(100 + n), providerRef: `ref-${n}`, lon, lat });
const OBSERVED = "2026-11-24T12:00:00.000Z";

/** Build legs from a function of (fromPoint, toPoint) in seconds; undefined = no entry, null = no route. */
function legsFor(roster: AddressRoster, seconds: (from: AddressPoint, to: AddressPoint) => number | null) {
  const legs = new Map<string, Leg>();
  for (const pair of requiredPairs(roster)) {
    legs.set(legKey(pair.from.id, pair.to.id), {
      from: pair.from.id,
      to: pair.to.id,
      seconds: seconds(pair.from, pair.to),
      source: "provider",
      observedAt: OBSERVED,
    });
  }
  return legs;
}

// ---- fixture 1 (minutes in the doc; seconds here) ---------------------------
const V = point(1, 10, 10);
const S1 = point(2, 11, 11);
const S2 = point(3, 12, 12);
const Q1 = point(4, 13, 13);
const Q2 = point(5, 14, 14);
const D1 = uuid(11), D2 = uuid(12), P1 = uuid(21), P2 = uuid(22);

function roster1(limitMinutes: number): AddressRoster {
  return {
    venue: V,
    drivers: [
      { id: D1, seatCapacity: 1, active: true, maxDetourMinutes: limitMinutes, location: S1 },
      { id: D2, seatCapacity: 1, active: true, maxDetourMinutes: limitMinutes, location: S2 },
    ],
    passengers: [
      { id: P1, active: true, location: Q1 },
      { id: P2, active: true, location: Q2 },
    ],
  };
}
const minutes = (m: number) => m * 60;
const times1 = new Map<string, number>([
  [`${S1.id}>${V.id}`, minutes(20)], [`${S2.id}>${V.id}`, minutes(24)],
  [`${Q1.id}>${V.id}`, minutes(10)], [`${Q2.id}>${V.id}`, minutes(12)],
  [`${S1.id}>${Q1.id}`, minutes(15)], [`${S1.id}>${Q2.id}`, minutes(10)],
  [`${S2.id}>${Q1.id}`, minutes(15)], [`${S2.id}>${Q2.id}`, minutes(20)],
]);
const seconds1 = (from: AddressPoint, to: AddressPoint) => times1.get(`${from.id}>${to.id}`) ?? null;

describe("hand fixture 1: detours 5/2 and 1/8 minutes", () => {
  test("edges are the hand-derived detours and the optimum is 180 seconds", () => {
    const roster = roster1(15);
    const { input } = projectAddressMatchInput(roster, legsFor(roster, seconds1));
    const cost = (d: string, p: string) => input.edges.find((e) => e.driverId === d && e.passengerId === p)?.cost;
    expect(cost(D1, P1)).toBe(300); // 15 + 10 - 20 = 5 min
    expect(cost(D1, P2)).toBe(120); // 10 + 12 - 20 = 2 min
    expect(cost(D2, P1)).toBe(60); // 15 + 10 - 24 = 1 min
    expect(cost(D2, P2)).toBe(480); // 20 + 12 - 24 = 8 min
    const optimal = minCostFlowMatch(input);
    expect(optimal.matchedCount).toBe(2);
    expect(optimal.totalCost).toBe(180); // D1->P2 (2) + D2->P1 (1) = 3 min; the other pairing is 13 min
    expect(Object.fromEntries(optimal.assignments.map((a) => [a.passengerId, a.driverId]))).toEqual({ [P1]: D2, [P2]: D1 });
  });

  test("transposing D->P or swapping the direct-to-venue times changes the answer", () => {
    const roster = roster1(15);
    // Transpose the driver x passenger matrix: the (D1,P2) cell reads D2->P1 and vice versa.
    const swapCell = new Map<string, string>([[`${S1.id}>${Q2.id}`, `${S2.id}>${Q1.id}`], [`${S2.id}>${Q1.id}`, `${S1.id}>${Q2.id}`]]);
    const transposed = legsFor(roster, (from, to) => {
      const key = `${from.id}>${to.id}`;
      return times1.get(swapCell.get(key) ?? key) ?? null;
    });
    const swappedDirect = legsFor(roster, (from, to) =>
      to.id === V.id && from.id === S1.id ? minutes(24) : to.id === V.id && from.id === S2.id ? minutes(20) : seconds1(from, to));
    const total = (legs: Map<string, Leg>) => minCostFlowMatch(projectAddressMatchInput(roster, legs).input).totalCost;
    expect(total(legsFor(roster, seconds1))).toBe(180);
    expect(total(swappedDirect)).toBe(300);
    expect(total(transposed)).toBe(420); // 7 min (D1->P2) + clamped 0 (D2->P1), derived by hand
  });
});

// ---- fixture 2 (seconds): greedy, direction and the inclusive threshold ------
const W = point(30, 30, 30);
const T1 = point(31, 31, 31), T2 = point(32, 32, 32);
const R1 = point(33, 33, 33), R2 = point(34, 34, 34);
const E1 = uuid(41), E2 = uuid(42), F1 = uuid(51), F2 = uuid(52);

const roster2: AddressRoster = {
  venue: W,
  drivers: [
    { id: E1, seatCapacity: 1, active: true, maxDetourMinutes: 15, location: T1 },
    { id: E2, seatCapacity: 1, active: true, maxDetourMinutes: 15, location: T2 },
  ],
  passengers: [
    { id: F1, active: true, location: R1 },
    { id: F2, active: true, location: R2 },
  ],
};
// D->P and P->D, in seconds (the doc's second table).
const forward = new Map<string, number>([
  [`${T1.id}>${R1.id}`, 660], [`${T1.id}>${R2.id}`, 1500], [`${T2.id}>${R1.id}`, 720], [`${T2.id}>${R2.id}`, 1501],
  [`${T1.id}>${W.id}`, 1200], [`${T2.id}>${W.id}`, 1200], [`${R1.id}>${W.id}`, 600], [`${R2.id}>${W.id}`, 600],
]);
const backward = new Map<string, number>([
  [`${R1.id}>${T1.id}`, 660], [`${R2.id}>${T1.id}`, 1550], [`${R1.id}>${T2.id}`, 1600], [`${R2.id}>${T2.id}`, 720],
]);
const secondsForward = (from: AddressPoint, to: AddressPoint) => forward.get(`${from.id}>${to.id}`) ?? null;
/** A defective adapter that asks for P->D wherever D->P is wanted. */
const secondsReversed = (from: AddressPoint, to: AddressPoint) =>
  forward.has(`${from.id}>${to.id}`) && to.id !== W.id ? backward.get(`${to.id}>${from.id}`) ?? null : secondsForward(from, to);

describe("hand fixture 2: coverage before cost, direction, and the inclusive 900 s limit", () => {
  const project = (seconds: typeof secondsForward) => projectAddressMatchInput(roster2, legsFor(roster2, seconds)).input;

  test("the pair exactly at the limit is eligible and the pair one second over is not", () => {
    const { edges } = project(secondsForward);
    const cost = (d: string, p: string) => edges.find((e) => e.driverId === d && e.passengerId === p)?.cost;
    expect(cost(E1, F1)).toBe(60);
    expect(cost(E1, F2)).toBe(900); // 1500 + 600 - 1200: exactly 15 minutes
    expect(cost(E2, F1)).toBe(120);
    expect(cost(E2, F2)).toBeUndefined(); // 1501 + 600 - 1200 = 901 s: one second over
  });

  test("the exact matcher seats two for 1,020 s while greedy seats one for 60 s", () => {
    const input = project(secondsForward);
    const optimal = minCostFlowMatch(input);
    expect(optimal.matchedCount).toBe(2);
    expect(optimal.totalCost).toBe(1020);
    expect(Object.fromEntries(optimal.assignments.map((a) => [a.passengerId, a.driverId]))).toEqual({ [F1]: E2, [F2]: E1 });
    const greedy = greedyMatch(input);
    expect(greedy.matchedCount).toBe(1);
    expect(greedy.totalCost).toBe(60);
    expect(greedy.unassignedPassengerIds).toEqual([F2]);
  });

  test("a reversed-direction adapter falsely reports two matches for 180 s", () => {
    const optimal = computeMatch(project(secondsReversed)).optimal;
    expect(optimal.matchedCount).toBe(2);
    expect(optimal.totalCost).toBe(180);
  });

  test("a zero-minute limit admits only an exactly on-the-way pickup", () => {
    const onTheWay = legsFor(roster2, (from, to) =>
      from.id === T1.id && to.id === R1.id ? 600 : // 600 + 600 - 1200 = 0
      secondsForward(from, to));
    const strict: AddressRoster = { ...roster2, drivers: roster2.drivers.map((d) => ({ ...d, maxDetourMinutes: 0 })) };
    const { edges } = projectAddressMatchInput(strict, onTheWay).input;
    expect(edges).toEqual([{ driverId: E1, passengerId: F1, cost: 0 }]);
  });
});

describe("rounding, no-route and missing observations", () => {
  test("half-seconds round up, a negative difference clamps to zero and is flagged", () => {
    expect(detourSeconds(10.5, 0, 0)).toEqual({ seconds: 11, clamped: false });
    expect(detourSeconds(10.4, 0, 0)).toEqual({ seconds: 10, clamped: false });
    // A NEGATIVE ESTIMATE is counted BEFORE rounding (ISSUE-069): -0.5 s rounds to 0 but is still negative.
    expect(detourSeconds(0, 0, 0.5)).toEqual({ seconds: 0, clamped: true });
    expect(detourSeconds(0, 0, 0.25)).toEqual({ seconds: 0, clamped: true });
    expect(detourSeconds(100, 50, 150.25)).toEqual({ seconds: 0, clamped: true });
    expect(detourSeconds(0.25, 0, 0.5)).toEqual({ seconds: 0, clamped: true }); // -0.25
    expect(detourSeconds(100, 100, 200)).toEqual({ seconds: 0, clamped: false }); // exactly zero is not negative
    expect(detourSeconds(100, 100, 199.75)).toEqual({ seconds: 0, clamped: false }); // +0.25 rounds to 0, positive
    expect(detourSeconds(100, 100, 199.5)).toEqual({ seconds: 1, clamped: false }); // +0.5 rounds UP to 1
    expect(detourSeconds(100, 100, 250)).toEqual({ seconds: 0, clamped: true });
    expect(detourSeconds(1, 1, 5)).toEqual({ seconds: 0, clamped: true });
  });

  test("a confirmed no-route excludes only its dependent pairs and is never a free edge", () => {
    const roster = roster1(15);
    const noRouteToQ1 = legsFor(roster, (from, to) => (to.id === Q1.id && from.id === S1.id ? null : seconds1(from, to)));
    const { edges } = projectAddressMatchInput(roster, noRouteToQ1).input;
    expect(edges.map((e) => `${e.driverId}>${e.passengerId}`).sort()).toEqual([`${D1}>${P2}`, `${D2}>${P1}`, `${D2}>${P2}`].sort());
    // No route from a pickup to the venue excludes that pickup from every driver.
    const noRouteHome = legsFor(roster, (from, to) => (from.id === Q2.id && to.id === V.id ? null : seconds1(from, to)));
    const home = projectAddressMatchInput(roster, noRouteHome).input.edges;
    expect(home.every((e) => e.passengerId === P1)).toBe(true);
    expect(home.length).toBeGreaterThan(0);
  });

  test("a missing required leg is an invariant failure, not a free edge", () => {
    const roster = roster1(15);
    const legs = legsFor(roster, seconds1);
    legs.delete(legKey(S1.id, Q1.id));
    expect(() => projectAddressMatchInput(roster, legs)).toThrow(AddressEvidenceError);
  });

  test("inactive participants and zero-seat drivers need no legs; an empty side needs none at all", () => {
    const roster = roster1(15);
    const trimmed: AddressRoster = {
      ...roster,
      drivers: [roster.drivers[0], { ...roster.drivers[1], seatCapacity: 0 }],
      passengers: [roster.passengers[0], { ...roster.passengers[1], active: false }],
    };
    const pairs = requiredPairs(trimmed).map((p) => `${p.from.id}>${p.to.id}`).sort();
    expect(pairs).toEqual([`${S1.id}>${Q1.id}`, `${S1.id}>${V.id}`, `${Q1.id}>${V.id}`].sort());
    expect(requiredPairs({ ...roster, passengers: [] })).toEqual([]);
    expect(requiredPairs({ ...roster, drivers: [] })).toEqual([]);
  });

  test("an empty side projects to an empty plan WITHOUT demanding any observation (regression)", () => {
    const roster = roster1(15);
    for (const empty of [{ ...roster, passengers: [] }, { ...roster, drivers: [] }]) {
      const { input } = projectAddressMatchInput(empty, new Map()); // no legs at all
      expect(input.edges).toEqual([]);
      expect(computeMatch(input).optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
    }
  });
});

describe("identical endpoints", () => {
  test("equal coordinates resolve locally to zero seconds with no provider observation", () => {
    const a = point(60, 5, 5);
    const b = { ...point(61, 5, 5) };
    expect(resolveIdentical({ from: a, to: b })).toEqual({
      from: a.id, to: b.id, seconds: 0, source: "identical_endpoint", observedAt: null,
    });
    expect(resolveIdentical({ from: a, to: point(62, 5, 5.0000001) })).toBeUndefined(); // close is not identical
  });

  test("two passengers sharing one location deduplicate their venue leg", () => {
    const shared = point(70, 70, 70);
    const roster: AddressRoster = {
      venue: V,
      drivers: [{ id: D1, seatCapacity: 2, active: true, maxDetourMinutes: 15, location: S1 }],
      passengers: [{ id: P1, active: true, location: shared }, { id: P2, active: true, location: shared }],
    };
    expect(requiredPairs(roster)).toHaveLength(3); // S1->V, S1->shared, shared->V
  });
});

describe("evidence validation proves the stored legs match the CURRENT roster", () => {
  const POLICY = "test-policy";
  const roster = roster1(15);
  const good = () => buildEvidence(roster, POLICY, legsFor(roster, seconds1));

  test("matching evidence decodes to the same legs", () => {
    const legs = validateEvidence(JSON.parse(JSON.stringify(good())), roster, POLICY);
    expect(legs.size).toBe(requiredPairs(roster).length);
    expect(legs.get(legKey(S1.id, V.id))?.seconds).toBe(minutes(20));
  });

  type Mutate = (e: ReturnType<typeof good>) => unknown;
  test.each<[string, Mutate]>([
    ["another policy", (e) => ({ ...e, policy: "other" })],
    ["a missing leg", (e) => ({ ...e, legs: e.legs.slice(1) })],
    ["an extra leg", (e) => ({ ...e, legs: [...e.legs, { from: V.id, to: S1.id, seconds: 1, source: "provider", observedAt: OBSERVED }] })],
    ["a repeated leg", (e) => ({ ...e, legs: [...e.legs, e.legs[0]] })],
    ["a changed driver seat count", (e) => ({ ...e, drivers: [{ ...e.drivers[0], seats: 2 }, e.drivers[1]] })],
    ["a changed detour limit", (e) => ({ ...e, drivers: [{ ...e.drivers[0], maxDetourMinutes: 14 }, e.drivers[1]] })],
    ["a moved passenger", (e) => ({ ...e, passengers: [{ ...e.passengers[0], location: { ...e.passengers[0].location, lat: 1 } }, e.passengers[1]] })],
    ["another venue", (e) => ({ ...e, venue: { ...e.venue, id: uuid(999) } })],
    ["a provider leg with no observation time", (e) => ({ ...e, legs: [{ ...e.legs[0], observedAt: null }, ...e.legs.slice(1)] })],
    ["a negative duration", (e) => ({ ...e, legs: [{ ...e.legs[0], seconds: -1 }, ...e.legs.slice(1)] })],
    ["a leg misclassified as an identical endpoint", (e) => ({ ...e, legs: [{ ...e.legs[0], source: "identical_endpoint", seconds: 0, observedAt: null }, ...e.legs.slice(1)] })],
    ["an unknown field", (e) => ({ ...e, surprise: true })],
    ["not an object", () => "garbage"],
  ])("rejects %s", (_name, mutate) => {
    expect(() => validateEvidence(JSON.parse(JSON.stringify(mutate(good()))), roster, POLICY)).toThrow(AddressEvidenceError);
  });

  test("evidence for a different roster state is rejected", () => {
    const changed: AddressRoster = { ...roster, passengers: [roster.passengers[0]] };
    expect(() => validateEvidence(JSON.parse(JSON.stringify(good())), changed, POLICY)).toThrow(AddressEvidenceError);
  });
});
