// Independent feasibility validator for a MatchingResult against a MatchInput.
// It re-derives capacity, uniqueness, membership, compatibility, the
// assigned/unassigned partition, and the summed totals. It shares no flow or
// reverse-edge logic with the optimizer, so it can catch optimizer defects.

import {
  type MatchInput,
  type MatchingResult,
  buildCostLookup,
  edgeKey,
} from "./types.ts";

export class FeasibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeasibilityError";
  }
}

/**
 * Throw FeasibilityError when `result` is not a feasible plan for `input`.
 * This checks feasibility and internal consistency only; optimality comes from
 * the trusted optimizer plus an unchanged input version, not from this check.
 */
export function assertFeasible(input: MatchInput, result: MatchingResult): void {
  const lookup = buildCostLookup(input);
  const capacity = new Map<string, number>();
  for (const d of input.drivers) capacity.set(d.id, d.seatCapacity);
  const activePassengers = new Set(input.passengers.map((p) => p.id));

  const seatsUsed = new Map<string, number>();
  const assignedPassengers = new Set<string>();
  let summedCost = 0;

  for (const a of result.assignments) {
    if (!activePassengers.has(a.passengerId)) {
      throw new FeasibilityError(
        `Assignment references unknown or inactive passenger ${a.passengerId}.`,
      );
    }
    if (!capacity.has(a.driverId)) {
      throw new FeasibilityError(
        `Assignment references unknown or inactive driver ${a.driverId}.`,
      );
    }
    if (assignedPassengers.has(a.passengerId)) {
      throw new FeasibilityError(
        `Passenger ${a.passengerId} assigned more than once.`,
      );
    }
    assignedPassengers.add(a.passengerId);

    const edgeCost = lookup.get(edgeKey(a.driverId, a.passengerId));
    if (edgeCost === undefined) {
      throw new FeasibilityError(
        `Incompatible pair ${a.driverId}->${a.passengerId}.`,
      );
    }
    if (edgeCost !== a.cost) {
      throw new FeasibilityError(
        `Assignment cost ${a.cost} does not match edge cost ${edgeCost}.`,
      );
    }
    summedCost += a.cost;
    seatsUsed.set(a.driverId, (seatsUsed.get(a.driverId) ?? 0) + 1);
  }

  for (const [driverId, used] of seatsUsed) {
    if (used > (capacity.get(driverId) ?? 0)) {
      throw new FeasibilityError(`Driver ${driverId} exceeds seat capacity.`);
    }
  }

  // Assigned and unassigned must form a complete partition of active passengers
  // with no duplicates and no overlap.
  const unassigned = new Set(result.unassignedPassengerIds);
  if (unassigned.size !== result.unassignedPassengerIds.length) {
    throw new FeasibilityError("Duplicate entries in unassignedPassengerIds.");
  }
  for (const id of unassigned) {
    if (!activePassengers.has(id)) {
      throw new FeasibilityError(`Unassigned list references unknown passenger ${id}.`);
    }
    if (assignedPassengers.has(id)) {
      throw new FeasibilityError(`Passenger ${id} both assigned and unassigned.`);
    }
  }
  if (assignedPassengers.size + unassigned.size !== activePassengers.size) {
    throw new FeasibilityError(
      "Assigned and unassigned passengers do not partition the active roster.",
    );
  }

  if (result.matchedCount !== result.assignments.length) {
    throw new FeasibilityError("matchedCount disagrees with assignments length.");
  }
  if (result.totalCost !== summedCost) {
    throw new FeasibilityError("totalCost disagrees with summed assignment costs.");
  }
}
