// Checkpoint B corrections (ISSUE-065 to ISSUE-068): how the service treats STORED previews that
// are inconsistent. Each case tampers with a row in PostgreSQL, as a corrupt or hand-edited
// database would, and asserts what a caller sees. Stored data that cannot be trusted is a
// SERVER-side failure (500), never a verdict on the request (400), and never leaks.

import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db/pool.ts";
import { commitPreview } from "../../src/trips/commit.ts";
import { publishPreview } from "../../src/trips/preview.ts";
import { addressCounters, resetAddressCounters } from "../../src/trips/address-metrics.ts";
import { addDriver, addRequest, createTrip, editDriver, getTripSnapshot } from "../../src/trips/service.ts";
import {
  APP,
  SETUP,
  addSyntheticDriver,
  addSyntheticPassenger,
  createSyntheticTrip,
  installRouting,
  key,
  resetTestDatabase,
  spots,
  useFixtureEnvironment,
  type FixtureEnv,
  type RoutingDouble,
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
  const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
  await __resetAppPoolForTests();
  await pool.end();
  await admin.end();
  env.dispose();
});

const FOREIGN = "00000000-0000-4000-8000-0000000000ee";

async function version(tripId: string) {
  return (await getTripSnapshot(pool, tripId))!.version;
}

/** One driver (seat 1), one passenger: three required legs. */
async function onePair(prefix: string) {
  const [V] = spots(`${prefix}v`, 1);
  const [S] = spots(`${prefix}s`, 1, 10);
  const [P, Q] = spots(`${prefix}p`, 2, 20);
  const tripId = await createSyntheticTrip(pool, V);
  const driver = await addSyntheticDriver(pool, tripId, "X", S, 1, 120);
  await addSyntheticPassenger(pool, tripId, "P", P);
  return { tripId, driver, extra: Q };
}

