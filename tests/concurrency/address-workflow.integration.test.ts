// Address workflow through real PostgreSQL (L-02/L-03 backend): create → register
// → preview → commit → reload, with expected answers derived BY HAND from the
// catalog's directed seconds in data/fixture-places.json:
//
//   Delta->Alpha 403, Alpha->Hall 346, Delta->Hall 519       => 403+346-519 = 230 s
//   Delta->Bravo 239, Bravo->Hall 344                        => 239+344-519 =  64 s
//   Echo ->Alpha 240, Echo ->Bravo 474, Echo ->Hall 568      => 18 s and 250 s
//
// The matcher, projector and routing adapter are not used to derive them.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db/pool.ts";
import { commitPreview } from "../../src/trips/commit.ts";
import { publishPreview } from "../../src/trips/preview.ts";
import { editDriver, getTripSnapshot } from "../../src/trips/service.ts";
import {
  APP,
  SETUP,
  createAddressTrip,
  key,
  registerDriver,
  registerPassenger,
  resetTestDatabase,
  useFixtureEnvironment,
  type FixtureEnv,
} from "./helpers/address.ts";

let env: FixtureEnv;
let pool: Pool;
let admin: Pool;

beforeEach(async () => {
  env = useFixtureEnvironment();
  await resetTestDatabase();
  pool = createPool(APP, 4);
  admin = createPool(SETUP, 1);
});
afterEach(async () => {
  await pool.end();
  await admin.end();
  env.dispose();
});

const nameOf = (snapshot: NonNullable<Awaited<ReturnType<typeof getTripSnapshot>>>, id: string) =>
  [...snapshot.drivers, ...snapshot.requests].find((m) => m.id === id)?.name;

