// Checks on a STORED preview before it is served again (ISSUE-066). A stored hit
// is returned without recomputation, so nothing else stands between a corrupt or
// hand-edited row and the browser. These checks use only the roster at the
// preview's version (no private leg evidence) and apply to zone and address
// trips alike.

import { StoredDataError } from "../contracts/errors.ts";
import type { MatchingResult } from "../matching/index.ts";

export interface RosterFacts {
  drivers: ReadonlyArray<{ id: string; seats: number; active: boolean }>;
  passengers: ReadonlyArray<{ id: string; active: boolean }>;
}

/**
 * The result must describe THIS trip's roster: every assigned driver is an
 * active driver with room, every passenger active and assigned once, nobody from
 * outside the trip appears, and the assigned and unassigned passengers together
 * are exactly the active passengers. A foreign UUID, an over-full driver, a
 * canceled driver or a withdrawn passenger is a server-side failure.
 */
export function assertResultMatchesRoster(result: MatchingResult, roster: RosterFacts, which: string): void {
  const fail = (reason: string): never => {
    throw new StoredDataError(`Stored ${which} result ${reason}.`);
  };
  const active = new Set(roster.passengers.filter((p) => p.active).map((p) => p.id));
  const seats = new Map(roster.drivers.filter((d) => d.active).map((d) => [d.id, d.seats] as const));
  const used = new Map<string, number>();
  const seen = new Set<string>();
  for (const a of result.assignments) {
    if (!active.has(a.passengerId)) fail("names a passenger outside this trip's active roster");
    if (!seats.has(a.driverId)) fail("names a driver outside this trip's active roster");
    if (seen.has(a.passengerId)) fail("assigns a passenger twice");
    seen.add(a.passengerId);
    const count = (used.get(a.driverId) ?? 0) + 1;
    used.set(a.driverId, count);
    if (count > (seats.get(a.driverId) ?? 0)) fail("assigns a driver beyond its seats");
  }
  for (const id of result.unassignedPassengerIds) {
    if (!active.has(id)) fail("lists an unassigned passenger outside this trip's active roster");
    if (seen.has(id)) fail("lists a passenger as both assigned and unassigned");
    seen.add(id);
  }
  if (seen.size !== active.size) fail("does not cover exactly the active passengers");
}

/** Copy ONLY the contract's fields, so a stored extra field can never reach a response. */
export function pickResult(result: MatchingResult): MatchingResult {
  return {
    assignments: result.assignments.map((a) => ({ passengerId: a.passengerId, driverId: a.driverId, cost: a.cost })),
    unassignedPassengerIds: [...result.unassignedPassengerIds],
    matchedCount: result.matchedCount,
    totalCost: result.totalCost,
  };
}
