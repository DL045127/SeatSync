import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, __resetAppPoolForTests } from "../../src/db/pool.ts";
import { testDatabase } from "../../src/db/local-target.ts";
import { runSetup } from "../../src/db/setup.ts";
import { bootstrapWorkspace, workspaceCookie } from "../../src/workspaces/service.ts";
import { addDriver, addRequest, createTrip, editDriver, editRequest, getTripSnapshot } from "../../src/trips/service.ts";
import { publishPreview } from "../../src/trips/preview.ts";
import { commitPreview } from "../../src/trips/commit.ts";
import { addressCounters, resetAddressCounters } from "../../src/trips/address-metrics.ts";
import type { AddressEvidence } from "../../src/trips/address-evidence.ts";
import { persistTravelBatch, purgeFixtureTravelTimes } from "../../src/trips/travel-times.ts";
import { POST } from "../../src/app/api/trips/[tripId]/match/preview/route.ts";
import { APP, SETUP, key, tokenFor, resetTestDatabase, useFixtureEnvironment, installRouting, type FixtureEnv } from "./helpers/address.ts";
import type { DirectedPair } from "../../src/matching/address.ts";

let pool: Pool;
let admin: Pool;
let env: FixtureEnv;

beforeEach(async () => {
  env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS", "30");
  await resetTestDatabase();
  pool = createPool(APP, 3);
  admin = createPool(SETUP, 2);
  resetAddressCounters();
});

afterEach(async () => {
  await __resetAppPoolForTests();
  await pool.end();
  await admin.end();
  vi.unstubAllEnvs();
  env.dispose();
});

async function trip(secret: string) {
  const created = await createTrip(pool, key(), {
    name: "Reuse meeting", locationMode: "address", departAt: "2027-03-05T17:30:00-06:00",
    venueSelectionToken: await tokenFor(pool, "Event Hall", "venue"),
  }, secret);
  expect(created.httpStatus).toBe(201);
  const { id } = created.body as { id: string };
  expect((await addDriver(pool, id, key(), {
    name: "Driver", startSelectionToken: await tokenFor(pool, "Driver Start Delta", "driver_start", id),
    seatCapacity: 2, maxDetourMinutes: 15,
  })).httpStatus).toBe(201);
  await passenger(id, "First rider");
  return id;
}

async function passenger(id: string, name: string) {
  expect((await addRequest(pool, id, key(), {
    name, pickupSelectionToken: await tokenFor(pool, "Pickup Alpha", "pickup", id),
  })).httpStatus).toBe(201);
}

const ownedPreview = (id: string, secret: string) => publishPreview(pool, id, undefined, secret);
const routedPreview = (id: string, secret?: string) => POST(new Request("http://127.0.0.1/api/preview", {
  method: "POST",
  headers: secret ? { cookie: `${workspaceCookie}=${secret}` } : {},
}), { params: Promise.resolve({ tripId: id }) });

test("fixture batches persist and an owner's matching coordinates reuse across trips through the route", async () => {
  const owner = await bootstrapWorkspace(pool);
  const outsider = await bootstrapWorkspace(pool);
  const cold = await trip(owner.secret!);
  const warm = await trip(owner.secret!);
  const unauthorized = await trip(owner.secret!);
  const coldResult = await (await routedPreview(cold, owner.secret)).json();
  expect(coldResult).toMatchObject({ optimal: { matchedCount: 1, totalCost: 230 }, estimate: { legs: { fetched: 3 } } });
  expect((await admin.query("SELECT seconds FROM travel_times WHERE workspace_id=$1 ORDER BY seconds", [owner.id])).rows)
    .toEqual([{ seconds: 346 }, { seconds: 403 }, { seconds: 519 }]);

  process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
  expect((await routedPreview(unauthorized, outsider.secret)).status).toBe(503);
  expect((await routedPreview(unauthorized)).status).toBe(503);
  const warmed = await routedPreview(warm, owner.secret);
  expect(warmed.status).toBe(200);
  const result = await warmed.json();
  expect(result).toMatchObject({ optimal: { matchedCount: 1, totalCost: 230 }, estimate: { legs: { reused: 3, fetched: 0 } } });
  expect((await commitPreview(pool, warm, key(), { previewId: result.previewId })).httpStatus).toBe(200);
  expect(await getTripSnapshot(pool, warm)).toMatchObject({ status: "assigned", totals: { matched: 1, totalCost: 230 } });

  vi.stubEnv("GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS", "0");
  expect((await routedPreview(unauthorized, owner.secret)).status).toBe(503);
  vi.stubEnv("GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS", "30");
  await admin.query("UPDATE travel_times SET routing_policy='older-fixture-policy'");
  expect((await routedPreview(unauthorized, owner.secret)).status).toBe(503);
});

