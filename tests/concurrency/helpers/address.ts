// Shared harness for the address integration suites: database URLs, offline
// fixture-provider environment with an isolated key directory, and helpers that
// drive the same service functions the routes call.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import type { Pool } from "pg";
import { __clearMasterCacheForTests } from "../../../src/locations/master-key.ts";
import { searchLocations } from "../../../src/locations/selection-service.ts";
import { appRole, assertLocalTarget, setupRole, testDatabase } from "../../../src/db/local-target.ts";
import { runSetup } from "../../../src/db/setup.ts";
import { addDriver, addRequest } from "../../../src/trips/service.ts";
import { createTripWithWorkspace as createTrip } from "./workspace.ts";

if (existsSync(".env")) loadEnvFile();
const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!setupUrl || !appUrl) {
  throw new Error("Configure TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL for the address suites.");
}
assertLocalTarget(appUrl, testDatabase, appRole);
assertLocalTarget(setupUrl, testDatabase, setupRole);
export const SETUP = setupUrl;
export const APP = appUrl;

export const key = () => randomUUID();

export interface FixtureEnv {
  dir: string;
  dispose: () => void;
}

/** Offline fixture provider with its own key directory, so tests never touch `.groupride-local`. */
export function useFixtureEnvironment(): FixtureEnv {
  const dir = mkdtempSync(path.join(tmpdir(), "groupride-address-"));
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
  process.env.GROUPRIDE_LOCAL_DIR = dir;
  process.env.GROUPRIDE_USE_TEST_DATABASE = "1";
  process.env.DATABASE_URL = APP;
  __clearMasterCacheForTests();
  return {
    dir,
    dispose: () => {
      delete process.env.GROUPRIDE_ADDRESS_PROVIDER;
      delete process.env.GROUPRIDE_LOCAL_DIR;
      delete process.env.GROUPRIDE_USE_TEST_DATABASE;
      __clearMasterCacheForTests();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function resetTestDatabase(): Promise<string> {
  await runSetup(SETUP, testDatabase, "migrate");
  return (await runSetup(SETUP, testDatabase, "reset"))!;
}

export type Purpose = "venue" | "driver_start" | "pickup";

/** The signed token of the catalog place named `name` (exact label), via real search. */
export async function tokenFor(pool: Pool, name: string, purpose: Purpose, tripId?: string): Promise<string> {
  const result = await searchLocations(pool, tripId ? { query: name, purpose, tripId } : { query: name, purpose });
  const wanted = `GROUPRIDE FIXTURE — ${name}`;
  const hit = result.body.suggestions.find((s) => s.label === wanted && s.selectable);
  if (!hit?.token) throw new Error(`No selectable suggestion for ${name}.`);
  return hit.token;
}

export async function createAddressTrip(pool: Pool, venue = "Event Hall"): Promise<string> {
  const token = await tokenFor(pool, venue, "venue");
  const res = await createTrip(pool, key(), {
    name: "Austin evening event",
    departAt: "2027-03-05T17:30:00-06:00",
    locationMode: "address",
    venueSelectionToken: token,
  });
  if (res.httpStatus !== 201) throw new Error(`Trip creation failed: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

export async function registerDriver(
  pool: Pool,
  tripId: string,
  name: string,
  startPlace: string,
  seats: number,
  maxDetourMinutes = 15,
): Promise<string> {
  const res = await addDriver(pool, tripId, key(), {
    name,
    startSelectionToken: await tokenFor(pool, startPlace, "driver_start", tripId),
    seatCapacity: seats,
    maxDetourMinutes,
  });
  if (res.httpStatus !== 201) throw new Error(`Driver registration failed: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

export async function registerPassenger(pool: Pool, tripId: string, name: string, pickupPlace: string): Promise<string> {
  const res = await addRequest(pool, tripId, key(), {
    name,
    pickupSelectionToken: await tokenFor(pool, pickupPlace, "pickup", tripId),
  });
  if (res.httpStatus !== 201) throw new Error(`Passenger registration failed: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

// ---- synthetic places and a counting routing double (checkpoint B) ----------------------------
//
// The offline catalog has only eight places, so a 20-driver / 50-pickup roster of DISTINCT
// coordinates needs tokens for synthetic ones. They are minted with the real signing path (real
// master secret and database generation), so registration, scope and verification are the real
// service code. The routing double replaces the fixture adapter through the production seam.

import { signSelection } from "../../../src/locations/selection-token.ts";
import { loadMaster } from "../../../src/locations/master-key.ts";
import {
  RoutingUnavailable,
  __setRoutingAdapterForTests,
  type RoutingAdapter,
} from "../../../src/routing/index.ts";
import type { DirectedPair } from "../../../src/matching/address.ts";

export interface Spot {
  ref: string;
  lon: number;
  lat: number;
}

/** `count` distinct coordinates under a prefix, spaced far enough apart to stay distinct. */
export function spots(prefix: string, count: number, base = 0): Spot[] {
  return Array.from({ length: count }, (_, i) => ({
    ref: `${prefix}-${i + 1}`,
    lon: -97.9 + (base + i) * 0.0013,
    lat: 30.05 + ((base + i) % 37) * 0.0017,
  }));
}

export async function mint(pool: Pool, purpose: Purpose, tripId: string | null, spot: Spot): Promise<string> {
  const dir = process.env.GROUPRIDE_LOCAL_DIR!;
  const { master } = await loadMaster({ mode: "fixture", target: "test", rootDir: dir });
  const generation = (await pool.query<{ generation: string }>("SELECT generation FROM dataset_generation")).rows[0].generation;
  return signSelection({
    context: { master, generation },
    purpose,
    tripId,
    provider: "fixture",
    id: randomUUID(),
    nowMs: Date.now(),
    snapshot: {
      providerRef: spot.ref,
      countryCode: "US",
      label: `GROUPRIDE FIXTURE — synthetic ${spot.ref}`,
      address: { city: "Fixtureville", state: "TX" },
      lon: spot.lon,
      lat: spot.lat,
      precision: "building",
      attribution: "GroupRide fixture data (fictional places and times)",
    },
  });
}

export async function createSyntheticTrip(pool: Pool, venue: Spot, name = "Synthetic trip"): Promise<string> {
  const res = await createTrip(pool, key(), {
    name,
    departAt: "2027-03-05T17:30:00-06:00",
    locationMode: "address",
    venueSelectionToken: await mint(pool, "venue", null, venue),
  });
  if (res.httpStatus !== 201) throw new Error(`Trip creation failed: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

export async function addSyntheticDriver(
  pool: Pool, tripId: string, name: string, spot: Spot, seats: number, limitMinutes = 15,
): Promise<string> {
  const res = await addDriver(pool, tripId, key(), {
    name,
    startSelectionToken: await mint(pool, "driver_start", tripId, spot),
    seatCapacity: seats,
    maxDetourMinutes: limitMinutes,
  });
  if (res.httpStatus !== 201) throw new Error(`Driver registration failed: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

export async function addSyntheticPassenger(pool: Pool, tripId: string, name: string, spot: Spot): Promise<string> {
  const res = await addRequest(pool, tripId, key(), {
    name,
    pickupSelectionToken: await mint(pool, "pickup", tripId, spot),
  });
  if (res.httpStatus !== 201) throw new Error(`Passenger registration failed: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

/** A deterministic directed time that is independent per direction and never zero. */
export function hashSeconds(from: { providerRef: string }, to: { providerRef: string }): number {
  let h = 2166136261;
  for (const ch of `${from.providerRef}>${to.providerRef}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return 200 + ((h >>> 0) % 1400);
}

export interface RoutingStats {
  /** Provider cells successfully requested. */
  cells: number;
  /** fetchLegs invocations that returned cells. */
  calls: number;
  /** fetchLegs invocations of any kind, including ones refused by an outage. */
  attempts: number;
  /** Every ordered `from>to` providerRef requested, in order. */
  requested: string[];
}

export interface RoutingDouble {
  stats: RoutingStats;
  /** While true every fetch throws RoutingUnavailable (after being counted as an attempt). */
  setOutage(on: boolean): void;
  reset(): void;
  restore(): void;
}

/** Install a counting routing double through the production seam (the fixture provider's adapter). */
export function installRouting(
  seconds: (from: DirectedPair["from"], to: DirectedPair["to"]) => number | null = hashSeconds,
  policyId = "test-double/drive/v1",
): RoutingDouble {
  const stats: RoutingStats = { cells: 0, calls: 0, attempts: 0, requested: [] };
  let outage = false;
  const adapter: RoutingAdapter = {
    provider: "fixture",
    policyId,
    async fetchLegs(pairs) {
      stats.attempts += 1;
      if (outage) throw new RoutingUnavailable("injected outage");
      stats.calls += 1;
      stats.cells += pairs.length;
      for (const { from, to } of pairs) {
        if (from.lon === to.lon && from.lat === to.lat) throw new Error("An identical endpoint reached the provider.");
        stats.requested.push(`${from.providerRef}>${to.providerRef}`);
      }
      return pairs.map(({ from, to }) => seconds(from, to));
    },
  };
  __setRoutingAdapterForTests(adapter);
  return {
    stats,
    setOutage: (on) => { outage = on; },
    reset: () => { stats.cells = 0; stats.calls = 0; stats.attempts = 0; stats.requested.length = 0; },
    restore: () => __setRoutingAdapterForTests(undefined),
  };
}
