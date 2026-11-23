// Deterministic seeded instance generator for oracle comparison. Reproducible
// across runs: the same seed always yields the same instance. UUID-shaped IDs
// keep the ASCII ordering contract exercised.

import type { MatchDriver, MatchEdge, MatchInput, MatchPassenger } from "../../src/matching/types.ts";

/** mulberry32: a small, fast, deterministic 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuidFrom(rand: () => number): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += hex[Math.floor(rand() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) out += "-";
  }
  return out;
}

export interface RandomCaseOptions {
  maxDrivers: number; // up to 4 per the oracle bound
  maxPassengers: number; // up to 7 per the oracle bound
  maxSeats: number; // 0..8
  maxCost: number; // 0..10000
  compatibility: number; // probability an edge exists, 0..1
}

const DEFAULTS: RandomCaseOptions = {
  maxDrivers: 4,
  maxPassengers: 7,
  maxSeats: 3,
  maxCost: 10,
  compatibility: 0.6,
};

/** Build a deterministic small instance for the given seed. */
export function randomCase(
  seed: number,
  options: Partial<RandomCaseOptions> = {},
): MatchInput {
  const opts = { ...DEFAULTS, ...options };
  const rand = mulberry32(seed + 1);
  const driverCount = 1 + Math.floor(rand() * opts.maxDrivers);
  const passengerCount = 1 + Math.floor(rand() * opts.maxPassengers);

  const drivers: MatchDriver[] = [];
  for (let i = 0; i < driverCount; i++) {
    drivers.push({
      id: uuidFrom(rand),
      seatCapacity: Math.floor(rand() * (opts.maxSeats + 1)),
    });
  }
  const passengers: MatchPassenger[] = [];
  for (let i = 0; i < passengerCount; i++) {
    passengers.push({ id: uuidFrom(rand) });
  }
  const edges: MatchEdge[] = [];
  for (const d of drivers) {
    for (const p of passengers) {
      if (rand() < opts.compatibility) {
        edges.push({
          driverId: d.id,
          passengerId: p.id,
          cost: Math.floor(rand() * (opts.maxCost + 1)),
        });
      }
    }
  }
  return { drivers, passengers, edges };
}
