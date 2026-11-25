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
import { addDriver, addRequest, createTrip } from "../../../src/trips/service.ts";

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