test("a new pickup ID at the same coordinates reuses trip evidence with sharing disabled", async () => {
  vi.stubEnv("GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS", "0");
  const owner = await bootstrapWorkspace(pool);
  const id = await trip(owner.secret!);
  await ownedPreview(id, owner.secret!);
  await passenger(id, "Second rider");
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
  const result = await ownedPreview(id, owner.secret!);
  expect(result.body).toMatchObject({ optimal: { matchedCount: 2, totalCost: 460 }, estimate: { legs: { reused: 5, fetched: 0 } } });
  expect((await admin.query("SELECT 1 FROM travel_times")).rowCount).toBe(0);
});

test("read failures dispatch nothing, optional write failures still publish", async () => {
  const owner = await bootstrapWorkspace(pool);
  const id = await trip(owner.secret!);
  const locker = await admin.connect();
  const adapter = installRouting();
  try {
    await locker.query("BEGIN");
    await locker.query("LOCK travel_times IN ACCESS EXCLUSIVE MODE");
    const blocked = await routedPreview(id, owner.secret);
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).error.code).toBe("DATABASE_BUSY");
    expect(adapter.stats.attempts).toBe(0);
    await locker.query("ROLLBACK");
    adapter.restore();

    // SHARE allows the scoped lookup while blocking the real fixture upsert.
    await locker.query("BEGIN");
    await locker.query("LOCK travel_times IN SHARE MODE");
    const result = await ownedPreview(id, owner.secret!);
    expect(result.body.optimal.matchedCount).toBe(1);
    expect(addressCounters.travelTimeWriteFailed).toBe(1);
    expect((await pool.query("SELECT 1 FROM travel_times")).rowCount).toBe(0);
  } finally {
    adapter.restore();
    await locker.query("ROLLBACK");
    locker.release();
  }
});

test("an expired observation is refreshed, future rows are repaired and cleanup is global", async () => {
  const owner = await bootstrapWorkspace(pool);
  const another = await bootstrapWorkspace(pool);
  const cold = await trip(owner.secret!);
  const next = await trip(owner.secret!);
  await ownedPreview(cold, owner.secret!);
  await admin.query("UPDATE travel_times SET observed_at=now()-interval '31 days' WHERE seconds=403");
  await admin.query("UPDATE travel_times SET observed_at=now()+interval '1 day' WHERE seconds=346");
  await admin.query(`INSERT INTO travel_times SELECT $1, routing_policy, from_point, to_point, seconds,
    now()-interval '38 days' FROM travel_times WHERE workspace_id=$2 AND seconds=519`, [another.id, owner.id]);

  expect((await ownedPreview(next, owner.secret!)).body.estimate).toMatchObject({ legs: { fetched: 2, reused: 1 } });
  const rows = await admin.query(
    "SELECT workspace_id, seconds, observed_at BETWEEN now()-interval '1 hour' AND now() AS fresh FROM travel_times ORDER BY seconds",
  );
  expect(rows.rows).toEqual([346, 403, 519].map(seconds => ({ workspace_id: owner.id, seconds, fresh: true })));

  await admin.query("UPDATE travel_times SET observed_at=now()-interval '38 days' WHERE seconds=519");
  await purgeFixtureTravelTimes(pool);
  expect((await admin.query("SELECT seconds FROM travel_times ORDER BY seconds")).rows).toEqual([{ seconds: 346 }, { seconds: 403 }]);
});

