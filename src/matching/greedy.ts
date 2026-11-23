// Greedy comparison matcher. It is deliberately suboptimal: it serves as the
// D-1 comparison baseline and must NOT satisfy the coverage/cost optimality
// claim on M-01/M-08. It is not used to produce committable results.

import {
  type MatchInput,
  type MatchingResult,
  asciiLess,
  buildCostLookup,
  edgeKey,
} from "./types.ts";

/**
 * Process passengers in ascending ID order; each takes the cheapest compatible
 * driver with remaining capacity, breaking ties by ascending driver ID. Once a
 * passenger is placed the choice is never revised, so greedy can block a later
 * passenger who had only one compatible driver.
 */
export function greedyMatch(input: MatchInput): MatchingResult {
  const lookup = buildCostLookup(input);
  const remaining = new Map<string, number>();
  for (const d of input.drivers) remaining.set(d.id, d.seatCapacity);
  const driverOrder = [...input.drivers].map((d) => d.id).sort(asciiLess);
  const passengerOrder = [...input.passengers].map((p) => p.id).sort(asciiLess);

  const assignments: MatchingResult["assignments"] = [];
  const unassigned: string[] = [];
  for (const passengerId of passengerOrder) {
    let bestDriver: string | undefined;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const driverId of driverOrder) {
      if ((remaining.get(driverId) ?? 0) <= 0) continue;
      const cost = lookup.get(edgeKey(driverId, passengerId));
      if (cost === undefined) continue;
      if (cost < bestCost) {
        bestCost = cost;
        bestDriver = driverId;
      }
    }
    if (bestDriver === undefined) {
      unassigned.push(passengerId);
      continue;
    }
    remaining.set(bestDriver, (remaining.get(bestDriver) ?? 0) - 1);
    assignments.push({ passengerId, driverId: bestDriver, cost: bestCost });
  }

  assignments.sort((a, b) => asciiLess(a.passengerId, b.passengerId));
  unassigned.sort(asciiLess);
  return {
    assignments,
    unassignedPassengerIds: unassigned,
    matchedCount: assignments.length,
    totalCost: assignments.reduce((sum, a) => sum + a.cost, 0),
  };
}
