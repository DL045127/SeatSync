// Checkpoint B3 against real PostgreSQL: L-11 (malformed reuse candidates, policy change, routing
// disabled) and L-12 (response and SQL allowlists at the maximum roster, a policy upgrade, corrupt
// evidence at commit and at reuse). Numbers are derived by hand from the routing double's seconds
// or from counts of required legs; none comes from the code under test.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db/pool.ts";
import { commitPreview } from "../../src/trips/commit.ts";
import { publishPreview } from "../../src/trips/preview.ts";
import { addressCounters, resetAddressCounters } from "../../src/trips/address-metrics.ts";
import { editDriver, getTripSnapshot } from "../../src/trips/service.ts";
import {
  APP,
  SETUP,
  addSyntheticDriver,
  addSyntheticPassenger,
  createSyntheticTrip,
  hashSeconds,
  installRouting,
  key,
  resetTestDatabase,
  spots,
  useFixtureEnvironment,
  type FixtureEnv,
  type RoutingDouble,
  type Spot,
} from "./helpers/address.ts";

let env: FixtureEnv;
let pool: Pool;
let admin: Pool;
let routing: RoutingDouble | undefined;

beforeEach(async () => {
  env = useFixtureEnvironment();
  await resetTestDatabase();
  pool = createPool(APP, 4);
  admin = createPool(SETUP, 1);
  resetAddressCounters();
});
afterEach(async () => {
  routing?.restore();
  routing = undefined;
  await pool.end();
  await admin.end();
  env.dispose();
});

