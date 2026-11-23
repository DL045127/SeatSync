// Independent exhaustive oracle for small matching instances. It enumerates
// every feasible assignment by recursive backtracking over passengers, tracking
// remaining seats, and keeps the best (maximum matched count, then minimum
// cost). It shares NO flow, residual, or reverse-edge logic with the optimizer,
// so agreement is independent evidence.
//
// Bounded to small instances (architecture: 7 passengers / 4 drivers) because
// the search is exponential.

import {
  type MatchInput,
  buildCostLookup,
  edgeKey,
} from "../../src/matching/types.ts";

export interface OracleResult {
  matchedCount: number;
  totalCost: number;
}

/**
 * Return the optimal objective for `input`: the maximum number of passengers
 * that can be accommodated, and the minimum total cost among plans achieving
 * that maximum. Infeasible pairs are simply never chosen.
 */
export function oracleObjective(input: MatchInput): OracleResult {
  const lookup = buildCostLookup(input);
  const passengers = input.passengers.map((p) => p.id);
  const drivers = input.drivers.map((d) => d.id);
  const remaining = new Map<string, number>();
  for (const d of input.drivers) remaining.set(d.id, d.seatCapacity);

  let bestCount = 0;
  let bestCost = 0;

  const consider = (count: number, cost: number) => {
    if (count > bestCount || (count === bestCount && cost < bestCost)) {
      bestCount = count;
      bestCost = cost;
    }
  };

  const recurse = (index: number, count: number, cost: number) => {
    if (index === passengers.length) {
      consider(count, cost);
      return;
    }
    const passengerId = passengers[index];
    // Option: leave this passenger unassigned.
    recurse(index + 1, count, cost);
    // Option: assign to each compatible driver with remaining capacity.
    for (const driverId of drivers) {
      if ((remaining.get(driverId) ?? 0) <= 0) continue;
      const edgeCost = lookup.get(edgeKey(driverId, passengerId));
      if (edgeCost === undefined) continue;
      remaining.set(driverId, (remaining.get(driverId) ?? 0) - 1);
      recurse(index + 1, count + 1, cost + edgeCost);
      remaining.set(driverId, (remaining.get(driverId) ?? 0) + 1);
    }
  };

  recurse(0, 0, 0);
  return { matchedCount: bestCount, totalCost: bestCost };
}