describe("one driver, one passenger: 230 seconds", () => {
  test("preview, stored hit, commit and reload agree on 230 s with its meaning and provenance", async () => {
    const tripId = await createAddressTrip(pool);
    await registerDriver(pool, tripId, "Dana", "Driver Start Delta", 1);
    await registerPassenger(pool, tripId, "Pat", "Pickup Alpha");

    const preview = await publishPreview(pool, tripId);
    expect(preview.body.costUnit).toBe("detour_seconds");
    expect(preview.body.locationMode).toBe("address");
    expect(preview.body.optimal).toMatchObject({ matchedCount: 1, totalCost: 230 });
    expect(preview.body.optimal.assignments[0].cost).toBe(230);
    expect(preview.body.algorithmVersion).toBe("mincostflow-v1+address-evidence-1+fixture/drive/fixture-catalog-1/rounding-1");
    expect(preview.body.estimate).toMatchObject({
      costUnit: "detour_seconds",
      provider: "fixture",
      routingPolicy: "fixture/drive/fixture-catalog-1/rounding-1",
      legs: { required: 3, fetched: 3, reused: 0, local: 0 },
    });
    expect(preview.body.estimate!.observedFrom).toBe(preview.body.estimate!.observedTo);

    // A repeated preview of the same version returns the SAME stored row, with its original observation time.
    const again = await publishPreview(pool, tripId);
    expect(again.body).toEqual(preview.body);
    expect((await admin.query("SELECT 1 FROM match_previews")).rowCount).toBe(1);

    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(200);
    expect(commit.body).toMatchObject({ matchedCount: 1, totalCost: 230, costUnit: "detour_seconds" });

    // Reload from an independent connection.
    const reloadPool = createPool(APP, 1);
    const reloaded = (await getTripSnapshot(reloadPool, tripId).finally(() => reloadPool.end()))!;
    expect(reloaded).toMatchObject({ status: "assigned", locationMode: "address", costUnit: "detour_seconds", totals: { matched: 1, totalCost: 230 } });
    expect(reloaded.assignments).toEqual([
      expect.objectContaining({ pickupCost: 230 }),
    ]);
    expect(nameOf(reloaded, reloaded.assignments[0].requestId)).toBe("Pat");
    expect(nameOf(reloaded, reloaded.assignments[0].driverId)).toBe("Dana");
    expect(reloaded.estimate).toEqual(preview.body.estimate);
    expect(reloaded.venue?.label).toBe("GROUPRIDE FIXTURE — Event Hall");
    expect(reloaded.algorithmVersion).toBe(preview.body.algorithmVersion);
    // Display rows never carry coordinates or location IDs.
    expect(JSON.stringify(reloaded)).not.toMatch(/"lat"|"lon"|providerRef|fx-/);
    // The database holds the private evidence, with three directed legs.
    const evidence = (await admin.query<{ evidence: { legs: unknown[]; policy: string } }>("SELECT evidence FROM match_previews")).rows[0].evidence;
    expect(evidence.legs).toHaveLength(3);
    expect(evidence.policy).toBe("fixture/drive/fixture-catalog-1/rounding-1");
  });

  test("the detour limit is inclusive and per pair: 230 s needs a limit of at least 4 minutes", async () => {
    const tripId = await createAddressTrip(pool);
    const strict = await registerDriver(pool, tripId, "Strict", "Driver Start Delta", 1, 3); // 180 s < 230 s
    await registerPassenger(pool, tripId, "Pat", "Pickup Alpha");
    const excluded = await publishPreview(pool, tripId);
    expect(excluded.body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
    expect(excluded.body.optimal.unassignedPassengerIds).toHaveLength(1);

    const version = (await getTripSnapshot(pool, tripId))!.version;
    await editDriver(pool, tripId, strict, key(), { baseVersion: version, active: false });
    await registerDriver(pool, tripId, "Relaxed", "Driver Start Delta", 1, 4); // 240 s >= 230 s
    const included = await publishPreview(pool, tripId);
    expect(included.body.optimal).toMatchObject({ matchedCount: 1, totalCost: 230 });
  });
});

describe("two drivers, two passengers: coverage first, then 82 seconds", () => {
  test("the optimum pairs Delta->Bravo (64 s) with Echo->Alpha (18 s), not the 480 s alternative", async () => {
    const tripId = await createAddressTrip(pool);
    await registerDriver(pool, tripId, "Dana", "Driver Start Delta", 1);
    await registerDriver(pool, tripId, "Eli", "Driver Start Echo", 1);
    await registerPassenger(pool, tripId, "Pat", "Pickup Alpha");
    await registerPassenger(pool, tripId, "Ben", "Pickup Bravo");

    const preview = await publishPreview(pool, tripId);
    expect(preview.body.optimal.matchedCount).toBe(2);
    expect(preview.body.optimal.totalCost).toBe(82);
    expect(preview.body.estimate!.legs).toMatchObject({ required: 8, fetched: 8 });
    const snapshot = (await getTripSnapshot(pool, tripId))!;
    const pairs = preview.body.optimal.assignments.map((a) => [nameOf(snapshot, a.passengerId), nameOf(snapshot, a.driverId), a.cost]);
    expect(pairs.sort()).toEqual([["Ben", "Dana", 64], ["Pat", "Eli", 18]].sort());
    expect(preview.body.greedy.matchedCount).toBeLessThanOrEqual(2);

    // Save, then remove one offered seat: the whole plan clears and a rematch shows who needs a seat.
    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.body).toMatchObject({ totalCost: 82 });
    const saved = (await getTripSnapshot(pool, tripId))!;
    const dana = saved.drivers.find((d) => d.name === "Dana")!;
    await editDriver(pool, tripId, dana.id, key(), { baseVersion: saved.version, seatCapacity: 0 });
    const cleared = (await getTripSnapshot(pool, tripId))!;
    expect(cleared).toMatchObject({ status: "needs_rematch", totals: { matched: 0 } });
    const rematch = await publishPreview(pool, tripId);
    expect(rematch.body.optimal.matchedCount).toBe(1);
    expect(rematch.body.optimal.unassignedPassengerIds).toHaveLength(1);
    expect(rematch.body.baseVersion).toBe(cleared.version);
  });
});

describe("identical coordinates resolve locally", () => {
  test("a pickup at the same coordinates as the driver's start costs 0 s with no provider observation for that leg", async () => {
    const tripId = await createAddressTrip(pool);
    await registerDriver(pool, tripId, "Dana", "Pickup Alpha", 1); // starts at Alpha
    await registerPassenger(pool, tripId, "Pat", "Pickup Alpha Annex"); // same coordinates as Alpha
    const preview = await publishPreview(pool, tripId);
    // D->P is local (0); P->V and D->V are both Alpha->Hall 346 s: extra = 0 + 346 - 346 = 0.
    expect(preview.body.optimal).toMatchObject({ matchedCount: 1, totalCost: 0 });
    expect(preview.body.estimate!.legs).toEqual({ required: 3, fetched: 2, reused: 0, local: 1 });
    const evidence = (await admin.query<{ evidence: { legs: Array<{ source: string; observedAt: string | null; seconds: number }> } }>("SELECT evidence FROM match_previews")).rows[0].evidence;
    const local = evidence.legs.filter((l) => l.source === "identical_endpoint");
    expect(local).toEqual([expect.objectContaining({ seconds: 0, observedAt: null })]);
    expect((await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId })).httpStatus).toBe(200);
  });
});

