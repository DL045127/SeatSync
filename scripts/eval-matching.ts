// D-1: exact min-cost-flow matching versus greedy (architecture section 8).
//
// Runs BOTH algorithms on:
//   - the M-01 and M-08 hand fixtures,
//   - 100 tiny deterministic oracle seeds (within the 4-driver/7-passenger
//     oracle bound) where the independent exhaustive oracle gives ground truth,
//   - size classes of 5/15/30/50 passengers (up to 20 drivers, varied
//     capacities, ties, sparse compatibility).
//
// Acceptance (D-1): zero fixture/oracle/invariant discrepancies. The optimizer
// must match the oracle objective on every tiny seed and the fixtures; both
// algorithms must emit feasible plans; greedy may match fewer/cost more but
// never beat the optimizer at equal cardinality. Costs are compared only at the
// SAME maximum cardinality. Reports median/p95 pure solver time at the maximum
// bounds (20 drivers / 50 passengers, dense) over 100 samples after warmup.
//
// Pure computation only: no database, HTTP, or cache. Writes a raw artifact to
// eval/d1-matching.json with environment/commit metadata.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { performance } from "node:perf_hooks";
import {
  type MatchInput,
  assertFeasible,
  greedyMatch,
  minCostFlowMatch,
} from "../src/matching/index.ts";
import { ALGORITHM_VERSION } from "../src/matching/index.ts";
import type { MatchEdge } from "../src/matching/types.ts";
import { seededId } from "../tests/matching/fromMatrix.ts";
import { fromMatrix } from "../tests/matching/fromMatrix.ts";
import { randomCase } from "../tests/matching/random.ts";
import { oracleObjective } from "../tests/matching/oracle.ts";
import fixtures from "../tests/fixtures/matching.json" with { type: "json" };

interface Discrepancy {
  where: string;
  detail: string;
}

const discrepancies: Discrepancy[] = [];
function check(ok: boolean, where: string, detail: string): void {
  if (!ok) discrepancies.push({ where, detail });
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function measurePlan(input: MatchInput, solve: typeof greedyMatch, label: string) {
  const start = performance.now();
  const plan = solve(input);
  const runtimeMs = performance.now() - start;
  let feasible = true;
  try {
    assertFeasible(input, plan);
  } catch (error) {
    feasible = false;
    check(false, label, `infeasible plan: ${(error as Error).message}`);
  }
  check(plan.matchedCount === plan.assignments.length, label, "matchedCount != assignments");
  const sum = plan.assignments.reduce((total, assignment) => total + assignment.cost, 0);
  check(plan.totalCost === sum, label, "totalCost != sum(costs)");
  return { matched: plan.matchedCount, cost: plan.totalCost, feasible, runtimeMs };
}

function measureCase(input: MatchInput, label: string) {
  const optimizer = measurePlan(input, minCostFlowMatch, `${label}/optimizer`);
  const greedy = measurePlan(input, greedyMatch, `${label}/greedy`);
  check(optimizer.matched >= greedy.matched, label, "greedy seated more passengers");
  if (optimizer.matched === greedy.matched) {
    check(optimizer.cost <= greedy.cost, label, "greedy was cheaper at equal coverage");
  }
  return { drivers: input.drivers.length, passengers: input.passengers.length, edges: input.edges.length, optimizer, greedy };
}

function runFixtures(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const id of ["M-01", "M-08"] as const) {
    const fx = fixtures[id];
    const input = fromMatrix(fx);
    const measured = measureCase(input, id);
    for (const [plan, expected] of [[measured.optimizer, fx.optimal], [measured.greedy, fx.greedy]]) {
      check(plan.matched === expected.matched && plan.cost === expected.cost, id,
        `expected ${expected.matched}/${expected.cost}, got ${plan.matched}/${plan.cost}`);
    }
    out.push({
      id,
      ...measured,
      expectedOptimal: fx.optimal,
      expectedGreedy: fx.greedy,
    });
  }
  return out;
}

