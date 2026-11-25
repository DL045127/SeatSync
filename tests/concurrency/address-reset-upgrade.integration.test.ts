// L-01 (dataset generation, reset outcomes, key lifecycle) and L-02 (upgrade of
// a W6 database) against real PostgreSQL. Each reset runs with NO app session
// connected, so every pool is closed first.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Pool, PoolClient } from "pg";
import { normalizeCreateTrip, requestFingerprint } from "../../src/contracts/index.ts";
import { createPool } from "../../src/db/pool.ts";
import { runSetup } from "../../src/db/setup.ts";
import { testDatabase } from "../../src/db/local-target.ts";
import { __setTransactionCommitFaultHook } from "../../src/db/transaction.ts";
import { commitPreview } from "../../src/trips/commit.ts";
import { publishPreview } from "../../src/trips/preview.ts";
import { addDriver, addRequest, createTrip, getTripSnapshot } from "../../src/trips/service.ts";
import {
  APP,
  SETUP,
  createAddressTrip,
  key,
  resetTestDatabase,
  tokenFor,
  useFixtureEnvironment,
  type FixtureEnv,
} from "./helpers/address.ts";
import { resetSelectionCounters, selectionCounters } from "../../src/locations/selection-token.ts";

let env: FixtureEnv;
let pool: Pool | undefined;
let setup: Pool | undefined;

beforeEach(async () => {
  env = useFixtureEnvironment();
  await resetTestDatabase();
  resetSelectionCounters();
  pool = createPool(APP, 3);
});

afterEach(async () => {
  __setTransactionCommitFaultHook(undefined);
  await pool?.end();
  await setup?.end();
  pool = undefined;
  setup = undefined;
  env.dispose();
});

const generationOf = async (p: Pool) =>
  (await p.query<{ generation: string }>("SELECT generation FROM dataset_generation")).rows[0].generation;

/** Close the app pool (a reset refuses connected app sessions) and give a setup-role reader. */
async function quiesce(): Promise<Pool> {
  await pool!.end();
  pool = undefined;
  setup = createPool(SETUP, 1);
  return setup;
}

async function reopen(): Promise<Pool> {
  await setup?.end();
  setup = undefined;
  pool = createPool(APP, 3);
  return pool;
}

const body = (venueSelectionToken: string) => ({
  name: "Reset Check",
  departAt: "2027-03-05T17:30:00-06:00",
  locationMode: "address" as const,
  venueSelectionToken,
});

