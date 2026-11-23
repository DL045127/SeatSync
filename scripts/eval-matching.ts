// Early maximum-size timing measurement for the pure optimizer (W1 leave-behind;
// the formal responsiveness gate is W5/P-01). Builds an uncached worst-case-ish
// instance at the supported bounds (20 drivers, 50 passengers, dense
// compatibility) and reports median and p95 pure solver time over 100 samples
// after a warmup. No database, HTTP, or cache is involved.

import { performance } from "node:perf_hooks";
import { minCostFlowMatch } from "../src/matching/index.ts";
import type { MatchEdge, MatchInput } from "../src/matching/types.ts";
import { seededId } from "../tests/matching/fromMatrix.ts";

function maxInstance(): MatchInput {
  const drivers = Array.from({ length: 20 }, (_, i) => ({
    id: seededId("d", i),
    seatCapacity: 8,
  }));
  const passengers = Array.from({ length: 50 }, (_, j) => ({ id: seededId("p", j) }));
  const edges: MatchEdge[] = [];
  // Dense compatibility with spread-out costs so the solver does real work.
  drivers.forEach((d, i) => {
    passengers.forEach((p, j) => {
      edges.push({ driverId: d.id, passengerId: p.id, cost: ((i * 7 + j * 13) % 101) });
    });
  });
  return { drivers, passengers, edges };
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function main(): void {
  const input = maxInstance();

  // Warmup.
  for (let i = 0; i < 20; i++) minCostFlowMatch(input);

  const samples: number[] = [];
  let lastMatched = 0;
  let lastCost = 0;
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    const result = minCostFlowMatch(input);
    samples.push(performance.now() - start);
    lastMatched = result.matchedCount;
    lastCost = result.totalCost;
  }
  samples.sort((a, b) => a - b);

  const median = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  console.log(
    JSON.stringify(
      {
        algorithm: "mincostflow-v1",
        drivers: input.drivers.length,
        passengers: input.passengers.length,
        edges: input.edges.length,
        matchedCount: lastMatched,
        totalCost: lastCost,
        samples: samples.length,
        medianMs: Number(median.toFixed(3)),
        p95Ms: Number(p95.toFixed(3)),
        node: process.version,
      },
      null,
      2,
    ),
  );
  console.log(
    `\nEarly measurement only; the W5/P-01 gate (p95 <= 100 ms pure solver) is` +
      ` evaluated on the documented demo machine with a production build.`,
  );
}

main();