test("a batch carrying the old generation is discarded even with a valid post-reset owner and trip", async () => {
  const { generation } = (await admin.query("SELECT generation FROM dataset_generation")).rows[0];
  await pool.end();
  await runSetup(SETUP, testDatabase, "reset");
  pool = createPool(APP, 3);
  const owner = await bootstrapWorkspace(pool);
  const id = await trip(owner.secret!);
  const pair: DirectedPair = {
    from: { id: "start", lon: -97.1, lat: 30.2, providerRef: "start" },
    to: { id: "end", lon: -97.2, lat: 30.2, providerRef: "end" },
  };
  const observation = { pair, leg: { from: pair.from.id, to: pair.to.id, seconds: 120,
    source: "provider" as const, observedAt: new Date().toISOString() } };
  const scope = { generation, workspaceId: owner.id, tripId: id, secret: owner.secret!, policyId: "fixture-test", maxAgeDays: 30 };
  await persistTravelBatch(pool, scope, [observation]);
  expect((await admin.query("SELECT 1 FROM travel_times")).rowCount).toBe(0);
  const current = (await admin.query("SELECT generation FROM dataset_generation")).rows[0].generation;
  await persistTravelBatch(pool, { ...scope, generation: current }, [observation]);
  expect((await admin.query("SELECT seconds FROM travel_times")).rows).toEqual([{ seconds: 120 }]);
});

test("ISSUE-124: reselecting the same pickup preserves an offline preview; forged history still fails", async () => {
  const owner = await bootstrapWorkspace(pool);
  const id = await trip(owner.secret!);
  const cold = await ownedPreview(id, owner.secret!);
  const { id: rider } = (await pool.query("SELECT id FROM ride_requests WHERE trip_id=$1", [id])).rows[0];
  const edit = await editRequest(pool, id, rider, key(), {
    baseVersion: cold.body.baseVersion,
    details: { name: "First rider", pickupSelectionToken: await tokenFor(pool, "Pickup Alpha", "pickup", id) },
  });
  expect(edit.httpStatus).toBe(200);
  expect((await pool.query("SELECT location FROM participant_location_history WHERE trip_id=$1", [id])).rows[0].location)
    .toEqual({ id: expect.any(String), lon: expect.any(Number), lat: expect.any(Number), providerRef: expect.any(String) });

  process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
  const result = await ownedPreview(id, owner.secret!);
  expect(result.body).toMatchObject({ optimal: { matchedCount: 1, totalCost: 230 }, estimate: { legs: { reused: 3, fetched: 0 } } });
  expect(addressCounters.reuseCandidateDiscarded).toBe(0);

  process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
  const editedAgain = await editRequest(pool, id, rider, key(), {
    baseVersion: result.body.baseVersion,
    details: { name: "First rider", pickupSelectionToken: await tokenFor(pool, "Pickup Alpha", "pickup", id) },
  });
  expect(editedAgain.httpStatus).toBe(200);
  await admin.query(`UPDATE match_previews SET evidence=jsonb_set(evidence, '{passengers,0,location,lat}', '0')
    WHERE id=$1`, [result.body.previewId]);
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
  expect((await routedPreview(id, owner.secret)).status).toBe(503);
  expect(addressCounters.reuseCandidateDiscarded).toBe(1);
});

test("ISSUE-125: a zero-seat preview retains re-keyed legs for an offline seat restoration", async () => {
  vi.stubEnv("GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS", "0");
  const owner = await bootstrapWorkspace(pool);
  const id = await trip(owner.secret!);
  const cold = await ownedPreview(id, owner.secret!);
  const { id: driver } = (await pool.query("SELECT id FROM drivers WHERE trip_id=$1", [id])).rows[0];
  const { id: rider } = (await pool.query("SELECT id FROM ride_requests WHERE trip_id=$1", [id])).rows[0];
  expect((await editDriver(pool, id, driver, key(), { baseVersion: cold.body.baseVersion, seatCapacity: 0 })).httpStatus).toBe(200);
  await passenger(id, "Replacement rider");
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [id])).rows[0];
  expect((await editRequest(pool, id, rider, key(), { baseVersion: version, active: false })).httpStatus).toBe(200);
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
  const dormant = await ownedPreview(id, owner.secret!);
  expect(dormant.body.optimal.matchedCount).toBe(0);
  const stored = await pool.query("SELECT jsonb_array_length(evidence->'legs') AS count FROM match_previews WHERE id=$1",
    [dormant.body.previewId]);
  expect(stored.rows[0].count).toBe(3);
  expect((await editDriver(pool, id, driver, key(), {
    baseVersion: dormant.body.baseVersion, seatCapacity: 1,
  })).httpStatus).toBe(200);
  expect((await ownedPreview(id, owner.secret!)).body).toMatchObject({
    optimal: { matchedCount: 1, totalCost: 230 }, estimate: { legs: { reused: 3, fetched: 0 } },
  });
});