describe("L-01 reset, generation and receipts share one commit boundary", () => {
  async function scenario() {
    const p = pool!;
    const venueToken = await tokenFor(p, "Event Hall", "venue");
    const creationKey = key();
    const created = await createTrip(p, creationKey, body(venueToken));
    expect(created.httpStatus).toBe(201);
    const tripId = (created.body as { id: string }).id;
    const registrationKey = key();
    const registrationBody = { name: "Dana", startSelectionToken: await tokenFor(p, "Driver Start Delta", "driver_start", tripId), seatCapacity: 1, maxDetourMinutes: 15 };
    const registered = await addDriver(p, tripId, registrationKey, registrationBody);
    expect(registered.httpStatus).toBe(201);
    return { venueToken, creationKey, created, tripId, registrationKey, registrationBody, registered, generation: await generationOf(p) };
  }

  test("a reset that rolls back keeps data, generation, receipts and tokens, so retries replay", async () => {
    const s = await scenario();
    const reader = await quiesce();
    __setTransactionCommitFaultHook(async () => {
      throw new Error("injected failure after the reset's writes, before COMMIT");
    });
    await expect(runSetup(SETUP, testDatabase, "reset")).rejects.toThrow("injected failure");
    __setTransactionCommitFaultHook(undefined);

    expect(await generationOf(reader)).toBe(s.generation);
    expect((await reader.query("SELECT 1 FROM trips WHERE id = $1", [s.tripId])).rowCount).toBe(1);
    const p = await reopen();
    const replayCreate = await createTrip(p, s.creationKey, body(s.venueToken));
    expect(replayCreate.replayed).toBe(true);
    expect(replayCreate.httpStatus).toBe(201);
    expect(replayCreate.body).toEqual(s.created.body);
    const replayRegister = await addDriver(p, s.tripId, s.registrationKey, s.registrationBody);
    expect(replayRegister.replayed).toBe(true);
    expect(replayRegister.body).toEqual(s.registered.body);
    // The pre-reset venue token still verifies for a brand-new key.
    const fresh = await createTrip(p, key(), body(s.venueToken));
    expect(fresh.httpStatus).toBe(201);
  });

  async function expectCommittedResetOutcome(s: Awaited<ReturnType<typeof scenario>>, p: Pool) {
    expect(await generationOf(p)).not.toBe(s.generation);
    expect((await p.query("SELECT 1 FROM trips WHERE id = $1", [s.tripId])).rowCount).toBe(0);
    expect((await p.query("SELECT 1 FROM mutation_receipts WHERE request_key = ANY($1)", [[s.creationKey, s.registrationKey]])).rowCount).toBe(0);

    // The creation retry finds no receipt and its token belongs to the old generation: a NEW terminal 422.
    const retryCreate = await createTrip(p, s.creationKey, body(s.venueToken));
    expect(retryCreate.httpStatus).toBe(422);
    expect((retryCreate.body as { error: { code: string } }).error.code).toBe("LOCATION_SELECTION_INVALID");
    expect((retryCreate.body as { operation: { outcome: string } }).operation.outcome).toBe("not_applied");
    // The registration retry reaches the trip lookup first: the trip is gone, a NEW terminal 404.
    const retryRegister = await addDriver(p, s.tripId, s.registrationKey, s.registrationBody);
    expect(retryRegister.httpStatus).toBe(404);
    expect((retryRegister.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    // Retrying each again replays its NEW receipt.
    const again = await createTrip(p, s.creationKey, body(s.venueToken));
    expect(again.replayed).toBe(true);
    expect(again.body).toEqual(retryCreate.body);
    const againRegister = await addDriver(p, s.tripId, s.registrationKey, s.registrationBody);
    expect(againRegister.replayed).toBe(true);
    expect(againRegister.body).toEqual(retryRegister.body);
    // The old token was rejected because of the generation, which the advisory counter labels.
    expect(selectionCounters.mac_failure_claimed_generation_mismatch).toBeGreaterThanOrEqual(1);
    // And a fresh search under the new generation works.
    const fresh = await createTrip(p, key(), body(await tokenFor(p, "Event Hall", "venue")));
    expect(fresh.httpStatus).toBe(201);
  }

  test("a committed reset invalidates the old token and deletes receipts: new 422 and new 404", async () => {
    const s = await scenario();
    await quiesce();
    await runSetup(SETUP, testDatabase, "reset");
    const p = await reopen();
    await expectCommittedResetOutcome(s, p);
  });

  test("a lost COMMIT acknowledgement leaves data and generation in agreement (the durable state wins)", async () => {
    const s = await scenario();
    await quiesce();
    __setTransactionCommitFaultHook(async (client: PoolClient) => {
      type Queryable = { query: (...args: unknown[]) => Promise<unknown> };
      const q = client as unknown as Queryable;
      const real = q.query.bind(q);
      q.query = async (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].trim().toUpperCase().startsWith("COMMIT")) {
          q.query = real;
          await real(...args); // the server really commits
          throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }); // the acknowledgement is lost
        }
        return real(...args);
      };
    });
    await expect(runSetup(SETUP, testDatabase, "reset")).rejects.toBeTruthy();
    __setTransactionCommitFaultHook(undefined);
    const p = await reopen();
    // The reset DID commit: data and generation moved together, so retries behave as after a committed reset.
    await expectCommittedResetOutcome(s, p);
  });

  test("reset writes no files and never touches the master secret", async () => {
    await scenario();
    const keyPath = path.join(env.dir, "test", "fixture-signing.key");
    const before = readFileSync(keyPath, "utf8");
    await quiesce();
    await runSetup(SETUP, testDatabase, "reset");
    expect(readFileSync(keyPath, "utf8")).toBe(before);
  });

  test("a deleted secret between processes makes a new one: the old token gets 422, with a warning", async () => {
    const venueToken = await tokenFor(pool!, "Event Hall", "venue");
    const { rmSync } = await import("node:fs");
    const { __clearMasterCacheForTests } = await import("../../src/locations/master-key.ts");
    const { __setSelectionDeps } = await import("../../src/locations/selection-service.ts");
    await createAddressTrip(pool!); // an address trip now exists
    rmSync(path.join(env.dir, "test", "fixture-signing.key"));
    __clearMasterCacheForTests(); // a new process
    const warnings: string[] = [];
    const restore = __setSelectionDeps({ warn: (m) => warnings.push(m) });
    try {
      // A search creates the replacement secret and warns, because address trips exist.
      await tokenFor(pool!, "Event Hall", "venue");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("earlier selections are no longer valid");
      const stale = await createTrip(pool!, key(), body(venueToken));
      expect(stale.httpStatus).toBe(422);
      expect(selectionCounters.mac_failure_claimed_key_mismatch).toBe(1);
    } finally {
      restore();
    }
  });
});

