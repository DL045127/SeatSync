// Pure matching domain types. No database, network, or framework imports.

/** A driver available for the current match, with projected per-passenger cost. */
export interface MatchDriver {
  id: string;
  seatCapacity: number; // 0..8; zero-seat active drivers receive nobody
}

/** A passenger requesting one seat. */
export interface MatchPassenger {
  id: string;
}

/**
 * Directional driver -> passenger pickup cost. A missing pair is incompatible
 * (x = 0); a present cost of 0 is a usable zero-cost edge. Costs are integers
 * in [0, 10000]; the matcher trusts the service to have projected them already.
 */
export interface MatchEdge {
  driverId: string;
  passengerId: string;
  cost: number;
}

/**
 * The matching problem. Participants are already filtered to active members by
 * the caller; the matcher additionally rejects duplicate IDs and edges that
 * reference unknown members.
 */
export interface MatchInput {
  drivers: readonly MatchDriver[];
  passengers: readonly MatchPassenger[];
  edges: readonly MatchEdge[];
}

export interface Assignment {
  passengerId: string;
  driverId: string;
  cost: number;
}

/**
 * A `MatchingResult` as defined by the API contract. Assignments are sorted by
 * passenger ID, and `unassignedPassengerIds` is sorted; both use stable ASCII
 * UUID ordering so repeated or permuted input yields identical output.
 */
export interface MatchingResult {
  assignments: Assignment[];
  unassignedPassengerIds: string[];
  matchedCount: number;
  totalCost: number;
}

export class MatchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchInputError";
  }
}

// Supported per-trip match bounds (architecture section 2). These are the
// active-member counts the matcher accepts; the lifetime record caps that
// include inactive members are enforced earlier, at the service boundary.
export const MATCH_LIMITS = {
  maxDrivers: 20,
  maxPassengers: 50,
} as const;

// Participant IDs must be canonical lowercase UUIDs. Requiring this before
// building the lookup both matches the contract normalization and makes the
// NUL-delimited edge key injective: no participant ID can contain the
// separator, so two distinct pairs can never collide to one key.
const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertCanonicalUuid(id: unknown, role: "driver" | "passenger"): void {
  // Guard the primitive type first: `RegExp.test` and template-string edge keys
  // both coerce a non-string (e.g. `[id]`) to a string, which would let an
  // array containing a UUID pass the pattern while the capacity and membership
  // maps still treat it as a distinct key.
  if (typeof id !== "string" || !CANONICAL_UUID_RE.test(id)) {
    throw new MatchInputError(`Non-canonical ${role} id ${JSON.stringify(id)}.`);
  }
}

/** Ascending ASCII comparison for deterministic ordering. */
export function asciiLess(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Validate structural input and build a compatibility lookup. Rejects duplicate
 * driver/passenger IDs, edges referencing unknown members, duplicate edges, and
 * out-of-range costs. Returns a map keyed `driverId\u0000passengerId`.
 */
export function buildCostLookup(input: MatchInput): Map<string, number> {
  if (input.drivers.length > MATCH_LIMITS.maxDrivers) {
    throw new MatchInputError(
      `Too many drivers: ${input.drivers.length} exceeds ${MATCH_LIMITS.maxDrivers}.`,
    );
  }
  if (input.passengers.length > MATCH_LIMITS.maxPassengers) {
    throw new MatchInputError(
      `Too many passengers: ${input.passengers.length} exceeds ${MATCH_LIMITS.maxPassengers}.`,
    );
  }
  const driverIds = new Set<string>();
  for (const d of input.drivers) {
    assertCanonicalUuid(d.id, "driver");
    if (driverIds.has(d.id)) {
      throw new MatchInputError(`Duplicate driver id ${d.id}.`);
    }
    if (!Number.isInteger(d.seatCapacity) || d.seatCapacity < 0 || d.seatCapacity > 8) {
      throw new MatchInputError(`Invalid seat capacity for driver ${d.id}.`);
    }
    driverIds.add(d.id);
  }
  const passengerIds = new Set<string>();
  for (const p of input.passengers) {
    assertCanonicalUuid(p.id, "passenger");
    if (passengerIds.has(p.id)) {
      throw new MatchInputError(`Duplicate passenger id ${p.id}.`);
    }
    passengerIds.add(p.id);
  }
  const lookup = new Map<string, number>();
  for (const e of input.edges) {
    if (!driverIds.has(e.driverId)) {
      throw new MatchInputError(`Edge references unknown driver ${e.driverId}.`);
    }
    if (!passengerIds.has(e.passengerId)) {
      throw new MatchInputError(
        `Edge references unknown passenger ${e.passengerId}.`,
      );
    }
    if (!Number.isInteger(e.cost) || e.cost < 0 || e.cost > 10_000) {
      throw new MatchInputError(
        `Edge cost out of range for ${e.driverId}->${e.passengerId}.`,
      );
    }
    const key = `${e.driverId}\u0000${e.passengerId}`;
    if (lookup.has(key)) {
      throw new MatchInputError(
        `Duplicate edge ${e.driverId}->${e.passengerId}.`,
      );
    }
    lookup.set(key, e.cost);
  }
  return lookup;
}

export function edgeKey(driverId: string, passengerId: string): string {
  return `${driverId}\u0000${passengerId}`;
}
