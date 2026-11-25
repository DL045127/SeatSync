// L-06 / L-07 / L-10, database-free: an INDEPENDENT reference calculation is compared with the
// production address path over seeded scenarios that include EDIT SEQUENCES (cancel, withdraw,
// seat changes 2->0->2, additions), so reuse is property-tested as well as projection.
//
// For every seed and every step the test requires:
//   1. reference edge map == production edge map from a REUSED preview == from a COLD preview
//      (absent edges included);
//   2. the exhaustive oracle on the REFERENCE input == the exact matcher on the PRODUCTION input
//      (matched count and total cost, so equal-optimum tie choices stay valid);
//   3. reused and cold previews have IDENTICAL optimal and greedy results (same IDs and order);
//   4. the number of provider cells the reused path requested equals an independent model of
//      reuse, and the cold path requested every nonlocal required leg;
//   5. no equal-coordinate leg was ever requested from the provider.
// A failure prints the seed, step, edit sequence, raw overrides and both edge sets.

import { describe, expect, test } from "vitest";
import { computeAddressPreview, type AddressPreviewComputation } from "../../src/trips/address-preview.ts";
import { addressCounters, resetAddressCounters } from "../../src/trips/address-metrics.ts";
import { validateCandidate, validateEvidence } from "../../src/trips/address-evidence.ts";
import { projectAddressMatchInput, type AddressRoster } from "../../src/matching/address.ts";
import type { RoutingAdapter } from "../../src/routing/index.ts";
import { oracleObjective } from "./oracle.ts";
import {
  applyEdit,
  generateScenario,
  rawSeconds,
  referenceEdges,
  stepLineage,
  type Scenario,
  type State,
} from "./address-reference.ts";

const POLICY = "reference-policy/1";
const SEEDS = 150;

function toRoster(state: State): AddressRoster {
  const point = (l: { id: string; ref: string; lon: number; lat: number }) => ({ id: l.id, providerRef: l.ref, lon: l.lon, lat: l.lat });
  return {
    venue: point(state.venue),
    drivers: state.drivers.map((d) => ({ id: d.id, seatCapacity: d.seats, active: d.active, maxDetourMinutes: d.limitMinutes, location: point(d.loc) })),
    passengers: state.passengers.map((p) => ({ id: p.id, active: p.active, location: point(p.loc) })),
  };
}

function countingAdapter(scenario: Scenario) {
  const counter = { cells: 0, calls: 0 };
  const adapter: RoutingAdapter = {
    provider: "fixture",
    policyId: POLICY,
    async fetchLegs(pairs) {
      counter.calls += 1;
      counter.cells += pairs.length;
      return pairs.map(({ from, to }) => rawSeconds(scenario, from, to)); // throws if asked for equal coordinates
    },
  };
  return { adapter, counter };
}

const source = (adapter: RoutingAdapter) => ({ provider: "fixture" as const, policyId: POLICY, adapter: () => adapter });
const roundTrip = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function edgesOf(result: AddressPreviewComputation, roster: AddressRoster): string[] {
  const legs = validateEvidence(roundTrip(result.evidence), roster, POLICY);
  return projectAddressMatchInput(roster, legs).input.edges.map((e) => `${e.driverId}>${e.passengerId}:${e.cost}`).sort();
}

const tally = {
  scenarios: 0, steps: 0, withCandidate: 0, reuseSavedCells: 0,
  zeroLimitDriver: 0, zeroSeatDriver: 0, inactive: 0, emptySide: 0,
  noRouteDP: 0, noRoutePV: 0, noRouteDV: 0,
  identicalCoordsDistinctIds: 0, sharedLocationId: 0,
  clamped: 0, clampedRoundsToZero: 0, halfSecond: 0, exactlyAtLimit: 0, overLimitByHalf: 0,
  edgesTotal: 0, oracleMatchedMax: 0,
};