test("ISSUE-127: an idle workspace cannot cascade past the child-row cleanup limit", async () => {
  const owner = await bootstrapWorkspace(pool);
  await admin.query("UPDATE workspaces SET last_used_at=now()-interval '366 days' WHERE id=$1", [owner.id]);
  await admin.query("UPDATE workspace_sessions SET last_used_at=now()-interval '366 days' WHERE workspace_id=$1", [owner.id]);
  await admin.query(`INSERT INTO travel_times
    SELECT $1, 'fixture-test', n::text, 'target', 42, now()-interval '38 days'
    FROM generate_series(1,2500) AS n`, [owner.id]);
  for (const remaining of [1500, 500, 0]) {
    await purgeFixtureTravelTimes(pool);
    expect((await admin.query("SELECT count(*)::int AS n FROM travel_times WHERE workspace_id=$1", [owner.id])).rows[0].n)
      .toBe(remaining);
    expect((await admin.query("SELECT 1 FROM workspaces WHERE id=$1", [owner.id])).rowCount)
      .toBe(remaining ? 1 : 0);
  }
});

test("ISSUE-129: a genuine later pickup cannot validate the earlier preview's legs", async () => {
  vi.stubEnv("GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS", "0");
  const owner = await bootstrapWorkspace(pool);
  const id = await trip(owner.secret!);
  const original = await ownedPreview(id, owner.secret!);
  expect(original.body.optimal.totalCost).toBe(230);
  const { id: rider } = (await pool.query("SELECT id FROM ride_requests WHERE trip_id=$1", [id])).rows[0];
  const bravoToken = await tokenFor(pool, "Pickup Bravo", "pickup", id);
  const charlieToken = await tokenFor(pool, "Pickup Charlie", "pickup", id);
  let baseVersion = original.body.baseVersion;
  for (const pickupSelectionToken of [bravoToken, charlieToken, bravoToken, charlieToken]) {
    expect((await editRequest(pool, id, rider, key(), {
      baseVersion: baseVersion++, details: { name: "First rider", pickupSelectionToken },
    })).httpStatus).toBe(200);
  }
  const { rows: history } = await pool.query(`SELECT location, replaced_at_version FROM participant_location_history
    WHERE trip_id=$1 AND participant_id=$2 ORDER BY replaced_at_version`, [id, rider]);
  expect(history.map(row => row.replaced_at_version)).toEqual([
    original.body.baseVersion + 1, original.body.baseVersion + 2, original.body.baseVersion + 3, original.body.baseVersion + 4,
  ]);
  expect(history[1].location).toEqual(history[3].location);

  expect((await editRequest(pool, id, rider, key(), { baseVersion, active: false })).httpStatus).toBe(200);
  expect((await addRequest(pool, id, key(), {
    name: "Replacement rider", pickupSelectionToken: bravoToken,
  })).httpStatus).toBe(201);
  const { rows } = await pool.query<{ evidence: AddressEvidence }>("SELECT evidence FROM match_previews WHERE id=$1", [original.body.previewId]);
  const { evidence } = rows[0];
  const previous = evidence.passengers[0].location.id;
  const bravo = history[1].location;
  const replaceId = (endpoint: string) => endpoint === previous ? bravo.id : endpoint;
  await admin.query("UPDATE match_previews SET evidence=$2 WHERE id=$1", [original.body.previewId, {
    ...evidence,
    passengers: [{ id: rider, location: bravo }],
    legs: evidence.legs.map(leg => ({ ...leg, from: replaceId(leg.from), to: replaceId(leg.to) })),
  }]);

  process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
  const offline = await routedPreview(id, owner.secret);
  expect(offline.status).toBe(503);
  expect(addressCounters.reuseCandidateDiscarded).toBe(1);
  expect((await pool.query("SELECT 1 FROM match_previews WHERE trip_id=$1", [id])).rowCount).toBe(1);
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
  const clean = await ownedPreview(id, owner.secret!);
  expect(clean.body.optimal.totalCost).toBe(64);
  expect(clean.body.estimate?.legs).toMatchObject({ reused: 0, fetched: 3 });
  expect((await commitPreview(pool, id, key(), { previewId: clean.body.previewId })).httpStatus).toBe(200);
  expect(await getTripSnapshot(pool, id)).toMatchObject({ totals: { matched: 1, totalCost: 64 } });
});