describe("empty rosters make no provider request", () => {
  test("no passengers or no seats gives the ordinary empty plan, with zero required legs", async () => {
    const tripId = await createAddressTrip(pool);
    await registerDriver(pool, tripId, "Dana", "Driver Start Delta", 1);
    const preview = await publishPreview(pool, tripId);
    expect(preview.body.optimal).toEqual({ assignments: [], unassignedPassengerIds: [], matchedCount: 0, totalCost: 0 });
    expect(preview.body.estimate).toMatchObject({ observedFrom: null, observedTo: null, legs: { required: 0, fetched: 0, reused: 0, local: 0 } });
  });
});

describe("commit trusts only evidence that matches the current roster", () => {
  async function previewed() {
    const tripId = await createAddressTrip(pool);
    await registerDriver(pool, tripId, "Dana", "Driver Start Delta", 1);
    await registerPassenger(pool, tripId, "Pat", "Pickup Alpha");
    return { tripId, preview: await publishPreview(pool, tripId) };
  }

  test("a stale preview is rejected after a roster change", async () => {
    const { tripId, preview } = await previewed();
    await registerPassenger(pool, tripId, "Late", "Pickup Bravo");
    const stale = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(stale.httpStatus).toBe(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe("STALE_VERSION");
    expect((await getTripSnapshot(pool, tripId))!.status).toBe("open");
  });

  test.each([
    ["a changed duration", `UPDATE match_previews SET evidence = jsonb_set(evidence, '{legs,0,seconds}', '1')`],
    ["a dropped leg", `UPDATE match_previews SET evidence = jsonb_set(evidence, '{legs}', (evidence->'legs') - 0)`],
    ["another policy", `UPDATE match_previews SET evidence = jsonb_set(evidence, '{policy}', '"other"')`],
    ["a changed threshold", `UPDATE match_previews SET evidence = jsonb_set(evidence, '{drivers,0,maxDetourMinutes}', '1')`],
    ["wiped evidence", `UPDATE match_previews SET evidence = '{}'::jsonb`],
  ])("corrupt evidence (%s) fails commit safely and leaves the prior plan intact", async (_name, sql) => {
    const { tripId, preview } = await previewed();
    await admin.query(sql);
    const k = key();
    const failed = await commitPreview(pool, tripId, k, { previewId: preview.body.previewId });
    expect(failed.httpStatus).toBe(500);
    expect((failed.body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
    const snapshot = (await getTripSnapshot(pool, tripId))!;
    expect(snapshot).toMatchObject({ status: "open", totals: { matched: 0 } });
    expect((await admin.query("SELECT 1 FROM assignments")).rowCount).toBe(0);
    // The failure is a durable receipt; a retry replays it rather than applying later.
    expect((await commitPreview(pool, tripId, k, { previewId: preview.body.previewId })).replayed).toBe(true);
  });

  test("a stored hit and a commit of a current preview need no provider; a cold preview does", async () => {
    const { tripId, preview } = await previewed();
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    const hit = await publishPreview(pool, tripId);
    expect(hit.body).toEqual(preview.body); // a stored hit is local
    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(200); // commit needs no provider call and no second solve
    const saved = (await getTripSnapshot(pool, tripId))!;
    expect(saved.status).toBe("assigned"); // a saved plan stays readable with the provider disabled
    expect(saved.estimate?.provider).toBe("fixture");
    // A roster change needs a NEW estimate, which needs the provider.
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
    await registerPassenger(pool, tripId, "Late", "Pickup Bravo");
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    await expect(publishPreview(pool, tripId)).rejects.toMatchObject({ code: "ADDRESS_PROVIDER_UNAVAILABLE" });
    expect((await admin.query("SELECT 1 FROM match_previews")).rowCount).toBe(1); // nothing partial published
  });

  test("dashboard and stored-hit reads never select the private evidence column", async () => {
    const { tripId } = await previewed();
    const statements: string[] = [];
    const recording = createPool(APP, 1);
    const realConnect = recording.connect.bind(recording);
    (recording as unknown as { connect: () => Promise<unknown> }).connect = async () => {
      const client = (await realConnect()) as { query: (...a: unknown[]) => Promise<unknown> };
      const query = client.query.bind(client);
      client.query = (...args: unknown[]) => {
        if (typeof args[0] === "string") statements.push(args[0]);
        return query(...args);
      };
      return client;
    };
    try {
      await publishPreview(recording, tripId); // a stored hit
      await getTripSnapshot(recording, tripId); // the dashboard
      const touchingPreviews = statements.filter((s) => /match_previews/i.test(s));
      expect(touchingPreviews.length).toBeGreaterThan(0);
      for (const sql of touchingPreviews) expect(sql, sql).not.toMatch(/\bevidence\b/i);
    } finally {
      await recording.end();
    }
  });
});
