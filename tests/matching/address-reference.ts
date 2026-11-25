// INDEPENDENT reference for the address projection (docs/ARCHITECTURE-v2.md,
// "Independent projection check"). Written from the design's formula and rules,
// not from the production projector. It deliberately shares no helper with
// src/matching/address.ts or src/trips/address-*.ts: it keys raw directed times
// by COORDINATES, applies the identical-coordinate rule itself, rounds with
// Math.round (a different expression from the production floor(x + 0.5)), and
// builds the expected MatchInput directly for the exhaustive oracle.
//
//   extra    = max(0, round(sec(D,P) + sec(P,V) - sec(D,V)))
//   eligible = all three legs routable and extra <= limitMinutes * 60
//   a leg between EXACTLY equal coordinates is 0 seconds and is never requested

import type { MatchInput } from "../../src/matching/types.ts";

export interface Loc {
  id: string;
  ref: string;
  lon: number;
  lat: number;
}
export interface Dr {
  id: string;
  seats: number;
  active: boolean;
  limitMinutes: number;
  loc: Loc;
}
export interface Pa {
  id: string;
  active: boolean;
  loc: Loc;
}
export interface State {
  venue: Loc;
  drivers: Dr[];
  passengers: Pa[];
}

export type Edit =
  | { kind: "seats"; driver: string; seats: number }
  | { kind: "cancel"; driver: string }
  | { kind: "withdraw"; passenger: string }
  | { kind: "addDriver"; driver: Dr }
  | { kind: "addPassenger"; passenger: Pa };

export interface Scenario {
  seed: number;
  initial: State;
  edits: Edit[];
  /** Explicit raw values that override the hashed table (exact-limit and over-by-half-a-second cases). */
  overrides: Array<{ from: string; to: string; seconds: number | null }>;
}

// ---- deterministic randomness ----------------------------------------------

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const coordKey = (l: { lon: number; lat: number }) => `${l.lon},${l.lat}`;
const pairKey = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => `${coordKey(a)}>${coordKey(b)}`;

/** The raw directed time FROM a TO b. Independent per direction; null is a confirmed no-route. */
export function rawSeconds(scenario: Scenario, a: { lon: number; lat: number }, b: { lon: number; lat: number }): number | null {
  if (a.lon === b.lon && a.lat === b.lat) throw new Error("A leg between equal coordinates must never be requested.");
  const key = pairKey(a, b);
  const override = scenario.overrides.find((o) => o.from === coordKey(a) && o.to === coordKey(b));
  if (override) return override.seconds;
  const r = mulberry(hashString(`${scenario.seed}|${key}`));
  if (r() < 0.12) return null;
  return Math.floor(r() * 9600) / 4; // 0 .. 2400 s in QUARTER-second steps, so -0.25 s estimates occur
}