function runOracleSeeds(): Record<string, unknown> {
  // Within the oracle bound (<=4 drivers, <=7 passengers). The optimizer MUST
  // equal the oracle objective on every seed; greedy is compared for coverage.
  const seeds = 100;
  const perSeed = [];
  let optimizerAgrees = 0;
  let greedySameCoverage = 0;
  let greedyWorseCost = 0;
  for (let s = 0; s < seeds; s++) {
    const input = randomCase(s, { maxDrivers: 4, maxPassengers: 7, maxSeats: 3, maxCost: 10, compatibility: 0.6 });
    const oracle = oracleObjective(input);
    const measured = measureCase(input, `oracle-seed-${s}`);
    const { optimizer: flow, greedy } = measured;
    perSeed.push({ seed: s, input, oracle, ...measured });
    const agrees = flow.matched === oracle.matchedCount && flow.cost === oracle.totalCost;
    if (agrees) optimizerAgrees += 1;
    else check(false, `oracle-seed-${s}`, `optimizer (${flow.matched}/${flow.cost}) != oracle (${oracle.matchedCount}/${oracle.totalCost})`);
    if (greedy.matched === flow.matched) {
      greedySameCoverage += 1;
      if (greedy.cost > flow.cost) greedyWorseCost += 1;
    }
  }
  return { seeds, optimizerAgrees, greedySameCoverage, greedyWorseCost, perSeed };
}

/** Deterministic 32-bit PRNG (mulberry32), local so size classes are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build an instance with EXACT driver and passenger counts (ISSUE-032: the
 * shared randomCase generator picks counts UP TO its bounds, so a "50" label
 * rarely had 50). Sparse compatibility and repeated costs introduce ties.
 */
function exactInstance(seed: number, drivers: number, passengers: number): MatchInput {
  const rand = prng(seed);
  const ds = Array.from({ length: drivers }, (_, i) => ({
    id: seededId("d", i),
    seatCapacity: 1 + Math.floor(rand() * 4), // 1..4, varied
  }));
  const ps = Array.from({ length: passengers }, (_, j) => ({ id: seededId("p", j) }));
  const edges: MatchEdge[] = [];
  for (const d of ds) {
    for (const p of ps) {
      if (rand() < 0.4) edges.push({ driverId: d.id, passengerId: p.id, cost: Math.floor(rand() * 101) });
    }
  }
  return { drivers: ds, passengers: ps, edges };
}

function sizeClasses(): Array<Record<string, unknown>> {
  // Each class fixes an EXACT passenger count and up to 20 drivers with ties and
  // sparse compatibility. Costs are compared only at equal cardinality. Per-seed
  // actual sizes and results are retained so the totals are auditable.
  const classes = [5, 15, 30, 50];
  const out: Array<Record<string, unknown>> = [];
  for (const passengers of classes) {
    const drivers = Math.min(20, Math.max(1, Math.ceil(passengers / 3)));
    const perSeed = 10;
    const seedResults: Array<Record<string, unknown>> = [];
    let flowMatchedTotal = 0;
    let greedyMatchedTotal = 0;
    let equalCardinality = 0;
    let greedyCostlierAtEqual = 0;
    let costGapAtEqual = 0;
    for (let k = 0; k < perSeed; k++) {
      const seed = 1000 + passengers * 100 + k;
      const input = exactInstance(seed, drivers, passengers);
      // Guard the exact sizes we claim.
      check(input.passengers.length === passengers, `size-${passengers}-seed-${k}`, `passengers ${input.passengers.length} != ${passengers}`);
      check(input.drivers.length === drivers, `size-${passengers}-seed-${k}`, `drivers ${input.drivers.length} != ${drivers}`);
      const measured = measureCase(input, `size-${passengers}-seed-${k}`);
      const { optimizer: flow, greedy } = measured;
      flowMatchedTotal += flow.matched;
      greedyMatchedTotal += greedy.matched;
      const equal = flow.matched === greedy.matched;
      if (equal) {
        equalCardinality += 1;
        if (greedy.cost > flow.cost) greedyCostlierAtEqual += 1;
        costGapAtEqual += greedy.cost - flow.cost;
      }
      seedResults.push({ seed, ...measured });
    }
    out.push({
      passengerClass: passengers,
      exactPassengers: passengers,
      exactDrivers: drivers,
      seeds: perSeed,
      optimizerMatchedTotal: flowMatchedTotal,
      greedyMatchedTotal: greedyMatchedTotal,
      equalCardinalityCount: equalCardinality,
      greedyCostlierAtEqualCardinality: greedyCostlierAtEqual,
      totalCostGapAtEqualCardinality: costGapAtEqual,
      perSeed: seedResults,
    });
  }
  return out;
}