// ---- L-02: upgrade over retained W6 data -----------------------------------

const insertDriverVia = (p: Pool, tripId: string, snapshot: string) =>
  p.query(
    `INSERT INTO drivers (trip_id, name, seat_capacity, location_mode, location, max_detour_minutes)
     VALUES ($1, 'Late', 1, 'address', $2::jsonb, NULL)`,
    [tripId, snapshot],
  );

const DOWNGRADE = readFileSync(path.resolve("tests/fixtures/downgrade-address.sql"), "utf8");

describe("L-02 upgrade of a W6 database", () => {
  test("migration 002 applies over retained zone data without changing it or its replay", async () => {
    const p = pool!;
    // W6-shaped state: a saved zone plan, a stored preview, applied and failed receipts.
    const createKey = key();
    const createBody = { name: "W6 Trip", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+02:00" };
    const created = await createTrip(p, createKey, createBody);
    const tripId = (created.body as { id: string }).id;
    const dKey = key();
    const dBody = { name: "Dana", zoneId: "north", seatCapacity: 1 };
    const driver = await addDriver(p, tripId, dKey, dBody);
    const passenger = await addRequest(p, tripId, key(), { name: "Pat", zoneId: "east" });
    expect(driver.httpStatus).toBe(201);
    expect(passenger.httpStatus).toBe(201);
    const preview = await publishPreview(p, tripId);
    expect(preview.body.optimal.totalCost).toBe(7);
    const commitKey = key();
    const commitBody = { previewId: preview.body.previewId };
    const commit = await commitPreview(p, tripId, commitKey, commitBody);
    expect(commit.httpStatus).toBe(200);
    const failedKey = key();
    const failed = await addDriver(p, "00000000-0000-4000-8000-0000000000aa", failedKey, dBody);
    expect(failed.httpStatus).toBe(404);

    const before = await getTripSnapshot(p, tripId);
    const reader = await quiesce();
    const receiptsBefore = (await reader.query("SELECT request_key, request_fingerprint, outcome, http_status, response_json FROM mutation_receipts ORDER BY request_key")).rows;
    const previewsBefore = (await reader.query("SELECT id, trip_id, base_version, algorithm_version, optimal_result, greedy_result FROM match_previews")).rows;
    const assignmentsBefore = (await reader.query("SELECT * FROM assignments ORDER BY request_id")).rows;
    const checksum001 = (await reader.query("SELECT checksum FROM schema_migrations WHERE name = '001_foundation.sql'")).rows[0].checksum;

    // Undo exactly what 002 added, then re-apply the REAL migration over the retained rows.
    await reader.query(DOWNGRADE);
    expect((await reader.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'dataset_generation'")).rowCount).toBe(0);
    await runSetup(SETUP, testDatabase, "migrate");
    setup = createPool(SETUP, 1);
    const after = setup;

    // 001 is untouched and 002 is recorded.
    expect((await after.query("SELECT checksum FROM schema_migrations WHERE name = '001_foundation.sql'")).rows[0].checksum).toBe(checksum001);
    expect((await after.query("SELECT 1 FROM schema_migrations WHERE name = '002_address_trips.sql'")).rowCount).toBe(1);
    expect((await after.query("SELECT 1 FROM dataset_generation")).rowCount).toBe(1);

    // Retained rows are byte-for-byte what they were, in zone mode.
    expect((await after.query("SELECT request_key, request_fingerprint, outcome, http_status, response_json FROM mutation_receipts ORDER BY request_key")).rows).toEqual(receiptsBefore);
    expect((await after.query("SELECT id, trip_id, base_version, algorithm_version, optimal_result, greedy_result FROM match_previews")).rows).toEqual(previewsBefore);
    expect((await after.query("SELECT * FROM assignments ORDER BY request_id")).rows).toEqual(assignmentsBefore);
    expect((await after.query("SELECT DISTINCT location_mode FROM (SELECT location_mode FROM trips UNION ALL SELECT location_mode FROM drivers UNION ALL SELECT location_mode FROM ride_requests) t")).rows)
      .toEqual([{ location_mode: "zone" }]);
    expect((await after.query("SELECT cost_unit, routing_policy, summary, evidence FROM match_previews")).rows)
      .toEqual([{ cost_unit: "zone_cost", routing_policy: null, summary: null, evidence: null }]);

    // Stored fingerprints still equal a fresh computation: the zone bodies are byte-identical.
    const stored = new Map(receiptsBefore.map((r) => [r.request_key, r.request_fingerprint]));
    expect(stored.get(createKey)).toBe(requestFingerprint("POST", "/api/trips", normalizeCreateTrip(createBody)));
    expect(stored.get(dKey)).toBe(requestFingerprint("POST", `/api/trips/${tripId}/drivers`, dBody));
    expect(stored.get(commitKey)).toBe(requestFingerprint("POST", `/api/trips/${tripId}/match/commit`, commitBody));

    // Same-key replays return the original stored responses, and zone reads still work.
    const p2 = await reopen();
    const replayCreate = await createTrip(p2, createKey, createBody);
    expect(replayCreate.replayed).toBe(true);
    expect(replayCreate.body).toEqual(created.body);
    const replayCommit = await commitPreview(p2, tripId, commitKey, commitBody);
    expect(replayCommit.replayed).toBe(true);
    expect(replayCommit.body).toEqual(commit.body);
    const replayFailed = await addDriver(p2, "00000000-0000-4000-8000-0000000000aa", failedKey, dBody);
    expect(replayFailed.replayed).toBe(true);
    expect(replayFailed.httpStatus).toBe(404);
    const snapshot = await getTripSnapshot(p2, tripId);
    expect(snapshot).toMatchObject({
      status: "assigned",
      version: before!.version,
      totals: before!.totals,
      locationMode: "zone",
      costUnit: "zone_cost",
      venue: null,
      estimate: null,
    });
    expect(snapshot!.drivers.map((d) => [d.name, d.zoneId, d.location])).toEqual([["Dana", "north", null]]);

    // New zone writes work, and an old zone preview still commits only while current.
    const next = await addDriver(p2, tripId, key(), { name: "Late", zoneId: "south", seatCapacity: 2 });
    expect(next.httpStatus).toBe(201);
    const staleCommit = await commitPreview(p2, tripId, key(), commitBody);
    expect(staleCommit.httpStatus).toBe(409);
    expect((staleCommit.body as { error: { code: string } }).error.code).toBe("STALE_VERSION");
  });

  test("a fresh install on an EMPTY database applies 001, 002 then 003, seeds the zones and creates one generation", async () => {
    const empty = await quiesce();
    // Return the disposable test database to its pre-migration, empty state.
    await empty.query(`DROP TABLE assignments, match_previews, drivers, ride_requests, trips, mutation_receipts,
      zone_costs, zones, dataset_generation, schema_migrations CASCADE`);
    expect((await empty.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public'")).rowCount).toBe(0);
    await runSetup(SETUP, testDatabase, "migrate"); // the same command the README tells a new installer to run
    const applied = (await empty.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r.name);
    expect(applied).toEqual(["001_foundation.sql", "002_address_trips.sql", "003_address_driver_limit.sql"]);
    expect((await empty.query("SELECT count(*)::int AS n FROM zones")).rows[0].n).toBe(4);
    expect((await empty.query("SELECT count(*)::int AS n FROM dataset_generation")).rows[0].n).toBe(1);
    // Reapplying is safe and keeps the generation.
    const generation = await generationOf(empty);
    await runSetup(SETUP, testDatabase, "migrate");
    expect(await generationOf(empty)).toBe(generation);
    // The app role works against the fresh schema: zone AND address writes.
    const p = await reopen();
    expect((await createTrip(p, key(), { name: "Fresh", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+00:00" })).httpStatus).toBe(201);
    expect((await createTrip(p, key(), body(await tokenFor(p, "Event Hall", "venue")))).httpStatus).toBe(201);
  });

  // ISSUE-057: a CHECK passes when its expression is NULL. `max_detour_minutes BETWEEN 0 AND 120`
  // is NULL for a NULL limit, so the address branch of the old constraint accepted it.
  describe("ISSUE-057: mode constraints reject NULL, out-of-range and mixed-mode rows (direct inserts)", () => {
    async function address() {
      const tripId = await createAddressTrip(pool!);
      const snapshot = (await pool!.query<{ venue_location: unknown }>("SELECT venue_location FROM trips WHERE id = $1", [tripId])).rows[0].venue_location;
      const zoneTrip = ((await createTrip(pool!, key(), { name: "Z", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+00:00" })).body as { id: string }).id;
      return { tripId, snapshot: JSON.stringify(snapshot), zoneTrip };
    }
    const insertDriver = (tripId: string, mode: string, zone: string | null, location: string | null, limit: number | null) =>
      pool!.query(
        `INSERT INTO drivers (trip_id, name, seat_capacity, location_mode, zone_id, location, max_detour_minutes)
         VALUES ($1, 'Direct', 1, $2, $3, $4::jsonb, $5)`,
        [tripId, mode, zone, location, limit],
      );
    const insertRequest = (tripId: string, mode: string, zone: string | null, location: string | null) =>
      pool!.query(
        "INSERT INTO ride_requests (trip_id, name, location_mode, zone_id, location) VALUES ($1, 'Direct', $2, $3, $4::jsonb)",
        [tripId, mode, zone, location],
      );

    test("an address driver needs a non-null limit between 0 and 120 inclusive", async () => {
      const { tripId, snapshot } = await address();
      await expect(insertDriver(tripId, "address", null, snapshot, null)).rejects.toMatchObject({ code: "23514" });
      await expect(insertDriver(tripId, "address", null, snapshot, -1)).rejects.toMatchObject({ code: "23514" });
      await expect(insertDriver(tripId, "address", null, snapshot, 121)).rejects.toMatchObject({ code: "23514" });
      await insertDriver(tripId, "address", null, snapshot, 0);
      await insertDriver(tripId, "address", null, snapshot, 120);
      expect((await pool!.query("SELECT count(*)::int AS n FROM drivers WHERE trip_id = $1", [tripId])).rows[0].n).toBe(2);
    });

    test("a zone driver has a zone and no address or limit; an address driver has no zone", async () => {
      const { tripId, snapshot, zoneTrip } = await address();
      await expect(insertDriver(zoneTrip, "zone", "north", null, 15)).rejects.toMatchObject({ code: "23514" }); // zone driver with a limit
      await expect(insertDriver(zoneTrip, "zone", null, null, null)).rejects.toMatchObject({ code: "23514" }); // zone driver with no zone
      await expect(insertDriver(zoneTrip, "zone", "north", snapshot, null)).rejects.toMatchObject({ code: "23514" }); // zone driver with an address
      await expect(insertDriver(tripId, "address", "north", snapshot, 15)).rejects.toMatchObject({ code: "23514" }); // address driver with a zone
      await expect(insertDriver(tripId, "address", null, null, 15)).rejects.toMatchObject({ code: "23514" }); // address driver, no address
      await insertDriver(zoneTrip, "zone", "north", null, null);
    });

    test("a request follows the same rules, and a row cannot disagree with its trip's mode", async () => {
      const { tripId, snapshot, zoneTrip } = await address();
      await expect(insertRequest(tripId, "address", null, null)).rejects.toMatchObject({ code: "23514" });
      await expect(insertRequest(tripId, "address", "north", snapshot)).rejects.toMatchObject({ code: "23514" });
      await expect(insertRequest(zoneTrip, "zone", "north", snapshot)).rejects.toMatchObject({ code: "23514" });
      await insertRequest(tripId, "address", null, snapshot);
      // A well-formed address row on a ZONE trip violates the (trip, mode) foreign key.
      await expect(insertRequest(zoneTrip, "address", null, snapshot)).rejects.toMatchObject({ code: "23503" });
      await expect(insertDriver(zoneTrip, "address", null, snapshot, 15)).rejects.toMatchObject({ code: "23503" });
    });

    test("a database that already applied the ORIGINAL 002 is repaired by 003 without losing rows", async () => {
      const { tripId, snapshot } = await address();
      await insertDriver(tripId, "address", null, snapshot, 15);
      const reader = await quiesce();
      // Put the database back to exactly what the original 002 left: the old constraint, no 003.
      await reader.query(`
        ALTER TABLE drivers DROP CONSTRAINT driver_mode_fields;
        ALTER TABLE drivers ADD CONSTRAINT driver_mode_fields CHECK (
          (location_mode = 'zone' AND zone_id IS NOT NULL AND location IS NULL AND max_detour_minutes IS NULL)
          OR (location_mode = 'address' AND zone_id IS NULL AND location IS NOT NULL AND max_detour_minutes BETWEEN 0 AND 120));
        DELETE FROM schema_migrations WHERE name = '003_address_driver_limit.sql';`);
      await reader.query(
        `INSERT INTO drivers (trip_id, name, seat_capacity, location_mode, location, max_detour_minutes)
         VALUES ($1, 'Old', 1, 'address', $2::jsonb, NULL)`, [tripId, snapshot]);
      // The old constraint really did accept the NULL limit (the reported defect).
      expect((await reader.query("SELECT count(*)::int AS n FROM drivers WHERE max_detour_minutes IS NULL")).rows[0].n).toBe(1);
      // 003 refuses to validate while such a row exists: a data repair is required, not silently ignored.
      await expect(runSetup(SETUP, testDatabase, "migrate")).rejects.toMatchObject({ code: "23514" });
      await reader.query("DELETE FROM drivers WHERE max_detour_minutes IS NULL");
      await runSetup(SETUP, testDatabase, "migrate");
      expect((await reader.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r.name))
        .toEqual(["001_foundation.sql", "002_address_trips.sql", "003_address_driver_limit.sql"]);
      expect((await reader.query("SELECT count(*)::int AS n FROM drivers")).rows[0].n).toBe(1); // the valid driver survived
      const p = await reopen();
      await expect(insertDriverVia(p, tripId, snapshot)).rejects.toMatchObject({ code: "23514" });
    });
  });

  test("the app role cannot write the generation or its table", async () => {
    const client = await pool!.connect();
    try {
      await expect(client.query("UPDATE dataset_generation SET generation = gen_random_uuid()")).rejects.toMatchObject({ code: "42501" });
    } finally {
      client.release();
    }
    const c2 = await pool!.connect();
    try {
      await expect(c2.query("DELETE FROM dataset_generation")).rejects.toMatchObject({ code: "42501" });
    } finally {
      c2.release();
    }
  });

  test("a fresh install and a reset both leave exactly one generation", async () => {
    expect((await pool!.query("SELECT count(*)::int AS n FROM dataset_generation")).rows[0].n).toBe(1);
    const g1 = await generationOf(pool!);
    await quiesce();
    await runSetup(SETUP, testDatabase, "reset");
    const p = await reopen();
    expect((await p.query("SELECT count(*)::int AS n FROM dataset_generation")).rows[0].n).toBe(1);
    expect(await generationOf(p)).not.toBe(g1);
  });
});
