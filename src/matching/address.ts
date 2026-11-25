// Pure projection from an address roster plus frozen directed leg durations to
// the same MatchInput the zone projector produces (docs/ARCHITECTURE-v2.md
// section 5). No database, network or filesystem. The matcher still sees only
// participant IDs, capacities and integer edge costs.
//
//   extraSeconds = max(0, round(seconds(D,P) + seconds(P,V) - seconds(D,V)))
//   eligible     = all three legs routable and extraSeconds <= maxDetour * 60
//
// Half-seconds round up; a negative estimated difference clamps to zero and is
// counted for profile-quality review. A no-route or unknown duration never
// becomes a zero-cost edge.

import type { MatchEdge, MatchInput } from "./types.ts";

/** A confirmed place as the projection needs it. `id` is the immutable location ID. */
export interface AddressPoint {
  id: string;
  providerRef: string;
  lon: number;
  lat: number;
}

export interface AddressDriver {
  id: string;
  seatCapacity: number;
  active: boolean;
  maxDetourMinutes: number;
  location: AddressPoint;
}

export interface AddressPassenger {
  id: string;
  active: boolean;
  location: AddressPoint;
}

export interface AddressRoster {
  drivers: readonly AddressDriver[];
  passengers: readonly AddressPassenger[];
  venue: AddressPoint;
}

export type LegSource = "provider" | "identical_endpoint";

/** One directed observation. `seconds` null is a confirmed no-route. */
export interface Leg {
  from: string;
  to: string;
  seconds: number | null;
  source: LegSource;
  /** Provider observation time; null for a locally resolved identical endpoint. */
  observedAt: string | null;
}

export interface DirectedPair {
  from: AddressPoint;
  to: AddressPoint;
}

export const MAX_EDGE_SECONDS = 120 * 60;

export function legKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/** Exact numeric equality of the validated coordinate pairs, across distinct IDs. */
export function identicalCoordinates(a: AddressPoint, b: AddressPoint): boolean {
  return a.lon === b.lon && a.lat === b.lat;
}

/** An identical endpoint resolves locally to zero seconds with no provider observation. */
export function resolveIdentical(pair: DirectedPair): Leg | undefined {
  if (!identicalCoordinates(pair.from, pair.to)) return undefined;
  return { from: pair.from.id, to: pair.to.id, seconds: 0, source: "identical_endpoint", observedAt: null };
}

/** The participants a solve involves: active, and for drivers with seats to offer. */
export function demandAndSupply(roster: AddressRoster): {
  drivers: AddressDriver[];
  passengers: AddressPassenger[];
} {
  return {
    drivers: roster.drivers.filter((d) => d.active && d.seatCapacity > 0),
    passengers: roster.passengers.filter((p) => p.active),
  };
}

/**
 * Directed pairs a solve needs: each D->P, D->V and P->V, deduplicated by
 * ordered location IDs. With no supply or no demand the set is empty, so an
 * empty roster makes no provider call.
 */
export function requiredPairs(roster: AddressRoster): DirectedPair[] {
  const { drivers, passengers } = demandAndSupply(roster);
  if (drivers.length === 0 || passengers.length === 0) return [];
  const pairs = new Map<string, DirectedPair>();
  const add = (from: AddressPoint, to: AddressPoint) => {
    const key = legKey(from.id, to.id);
    if (!pairs.has(key)) pairs.set(key, { from, to });
  };
  for (const d of drivers) {
    add(d.location, roster.venue);
    for (const p of passengers) add(d.location, p.location);
  }
  for (const p of passengers) add(p.location, roster.venue);
  return [...pairs.values()];
}

/**
 * Directed pairs worth RETAINING between previews: every driver->pickup,
 * driver->venue and pickup->venue pair over ALL active drivers (including those
 * offering zero seats, who may regain capacity) and all active pickups. A pair
 * stays while some active participant still references the relevant location in
 * that role; once the last reference is withdrawn or canceled the pair drops
 * from the next preview. This is a superset of requiredPairs.
 */
export function retentionPairs(roster: AddressRoster): DirectedPair[] {
  const drivers = roster.drivers.filter((d) => d.active);
  const passengers = roster.passengers.filter((p) => p.active);
  const pairs = new Map<string, DirectedPair>();
  const add = (from: AddressPoint, to: AddressPoint) => {
    if (from.id === to.id) return;
    const key = legKey(from.id, to.id);
    if (!pairs.has(key)) pairs.set(key, { from, to });
  };
  for (const d of drivers) {
    add(d.location, roster.venue);
    for (const p of passengers) add(d.location, p.location);
  }
  for (const p of passengers) add(p.location, roster.venue);
  return [...pairs.values()];
}

/**
 * Half-up rounding of the final difference, clamped at zero. A NEGATIVE
 * ESTIMATE is counted before rounding: -0.25 s rounds to 0 but is still a
 * negative estimate the profile-quality counter must see (ISSUE-069).
 */
export function detourSeconds(driverToPickup: number, pickupToVenue: number, driverToVenue: number): {
  seconds: number;
  clamped: boolean;
} {
  const difference = driverToPickup + pickupToVenue - driverToVenue;
  return { seconds: Math.max(0, Math.floor(difference + 0.5)), clamped: difference < 0 };
}

export class AddressEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressEvidenceError";
  }
}

export interface ProjectionStats {
  clampedNegative: number;
}

/**
 * Project the roster and legs into a MatchInput. Every required leg must be
 * present: a missing observation is an invariant failure, never a free edge.
 */
export function projectAddressMatchInput(
  roster: AddressRoster,
  legs: ReadonlyMap<string, Leg>,
): { input: MatchInput; stats: ProjectionStats } {
  const { drivers, passengers } = demandAndSupply(roster);
  const stats: ProjectionStats = { clampedNegative: 0 };
  const edges: MatchEdge[] = [];
  // With no supply or no demand a solve needs no leg at all (requiredPairs is
  // empty), so no edge is built and no observation may be demanded.
  if (drivers.length === 0 || passengers.length === 0) {
    return {
      input: {
        drivers: drivers.map((d) => ({ id: d.id, seatCapacity: d.seatCapacity })),
        passengers: passengers.map((p) => ({ id: p.id })),
        edges,
      },
      stats,
    };
  }

  const lookup = (from: AddressPoint, to: AddressPoint): Leg => {
    const leg = legs.get(legKey(from.id, to.id));
    if (!leg) throw new AddressEvidenceError("A required directed leg has no observation.");
    return leg;
  };

  for (const d of drivers) {
    const driverToVenue = lookup(d.location, roster.venue);
    for (const p of passengers) {
      const driverToPickup = lookup(d.location, p.location);
      const pickupToVenue = lookup(p.location, roster.venue);
      if (driverToPickup.seconds === null || pickupToVenue.seconds === null || driverToVenue.seconds === null) {
        continue; // a confirmed no-route excludes only its dependent pairs
      }
      const { seconds, clamped } = detourSeconds(
        driverToPickup.seconds,
        pickupToVenue.seconds,
        driverToVenue.seconds,
      );
      if (clamped) stats.clampedNegative += 1;
      if (seconds > d.maxDetourMinutes * 60) continue; // inclusive limit
      edges.push({ driverId: d.id, passengerId: p.id, cost: seconds });
    }
  }

  return {
    input: {
      drivers: drivers.map((d) => ({ id: d.id, seatCapacity: d.seatCapacity })),
      passengers: passengers.map((p) => ({ id: p.id })),
      edges,
    },
    stats,
  };
}