// ---- scenario generator -----------------------------------------------------

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export function generateScenario(seed: number): Scenario {
  const r = mulberry(seed * 7919 + 13);
  let next = 1;
  const nextId = () => uuid(seed * 1000 + next++);
  // A small coordinate pool, so locations repeat and sometimes coincide.
  const pool = Array.from({ length: 7 }, (_, i) => ({ lon: -97 + i * 0.01, lat: 30 + ((i * 3) % 7) * 0.01 }));
  const makeLoc = (): Loc => {
    const c = pool[Math.floor(r() * pool.length)];
    const id = nextId();
    return { id, ref: `ref-${id.slice(-8)}`, lon: c.lon, lat: c.lat };
  };
  // A location ID is purpose-scoped in the real API: one token may serve several drivers (or
  // several passengers), but never two roles. So IDs are shared WITHIN a role only, while the
  // COORDINATES may coincide across roles under different IDs.
  const startLocs: Loc[] = [];
  const pickupLocs: Loc[] = [];
  const locFor = (pool: Loc[]): Loc => {
    if (pool.length > 0 && r() < 0.2) return pool[Math.floor(r() * pool.length)];
    const l = makeLoc();
    pool.push(l);
    return l;
  };
  const venue = makeLoc();
  const driver = (): Dr => ({
    id: nextId(),
    seats: [0, 1, 1, 2, 3][Math.floor(r() * 5)],
    active: r() > 0.12,
    limitMinutes: [0, 3, 8, 15, 15, 40][Math.floor(r() * 6)],
    loc: locFor(startLocs),
  });
  const passenger = (): Pa => ({ id: nextId(), active: r() > 0.12, loc: locFor(pickupLocs) });

  const initial: State = {
    venue,
    drivers: Array.from({ length: Math.floor(r() * 4) + 1 }, driver),
    passengers: Array.from({ length: Math.floor(r() * 6) + 1 }, passenger),
  };

  const overrides: Scenario["overrides"] = [];
  const scenarioShell: Scenario = { seed, initial, edits: [], overrides };

  // Engineer exact-limit and just-over-the-limit edges: choose a pair at distinct coordinates and
  // set D->V so that extra is EXACTLY k minutes (or k minutes and half a second).
  if (r() < 0.5) {
    const d = initial.drivers[Math.floor(r() * initial.drivers.length)];
    const p = initial.passengers[Math.floor(r() * initial.passengers.length)];
    const same = (a: Loc, b: Loc) => a.lon === b.lon && a.lat === b.lat;
    if (!same(d.loc, p.loc) && !same(p.loc, venue) && !same(d.loc, venue)) {
      const dp = rawSeconds(scenarioShell, d.loc, p.loc);
      const pv = rawSeconds(scenarioShell, p.loc, venue);
      if (dp !== null && pv !== null) {
        const k = Math.floor(r() * 6);
        // Mostly engineer an estimate exactly at, just under or over the limit; sometimes a SLIGHTLY
        // NEGATIVE estimate (-0.25 or -0.5 s) that rounds to zero, which random values almost never hit.
        const target = r() < 0.3
          ? -[0.25, 0.5][Math.floor(r() * 2)]
          : k * 60 + [0, 0, 0.25, 0.5][Math.floor(r() * 4)];
        const dv = dp + pv - target;
        if (dv >= 0) {
          overrides.push({ from: coordKey(d.loc), to: coordKey(venue), seconds: dv });
          d.limitMinutes = k; // exactly at the limit when half === 0, half a second over otherwise
          d.seats = Math.max(1, d.seats);
          d.active = true;
          p.active = true;
        }
      }
    }
  }

  // Edit sequence, kept inside the exhaustive oracle's bound (4 drivers, 7 passengers).
  const edits: Edit[] = [];
  const working: State = structuredClone(initial);
  for (let step = 0; step < 3; step += 1) {
    const roll = r();
    if (roll < 0.3 && working.drivers.length > 0) {
      const d = working.drivers[Math.floor(r() * working.drivers.length)];
      const seats = d.seats > 0 ? 0 : [1, 2][Math.floor(r() * 2)];
      edits.push({ kind: "seats", driver: d.id, seats });
      d.seats = seats;
    } else if (roll < 0.45 && working.drivers.some((d) => d.active)) {
      const live = working.drivers.filter((d) => d.active);
      const d = live[Math.floor(r() * live.length)];
      edits.push({ kind: "cancel", driver: d.id });
      d.active = false;
    } else if (roll < 0.65 && working.passengers.some((p) => p.active)) {
      const live = working.passengers.filter((p) => p.active);
      const p = live[Math.floor(r() * live.length)];
      edits.push({ kind: "withdraw", passenger: p.id });
      p.active = false;
    } else if (roll < 0.82 && working.drivers.length < 4) {
      const d = driver();
      d.active = true;
      edits.push({ kind: "addDriver", driver: d });
      working.drivers.push(structuredClone(d));
    } else if (working.passengers.length < 7) {
      const p = passenger();
      p.active = true;
      edits.push({ kind: "addPassenger", passenger: p });
      working.passengers.push(structuredClone(p));
    }
  }
  return { seed, initial, edits, overrides };
}

export function applyEdit(state: State, edit: Edit): State {
  const next = structuredClone(state);
  switch (edit.kind) {
    case "seats":
      next.drivers.find((d) => d.id === edit.driver)!.seats = edit.seats;
      break;
    case "cancel":
      next.drivers.find((d) => d.id === edit.driver)!.active = false;
      break;
    case "withdraw":
      next.passengers.find((p) => p.id === edit.passenger)!.active = false;
      break;
    case "addDriver":
      next.drivers.push(structuredClone(edit.driver));
      break;
    case "addPassenger":
      next.passengers.push(structuredClone(edit.passenger));
      break;
  }
  return next;
}

// ---- the reference calculation ------------------------------------------------

const same = (a: Loc, b: Loc) => a.lon === b.lon && a.lat === b.lat;