const previewRows = async (tripId: string) =>
  Number((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM match_previews WHERE trip_id = $1", [tripId])).rows[0].n);
const receiptCount = async () =>
  Number((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM mutation_receipts")).rows[0].n);
async function version(tripId: string): Promise<number> {
  return (await getTripSnapshot(pool, tripId))!.version;
}

/** A small address trip: 2 driving drivers (limit 120 min) and 3 passengers at distinct coordinates. */
async function smallTrip(prefix = "s") {
  const [V] = spots(`${prefix}v`, 1);
  const D = spots(`${prefix}d`, 2, 10);
  const P = spots(`${prefix}p`, 4, 30);
  const tripId = await createSyntheticTrip(pool, V);
  const drivers = [await addSyntheticDriver(pool, tripId, "D0", D[0], 1, 120), await addSyntheticDriver(pool, tripId, "D1", D[1], 1, 120)];
  for (let i = 0; i < 3; i += 1) await addSyntheticPassenger(pool, tripId, `P${i}`, P[i]);
  return { tripId, V, D, P, drivers };
}

// ============================ L-11 ============================

describe("L-11: policy change, malformed reuse candidates, and routing disabled", () => {
  test("a routing-policy change starts a new duration history: every required provider cell is fetched again", async () => {
    routing = installRouting(hashSeconds, "policy/one");
    const { tripId, P } = await smallTrip("pc");
    const first = await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(2 * 3 + 2 + 3);
    expect(first.body.estimate!.routingPolicy).toBe("policy/one");

    routing.restore();
    routing = installRouting(hashSeconds, "policy/two"); // a deliberate policy revision, SAME roster and version
    const second = await publishPreview(pool, tripId);
    expect(second.body.previewId).not.toBe(first.body.previewId); // no stored hit across policies
    expect(second.body.estimate!.routingPolicy).toBe("policy/two");
    expect(routing.stats.cells).toBe(2 * 3 + 2 + 3); // nothing was reused across policies
    expect(second.body.estimate!.legs).toEqual({ required: 11, fetched: 11, reused: 0, local: 0 });

    // A later edit under the NEW policy reuses ONLY the new policy's history.
    routing.reset();
    await addSyntheticPassenger(pool, tripId, "P3", P[3]);
    await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(2 + 1); // two driver->pickup + one pickup->venue
    expect(await previewRows(tripId)).toBe(3);
  });

  /** Corruptions of the stored evidence, each applied to the candidate row in SQL. */
  const corruptions: Array<[string, string]> = [
    ["a malformed duration", `jsonb_set(evidence, '{legs,0,seconds}', '"slow"')`],
    ["a missing policy field", `evidence - 'policy'`],
    ["a duplicate leg", `jsonb_set(evidence, '{legs}', (evidence->'legs') || jsonb_build_array(evidence->'legs'->0))`],
    ["a reversed key", `jsonb_set(jsonb_set(evidence, '{legs,0,from}', evidence->'legs'->0->'to'), '{legs,0,to}', evidence->'legs'->0->'from')`],
    ["an unexpected endpoint", `jsonb_set(evidence, '{legs}', (evidence->'legs') || '[{"from":"00000000-0000-4000-8000-0000000000aa","to":"00000000-0000-4000-8000-0000000000bb","seconds":1,"source":"provider","observedAt":"2026-11-24T12:00:00.000Z"}]'::jsonb)`],
    ["another trip's venue", `jsonb_set(evidence, '{venue,id}', '"00000000-0000-4000-8000-0000000000cc"')`],
    ["a wrong policy", `jsonb_set(evidence, '{policy}', '"policy/other"')`],
    ["wiped evidence", `'{}'::jsonb`],
  ];

  /** A trip whose latest preview's evidence is corrupt, then an effective roster change. */
  async function corruptCandidate(sql: string) {
    const trip = await smallTrip("cc");
    await publishPreview(pool, trip.tripId);
    await admin.query(`UPDATE match_previews SET evidence = ${sql} WHERE trip_id = $1`, [trip.tripId]);
    await addSyntheticPassenger(pool, trip.tripId, "P3", trip.P[3]); // 4 active passengers now
    return trip;
  }

  test.each(corruptions)("a malformed candidate (%s) is discarded whole: counted once, no leg reused, a COLD rebuild", async (_name, sql) => {
    routing = installRouting();
    const { tripId } = await corruptCandidate(sql);
    routing.reset();
    resetAddressCounters();
    const rebuilt = await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
    const required = 2 * 4 + 2 + 4; // 2 drivers x 4 passengers + 2 + 4
    expect(routing.stats.cells).toBe(required); // every required leg fetched: nothing reused
    expect(rebuilt.body.estimate!.legs).toEqual({ required, fetched: required, reused: 0, local: 0 });
    // The rebuilt row is itself sound: it commits.
    expect((await commitPreview(pool, tripId, key(), { previewId: rebuilt.body.previewId })).httpStatus).toBe(200);
  });

  test("older rows are NOT tried after the newest candidate fails (no silent fallback)", async () => {
    routing = installRouting();
    const { tripId, P } = await smallTrip("ol");
    await publishPreview(pool, tripId); // v1: a GOOD preview
    await addSyntheticPassenger(pool, tripId, "P3", P[3]);
    const second = await publishPreview(pool, tripId); // v2, good, reused v1
    await admin.query("UPDATE match_previews SET evidence = '{}'::jsonb WHERE id = $1", [second.body.previewId]);
    // One more effective roster change, so a new version needs a new preview (5 passengers now).
    await addSyntheticPassenger(pool, tripId, "P4", spots("zz", 1, 700)[0]);
    routing.reset();
    resetAddressCounters();
    await publishPreview(pool, tripId); // v3: the newest candidate (v2) is corrupt; v1 is fine but must NOT be used
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
    expect(routing.stats.cells).toBe(2 * 5 + 2 + 5); // a full cold rebuild: nothing was taken from v1 or v2
  });

  test("with routing DISABLED and a corrupt candidate: a routing-unavailable response, no new row, a readable dashboard", async () => {
    routing = installRouting();
    const { tripId } = await corruptCandidate(`'{}'::jsonb`);
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    const rows = await previewRows(tripId);
    resetAddressCounters();
    await expect(publishPreview(pool, tripId)).rejects.toMatchObject({ code: "ROUTING_UNAVAILABLE" });
    expect(addressCounters.reuseCandidateDiscarded).toBe(1); // counted once for this attempt
    expect(await previewRows(tripId)).toBe(rows);
    const dashboard = await getTripSnapshot(pool, tripId);
    expect(dashboard!.requests).toHaveLength(4);
  });

  test("with only LOCAL required legs, routing disabled still publishes, with zero upstream calls", async () => {
    routing = installRouting();
    const [S] = spots("loc", 1);
    const tripId = await createSyntheticTrip(pool, S); // venue, driver start and pickup all at ONE place
    await addSyntheticDriver(pool, tripId, "D", S, 1, 0);
    await addSyntheticPassenger(pool, tripId, "P", S);
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    const preview = await publishPreview(pool, tripId);
    expect(routing.stats.attempts).toBe(0);
    expect(preview.body.optimal).toMatchObject({ matchedCount: 1, totalCost: 0 });
    expect(preview.body.estimate!.legs).toEqual({ required: 3, fetched: 0, reused: 0, local: 3 });
    expect(preview.body.estimate).toMatchObject({ observedFrom: null, observedTo: null }); // no provider observation at all
  });

  test("covered rematches, current stored hits, commit and receipt replay all work with routing disabled", async () => {
    routing = installRouting();
    const { tripId, drivers } = await smallTrip("off");
    const first = await publishPreview(pool, tripId);
    const commitKey = key();
    const committed = await commitPreview(pool, tripId, commitKey, { previewId: first.body.previewId });
    expect(committed.httpStatus).toBe(200);
    const cellsBefore = routing.stats.cells;

    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    // Receipt replay.
    const replay = await commitPreview(pool, tripId, commitKey, { previewId: first.body.previewId });
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(committed.body);
    // A covered rematch after a cancellation, then a current stored hit, then a commit.
    const version0 = await version(tripId);
    await editDriver(pool, tripId, drivers[1], key(), { baseVersion: version0, active: false });
    const rematch = await publishPreview(pool, tripId);
    expect(rematch.body.estimate!.legs).toMatchObject({ fetched: 0 });
    const hit = await publishPreview(pool, tripId);
    expect(hit.body.previewId).toBe(rematch.body.previewId);
    expect((await commitPreview(pool, tripId, key(), { previewId: rematch.body.previewId })).httpStatus).toBe(200);
    expect(routing.stats.cells).toBe(cellsBefore); // nothing was fetched
    expect(routing.stats.attempts).toBe(1); // only the original cold preview ever reached routing
  });
});

// ============================ L-12 ============================

/** Collect every key of every object in a JSON value (deep). */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { into.add(k); allKeys(v, into); }
  }
  return into;
}
const keysOf = (o: object) => Object.keys(o).sort();

describe("L-12: the serialized responses, the SQL, and the policy upgrade", () => {
  test("at the MAXIMUM roster no response carries raw cells, endpoint mappings, coordinates or dormant evidence", async () => {
    routing = installRouting();
    const [V] = spots("mv", 1);
    const D = spots("md", 20, 100);
    const P = spots("mp", 50, 200);
    const tripId = await createSyntheticTrip(pool, V);
    for (let i = 0; i < 20; i += 1) await addSyntheticDriver(pool, tripId, `D${i}`, D[i], i === 19 ? 0 : 1, 120); // one DORMANT driver
    for (let i = 0; i < 50; i += 1) await addSyntheticPassenger(pool, tripId, `P${i}`, P[i]);

    const cold = (await publishPreview(pool, tripId)).body;
    const hit = (await publishPreview(pool, tripId)).body;
    const commit = (await commitPreview(pool, tripId, key(), { previewId: cold.previewId })).body;
    const dashboard = (await getTripSnapshot(pool, tripId))!;

    // Required legs: 19 driving drivers x 50 + 19 + 50 = 1019; the dormant driver's 50 + 1 are RETAINED only if observed (never fetched).
    expect(cold.estimate!.legs).toEqual({ required: 19 * 50 + 19 + 50, fetched: 1019, reused: 0, local: 0 });
    expect(hit).toEqual(cold); // a stored hit is the same row
    const stored = (await admin.query<{ evidence: { legs: unknown[]; drivers: unknown[] } }>("SELECT evidence FROM match_previews WHERE id = $1", [cold.previewId])).rows[0].evidence;
    expect(stored.legs).toHaveLength(1019); // the private evidence IS in the database (and holds no dormant row: never fetched)
    expect(stored.drivers).toHaveLength(20);

    // Allowlisted SHAPES.
    expect(keysOf(cold)).toEqual(["algorithmVersion", "baseVersion", "costUnit", "estimate", "greedy", "locationMode", "optimal", "previewId"]);
    expect(keysOf(cold.estimate!)).toEqual(["costUnit", "legs", "observedFrom", "observedTo", "provider", "routingPolicy"]);
    expect(keysOf(cold.estimate!.legs)).toEqual(["fetched", "local", "required", "reused"]);
    expect(keysOf(commit as object)).toEqual(["costUnit", "matchedCount", "mutationVersion", "operation", "previewId", "totalCost"]);
    expect(keysOf(dashboard)).toEqual(["algorithmVersion", "assignments", "committedPreviewId", "costUnit", "departAt", "destinationLabel", "drivers", "estimate", "id", "locationMode", "name", "planVersion", "requests", "status", "totals", "venue", "version"]);
    expect(keysOf(dashboard.drivers[0])).toEqual(["active", "id", "location", "maxDetourMinutes", "name", "seatCapacity", "zoneId"]);
    expect(keysOf(dashboard.requests[0])).toEqual(["active", "id", "location", "name", "zoneId"]);
    expect(keysOf(dashboard.drivers[0].location!)).toEqual(["attribution", "detail", "label", "precision", "provider"]);
    expect(keysOf(dashboard.venue!)).toEqual(["attribution", "detail", "label", "precision", "provider"]);
    expect(dashboard.estimate).toEqual(cold.estimate);

    // No leg, endpoint, coordinate or observation key anywhere, and no location ID anywhere.
    const serialized = JSON.stringify({ cold, hit, commit, dashboard });
    for (const forbidden of ["providerRef", "\"lon\"", "\"lat\"", "\"evidence\"", "\"seconds\"", "\"observedAt\"", "\"from\"", "\"to\"", "\"source\"", "identical_endpoint"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    const locationIds = (await admin.query<{ id: string }>(
      `SELECT venue_location->>'id' AS id FROM trips UNION ALL SELECT location->>'id' FROM drivers UNION ALL SELECT location->>'id' FROM ride_requests`,
    )).rows.map((r) => r.id).filter(Boolean);
    expect(locationIds.length).toBe(71);
    for (const id of locationIds) expect(serialized).not.toContain(id);
    // The only array under `estimate` would be a leg list: there is none.
    expect(allKeys(cold.estimate).has("0")).toBe(false);
  }, 90_000);

  test("dashboard and stored-hit reads never select the evidence column (captured SQL)", async () => {
    routing = installRouting();
    const { tripId } = await smallTrip("sq");
    const preview = await publishPreview(pool, tripId);
    // Commit first, so the dashboard has a committed preview whose summary it must read.
    expect((await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId })).httpStatus).toBe(200);
    await publishPreview(pool, tripId); // a preview of the new version, so the next one is a stored HIT
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
      const touching = statements.filter((s) => /match_previews/i.test(s));
      expect(touching.length).toBeGreaterThan(1);
      for (const sql of touching) expect(sql, sql).not.toMatch(/\bevidence\b/i);
    } finally {
      await recording.end();
    }
  });

  test("a policy upgrade: a committed OLD-policy plan still displays with its stored summary", async () => {
    routing = installRouting(hashSeconds, "policy/old");
    const { tripId } = await smallTrip("up");
    const preview = await publishPreview(pool, tripId);
    expect((await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId })).httpStatus).toBe(200);
    const before = (await getTripSnapshot(pool, tripId))!;

    routing.restore();
    routing = installRouting(hashSeconds, "policy/new"); // the deployment now expects a newer policy
    const after = (await getTripSnapshot(pool, tripId))!;
    expect(after).toEqual(before); // the saved plan is still readable
    expect(after.estimate!.routingPolicy).toBe("policy/old");
    expect(after.algorithmVersion).toContain("policy/old");
    expect(after.assignments.length).toBe(before.assignments.length);
    expect(after.totals.totalCost).toBe(before.totals.totalCost);
  });

  test("a policy upgrade: a SUPERSEDED uncommitted preview cannot be committed (ALGORITHM_CHANGED), state unchanged", async () => {
    routing = installRouting(hashSeconds, "policy/old");
    const { tripId } = await smallTrip("sup");
    const preview = await publishPreview(pool, tripId);
    const before = (await getTripSnapshot(pool, tripId))!;

    routing.restore();
    routing = installRouting(hashSeconds, "policy/new");
    const rejected = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(rejected.httpStatus).toBe(409);
    expect((rejected.body as { error: { code: string } }).error.code).toBe("ALGORITHM_CHANGED");
    expect(await getTripSnapshot(pool, tripId)).toEqual(before);
  });

  /** A trip with a committed plan whose CURRENT-version preview then has only its evidence corrupted. */
  async function corruptedCurrentPreview() {
    routing = installRouting();
    const trip = await smallTrip("co");
    const planned = await publishPreview(pool, trip.tripId);
    expect((await commitPreview(pool, trip.tripId, key(), { previewId: planned.body.previewId })).httpStatus).toBe(200);
    const plan = (await getTripSnapshot(pool, trip.tripId))!; // assigned at version v
    const same = await publishPreview(pool, trip.tripId); // a fresh preview of the SAME roster at version v
    expect(same.body.previewId).not.toBe(planned.body.previewId);
    await admin.query("UPDATE match_previews SET evidence = '{}'::jsonb WHERE id = $1", [same.body.previewId]);
    return { ...trip, plan, corrupt: same.body };
  }

  test("corrupt ONLY the evidence of a stored preview: the hit still displays; commit fails as an internal error and the prior plan is intact", async () => {
    const { tripId, plan, corrupt } = await corruptedCurrentPreview();
    const hit = await publishPreview(pool, tripId);
    expect(hit.body).toEqual(corrupt); // display needs no evidence
    const receiptsBefore = await receiptCount();
    const failed = await commitPreview(pool, tripId, key(), { previewId: corrupt.previewId });
    expect(failed.httpStatus).toBe(500);
    expect((failed.body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
    expect(await receiptCount()).toBe(receiptsBefore + 1); // a terminal failure receipt, nothing applied
    expect(await getTripSnapshot(pool, tripId)).toEqual(plan); // the committed plan is untouched
  });

  /** Both runs begin from the SAME corrupt candidate: after the corruption, one effective roster change. */
  async function corruptThenChange() {
    const ctx = await corruptedCurrentPreview();
    await addSyntheticPassenger(pool, ctx.tripId, "Late", spots("late", 1, 800)[0]);
    resetAddressCounters();
    routing!.reset();
    return ctx;
  }

  test("run A, routing available: the next preview skips the corrupt candidate, counts it, and fetches every required leg cold", async () => {
    const { tripId } = await corruptThenChange();
    const rebuilt = await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
    const required = 2 * 4 + 2 + 4;
    expect(routing!.stats.cells).toBe(required);
    expect(rebuilt.body.estimate!.legs).toEqual({ required, fetched: required, reused: 0, local: 0 });
    expect((await commitPreview(pool, tripId, key(), { previewId: rebuilt.body.previewId })).httpStatus).toBe(200);
  });

  test("run B, routing disabled: a routing-unavailable response, no new row and a readable dashboard", async () => {
    const { tripId } = await corruptThenChange();
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    const rows = await previewRows(tripId);
    await expect(publishPreview(pool, tripId)).rejects.toMatchObject({ code: "ROUTING_UNAVAILABLE" });
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
    expect(await previewRows(tripId)).toBe(rows);
    expect((await getTripSnapshot(pool, tripId))!.status).toBe("needs_rematch");
    expect(routing!.stats.attempts).toBe(0);
  });
});

void (null as unknown as Spot);