function summarizeTimings(rawMs: number[]) {
  const sorted = [...rawMs].sort((a, b) => a - b);
  return { rawMs, medianMs: percentile(sorted, 50), p95Ms: percentile(sorted, 95) };
}

function maxBoundTiming() {
  // Dense worst-case at the supported bounds (20 drivers, 50 passengers).
  const drivers = Array.from({ length: 20 }, (_, i) => ({ id: seededId("d", i), seatCapacity: 8 }));
  const passengers = Array.from({ length: 50 }, (_, j) => ({ id: seededId("p", j) }));
  const edges: MatchEdge[] = [];
  drivers.forEach((d, i) => {
    passengers.forEach((p, j) => {
      edges.push({ driverId: d.id, passengerId: p.id, cost: (i * 7 + j * 13) % 101 });
    });
  });
  const input: MatchInput = { drivers, passengers, edges };

  // Each passenger's cheapest edge is unique. Those 50 edges cost 113 in
  // total and use at most four seats per driver, so both algorithms attain it.
  const expected = { matched: 50, cost: 113 };
  for (let i = 0; i < 20; i++) {
    minCostFlowMatch(input);
    greedyMatch(input);
  }
  const flowSamples: number[] = [];
  const greedySamples: number[] = [];
  let matched = 0;
  let cost = 0;
  for (let i = 0; i < 100; i++) {
    const label = `dense/sample-${i + 1}`;
    // measurePlan stops the clock before checking the returned assignments.
    const flow = measurePlan(input, minCostFlowMatch, `${label}/optimizer`);
    const greedy = measurePlan(input, greedyMatch, `${label}/greedy`);
    for (const [algorithm, plan] of [["optimizer", flow], ["greedy", greedy]] as const) {
      check(plan.matched === expected.matched && plan.cost === expected.cost,
        `${label}/${algorithm}`, `expected ${expected.matched}/${expected.cost}, got ${plan.matched}/${plan.cost}`);
    }
    flowSamples.push(flow.runtimeMs);
    greedySamples.push(greedy.runtimeMs);
    matched = flow.matched;
    cost = flow.cost;
  }
  const optimizer = summarizeTimings(flowSamples);
  check(optimizer.p95Ms <= 100, "timing", `optimizer p95 ${optimizer.p95Ms.toFixed(3)} ms exceeds the 100 ms target`);
  return {
    drivers: drivers.length,
    passengers: passengers.length,
    edges: edges.length,
    expected,
    matchedCount: matched,
    totalCost: cost,
    samples: flowSamples.length,
    optimizer,
    greedy: summarizeTimings(greedySamples),
    targetP95Ms: 100,
  };
}

function main(): void {
  const artifact = {
    experiment: "D-1 exact matching versus greedy",
    algorithm: ALGORITHM_VERSION,
    comparison: "src/matching/greedy.ts#greedyMatch",
    machine: { cpu: cpus()[0]?.model, osRelease: release() },
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    commit: gitCommit(),
    generatedAt: new Date().toISOString(),
    fixtures: runFixtures(),
    oracleSeeds: runOracleSeeds(),
    sizeClasses: sizeClasses(),
    maxBoundTiming: maxBoundTiming(),
    discrepancies,
    pass: discrepancies.length === 0,
  };

  mkdirSync("eval", { recursive: true });
  writeFileSync("eval/d1-matching.json", JSON.stringify(artifact, null, 2) + "\n");

  console.log(JSON.stringify(
    {
      experiment: artifact.experiment,
      optimizerAgreesWithOracle: `${(artifact.oracleSeeds as { optimizerAgrees: number }).optimizerAgrees}/100`,
      maxBoundP95Ms: Number(artifact.maxBoundTiming.optimizer.p95Ms.toFixed(3)),
      targetP95Ms: 100,
      discrepancies: discrepancies.length,
      pass: artifact.pass,
    },
    null,
    2,
  ));
  if (!artifact.pass) {
    console.error("\nD-1 FAILED — discrepancies:");
    for (const d of discrepancies) console.error(`  [${d.where}] ${d.detail}`);
    process.exitCode = 1;
  } else {
    console.log("\nD-1 passed: zero discrepancies; artifact at eval/d1-matching.json");
  }
}

main();