async function runScenario(scenario: Scenario): Promise<void> {
  let state = scenario.initial;
  let lineage = new Set<string>();
  let previous: AddressPreviewComputation | undefined;
  for (let step = 0; step <= scenario.edits.length; step += 1) {
    if (step > 0) state = applyEdit(state, scenario.edits[step - 1]);
    const roster = toRoster(state);
    const context = () => JSON.stringify({ seed: scenario.seed, step, edits: scenario.edits.slice(0, step), overrides: scenario.overrides }, null, 1);
    try {
      const reference = referenceEdges(scenario, state);
      const model = stepLineage(lineage, state);
      lineage = model.lineage;

      const candidate = previous ? validateCandidate(roundTrip(previous.evidence), roster, POLICY) : undefined;
      const reusedRun = countingAdapter(scenario);
      resetAddressCounters();
      const reused = await computeAddressPreview(roster, source(reusedRun.adapter), candidate);
      // The production counter must equal the reference's count of NEGATIVE estimates, taken before rounding.
      expect(addressCounters.negativeDetourClamped, "clamp counter, reused path").toBe(reference.clamped);
      const coldRun = countingAdapter(scenario);
      resetAddressCounters();
      const cold = await computeAddressPreview(roster, source(coldRun.adapter), undefined);
      expect(addressCounters.negativeDetourClamped, "clamp counter, cold path").toBe(reference.clamped);

      const expected = reference.edges.map((e) => `${e.driverId}>${e.passengerId}:${e.cost}`).sort();
      expect(edgesOf(reused, roster), "reused edges differ from the reference").toEqual(expected);
      expect(edgesOf(cold, roster), "cold edges differ from the reference").toEqual(expected);

      const oracle = oracleObjective(reference.input);
      for (const [name, result] of [["reused", reused], ["cold", cold]] as const) {
        expect({ matchedCount: result.optimal.matchedCount, totalCost: result.optimal.totalCost }, `${name} objective`).toEqual(oracle);
      }
      expect(reused.optimal, "reused vs cold optimal result").toEqual(cold.optimal);
      expect(reused.greedy, "reused vs cold greedy result").toEqual(cold.greedy);

      expect(reusedRun.counter.cells, "reused provider cells vs the independent reuse model").toBe(model.expectedFetched);
      expect(reused.fetchedCells).toBe(model.expectedFetched);
      expect(coldRun.counter.cells).toBe(cold.fetchedCells);
      expect(coldRun.counter.cells).toBeGreaterThanOrEqual(reusedRun.counter.cells);

      // Coverage tallies (so a generator that stops exercising a feature fails loudly below).
      tally.steps += 1;
      if (candidate) tally.withCandidate += 1;
      if (coldRun.counter.cells > reusedRun.counter.cells) tally.reuseSavedCells += 1;
      const live = state.drivers.filter((d) => d.active);
      if (live.some((d) => d.seats > 0 && d.limitMinutes === 0)) tally.zeroLimitDriver += 1;
      if (live.some((d) => d.seats === 0)) tally.zeroSeatDriver += 1;
      if (state.drivers.some((d) => !d.active) || state.passengers.some((p) => !p.active)) tally.inactive += 1;
      const supply = live.filter((d) => d.seats > 0).length;
      const demand = state.passengers.filter((p) => p.active).length;
      if (supply === 0 || demand === 0) tally.emptySide += 1;
      tally.clamped += reference.clamped;
      tally.clampedRoundsToZero += reference.clampedRoundsToZero;
      tally.halfSecond += reference.halves;
      tally.exactlyAtLimit += reference.exactlyAtLimit;
      tally.edgesTotal += reference.edges.length;
      tally.oracleMatchedMax = Math.max(tally.oracleMatchedMax, oracle.matchedCount);
      for (const d of live.filter((x) => x.seats > 0)) {
        for (const p of state.passengers.filter((x) => x.active)) {
          const eq = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => a.lon === b.lon && a.lat === b.lat;
          const t = (a: typeof d.loc, b: typeof d.loc) => (eq(a, b) ? 0 : rawSeconds(scenario, a, b));
          if (t(d.loc, p.loc) === null) tally.noRouteDP += 1;
          if (t(p.loc, state.venue) === null) tally.noRoutePV += 1;
          if (t(d.loc, state.venue) === null) tally.noRouteDV += 1;
          if (eq(d.loc, p.loc) && d.loc.id !== p.loc.id) tally.identicalCoordsDistinctIds += 1;
          const dp = t(d.loc, p.loc), pv = t(p.loc, state.venue), dv = t(d.loc, state.venue);
          if (dp !== null && pv !== null && dv !== null && Math.round(dp + pv - dv) === d.limitMinutes * 60 + 1 && Math.abs((dp + pv - dv) % 1) === 0.5) tally.overLimitByHalf += 1;
        }
      }
      if (new Set(state.passengers.map((p) => p.loc.id)).size < state.passengers.length) tally.sharedLocationId += 1;
      previous = reused; // the NEXT step may reuse this preview's evidence
    } catch (error) {
      throw new Error(`${(error as Error).message}\n--- reproduction ---\n${context()}`, { cause: error });
    }
  }
  tally.scenarios += 1;
}

describe(`L-06/L-07/L-10: the production address path agrees with an independent reference (seeds 1-${SEEDS})`, () => {
  test(`${SEEDS} seeded scenarios with edit sequences`, async () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) await runScenario(generateScenario(seed));
    // Retained for EVIDENCE: the seed range and what the generator actually exercised.
    console.info(`address-reference seeds 1-${SEEDS}: ${JSON.stringify(tally)}`);
    expect(tally.scenarios).toBe(SEEDS);
  }, 120_000);

  test("the generator really exercises every feature the check claims to cover", () => {
    // Runs after the seeded test populated the tally (tests in a file run in order).
    expect(tally.steps).toBeGreaterThan(SEEDS * 2);
    expect(tally.withCandidate, "steps that reused an earlier preview").toBeGreaterThan(100);
    expect(tally.reuseSavedCells, "steps where reuse requested fewer cells than cold").toBeGreaterThan(20);
    for (const key of [
      "zeroLimitDriver", "zeroSeatDriver", "inactive", "emptySide", "noRouteDP", "noRoutePV", "noRouteDV",
      "identicalCoordsDistinctIds", "sharedLocationId", "clamped", "clampedRoundsToZero", "halfSecond", "exactlyAtLimit", "overLimitByHalf",
    ] as const) {
      expect(tally[key], key).toBeGreaterThan(0);
    }
    expect(tally.edgesTotal).toBeGreaterThan(300);
    expect(tally.oracleMatchedMax, "a scenario where several passengers are seated").toBeGreaterThanOrEqual(3);
  });
});