/** A leg's seconds by the reference rule: zero for equal coordinates, else the raw table. */
function leg(scenario: Scenario, a: Loc, b: Loc): number | null {
  return same(a, b) ? 0 : rawSeconds(scenario, a, b);
}

export interface RefEdge {
  driverId: string;
  passengerId: string;
  cost: number;
}

export interface RefResult {
  edges: RefEdge[];
  input: MatchInput;
  /** How many estimates were negative and clamped, and how many landed on a half second. */
  clamped: number;
  /** Negative estimates that nevertheless ROUND to zero (-0.5 <= x < 0): the ISSUE-069 case. */
  clampedRoundsToZero: number;
  halves: number;
  exactlyAtLimit: number;
}

export function referenceEdges(scenario: Scenario, state: State): RefResult {
  const drivers = state.drivers.filter((d) => d.active && d.seats > 0);
  const passengers = state.passengers.filter((p) => p.active);
  const edges: RefEdge[] = [];
  let clamped = 0;
  let clampedRoundsToZero = 0;
  let halves = 0;
  let exactlyAtLimit = 0;
  for (const d of drivers) {
    for (const p of passengers) {
      const dp = leg(scenario, d.loc, p.loc);
      const pv = leg(scenario, p.loc, state.venue);
      const dv = leg(scenario, d.loc, state.venue);
      if (dp === null || pv === null || dv === null) continue;
      const raw = dp + pv - dv;
      if (raw < 0) clamped += 1; // counted BEFORE rounding
      if (raw < 0 && Math.round(raw) === 0) clampedRoundsToZero += 1;
      if (Math.abs(raw % 1) === 0.5) halves += 1;
      const extra = Math.max(0, Math.round(raw));
      if (extra === d.limitMinutes * 60) exactlyAtLimit += 1;
      if (extra <= d.limitMinutes * 60) edges.push({ driverId: d.id, passengerId: p.id, cost: extra });
    }
  }
  return {
    edges,
    clamped,
    clampedRoundsToZero,
    halves,
    exactlyAtLimit,
    input: {
      drivers: drivers.map((d) => ({ id: d.id, seatCapacity: d.seats })),
      passengers: passengers.map((p) => ({ id: p.id })),
      edges,
    },
  };
}

// ---- expected upstream cells (an independent model of reuse) -------------------

const idKey = (a: Loc, b: Loc) => `${a.id}>${b.id}`;

/** Directed ID pairs the solve needs. */
export function referenceRequired(state: State): Map<string, [Loc, Loc]> {
  const out = new Map<string, [Loc, Loc]>();
  const drivers = state.drivers.filter((d) => d.active && d.seats > 0);
  const passengers = state.passengers.filter((p) => p.active);
  if (drivers.length === 0 || passengers.length === 0) return out;
  for (const d of drivers) {
    out.set(idKey(d.loc, state.venue), [d.loc, state.venue]);
    for (const p of passengers) out.set(idKey(d.loc, p.loc), [d.loc, p.loc]);
  }
  for (const p of passengers) out.set(idKey(p.loc, state.venue), [p.loc, state.venue]);
  return out;
}

/** Directed ID pairs still worth keeping: every ACTIVE driver (any seats) against every active pickup. */
export function referenceRetention(state: State): Set<string> {
  const out = new Set<string>();
  const drivers = state.drivers.filter((d) => d.active);
  const passengers = state.passengers.filter((p) => p.active);
  for (const d of drivers) {
    if (d.loc.id !== state.venue.id) out.add(idKey(d.loc, state.venue));
    for (const p of passengers) if (d.loc.id !== p.loc.id) out.add(idKey(d.loc, p.loc));
  }
  for (const p of passengers) if (p.loc.id !== state.venue.id) out.add(idKey(p.loc, state.venue));
  return out;
}

/**
 * Step the lineage and return the number of provider cells a correct
 * implementation must request: required legs that were not carried over and are
 * not between equal coordinates.
 */
export function stepLineage(
  lineage: Set<string>,
  state: State,
): { lineage: Set<string>; expectedFetched: number } {
  const required = referenceRequired(state);
  const retention = referenceRetention(state);
  const carried = new Set([...lineage].filter((k) => retention.has(k)));
  let expectedFetched = 0;
  for (const [key, [a, b]] of required) {
    if (carried.has(key)) continue;
    if (!same(a, b)) expectedFetched += 1;
  }
  return { lineage: new Set([...carried, ...required.keys()]), expectedFetched };
}

export const asCoordinates = coordKey;