/** Run the real preview POST route and return its status and body. */
async function previewOverHttp(tripId: string) {
  const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
  await __resetAppPoolForTests();
  const route = await import("../../src/app/api/trips/[tripId]/match/preview/route.ts");
  const response = await route.POST(
    new Request(`http://127.0.0.1:3100/api/trips/${tripId}/match/preview`, { method: "POST", headers: { host: "127.0.0.1:3100" } }),
    { params: Promise.resolve({ tripId }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

// ================= ISSUE-065: incomplete evidence is never partly reused =================

describe("ISSUE-065: a candidate missing a leg its OWN roster required is discarded whole", () => {
  test("one of three required legs removed, then the driver's capacity changes: counted once, a full cold rebuild", async () => {
    routing = installRouting();
    const { tripId, driver } = await onePair("i65");
    const first = await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(3); // X->P, X->V, P->V
    // Remove exactly ONE required leg from the stored evidence.
    await admin.query("UPDATE match_previews SET evidence = evidence #- '{legs,0}' WHERE id = $1", [first.body.previewId]);
    expect((await admin.query<{ n: number }>("SELECT jsonb_array_length(evidence->'legs') AS n FROM match_previews WHERE id = $1", [first.body.previewId])).rows[0].n).toBe(2);

    await editDriver(pool, tripId, driver, key(), { baseVersion: await version(tripId), seatCapacity: 2 });
    routing.reset();
    resetAddressCounters();
    const rebuilt = await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
    expect(routing.stats.cells).toBe(3); // ALL three required legs fetched again: nothing was reused
    expect(rebuilt.body.estimate!.legs).toEqual({ required: 3, fetched: 3, reused: 0, local: 0 });
  });

  test("control: a candidate missing only a DORMANT (retained, not required) leg is still valid and is reused", async () => {
    routing = installRouting();
    const [V] = spots("i65cv", 1);
    const [S1, S2] = spots("i65cs", 2, 10);
    const [P, Q] = spots("i65cp", 2, 20);
    const tripId = await createSyntheticTrip(pool, V);
    await addSyntheticDriver(pool, tripId, "X", S1, 1, 120);
    const dormant = await addSyntheticDriver(pool, tripId, "D2", S2, 2, 120);
    await addSyntheticPassenger(pool, tripId, "P", P);
    await publishPreview(pool, tripId); // D2 offers seats, so ITS legs are fetched too
    await editDriver(pool, tripId, dormant, key(), { baseVersion: await version(tripId), seatCapacity: 0 });
    const second = await publishPreview(pool, tripId); // D2 is now dormant: its legs are retained, not required
    expect(routing.stats.cells).toBe(5); // X->P, X->V, D2->P, D2->V, P->V, all from the first preview
    // Drop one DORMANT leg (D2 -> P). Everything X needs is still present.
    const removed = await admin.query(
      `UPDATE match_previews SET evidence = jsonb_set(evidence, '{legs}', (
         SELECT jsonb_agg(l) FROM jsonb_array_elements(evidence->'legs') l
          WHERE NOT (l->>'from' = (SELECT d->'location'->>'id' FROM jsonb_array_elements(evidence->'drivers') d WHERE d->>'seats' = '0')
                 AND l->>'to' <> (evidence->'venue'->>'id'))))
       WHERE id = $1`, [second.body.previewId]);
    expect(removed.rowCount).toBe(1);
    await addSyntheticPassenger(pool, tripId, "Q", Q);
    routing.reset();
    resetAddressCounters();
    await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(0);
    expect(routing.stats.cells).toBe(2); // only X->Q and Q->V: the candidate was reused
  });
});

// ================= ISSUE-066: a stored hit is rebuilt from allowed fields and checked =================

describe("ISSUE-066: a cached preview is never echoed raw and never names someone outside the trip", () => {
  test("unexpected fields in the stored results are not returned", async () => {
    routing = installRouting();
    const { tripId } = await onePair("i66a");
    const first = await publishPreview(pool, tripId);
    await admin.query(
      `UPDATE match_previews SET
         optimal_result = jsonb_set(jsonb_set(optimal_result, '{marker}', '"SECRET-ROOT"'), '{assignments,0,marker}', '"SECRET-ASSIGNMENT"'),
         greedy_result  = jsonb_set(greedy_result, '{marker}', '"SECRET-GREEDY"')
       WHERE id = $1`, [first.body.previewId]);
    const hit = await publishPreview(pool, tripId);
    const text = JSON.stringify(hit.body);
    expect(text).not.toContain("SECRET");
    expect(Object.keys(hit.body.optimal).sort()).toEqual(["assignments", "matchedCount", "totalCost", "unassignedPassengerIds"]);
    expect(Object.keys(hit.body.optimal.assignments[0]).sort()).toEqual(["cost", "driverId", "passengerId"]);
  });

  test.each([
    ["a driver UUID outside the trip", `jsonb_set(optimal_result, '{assignments,0,driverId}', '"${FOREIGN}"')`, "optimal_result"],
    ["a passenger UUID outside the trip", `jsonb_set(optimal_result, '{assignments,0,passengerId}', '"${FOREIGN}"')`, "optimal_result"],
    ["a foreign driver in the GREEDY result", `jsonb_set(greedy_result, '{assignments,0,driverId}', '"${FOREIGN}"')`, "greedy_result"],
    ["an unassigned id outside the trip", `jsonb_set(optimal_result, '{unassignedPassengerIds}', '["${FOREIGN}"]'::jsonb)`, "optimal_result"],
  ])("%s is a server-side failure, not a 200", async (_name, expression, column) => {
    routing = installRouting();
    const { tripId } = await onePair("i66b");
    const first = await publishPreview(pool, tripId);
    await admin.query(`UPDATE match_previews SET ${column} = ${expression} WHERE id = $1`, [first.body.previewId]);
    await expect(publishPreview(pool, tripId)).rejects.toThrow();
    const http = await previewOverHttp(tripId);
    expect(http.status).toBe(500);
    expect(JSON.stringify(http.body)).not.toContain(FOREIGN);
  });

  test("a driver assigned beyond its seats, or a canceled driver, or a withdrawn passenger, is refused", async () => {
    routing = installRouting();
    const { tripId, driver } = await onePair("i66c");
    const first = await publishPreview(pool, tripId);
    // The stored plan assigns P to X. Now make the STORED row disagree with the roster at its version
    // without changing the version: cancel nothing, but shrink the seat count with a direct edit.
    await admin.query("UPDATE drivers SET seat_capacity = 0 WHERE id = $1", [driver]);
    await expect(publishPreview(pool, tripId)).rejects.toThrow();
    await admin.query("UPDATE drivers SET seat_capacity = 1, active = false WHERE id = $1", [driver]);
    await expect(publishPreview(pool, tripId)).rejects.toThrow();
    await admin.query("UPDATE drivers SET active = true WHERE id = $1", [driver]);
    expect((await publishPreview(pool, tripId)).body.previewId).toBe(first.body.previewId); // a consistent row is served again
  });

  test("the same check protects ZONE trips, which share the stored-hit path", async () => {
    const zone = await createTrip(pool, key(), { name: "Z", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+00:00" });
    const tripId = (zone.body as { id: string }).id;
    await addDriver(pool, tripId, key(), { name: "Dana", zoneId: "north", seatCapacity: 1 });
    await addRequest(pool, tripId, key(), { name: "Pat", zoneId: "east" });
    const first = await publishPreview(pool, tripId);
    expect(first.body.optimal.totalCost).toBe(7);
    await admin.query("UPDATE match_previews SET optimal_result = jsonb_set(optimal_result, '{assignments,0,driverId}', $2::jsonb) WHERE id = $1", [first.body.previewId, JSON.stringify(FOREIGN)]);
    await expect(publishPreview(pool, tripId)).rejects.toThrow();
  });
});

// ================= ISSUE-067: contradictory routing metadata =================

describe("ISSUE-067: stored routing metadata is checked, and a corrupt summary is a 500, never a 400", () => {
  const T0 = "2026-11-24T12:00:00.000Z";
  const T1 = "2026-11-24T12:00:05.000Z";
  const summaryEdits: Array<[string, string]> = [
    ["another routing policy", `jsonb_set(summary, '{routingPolicy}', '"policy/other"')`],
    ["observation times reversed", `jsonb_set(jsonb_set(summary, '{observedFrom}', '"${T1}"'), '{observedTo}', '"${T0}"')`],
    ["999 legs fetched for three required", `jsonb_set(summary, '{legs,fetched}', '999')`],
    ["counts that do not sum to the required legs", `jsonb_set(summary, '{legs,reused}', '2')`],
    ["no observation range although legs were fetched", `jsonb_set(jsonb_set(summary, '{observedFrom}', 'null'::jsonb), '{observedTo}', 'null'::jsonb)`],
    ["an observation range with no provider legs", `jsonb_set(jsonb_set(jsonb_set(jsonb_set(summary, '{legs,fetched}', '0'), '{legs,local}', '3'), '{observedFrom}', '"${T0}"'), '{observedTo}', '"${T0}"')`],
    ["another provider", `jsonb_set(summary, '{provider}', '"geoapify"')`],
    ["an empty summary", `'{}'::jsonb`],
    ["a summary that is not an object", `'"oops"'::jsonb`],
  ];

  test.each(summaryEdits)("a stored hit with %s is a server-side failure (500), never 400 INVALID_INPUT", async (_name, expression) => {
    routing = installRouting();
    const { tripId } = await onePair("i67a");
    const first = await publishPreview(pool, tripId);
    await admin.query(`UPDATE match_previews SET summary = ${expression} WHERE id = $1`, [first.body.previewId]);
    const direct = await publishPreview(pool, tripId).then(() => undefined, (error: unknown) => error);
    expect(direct).toBeInstanceOf(Error);
    expect(direct).not.toBeInstanceOf(ZodError); // a request-validation error must never describe stored data
    const http = await previewOverHttp(tripId);
    expect(http.status).toBe(500);
    expect((http.body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
  });

  test.each(summaryEdits)("the saved dashboard with %s fails as a server error and never shows it", async (_name, expression) => {
    routing = installRouting();
    const { tripId } = await onePair("i67b");
    const preview = await publishPreview(pool, tripId);
    expect((await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId })).httpStatus).toBe(200);
    await admin.query(`UPDATE match_previews SET summary = ${expression} WHERE id = $1`, [preview.body.previewId]);
    const failure = await getTripSnapshot(pool, tripId).then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ZodError);
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    await __resetAppPoolForTests();
    const route = await import("../../src/app/api/trips/[tripId]/route.ts");
    const response = await route.GET(new Request(`http://127.0.0.1:3100/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(500);
  });

  test("a consistent summary is unaffected, and a committed OLD-policy plan still displays under its own policy", async () => {
    routing = installRouting(undefined, "policy/old");
    const { tripId } = await onePair("i67c");
    const preview = await publishPreview(pool, tripId);
    await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    routing.restore();
    routing = installRouting(undefined, "policy/new");
    const dashboard = await getTripSnapshot(pool, tripId);
    expect(dashboard!.estimate!.routingPolicy).toBe("policy/old"); // judged against the plan's OWN policy, not the current one
  });
});

// ================= ISSUE-068: only a genuine legacy row is "unsupported" =================

describe("ISSUE-068: a self-declared schema tag does not make a corrupt row legacy", () => {
  /** A trip whose newest candidate carries `schemaSql`, then one effective roster change. */
  async function mistagged(schema: string, algorithmSql?: string) {
    routing = installRouting();
    const { tripId, extra } = await onePair("i68");
    const first = await publishPreview(pool, tripId);
    await admin.query("UPDATE match_previews SET evidence = jsonb_set(evidence, '{schema}', $2::jsonb) WHERE id = $1", [first.body.previewId, JSON.stringify(schema)]);
    if (algorithmSql) await admin.query(`UPDATE match_previews SET algorithm_version = ${algorithmSql} WHERE id = $1`, [first.body.previewId]);
    await addSyntheticPassenger(pool, tripId, "Q", extra);
    routing.reset();
    resetAddressCounters();
    return { tripId };
  }

  test.each([
    ["a typo", "address-evidenc-2"],
    ["an unknown future revision", "address-evidence-9"],
    ["a numeric suffix variation", "address-evidence-02"],
    ["the genuine checkpoint A label on a B row", "address-evidence-1"],
    ["an empty tag", ""],
  ])("%s is CORRUPTION: counted once and rebuilt cold", async (_name, schema) => {
    const { tripId } = await mistagged(schema);
    const rebuilt = await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
    expect(rebuilt.body.estimate!.legs).toMatchObject({ required: 5, fetched: 5, reused: 0 }); // 2 passengers: 2 + 1 + 2
  });

  test("a GENUINE legacy row (known schema AND its own algorithm revision) is unsupported, not a failure", async () => {
    const { tripId } = await mistagged(
      "address-evidence-1",
      `'mincostflow-v1+address-evidence-1+' || routing_policy`,
    );
    const rebuilt = await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(0); // not counted
    expect(rebuilt.body.estimate!.legs).toMatchObject({ required: 5, fetched: 5, reused: 0 }); // cold, and no older row consulted
  });

  test("a legacy-looking row whose ALGORITHM revision does not match is corruption", async () => {
    const { tripId } = await mistagged("address-evidence-1", `'mincostflow-v1+address-evidence-7+' || routing_policy`);
    await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
  });
});

// ================= the sibling: a corrupt stored LOCATION is also a 500, not a 400 =================

describe("a corrupt stored location snapshot is a server-side failure on every route that reads it", () => {
  test("preview, trip-scoped search and the dashboard all answer 500, never 400", async () => {
    routing = installRouting();
    const { tripId } = await onePair("i67loc");
    await admin.query("UPDATE drivers SET location = '{\"label\": 5}'::jsonb WHERE trip_id = $1", [tripId]);
    const preview = await previewOverHttp(tripId); // a miss builds the address roster from the stored snapshots
    expect(preview.status).toBe(500);

    await admin.query("UPDATE trips SET venue_location = '{}'::jsonb WHERE id = $1", [tripId]);
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    await __resetAppPoolForTests();
    const search = await import("../../src/app/api/locations/search/route.ts");
    const searched = await search.POST(new Request("http://127.0.0.1:3100/api/locations/search", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3100" },
      body: JSON.stringify({ query: "pickup", purpose: "pickup", tripId }),
    }));
    expect(searched.status).toBe(500);
    await __resetAppPoolForTests();
    const trip = await import("../../src/app/api/trips/[tripId]/route.ts");
    const dashboard = await trip.GET(new Request(`http://127.0.0.1:3100/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(dashboard.status).toBe(500);
  });
});

// ================= ISSUE-071: a bad summary must never be COMMITTED =================

describe("ISSUE-071: saving a preview whose summary is unusable fails and preserves the prior plan", () => {
  /** A saved plan, then a second preview of the same roster whose summary is then corrupted. */
  async function savedThenCorruptSecond(setClause: string) {
    routing = installRouting();
    const { tripId } = await onePair("i71");
    const first = await publishPreview(pool, tripId);
    expect((await commitPreview(pool, tripId, key(), { previewId: first.body.previewId })).httpStatus).toBe(200);
    const before = (await getTripSnapshot(pool, tripId))!;
    const second = await publishPreview(pool, tripId); // a preview of the SAME roster at the new version
    expect(second.body.previewId).not.toBe(first.body.previewId);
    await admin.query(`UPDATE match_previews SET ${setClause} WHERE id = $1`, [second.body.previewId]);
    return { tripId, before, second };
  }

  test.each([
    ["an empty summary", `summary = '{}'::jsonb`],
    ["another routing policy", `summary = jsonb_set(summary, '{routingPolicy}', '"policy/other"')`],
    ["counts that do not add up", `summary = jsonb_set(summary, '{legs,fetched}', '999')`],
    ["reversed observation times", `summary = jsonb_set(jsonb_set(summary, '{observedFrom}', '"2026-11-24T12:00:05.000Z"'), '{observedTo}', '"2026-11-24T12:00:00.000Z"')`],
    // Internally consistent (reused 2 + local 1 = required 3), but this evidence has NO identical endpoints.
    ["a self-consistent summary that disagrees with the evidence", `summary = jsonb_set(jsonb_set(summary, '{legs,reused}', '2'), '{legs,local}', '1')`],
    // ISSUE-074: valid, ordered, present, and every count right, but not the times THIS evidence carries.
    ["observation times that are valid but not the evidence's", `summary = jsonb_set(jsonb_set(summary, '{observedFrom}', '"2028-02-29T00:00:00.000Z"'), '{observedTo}', '"2028-02-29T00:00:00.000Z"')`],
    // The summary is fine; the row's own routing-policy column names another policy.
    ["a routing-policy column that disagrees with the trip", `routing_policy = 'policy/other'`],
  ])("a summary with %s: the save is refused (500), the version and the readable dashboard are unchanged", async (_name, setClause) => {
    const { tripId, before, second } = await savedThenCorruptSecond(setClause);
    const receipts = (await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM mutation_receipts")).rows[0].n;
    const failed = await commitPreview(pool, tripId, key(), { previewId: second.body.previewId });
    expect(failed.httpStatus).toBe(500);
    expect((failed.body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
    expect(Number((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM mutation_receipts")).rows[0].n)).toBe(Number(receipts) + 1);
    const committed = (await admin.query<{ version: number; committed_preview_id: string }>("SELECT version, committed_preview_id FROM trips WHERE id = $1", [tripId])).rows[0];
    expect(committed.version).toBe(before.version); // PostgreSQL confirms nothing advanced
    expect(committed.committed_preview_id).toBe(before.committedPreviewId);
    expect(await getTripSnapshot(pool, tripId)).toEqual(before); // and the dashboard still loads, unchanged
  });

  test("control: an untouched second preview still saves, and the dashboard reads it", async () => {
    const { tripId, second } = await savedThenCorruptSecond(`summary = summary`);
    expect((await commitPreview(pool, tripId, key(), { previewId: second.body.previewId })).httpStatus).toBe(200);
    expect((await getTripSnapshot(pool, tripId))!.committedPreviewId).toBe(second.body.previewId);
  });
});

// ================= ISSUE-072: impossible calendar dates and times =================

describe("ISSUE-072: a timestamp must be a real instant, not just the right shape", () => {
  const IMPOSSIBLE = ["2026-19-42T35:73:65.000Z", "2026-02-30T00:00:00.000Z", "2026-11-24T24:00:00.000Z", "2026-13-01T00:00:00.000Z"];

  test.each(IMPOSSIBLE)("evidence observation time %s: the candidate is discarded and rebuilt cold", async (stamp) => {
    routing = installRouting();
    const { tripId, extra } = await onePair("i72a");
    const first = await publishPreview(pool, tripId);
    await admin.query(
      `UPDATE match_previews SET evidence = jsonb_set(evidence, '{legs}', (SELECT jsonb_agg(jsonb_set(l, '{observedAt}', to_jsonb($2::text))) FROM jsonb_array_elements(evidence->'legs') l)) WHERE id = $1`,
      [first.body.previewId, stamp]);
    await addSyntheticPassenger(pool, tripId, "Q", extra);
    routing.reset();
    resetAddressCounters();
    const rebuilt = await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
    expect(rebuilt.body.estimate!.legs).toMatchObject({ required: 5, fetched: 5, reused: 0 });
    expect(JSON.stringify(rebuilt.body)).not.toContain(stamp); // the impossible time is never displayed
  });

  test.each(IMPOSSIBLE)("a summary observation time %s is a server-side failure", async (stamp) => {
    routing = installRouting();
    const { tripId } = await onePair("i72b");
    const first = await publishPreview(pool, tripId);
    await admin.query("UPDATE match_previews SET summary = jsonb_set(jsonb_set(summary, '{observedFrom}', to_jsonb($2::text)), '{observedTo}', to_jsonb($2::text)) WHERE id = $1", [first.body.previewId, stamp]);
    await expect(publishPreview(pool, tripId)).rejects.toThrow();
  });
});

// ================= ISSUE-073: a participant listed twice =================

describe("ISSUE-073: a candidate that lists a participant twice is discarded whole", () => {
  test.each([
    ["driver", "drivers"],
    ["passenger", "passengers"],
  ])("a duplicated %s entry in the stored roster", async (_who, list) => {
    routing = installRouting();
    const { tripId, driver, extra } = await onePair("i73");
    const first = await publishPreview(pool, tripId);
    await admin.query(`UPDATE match_previews SET evidence = jsonb_set(evidence, '{${list}}', (evidence->'${list}') || (evidence->'${list}'->0)) WHERE id = $1`, [first.body.previewId]);
    await editDriver(pool, tripId, driver, key(), { baseVersion: await version(tripId), seatCapacity: 2 });
    routing.reset();
    resetAddressCounters();
    const rebuilt = await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(1);
    expect(rebuilt.body.estimate!.legs).toEqual({ required: 3, fetched: 3, reused: 0, local: 0 });
    void extra;
  });

  test("control: DISTINCT participants may still share one location", async () => {
    routing = installRouting();
    const [V] = spots("i73cv", 1);
    const [S] = spots("i73cs", 1, 10);
    const [P] = spots("i73cp", 1, 20);
    const tripId = await createSyntheticTrip(pool, V);
    const { mint } = await import("./helpers/address.ts");
    const shared = await mint(pool, "pickup", tripId, P); // one token, so ONE location ID
    for (const name of ["Pa", "Pb"]) await addRequest(pool, tripId, key(), { name, pickupSelectionToken: shared });
    await addSyntheticDriver(pool, tripId, "X", S, 2, 120);
    await publishPreview(pool, tripId);
    await addSyntheticDriver(pool, tripId, "Y", spots("i73cy", 1, 30)[0], 1, 120);
    resetAddressCounters();
    await publishPreview(pool, tripId);
    expect(addressCounters.reuseCandidateDiscarded).toBe(0); // reused: two passengers sharing a location is legal
  });
});
