// Pure projection from the authoritative roster to a MatchInput. This is the
// step the trip service runs before matching: it filters inactive participants
// and projects the immutable directional zone-cost table into per-pair driver
// -> passenger pickup costs. A missing (driverZone, passengerZone) entry means
// the pair is incompatible and produces no edge; a present cost of 0 is a
// usable zero-cost edge. No database or network dependencies.

import type { MatchEdge, MatchInput } from "./types.ts";

/** A rostered driver as stored, including activity and home zone. */
export interface RosterDriver {
  id: string;
  zoneId: string;
  seatCapacity: number;
  active: boolean;
}

/** A rostered passenger as stored, including activity and home zone. */
export interface RosterPassenger {
  id: string;
  zoneId: string;
  active: boolean;
}

/** One directional zone cost entry from the immutable cost table. */
export interface ZoneCost {
  driverZoneId: string;
  passengerZoneId: string;
  cost: number;
}

export interface Roster {
  drivers: readonly RosterDriver[];
  passengers: readonly RosterPassenger[];
  zoneCosts: readonly ZoneCost[];
}

function zoneKey(driverZoneId: string, passengerZoneId: string): string {
  return `${driverZoneId}\u0000${passengerZoneId}`;
}

/**
 * Project the roster into a MatchInput. Inactive drivers and passengers are
 * excluded entirely, so an omitted activity filter would change the result and
 * be caught by a test that asserts exact assigned/unassigned IDs. The cost is
 * read in the directional order (driver zone first, passenger zone second), so
 * a reversed projection changes the cost and is detectable (WF-4).
 */
export function projectMatchInput(roster: Roster): MatchInput {
  const costByZonePair = new Map<string, number>();
  for (const c of roster.zoneCosts) {
    costByZonePair.set(zoneKey(c.driverZoneId, c.passengerZoneId), c.cost);
  }

  const drivers = roster.drivers
    .filter((d) => d.active)
    .map((d) => ({ id: d.id, seatCapacity: d.seatCapacity, zoneId: d.zoneId }));
  const passengers = roster.passengers
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, zoneId: p.zoneId }));

  const edges: MatchEdge[] = [];
  for (const d of drivers) {
    for (const p of passengers) {
      const cost = costByZonePair.get(zoneKey(d.zoneId, p.zoneId));
      if (cost === undefined) continue; // missing pair = incompatible
      edges.push({ driverId: d.id, passengerId: p.id, cost });
    }
  }

  return {
    drivers: drivers.map(({ id, seatCapacity }) => ({ id, seatCapacity })),
    passengers: passengers.map(({ id }) => ({ id })),
    edges,
  };
}
