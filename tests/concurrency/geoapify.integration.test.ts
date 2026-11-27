import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PreviewDeadline } from "../../src/db/deadline.ts";
import { __setTransactionCommitFaultHook } from "../../src/db/transaction.ts";
import * as permits from "../../src/trips/routing-permit.ts";
import * as travelTimes from "../../src/trips/travel-times.ts";
import * as telemetry from "../../src/trips/preview-telemetry.ts";
import { legKey, requiredPairs, type AddressPoint, type AddressRoster, type Leg } from "../../src/matching/address.ts";
import { planMatrix } from "../../src/routing/matrix.ts";
import { computeAddressPreview } from "../../src/trips/address-preview.ts";
import { addressCounters, resetAddressCounters } from "../../src/trips/address-metrics.ts";
import { editDriver, editRequest, getTripSnapshot } from "../../src/trips/service.ts";
import { commitPreview } from "../../src/trips/commit.ts";
import { runPreview } from "../../src/app/api/http.ts";
import { createPool } from "../../src/db/pool.ts";
import { bootstrapWorkspace } from "../../src/workspaces/service.ts";
import { geoapifyRoutingAdapter, GeoapifyRateLimit } from "../../src/routing/geoapify.ts";
import { __setRoutingAdapterForTests, routingPolicyFor } from "../../src/routing/index.ts";
import { __setPublishBarrier, publishPreview } from "../../src/trips/preview.ts";
import {
  APP, SETUP, addSyntheticDriver, addSyntheticPassenger, createSyntheticTrip,
  mint, resetTestDatabase, spots, useFixtureEnvironment, type FixtureEnv,
} from "./helpers/address.ts";

type Waypoint = { location: [number, number] };
interface RequestBody {
  sources: Waypoint[];
  targets: Waypoint[];
}

const [venue, driver, pickup] = spots("matrix", 3);
const waypoint = ({ lon, lat }: typeof venue) => ({ location: [lon, lat] });
const profile = { mode: "drive", traffic: "free_flow", type: "balanced", units: "metric", max_speed: 140 };
const times = new Map([
  [JSON.stringify([waypoint(driver), waypoint(pickup)]), 403.25],
  [JSON.stringify([waypoint(driver), waypoint(venue)]), 519.5],
  [JSON.stringify([waypoint(pickup), waypoint(venue)]), 346.75],
]);

test.each([
  { name: "scattered workspace hits", credits: [400, 500, 500], chosen: "P0", requests: [[16, 20], [4, 50]] },
  { name: "coordinate reuse with empty store", credits: [424, 500, 520], chosen: "P0", requests: [[14, 26], [6, 24], [20, 1]] },
  { name: "aligned workspace hits", credits: [500, 480, 480], chosen: "P1", requests: [[20, 48]] },
  { name: "fragmented workspace hits", credits: [500, 546, 400], chosen: "P2", requests: [[14, 40]] },
] as const)("SC-04: dispatches the lowest-credit rectangles for $name", async ({ name, credits, chosen, requests }) => {
  const asPoint = (spot: typeof venue): AddressPoint => ({ ...spot, id: randomUUID(), providerRef: spot.ref });
  const starts = spots("pricing-driver", 20, 200).map(asPoint);
  const pickups = spots("pricing-pickup", 50, 250).map(asPoint);
  const roster: AddressRoster = {
    venue: asPoint(venue),
    drivers: starts.map(location => ({ id: randomUUID(), active: true, seatCapacity: 2, maxDetourMinutes: 15, location })),
    passengers: pickups.map(location => ({ id: randomUUID(), active: true, location })),
  };
  const required = requiredPairs(roster);
  const baselineKnown = new Set<string>();
  const trip = new Map<string, Leg>();
  const history: AddressPoint[] = [];
  const workspace = new Map<string, Leg>();
  const observedAt = "2026-11-24T00:00:00.000Z";
  for (const { from, to } of required) {
    const i = starts.indexOf(from);
    const j = pickups.indexOf(to);
    const key = legKey(from.id, to.id);
    const observation: Leg = { from: from.id, to: to.id, seconds: 60, source: "provider", observedAt };
    const knownById = j < 0
      ? name !== "coordinate reuse with empty store" || i < 0
      : (name === "scattered workspace hits" && i < 16 && j >= 20)
        || (name === "coordinate reuse with empty store" && (i < 14 ? j >= 26 : j < 26));
    if (knownById) {
      baselineKnown.add(key);
      trip.set(key, observation);
    } else if (name === "coordinate reuse with empty store" && j >= 0) {
      const localColumn = i < 14 ? j : j - 26;
      if (localColumn === i || (i < 8 && localColumn === i + 14)) {
        const old = { ...to, id: randomUUID() };
        history.push(old);
        trip.set(legKey(from.id, old.id), { ...observation, to: old.id, seconds: null });
      }
    } else if (j >= 0 && (
      (name === "scattered workspace hits" && j === i)
      || (name === "aligned workspace hits" && j >= 48)
      || (name === "fragmented workspace hits" && (i >= 14 || j >= 40 || j === i))
    )) {
      workspace.set(key, observation);
    }
  }
  const baseline = travelTimes.missingTravelPairs(required, new Map([...trip].filter(([key]) => baselineKnown.has(key))));
  travelTimes.reuseTripCoordinates(roster, required, trip, history);
  const candidate = new Map([...workspace, ...trip]);
  const misses = travelTimes.missingTravelPairs(required, candidate);
  const selection = planMatrix(required, baseline, misses, roster.venue);
  expect(["P0", "P1", "P2"].map(id => selection.alternatives.find(p => p.plan === id)?.predictedBaseCredits))
    .toEqual(credits);

  stub.respondWith((res, body) => {
    const response = matrix(body);
    for (const row of response.sources_to_targets) for (const cell of row) cell.time = 120;
    res.end(JSON.stringify(response));
  });
  const adapter = geoapifyRoutingAdapter({ endpoint: stub.endpoint, apiKey: "stub-key", limit: new GeoapifyRateLimit() });
  const refreshed = new Map<string, Leg>();
  const settled = new Map<string, Leg>();
  const result = await computeAddressPreview(roster, {
    provider: "geoapify", policyId: adapter.policyId, adapter: () => adapter, baselineKnown, settled,
    recordBatch: batch => {
      for (const { leg } of batch) refreshed.set(legKey(leg.from, leg.to), leg);
    },
  }, candidate);
  const actualShapes = stub.calls.map(({ body }) => [body.sources.length, body.targets.length]);
  expect(actualShapes).toEqual(requests);
  const dispatched = new Set(stub.calls.flatMap(({ body }) => body.sources
    .flatMap(from => body.targets.map(to => JSON.stringify([from.location, to.location])))));
  for (const { from, to } of misses) {
    expect(dispatched.has(JSON.stringify([[from.lon, from.lat], [to.lon, to.lat]]))).toBe(true);
  }
  for (const [sources, targets] of actualShapes) expect(sources * targets).toBeLessThanOrEqual(1000);
  const baseCredits = actualShapes.reduce((sum, [sources, targets]) =>
    sum + (sources > targets ? sources * Math.min(targets, 10) : targets * Math.min(sources, 10)), 0);
  expect(result.matrix).toEqual({
    plan: chosen, requests: actualShapes, predictedBaseCredits: baseCredits,
    cells: actualShapes.reduce((sum, [sources, targets]) => sum + sources * targets, 0),
  });
  expect(baseCredits).toBeLessThanOrEqual(credits[0]);
  const stored = new Map(result.evidence.legs.map(leg => [legKey(leg.from, leg.to), leg]));
  for (const { from, to } of misses) expect(stored.get(legKey(from.id, to.id))?.seconds).toBe(120);
  let refetched = 0;
  for (const [key, leg] of candidate) {
    if (!stored.has(key)) continue;
    expect(stored.get(key)).toEqual(leg);
    expect(settled.has(key)).toBe(false);
    if (refreshed.has(key)) {
      refetched++;
      expect(refreshed.get(key)?.seconds).toBe(120);
    }
  }
  expect(refetched).toBe(name === "aligned workspace hits" ? 0
    : name === "scattered workspace hits" ? 20 : name === "fragmented workspace hits" ? 14 : 28);
});

function matrix(body: RequestBody) {
  return {
    // Deliberately different from the submitted locations.
    sources: body.sources.map(() => ({ location: [0, 0] })),
    targets: body.targets.map(() => ({ location: [0, 0] })),
    sources_to_targets: body.sources.map((source, i) => body.targets.map((target, j) => ({
      source_index: i, target_index: j, time: times.get(JSON.stringify([source, target])) ?? null,
    }))),
  };
}

async function startStub() {
  const calls: { method?: string; url?: string; type?: string; body: RequestBody }[] = [];
  let respond = (res: ServerResponse, body: RequestBody) => { res.end(JSON.stringify(matrix(body))); };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push({ method: req.method, url: req.url, type: req.headers["content-type"], body });
    respond(res, body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/routematrix`,
    calls,
    respondWith(fn: typeof respond) { respond = fn; },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

let env: FixtureEnv;
let pool: Pool;
let stub: Awaited<ReturnType<typeof startStub>>;
let tripId: string;
let firstDriver: string;
function install(apiKey = "stub-key", timeoutMs = 5_000) {
  __setRoutingAdapterForTests(geoapifyRoutingAdapter({
    apiKey, timeoutMs, endpoint: stub.endpoint, limit: new GeoapifyRateLimit(),
  }));
}
const preview = () => runPreview(() => publishPreview(pool, tripId));

beforeEach(async () => {
  env = useFixtureEnvironment();
  await resetTestDatabase();
  pool = createPool(APP, 3);
  tripId = await createSyntheticTrip(pool, venue);
  firstDriver = await addSyntheticDriver(pool, tripId, "D", driver, 1);
  await addSyntheticPassenger(pool, tripId, "P", pickup);
  // D's live search is outside this checkpoint. Seed the provider namespace on
  // the three fictional, already-confirmed snapshots before the first preview.
  await pool.query("UPDATE trips SET venue_location = venue_location || $2::jsonb WHERE id = $1", [tripId, { provider: "geoapify" }]);
  await pool.query("UPDATE drivers SET location = location || $2::jsonb WHERE trip_id = $1", [tripId, { provider: "geoapify" }]);
  await pool.query("UPDATE ride_requests SET location = location || $2::jsonb WHERE trip_id = $1", [tripId, { provider: "geoapify" }]);
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "geoapify";
  stub = await startStub();
  install();
});
afterEach(async () => {
  __setRoutingAdapterForTests(undefined);
  await stub?.close();
  await pool?.end();
  env.dispose();
});

test("L-13: two directed rectangles, pinned profile, fractions and immutable endpoints", async () => {
  const res = await preview();
  expect(res.status).toBe(200);
  const result = await res.json();
  // 403.25 + 346.75 - 519.50 = 230.50, rounded once.
  expect(result.optimal).toMatchObject({ matchedCount: 1, totalCost: 231 });
  expect(stub.calls.map((call) => call.body)).toEqual([
    { ...profile, sources: [waypoint(driver)], targets: [waypoint(pickup)] },
    { ...profile, sources: [waypoint(driver), waypoint(pickup)], targets: [waypoint(venue)] },
  ]);
  for (const call of stub.calls) {
    expect(call).toMatchObject({ method: "POST", url: "/v1/routematrix?apiKey=stub-key", type: "application/json" });
  }
  const { evidence } = (await pool.query("SELECT evidence FROM match_previews WHERE trip_id=$1", [tripId])).rows[0];
  expect(evidence.venue).toMatchObject({ lon: venue.lon, lat: venue.lat });
  expect(evidence.drivers[0].location).toMatchObject({ lon: driver.lon, lat: driver.lat });
  expect(evidence.passengers[0].location).toMatchObject({ lon: pickup.lon, lat: pickup.lat });
  expect(evidence.legs.map((leg: { seconds: number }) => leg.seconds).sort()).toEqual([346.75, 403.25, 519.5]);
  __setRoutingAdapterForTests(undefined);
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
  expect(result.estimate.routingPolicy).toBe(routingPolicyFor("geoapify"));
  expect(await (await preview()).json()).toEqual(result);
});

test("L-13: explicit null excludes an edge", async () => {
  stub.respondWith((res, body) => {
    const response = matrix(body);
    if (stub.calls.length === 1) response.sources_to_targets[0][0].time = null;
    res.end(JSON.stringify(response));
  });
  expect(await (await preview()).json()).toMatchObject({ optimal: { matchedCount: 0 } });
});

test.each(["401", "403", "429", "invalid JSON", "wrong index", "missing row", "string time",
  "missing time", "negative time", "duplicate row", "socket lost", "stalled body", "missing key"])(
  "L-13: %s leaves no published row or receipt and a retry recovers", async (failure) => {
    const receipts = async () => (await pool.query("SELECT count(*) FROM mutation_receipts")).rows[0].count;
    const before = await receipts();
    if (failure === "missing key") install("");
    if (failure === "stalled body") install("stub-key", 350);
    stub.respondWith((res, body) => {
      const good = matrix(body);
      if (stub.calls.length !== 2) { res.end(JSON.stringify(good)); return; }
      const cells = good.sources_to_targets;
      switch (failure) {
        case "401": case "403": case "429":
          res.writeHead(Number(failure), { "retry-after": "7" }).end("upstream detail"); return;
        case "invalid JSON": res.end("{"); return;
        case "socket lost": res.destroy(); return;
        case "stalled body": res.writeHead(200).write("{"); return;
        case "wrong index": cells[0][0].target_index = 1; break;
        case "missing row": cells.pop(); break;
        case "duplicate row": cells[1] = cells[0]; break;
        case "string time": Object.assign(cells[0][0], { time: "90" }); break;
        case "missing time": Reflect.deleteProperty(cells[0][0], "time"); break;
        case "negative time": cells[0][0].time = -1; break;
      }
      res.end(JSON.stringify(good));
    });
    const response = await preview();
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({ error: {
      code: failure === "429" ? "ROUTING_QUOTA" : "ROUTING_UNAVAILABLE",
      message: expect.any(String), requestId: expect.any(String),
    } });
    expect(JSON.stringify(payload)).not.toMatch(/stub-key|upstream detail/);
    expect(stub.calls).toHaveLength(failure === "missing key" ? 0 : 2);
    if (failure === "429") {
      expect(response.headers.get("retry-after")).toBe("7");
      expect((await preview()).status).toBe(503);
      expect(stub.calls).toHaveLength(2);
    }
    expect((await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [tripId])).rowCount).toBe(0);
    expect(await receipts()).toBe(before);
    install();
    stub.respondWith((res, body) => { res.end(JSON.stringify(matrix(body))); });
    expect((await preview()).status).toBe(200);
    expect((await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [tripId])).rowCount).toBe(1);
  },
);

function barrier() {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => { open = resolve; });
  return { reached, open };
}

test("ISSUE-076: three queued versions publish one winner with no repeated provider cells", async () => {
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  const computed = barrier();
  const release = barrier();
  const middleQueued = barrier();
  const lastQueued = barrier();
  const restorePublish = __setPublishBarrier(async () => {
    computed.open(); // both rectangles have been decoded before the first publisher gets here
    await release.reached;
  });
  const acquire = permits.acquireRouting;
  const admission = vi.spyOn(permits, "acquireRouting").mockImplementation((...args) => {
    const waiting = acquire(...args);
    // The original holder is gated, so neither newer acquire can return a permit yet.
    if (args[1] === version + 1) middleQueued.open();
    if (args[1] === version + 2) lastQueued.open();
    return waiting;
  });
  const requests = [preview()];
  try {
    await computed.reached;
    const changeSeats = (baseVersion: number, seatCapacity: number) =>
      editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion, seatCapacity });
    expect((await changeSeats(version, 2)).httpStatus).toBe(200);
    requests.push(preview());
    await middleQueued.reached;
    expect((await changeSeats(version + 1, 3)).httpStatus).toBe(200);
    requests.push(preview());
    await lastQueued.reached;
    release.open();

    const [old, middle, latest] = await Promise.all(requests);
    expect([old.status, middle.status, latest.status]).toEqual([409, 409, 200]);
    for (const res of [old, middle]) {
      expect(await res.json()).toMatchObject({ error: { code: "STALE_VERSION" } });
    }
    const winner = await latest.json();
    expect((await pool.query("SELECT id, base_version FROM match_previews WHERE trip_id=$1", [tripId])).rows)
      .toEqual([{ id: winner.previewId, base_version: version + 2 }]);
    // Count every request and every directed cell across all three versions.
    expect(stub.calls.map(({ body }) => [body.sources, body.targets])).toEqual([
      [[waypoint(driver)], [waypoint(pickup)]],
      [[waypoint(driver), waypoint(pickup)], [waypoint(venue)]],
    ]);
    expect(winner.estimate.legs).toEqual({ required: 3, fetched: 0, reused: 3, local: 0 });
    expect(winner.optimal).toMatchObject({ matchedCount: 1, totalCost: 231 });
  } finally {
    release.open();
    admission.mockRestore();
    restorePublish();
    await Promise.allSettled(requests);
  }
});

test("ISSUE-078: a zero-seat successor retains settled legs before the old preview is released", async () => {
  const reached = barrier();
  const release = barrier();
  const restore = __setPublishBarrier(async () => {
    restore(); // gate only the first publisher, after both matrix responses
    reached.open();
    await release.reached;
  });
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  const setSeats = (baseVersion: number, seatCapacity: number) =>
    editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion, seatCapacity });
  const storedLegs = async (previewId: string) =>
    (await pool.query("SELECT evidence->'legs' AS legs FROM match_previews WHERE trip_id=$1 AND id=$2",
      [tripId, previewId])).rows[0].legs;

  const old = preview();
  try {
    await reached.reached;
    expect(stub.calls).toHaveLength(2);
    expect((await setSeats(version, 0)).httpStatus).toBe(200);
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    const empty = await preview();
    expect(empty.status).toBe(200);
    const dormant = await empty.json();
    expect(dormant).toMatchObject({
      optimal: { matchedCount: 0 },
      estimate: { legs: { required: 0, reused: 0, fetched: 0, local: 0 }, observedFrom: null, observedTo: null },
    });
    const retained = await storedLegs(dormant.previewId);
    expect(retained.map((leg: { seconds: number }) => leg.seconds).sort()).toEqual([346.75, 403.25, 519.5]);
    release.open();
    expect((await old).status).toBe(409);

    expect((await setSeats(version + 1, 2)).httpStatus).toBe(200);
    const resumed = await preview();
    expect(resumed.status).toBe(200);
    const winner = await resumed.json();
    expect(winner).toMatchObject({
      optimal: { matchedCount: 1, totalCost: 231 },
      estimate: { legs: { required: 3, reused: 3, fetched: 0, local: 0 } },
    });
    expect(await storedLegs(winner.previewId)).toEqual(retained); // includes endpoints and observation timestamps
    expect(stub.calls).toHaveLength(2);
    expect((await pool.query("SELECT base_version FROM match_previews WHERE trip_id=$1 ORDER BY base_version",
      [tripId])).rows).toEqual([{ base_version: version + 1 }, { base_version: version + 2 }]);
  } finally {
    release.open();
    restore();
    await old;
  }
});

test.each([0, 1])("ISSUE-080: covered publisher %i wins with all dormant legs after the routing holder exits", async (winner) => {
  const gates = Array.from({ length: 3 }, () => ({ ready: barrier(), release: barrier() }));
  let arrivals = 0;
  const restore = __setPublishBarrier(async () => {
    const gate = gates[arrivals++];
    if (gate) {
      gate.ready.open();
      await gate.release.reached;
    }
  });
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  const setSeats = (baseVersion: number, seatCapacity: number) =>
    editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion, seatCapacity });
  const old = preview();
  const peers: Promise<Response>[] = [];
  try {
    await gates[0].ready.reached;
    expect(stub.calls).toHaveLength(2);
    expect((await setSeats(version, 0)).httpStatus).toBe(200);
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    peers.push(preview());
    await gates[1].ready.reached;
    gates[0].release.open();
    expect((await old).status).toBe(409);
    peers.push(preview());
    await gates[2].ready.reached;

    gates[1 + winner].release.open();
    const first = await peers[winner];
    expect(first.status).toBe(200);
    const saved = await first.json();
    gates[2 - winner].release.open();
    const other = await peers[1 - winner];
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual(saved);
    expect(saved).toMatchObject({ baseVersion: version + 1, optimal: { matchedCount: 0 }, estimate: { legs: { required: 0 } } });
    const { rows } = await pool.query("SELECT id, evidence->'legs' AS legs FROM match_previews WHERE trip_id=$1", [tripId]);
    expect(rows.map(row => row.id)).toEqual([saved.previewId]);
    expect(rows[0].legs.map((leg: Leg) => leg.seconds).sort()).toEqual([346.75, 403.25, 519.5]);

    expect((await setSeats(version + 1, 2)).httpStatus).toBe(200);
    const resumed = await preview();
    expect(resumed.status).toBe(200);
    const result = await resumed.json();
    expect(result).toMatchObject({ optimal: { matchedCount: 1, totalCost: 231 }, estimate: { legs: { reused: 3, fetched: 0 } } });
    const stored = await pool.query("SELECT evidence->'legs' AS legs FROM match_previews WHERE id=$1", [result.previewId]);
    expect(stored.rows[0].legs).toEqual(rows[0].legs);
    expect(stub.calls).toHaveLength(2);
  } finally {
    for (const gate of gates) gate.release.open();
    restore();
    await Promise.allSettled([old, ...peers]);
  }
});

test("ISSUE-078: a covered preview retains a settled no-route while the venue batch is stalled", async () => {
  const stalled = barrier();
  stub.respondWith((res, body) => {
    if (stub.calls.length === 2) {
      res.writeHead(200).write("{");
      stalled.open();
    } else {
      const result = matrix(body);
      result.sources_to_targets[0][0].time = null;
      res.end(JSON.stringify(result));
    }
  });
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  const old = preview();
  await stalled.reached;
  expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version, seatCapacity: 0 })).httpStatus).toBe(200);
  const empty = await preview();
  expect(empty.status).toBe(200);
  expect((await old).status).toBe(409);
  const { evidence } = (await pool.query("SELECT evidence FROM match_previews WHERE trip_id=$1", [tripId])).rows[0];
  expect(evidence.legs).toEqual([{
    from: evidence.drivers[0].location.id, to: evidence.passengers[0].location.id,
    seconds: null, source: "provider", observedAt: expect.any(String),
  }]);
  expect(stub.calls).toHaveLength(2);
});

test.each(["valid", "corrupt"])("ISSUE-078: covered handoff respects %s stored evidence", async (kind) => {
  const prior = await (await preview()).json();
  const { evidence } = (await pool.query("SELECT evidence FROM match_previews WHERE id=$1", [prior.previewId])).rows[0];
  if (kind === "corrupt") {
    const admin = createPool(SETUP, 1);
    try { await admin.query("UPDATE match_previews SET evidence='{}'::jsonb WHERE id=$1", [prior.previewId]); }
    finally { await admin.end(); }
  }

  // Stage distinguishable observations for the same endpoints in an older permit.
  const old = (await permits.acquireRouting(tripId, prior.baseVersion, routingPolicyFor("geoapify"), new PreviewDeadline()))!;
  for (const leg of evidence.legs as Leg[]) old.settled.set(legKey(leg.from, leg.to), { ...leg, seconds: 99 });
  try {
    // Canceling removes both driver legs from the retention set. The valid
    // stored pickup→venue wins over the staged one. A corrupt candidate means cold.
    expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: prior.baseVersion, active: false })).httpStatus).toBe(200);
    const result = await preview();
    expect(result.status).toBe(200);
    const { previewId } = await result.json();
    const { legs } = (await pool.query("SELECT evidence->'legs' AS legs FROM match_previews WHERE id=$1", [previewId])).rows[0];
    expect(legs).toEqual(kind === "corrupt" ? [] : evidence.legs.filter((leg: Leg) => leg.from === evidence.passengers[0].location.id));
    expect(stub.calls).toHaveLength(2);
  } finally { old.release(); }
});

test.each<[string | undefined, string | null, number?]>([
  ["7", "7"],
  ["0", "0"],
  ["-1", null],
  ["1.5", null],
  ["Sun, 06 Nov 1994 08:49:37 GMT", "7"],
  ["Fri, 01 Jan 9999 00:00:07 GMT", "7", Date.UTC(9999, 0, 1)],
  ["Sat, 01 Jan 10000 00:00:07 GMT", null],
  ["Sunday, 06-Nov-94 08:49:37 GMT", "7"],
  ["Sun Nov  6 08:49:37 1994", "7"],
  ["Sun Nov 06 08:49:37 1994", "7"],
  ["Saturday, 01-Jan-50 00:00:07 GMT", "7", Date.UTC(2050, 0, 1)],
  ["Friday, 01-Jan-00 00:00:02 GMT", "7", Date.UTC(2099, 11, 31, 23, 59, 55)],
  // At exactly fifty years the future instant is accepted. One second later the year resolves to 1950.
  ["Saturday, 01-Jan-50 00:00:00 GMT", "1577923200", Date.UTC(2000, 0, 1)],
  ["Sunday, 01-Jan-50 00:00:01 GMT", "0", Date.UTC(2000, 0, 1)],
  ["Saturday, 01-Jan-50 00:00:01 GMT", null, Date.UTC(2000, 0, 1)],
  ["Mon Nov 06 08:49:37 1994", null],
  ["Sun Nov 6 08:49:37 1994", null],
  ["unavailable", null],
  [undefined, null],
])("ISSUE-077/079: temporary provider 503 with Retry-After %s", async (hint, expected, now = Date.UTC(1994, 10, 6, 8, 49, 30)) => {
  stub.respondWith((res, body) => {
    if (stub.calls.length === 1) res.end(JSON.stringify(matrix(body)));
    else res.writeHead(503, hint === undefined ? {} : { "retry-after": hint }).end();
  });
  // Fix the receive time for HTTP dates while keeping real I/O and deadline timers.
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  let res: Response;
  try { res = await preview(); } finally { clock.mockRestore(); }
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: { code: "ROUTING_UNAVAILABLE" } });
  expect(res.headers.get("retry-after")).toBe(expected);
  expect(stub.calls).toHaveLength(2);
  expect((await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [tripId])).rowCount).toBe(0);
});

test("ISSUE-081: a five-digit IMF year on a 429 uses only the fallback cooldown", async () => {
  stub.respondWith((res, body) => {
    if (stub.calls.length === 1) res.writeHead(429, { "retry-after": "Sat, 01 Jan 10000 00:00:07 GMT" }).end();
    else res.end(JSON.stringify(matrix(body)));
  });
  const now = vi.spyOn(performance, "now").mockReturnValue(1000);
  try {
    const failed = await preview();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: "ROUTING_QUOTA" } });
    expect(failed.headers.get("retry-after")).toBeNull();
    now.mockReturnValue(1999);
    const cooling = await preview();
    expect(cooling.status).toBe(503);
    expect(cooling.headers.get("retry-after")).toBe("1");
    expect(stub.calls).toHaveLength(1);
    now.mockReturnValue(2000);
    expect((await preview()).status).toBe(200);
    expect(stub.calls).toHaveLength(3);
  } finally { now.mockRestore(); }
});

test("L-14: same-version peer is busy, successor waits for settlement and keeps only pickup→venue", async () => {
  // Seed Y dormant before any preview. Its location is distinct from X's.
  const second = spots("replacement", 1, 40)[0];
  const { id: secondId } = (await pool.query(
    `INSERT INTO drivers(trip_id,name,seat_capacity,location_mode,location,max_detour_minutes)
     SELECT trip_id,'Y',0,'address',location || $2::jsonb,max_detour_minutes
     FROM drivers WHERE id=$1 RETURNING id`,
    [firstDriver, { id: randomUUID(), providerRef: second.ref, lon: second.lon, lat: second.lat }],
  )).rows[0];
  const oldComplete = barrier();
  const notice = barrier();
  const settle = barrier();
  const adapter = geoapifyRoutingAdapter({ endpoint: stub.endpoint, apiKey: "stub", limit: new GeoapifyRateLimit() });
  let workloads = 0;
  let peak = 0;
  let first = true;
  __setRoutingAdapterForTests({ ...adapter, async fetchLegs(pairs, request) {
    workloads++;
    peak = Math.max(peak, workloads);
    try {
      const cells = await adapter.fetchLegs(pairs, request);
      if (first) {
        first = false;
        request.signal!.addEventListener("abort", notice.open, { once: true });
        oldComplete.open();
        await settle.reached; // model late completion after the transport's validated batches
      }
      return cells;
    } finally { workloads--; }
  } });
  const old = preview();
  try {
    await oldComplete.reached;
    const busy = await preview();
    expect(busy.status).toBe(429);
    expect(await busy.json()).toMatchObject({ error: { code: "PREVIEW_BUSY" } });
    expect(stub.calls).toHaveLength(2);
    const oldVersion = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0].version;
    const cancel = await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: oldVersion, active: false });
    expect(cancel.httpStatus).toBe(200);
    const activate = await editDriver(pool, tripId, secondId, randomUUID(), { baseVersion: oldVersion + 1, seatCapacity: 1 });
    expect(activate.httpStatus).toBe(200);
    const newer = preview();
    await notice.reached;
    expect(stub.calls).toHaveLength(2);
    settle.open();
    expect((await old).status).toBe(409);
    const result = (await newer)!;
    expect(result.status).toBe(200);
    const winner = await result.json();
    expect(winner.estimate.legs).toMatchObject({ required: 3, reused: 1, fetched: 2 });
    expect(peak).toBe(1);
    expect(stub.calls.slice(2).map((call) => [call.body.sources, call.body.targets])).toEqual([
      [[waypoint(second)], [waypoint(pickup)]], [[waypoint(second)], [waypoint(venue)]],
    ]);
    const rows = (await pool.query("SELECT evidence,base_version FROM match_previews WHERE trip_id=$1", [tripId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].base_version).toBe(oldVersion + 2);
    const x = (await pool.query("SELECT location->>'id' AS id FROM drivers WHERE id=$1", [firstDriver])).rows[0].id;
    expect(JSON.stringify(rows[0].evidence)).not.toContain(x);
    expect(await (await preview()).json()).toEqual(winner);
    expect(stub.calls).toHaveLength(4);
  } finally { settle.open(); }
});

test("L-15: two fixture computations with different times return the one stored winner", async () => {
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
  const fixtureTrip = await createSyntheticTrip(pool, venue);
  await addSyntheticDriver(pool, fixtureTrip, "D", driver, 1);
  await addSyntheticPassenger(pool, fixtureTrip, "P", pickup);
  const ready = barrier();
  const release = barrier();
  let count = 0;
  __setRoutingAdapterForTests({
    provider: "fixture", policyId: "fixture/race",
    async fetchLegs(pairs) {
      const time = ++count * 60;
      return pairs.map(() => time);
    },
  });
  const restore = __setPublishBarrier(async () => {
    if (count === 2) ready.open();
    await release.reached;
  });
  try {
    const a = publishPreview(pool, fixtureTrip);
    const b = publishPreview(pool, fixtureTrip);
    await ready.reached;
    release.open();
    const [left, right] = await Promise.all([a, b]);
    expect(left.body).toEqual(right.body);
    expect([60, 120]).toContain(left.body.optimal.totalCost);
    expect((await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [fixtureTrip])).rowCount).toBe(1);
  } finally { release.open(); restore(); }
});

test("L-15: roster edit during a live batch prevents stale publication", async () => {
  const started = barrier();
  const release = barrier();
  stub.respondWith((res, body) => {
    started.open();
    void release.reached.then(() => res.end(JSON.stringify(matrix(body))));
  });
  const old = preview();
  try {
    await started.reached;
    const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
    expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version, seatCapacity: 2 })).httpStatus).toBe(200);
    release.open();
    const response = await old;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "STALE_VERSION", currentVersion: version + 1 } });
    expect((await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [tripId])).rowCount).toBe(0);
  } finally { release.open(); }
});

test.each(["pool", "trip lock"])("L-16: routing and blocked %s share one deadline and the pool recovers", async (block) => {
  const only = createPool(APP, 1);
  const upstream = barrier();
  const release = barrier();
  stub.respondWith((res, body) => {
    if (stub.calls.length === 2) {
      upstream.open();
      void release.reached.then(() => res.end(JSON.stringify(matrix(body))));
    } else res.end(JSON.stringify(matrix(body)));
  });
  const blocked = await pool.connect();
  let occupying;
  try {
    const start = performance.now();
    const pending = runPreview(() => publishPreview(only, tripId, new PreviewDeadline(900)));
    await upstream.reached;
    if (block === "pool") occupying = await only.connect();
    else {
      await blocked.query("BEGIN");
      await blocked.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [tripId]);
    }
    await delay(450); // consume budget at a known barrier, with the blocker already held
    release.open();
    const res = await pending;
    expect(res.status).toBe(503);
    expect(performance.now() - start).toBeLessThan(1200);
    expect((await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [tripId])).rowCount).toBe(0);
    await blocked.query("ROLLBACK");
    occupying?.release();
    occupying = undefined;
    expect((await publishPreview(only, tripId)).httpStatus).toBe(200);
    expect(only.idleCount).toBe(only.totalCount);
  } finally {
    release.open();
    occupying?.release();
    blocked.release(true);
    await only.end();
  }
});

test("L-16: retry after a lost publication acknowledgement finds the committed winner", async () => {
  let injected = false;
  const restore = __setTransactionCommitFaultHook(async (client) => {
    if ((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only !== "off") return;
    const real = client.query.bind(client);
    // A real COMMIT followed by an injected missing acknowledgement in this client.
    client.query = (async (sql: string, values?: unknown[]) => {
      const result = await real(sql, values);
      if (sql === "COMMIT") {
        injected = true;
        throw new Error("acknowledgement unavailable");
      }
      return result;
    }) as typeof client.query;
  });
  try { expect((await preview()).status).toBe(503); } finally { restore(); }
  expect(injected).toBe(true);
  const rows = (await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [tripId])).rows;
  expect(rows).toHaveLength(1);
  expect(await (await preview()).json()).toMatchObject({ previewId: rows[0].id });
  expect(stub.calls).toHaveLength(2);
});

test("L-14: a new version aborts a stalled body and reuses the earlier validated no-route batch", async () => {
  const stalled = barrier();
  const closed = barrier();
  stub.respondWith((res, body) => {
    const result = matrix(body);
    if (stub.calls.length === 1) result.sources_to_targets[0][0].time = null;
    if (stub.calls.length === 2) {
      res.once("close", closed.open);
      res.writeHead(200).write("{");
      stalled.open();
    } else res.end(JSON.stringify(result));
  });
  const old = preview();
  await stalled.reached;
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version, seatCapacity: 2 })).httpStatus).toBe(200);
  const replacement = preview();
  expect((await old).status).toBe(409);
  await closed.reached;
  const result = await replacement;
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    estimate: { legs: { required: 3, reused: 1, fetched: 2 } },
    optimal: { matchedCount: 0 },
  });
  expect(stub.calls.map((call) => call.body.targets)).toEqual([[waypoint(pickup)], [waypoint(venue)], [waypoint(venue)]]);
  const rows = (await pool.query("SELECT base_version FROM match_previews WHERE trip_id=$1", [tripId])).rows;
  expect(rows).toEqual([{ base_version: version + 1 }]);
});

async function pinToWorkspace(id: string, workspaceId: string) {
  const admin = createPool(SETUP, 1);
  try {
    await admin.query("UPDATE trips SET workspace_id=$2, venue_location=venue_location || $3::jsonb WHERE id=$1",
      [id, workspaceId, { provider: "geoapify" }]);
    await admin.query("UPDATE drivers SET location=location || $2::jsonb WHERE trip_id=$1", [id, { provider: "geoapify" }]);
    await admin.query("UPDATE ride_requests SET location=location || $2::jsonb WHERE trip_id=$1", [id, { provider: "geoapify" }]);
  } finally { await admin.end(); }
}

async function sameCoordinatesTrip(workspaceId: string) {
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
  try {
    const id = await createSyntheticTrip(pool, venue);
    await addSyntheticDriver(pool, id, "D", driver, 1);
    await addSyntheticPassenger(pool, id, "P", pickup);
    await pinToWorkspace(id, workspaceId);
    return id;
  } finally {
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "geoapify";
  }
}

test("SC-01: workspace-covered loopback preview sends no matrix request and takes no permit", async () => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const second = await sameCoordinatesTrip(owner.id);
  const liveGate = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, tripId, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
  expect(stub.calls).toHaveLength(2);
  const admission = vi.spyOn(permits, "acquireRouting");
  const recording = vi.spyOn(telemetry, "recordPreview");
  try {
    const warmed = await publishPreview(pool, second, undefined, owner.secret);
    expect(warmed.body).toMatchObject({ optimal: { matchedCount: 1, totalCost: 231 }, estimate: { legs: { reused: 3, fetched: 0 } } });
    expect(stub.calls).toHaveLength(2);
    expect(admission).not.toHaveBeenCalled();
    expect(recording).toHaveBeenLastCalledWith(expect.objectContaining({
      matrix: { plan: "P1", requests: [], cells: 0, predictedBaseCredits: 0 },
    }));
  } finally {
    admission.mockRestore();
    recording.mockRestore();
  }

  // The default live adapter cannot use the populated workspace store. Disable
  // dispatch so the negative control remains completely offline.
  __setRoutingAdapterForTests(undefined);
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
  expect((await runPreview(() => publishPreview(pool, liveGate, undefined, owner.secret))).status).toBe(503);
  expect(stub.calls).toHaveLength(2);
});

test("SC-06: a confirmed no-route stays trip-local and is queried again on another trip", async () => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const next = await sameCoordinatesTrip(owner.id);
  stub.respondWith((res, body) => {
    const result = matrix(body);
    if (stub.calls.length === 1) result.sources_to_targets[0][0].time = null;
    res.end(JSON.stringify(result));
  });
  expect((await publishPreview(pool, tripId, undefined, owner.secret)).body.optimal.matchedCount).toBe(0);
  expect((await pool.query("SELECT seconds FROM travel_times WHERE workspace_id=$1 ORDER BY seconds", [owner.id])).rows)
    .toEqual([{ seconds: 346.75 }, { seconds: 519.5 }]);
  const warmed = await publishPreview(pool, next, undefined, owner.secret);
  expect(warmed.body).toMatchObject({ optimal: { matchedCount: 1 }, estimate: { legs: { reused: 2, fetched: 1 } } });
  expect(stub.calls.map(call => call.body.targets)).toEqual([[waypoint(pickup)], [waypoint(venue)], [waypoint(pickup)]]);
});

test("SC-07: a settled batch persists and reaches its successor during supersession", async () => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const stalled = barrier();
  stub.respondWith((res, body) => {
    if (stub.calls.length === 2) {
      res.writeHead(200).write("{");
      stalled.open();
    } else res.end(JSON.stringify(matrix(body)));
  });
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  const old = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
  await stalled.reached;
  expect((await pool.query("SELECT 1 FROM travel_times WHERE workspace_id=$1", [owner.id])).rowCount).toBe(0);
  expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version, seatCapacity: 0 })).httpStatus).toBe(200);
  const next = await publishPreview(pool, tripId, undefined, owner.secret);
  expect((await old).status).toBe(409);
  expect((await pool.query("SELECT seconds FROM travel_times WHERE workspace_id=$1", [owner.id])).rows)
    .toEqual([{ seconds: 403.25 }]);
  const rows = await pool.query("SELECT id, evidence->'legs' AS legs FROM match_previews WHERE trip_id=$1", [tripId]);
  expect(rows.rows).toEqual([{ id: next.body.previewId, legs: [expect.objectContaining({ seconds: 403.25 })] }]);
  expect(stub.calls).toHaveLength(2);
});

test("ISSUE-123: a pickup at the venue shares a directed observation on cold and warm previews", async () => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const second = await sameCoordinatesTrip(owner.id);
  const admin = createPool(SETUP, 1);
  try {
    await admin.query("UPDATE ride_requests SET location=location || $2::jsonb WHERE trip_id=ANY($1::uuid[])",
      [[tripId, second], { lon: venue.lon, lat: venue.lat }]);
  } finally { await admin.end(); }
  // A second request for the same cell would create a 1,000-second difference.
  stub.respondWith((res, body) => {
    const result = matrix(body);
    if (stub.calls.length === 1) result.sources_to_targets[0][0].time = 1519.5;
    res.end(JSON.stringify(result));
  });
  const cold = await publishPreview(pool, tripId, undefined, owner.secret);
  const warm = await publishPreview(pool, second, undefined, owner.secret);
  for (const preview of [cold, warm]) expect(preview.body.optimal).toMatchObject({ matchedCount: 1, totalCost: 0 });
  expect(stub.calls).toHaveLength(1);
  expect(stub.calls[0].body).toMatchObject({ sources: [waypoint(driver)], targets: [waypoint(venue)] });
  const { rows } = await pool.query("SELECT evidence->'legs' AS legs FROM match_previews WHERE id=$1", [cold.body.previewId]);
  const legs = (rows[0].legs as Leg[]).filter(leg => leg.source === "provider");
  expect(legs).toHaveLength(2);
  expect(legs.map(leg => leg.seconds)).toEqual([1519.5, 1519.5]);
  expect(new Set(legs.map(leg => leg.observedAt)).size).toBe(1);
});

test("SC-04 / ISSUE-131: a pickup at the venue keeps the 181-credit baseline", async () => {
  const owner = await bootstrapWorkspace(pool);
  const starts = spots("baseline-driver", 20, 300);
  const pickups = spots("baseline-pickup", 16, 400);
  const admin = createPool(SETUP, 1);
  const telemetrySpy = vi.spyOn(telemetry, "recordPreview");
  vi.stubEnv("GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS", "0");
  try {
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
    const id = await createSyntheticTrip(pool, venue);
    const drivers = [];
    for (const [index, spot] of starts.slice(0, 13).entries()) {
      drivers.push(await addSyntheticDriver(pool, id, `Driver ${index + 1}`, spot, 1));
    }
    const temporary = await addSyntheticPassenger(pool, id, "Temporary pickup", pickups[0]);
    const version = async () => (await pool.query<{ version: number }>(
      "SELECT version FROM trips WHERE id=$1", [id],
    )).rows[0].version;
    const seats = async (driverId: string, seatCapacity: number) => {
      const result = await editDriver(pool, id, driverId, randomUUID(), { baseVersion: await version(), seatCapacity });
      expect(result.httpStatus).toBe(200);
    };
    const switchToFixture = async () => {
      process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
      await admin.query("UPDATE trips SET venue_location=venue_location || $2::jsonb WHERE id=$1",
        [id, { provider: "fixture" }]);
    };
    const route = async () => {
      await pinToWorkspace(id, owner.id);
      process.env.GROUPRIDE_ADDRESS_PROVIDER = "geoapify";
      const result = await publishPreview(pool, id);
      await switchToFixture();
      return result;
    };
    stub.respondWith((res, body) => {
      const response = matrix(body);
      for (const row of response.sources_to_targets) for (const cell of row) cell.time = 60;
      res.end(JSON.stringify(response));
    });
    await route();
    for (const driverId of drivers.slice(0, 7)) await seats(driverId, 0);
    const reselected = await addSyntheticPassenger(pool, id, "Reselected pickup", pickups[1]);
    await route();
    for (const driverId of drivers.slice(7)) await seats(driverId, 0);
    for (const [index, spot] of starts.slice(13, 19).entries()) {
      await addSyntheticDriver(pool, id, `Driver ${index + 14}`, spot, 1);
    }
    for (const [index, spot] of pickups.slice(2, 15).entries()) {
      await addSyntheticPassenger(pool, id, `Pickup ${index + 1}`, spot);
    }
    await route();
    expect((await editRequest(pool, id, temporary, randomUUID(), { baseVersion: await version(), active: false })).httpStatus).toBe(200);
    expect((await editRequest(pool, id, reselected, randomUUID(), {
      baseVersion: await version(),
      details: { name: "Reselected pickup", pickupSelectionToken: await mint(pool, "pickup", id, pickups[1]) },
    })).httpStatus).toBe(200);
    const atVenue = await addSyntheticPassenger(pool, id, "At the venue", venue);
    await addSyntheticPassenger(pool, id, "Another pickup", pickups[15]);
    const newestDriver = await addSyntheticDriver(pool, id, "Driver 20", starts[19], 1);
    for (const driverId of drivers) await seats(driverId, 1);

    await pinToWorkspace(id, owner.id);
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "geoapify";
    // Overlapping physical cells in P0 return different values. The pickup
    // and direct leg must both keep the first observation.
    stub.calls.length = 0;
    stub.respondWith((res, body) => {
      const response = matrix(body);
      for (const row of response.sources_to_targets) for (const cell of row) cell.time = body.targets.length === 1 ? 180 : 60;
      res.end(JSON.stringify(response));
    });
    const result = await publishPreview(pool, id);
    const shapes = stub.calls.map(({ body }) => [body.sources.length, body.targets.length]);
    expect([...shapes].sort(([a], [b]) => b - a)).toEqual([[14, 16], [6, 3], [3, 1]]);
    const credits = shapes.reduce((sum, [s, t]) => sum + Math.max(s, t) * Math.min(s, t, 10), 0);
    expect(credits).toBe(181);
    expect(telemetrySpy).toHaveBeenLastCalledWith(expect.objectContaining({
      matrix: { plan: "P0", requests: shapes, cells: 245, predictedBaseCredits: credits },
    }));
    const { evidence } = (await pool.query("SELECT evidence FROM match_previews WHERE id=$1", [result.body.previewId])).rows[0];
    const start = evidence.drivers.find((entry: { id: string }) => entry.id === newestDriver).location.id;
    const pickupId = evidence.passengers.find((entry: { id: string }) => entry.id === atVenue).location.id;
    const colocated = (evidence.legs as Leg[]).filter(leg => leg.from === start
      && (leg.to === pickupId || leg.to === evidence.venue.id));
    expect(colocated).toHaveLength(2);
    expect(colocated.map(leg => leg.seconds)).toEqual([60, 60]);
    expect(new Set(colocated.map(leg => leg.observedAt)).size).toBe(1);
    expect((await commitPreview(pool, id, randomUUID(), { previewId: result.body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, id)).toMatchObject({ totals: {
      matched: result.body.optimal.matchedCount, totalCost: result.body.optimal.totalCost,
    } });
  } finally {
    telemetrySpy.mockRestore();
    vi.unstubAllEnvs();
    await admin.end();
  }
});

test.each([false, true])("SC-04 / ISSUE-132: a coordinate handoff preserves the 182-credit baseline (intermediate: %s)", async overlap => {
  const owner = await bootstrapWorkspace(pool);
  const starts = spots("handoff-driver", 14, 540);
  const pickups = spots("handoff-pickup", 24, 560);
  const admin = createPool(SETUP, 1);
  const recording = vi.spyOn(telemetry, "recordPreview");
  const oldVenue = barrier();
  const middleFirst = barrier();
  let phase: "initial" | "old" | "middle" | "final" = "initial";
  let old: Promise<Response> | undefined;
  let middle: Promise<Response> | undefined;
  vi.stubEnv("GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS", "0");
  try {
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
    const id = await createSyntheticTrip(pool, venue);
    const drivers = [];
    for (const [index, spot] of starts.slice(0, 12).entries()) {
      drivers.push(await addSyntheticDriver(pool, id, `Driver ${index + 1}`, spot, 1));
    }
    for (const [index, spot] of pickups.slice(0, 12).entries()) {
      await addSyntheticPassenger(pool, id, `Pickup ${index + 1}`, spot);
    }
    const version = async () => (await pool.query<{ version: number }>(
      "SELECT version FROM trips WHERE id=$1", [id],
    )).rows[0].version;
    const seats = async (driverId: string, seatCapacity: number) => {
      expect((await editDriver(pool, id, driverId, randomUUID(), {
        baseVersion: await version(), seatCapacity,
      })).httpStatus).toBe(200);
    };
    const switchToFixture = async () => {
      process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
      await admin.query("UPDATE trips SET venue_location=venue_location || $2::jsonb WHERE id=$1",
        [id, { provider: "fixture" }]);
    };
    const startLive = async () => {
      await pinToWorkspace(id, owner.id);
      process.env.GROUPRIDE_ADDRESS_PROVIDER = "geoapify";
    };
    stub.respondWith((res, body) => {
      if (phase === "old" && body.targets.some(target => JSON.stringify(target) === JSON.stringify(waypoint(venue)))) {
        oldVenue.open();
        return;
      }
      if (phase === "middle") {
        middleFirst.open();
        return;
      }
      const response = matrix(body);
      for (const row of response.sources_to_targets) for (const cell of row) cell.time = 120;
      res.end(JSON.stringify(response));
    });
    await startLive();
    await publishPreview(pool, id);
    await switchToFixture();
    for (const driverId of drivers.slice(0, 6)) await seats(driverId, 0);
    const rider = await addSyntheticPassenger(pool, id, "Reselected pickup", pickups[12]);
    await startLive();
    phase = "old";
    const oldAt = stub.calls.length;
    old = runPreview(() => publishPreview(pool, id));
    await oldVenue.reached;
    expect(stub.calls.slice(oldAt).map(({ body }) => [body.sources.length, body.targets.length])).toEqual([[6, 1], [1, 1]]);
    await switchToFixture();
    expect((await editRequest(pool, id, rider, randomUUID(), {
      baseVersion: await version(),
      details: { name: "Reselected pickup", pickupSelectionToken: await mint(pool, "pickup", id, pickups[12]) },
    })).httpStatus).toBe(200);
    for (const driverId of drivers.slice(0, 6)) await seats(driverId, 1);
    for (const [index, spot] of starts.slice(12).entries()) {
      await addSyntheticDriver(pool, id, `Driver ${index + 13}`, spot, 1);
    }
    for (const [index, spot] of pickups.slice(13).entries()) {
      await addSyntheticPassenger(pool, id, `Pickup ${index + 14}`, spot);
    }
    await startLive();
    if (overlap) {
      phase = "middle";
      middle = runPreview(() => publishPreview(pool, id));
      await middleFirst.reached;
    }
    await seats(drivers[0], 2);
    phase = "final";
    const finalAt = stub.calls.length;
    const result = await publishPreview(pool, id);
    for (const superseded of [old, middle]) {
      if (superseded) {
        const response = await superseded;
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: { code: "STALE_VERSION" } });
      }
    }
    const shapes = stub.calls.slice(finalAt).map(({ body }) => [body.sources.length, body.targets.length]);
    const credits = shapes.reduce((sum, [s, t]) => sum + Math.max(s, t) * Math.min(s, t, 10), 0);
    expect(credits).toBe(182);
    expect([...shapes].sort(([a], [b]) => b - a)).toEqual([[14, 1], [12, 12], [2, 24]]);
    expect(recording).toHaveBeenLastCalledWith(expect.objectContaining({
      matrix: { plan: "P0", requests: shapes, cells: 206, predictedBaseCredits: 182 },
    }));
    expect(result.body.optimal).toMatchObject({ matchedCount: 15, totalCost: 1800 });
    expect(result.body.estimate?.legs.reused).toBe(174); // 168 published legs and six coordinate copies
    expect((await commitPreview(pool, id, randomUUID(), { previewId: result.body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, id)).toMatchObject({ totals: { matched: 15, totalCost: 1800 } });
  } finally {
    await admin.end();
    await Promise.allSettled([old, middle]);
    recording.mockRestore();
    vi.unstubAllEnvs();
  }
});

test("ISSUE-125: an in-flight preview hands off completed estimates to a co-located rider", async () => {
  const computed = barrier();
  const release = barrier();
  let first = true;
  const restore = __setPublishBarrier(async () => {
    if (!first) return;
    first = false;
    computed.open();
    await release.reached;
  });
  const observe = vi.spyOn(permits, "observeVersion");
  const old = preview();
  let next: Promise<Response> | undefined;
  try {
    await computed.reached;
    const admin = createPool(SETUP, 1);
    try {
      await admin.query("UPDATE trips SET venue_location=venue_location || '{\"provider\":\"fixture\"}'::jsonb WHERE id=$1", [tripId]);
      process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
      await addSyntheticPassenger(pool, tripId, "Co-located rider", pickup);
      await pinToWorkspace(tripId, (await bootstrapWorkspace(pool)).id);
    } finally {
      process.env.GROUPRIDE_ADDRESS_PROVIDER = "geoapify";
      await admin.end();
    }
    const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
    next = preview();
    await expect.poll(() => observe.mock.calls.some(([id, observed]) => id === tripId && observed === version)).toBe(true);
    release.open();
    expect((await old).status).toBe(409);
    const response = await next;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ optimal: { matchedCount: 1, totalCost: 231 }, estimate: { legs: { fetched: 0, reused: 5 } } });
    expect(stub.calls).toHaveLength(2);
  } finally {
    release.open();
    restore();
    observe.mockRestore();
    await Promise.allSettled([old, next]);
  }
});

test.each([false, true])("ISSUE-126: final cells publish with 240 ms left (store locked: %s)", async locked => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const final = barrier();
  let reply: (() => void) | undefined;
  stub.respondWith((res, body) => {
    if (stub.calls.length === 1) res.end(JSON.stringify(matrix(body)));
    else {
      reply = () => res.end(JSON.stringify(matrix(body)));
      final.open();
    }
  });
  const admin = createPool(SETUP, 1);
  const locker = await admin.connect();
  // Advance the request's monotonic clock only after the provider reaches the
  // final response. Real SQL runs under the remaining statement time budget.
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  resetAddressCounters();
  const outcome = runPreview(() => publishPreview(pool, tripId, new PreviewDeadline(), owner.secret));
  try {
    await final.reached;
    if (locked) {
      await locker.query("BEGIN");
      await locker.query("LOCK travel_times IN SHARE MODE");
    }
    clock.mockReturnValue(10_760);
    reply!();
    reply = undefined;
    const response = await outcome;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ optimal: { matchedCount: 1, totalCost: 231 } });
    expect(stub.calls).toHaveLength(2);
    expect(addressCounters.travelTimeWriteFailed).toBe(0);
    expect((await pool.query("SELECT 1 FROM travel_times WHERE workspace_id=$1", [owner.id])).rowCount).toBe(0);
  } finally {
    clock.mockRestore();
    reply?.();
    if (locked) await locker.query("ROLLBACK");
    locker.release();
    await admin.end();
    await outcome;
  }
});

test.each(["without-cookie", "partial-store", "covered-store"] as const)(
  "ISSUE-128: a settled no-route takes precedence over finite workspace estimates (%s)",
  async mode => {
    const owner = await bootstrapWorkspace(pool);
    await pinToWorkspace(tripId, owner.id);
    const warm = await sameCoordinatesTrip(owner.id);
    expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
    if (mode === "partial-store") {
      const admin = createPool(SETUP, 1);
      try { await admin.query("DELETE FROM travel_times WHERE workspace_id=$1 AND seconds=519.5", [owner.id]); }
      finally { await admin.end(); }
    }
    stub.respondWith((res, body) => {
      const result = matrix(body);
      if (stub.calls.length === 3) result.sources_to_targets[0][0].time = null;
      res.end(JSON.stringify(result));
    });
    const computed = barrier();
    const release = barrier();
    const restore = __setPublishBarrier(async () => {
      computed.open();
      await release.reached;
    });
    const observe = vi.spyOn(permits, "observeVersion");
    const old = preview();
    let next: Promise<Awaited<ReturnType<typeof publishPreview>>> | undefined;
    try {
      await computed.reached;
      const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
      expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version, seatCapacity: 2 })).httpStatus).toBe(200);
      next = publishPreview(pool, tripId, undefined, mode === "without-cookie" ? undefined : owner.secret);
      // Attach rejection handling before waiting for the successor's handoff.
      void next.catch(() => {});
      await expect.poll(() => observe.mock.calls.some(([id, observed]) => id === tripId && observed === version + 1)).toBe(true);
      release.open();
      expect((await old).status).toBe(409);
      const { body } = await next;
      expect(body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
      expect(body.estimate?.legs).toMatchObject({ fetched: 0, reused: 3 });
      expect((await commitPreview(pool, tripId, randomUUID(), { previewId: body.previewId })).httpStatus).toBe(200);
      expect(await getTripSnapshot(pool, tripId)).toMatchObject({ status: "assigned", totals: { matched: 0, totalCost: 0 } });
      expect(stub.calls).toHaveLength(4);
    } finally {
      release.open();
      restore();
      observe.mockRestore();
      await Promise.allSettled([old, next]);
    }
  },
);

test("ISSUE-126: a locked store neither delays the second dispatch nor prevents publication", async () => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  resetAddressCounters();
  const second = barrier();
  let finishSecond: (() => void) | undefined;
  stub.respondWith((res, body) => {
    if (stub.calls.length === 1) res.end(JSON.stringify(matrix(body)));
    else {
      finishSecond = () => res.end(JSON.stringify(matrix(body)));
      second.open();
    }
  });
  const admin = createPool(SETUP, 1);
  const locker = await admin.connect();
  let outcome: Promise<Response> | undefined;
  try {
    await locker.query("BEGIN");
    await locker.query("LOCK travel_times IN SHARE MODE");
    outcome = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
    await second.reached;
    // If the first batch awaited a write, it could only reach the second
    // dispatch after that write timed out on the still-held SHARE lock.
    expect(addressCounters.travelTimeWriteFailed).toBe(0);
    finishSecond!();
    finishSecond = undefined;
    const response = await outcome;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ optimal: { matchedCount: 1, totalCost: 231 } });
    expect(addressCounters.travelTimeWriteFailed).toBe(1);
    expect((await locker.query("SELECT 1 FROM match_previews WHERE trip_id=$1", [tripId])).rowCount).toBe(1);
    expect((await locker.query("SELECT 1 FROM travel_times WHERE workspace_id=$1", [owner.id])).rowCount).toBe(0);
    expect(stub.calls).toHaveLength(2);
  } finally {
    finishSecond?.();
    await locker.query("ROLLBACK");
    locker.release();
    await admin.end();
    await outcome;
  }
});

test.each(["owner ready first", "routing released first", "routing publication fails"] as const)(
  "ISSUE-128: same-version peers preserve a confirmed no-route (%s)",
  async order => {
    const owner = await bootstrapWorkspace(pool);
    await pinToWorkspace(tripId, owner.id);
    const warm = await sameCoordinatesTrip(owner.id);
    expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
    stub.respondWith((res, body) => {
      const reply = matrix(body);
      if (stub.calls.length === 3) reply.sources_to_targets[0][0].time = null;
      res.end(JSON.stringify(reply));
    });
    const routingComputed = barrier();
    const releaseRouting = barrier();
    const releaseOwner = barrier();
    const ownerAdmitted = barrier();
    const ownerComputed = barrier();
    let computations = 0;
    const restore = __setPublishBarrier(async () => {
      if (++computations === 1) {
        routingComputed.open();
        await releaseRouting.reached;
        if (order === "routing publication fails") throw new Error("Injected failure after routing settled.");
      } else {
        ownerComputed.open();
        await releaseOwner.reached;
      }
    });
    const retain = permits.retainForPublication;
    const admission = vi.spyOn(permits, "retainForPublication").mockImplementation((...args) => {
      const covered = retain(...args);
      if (covered.routing) ownerAdmitted.open();
      return covered;
    });
    const routing = preview();
    let covered: Promise<Response> | undefined;
    try {
      await routingComputed.reached;
      if (order === "owner ready first") releaseOwner.open();
      covered = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
      // The old race reaches the second computation rather than joining the
      // first request. Resolve either event so the regression fails promptly.
      const waiting = await Promise.race([
        ownerAdmitted.reached.then(() => true), ownerComputed.reached.then(() => false),
      ]);
      expect(waiting).toBe(true);
      expect((await pool.query("SELECT 1 FROM match_previews WHERE trip_id=$1", [tripId])).rowCount).toBe(0);
      releaseRouting.open();
      const first = await routing;
      expect(first.status).toBe(order === "routing publication fails" ? 500 : 200);
      releaseOwner.open();
      const second = await covered;
      expect(second.status).toBe(200);
      const body = await second.json();
      expect(body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
      if (first.ok) expect(await first.json()).toEqual(body);
      expect(computations).toBe(first.ok ? 1 : 2);
      expect((await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [tripId])).rows)
        .toEqual([{ id: body.previewId }]);
      expect((await commitPreview(pool, tripId, randomUUID(), { previewId: body.previewId })).httpStatus).toBe(200);
      expect(await getTripSnapshot(pool, tripId)).toMatchObject({ status: "assigned", totals: { matched: 0, totalCost: 0 } });
      expect(stub.calls).toHaveLength(4);
    } finally {
      releaseRouting.open();
      releaseOwner.open();
      await Promise.allSettled([routing, covered]);
      admission.mockRestore();
      restore();
    }
  },
);

test("ISSUE-128: routing waits when a same-version workspace-covered caller is already publishing", async () => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const warm = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
  const ready = barrier();
  const release = barrier();
  const attemptingAdmission = barrier();
  let computations = 0;
  const restore = __setPublishBarrier(async () => {
    computations++;
    ready.open();
    await release.reached;
  });
  const acquire = permits.acquireRouting;
  const admission = vi.spyOn(permits, "acquireRouting").mockImplementation((...args) => {
    const result = acquire(...args);
    attemptingAdmission.open();
    return result;
  });
  const covered = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
  let routing: Promise<Response> | undefined;
  try {
    await ready.reached;
    routing = preview();
    await attemptingAdmission.reached;
    release.open();
    const [first, second] = await Promise.all([covered, routing]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const body = await first.json();
    expect(await second.json()).toEqual(body);
    expect(body.optimal).toMatchObject({ matchedCount: 1, totalCost: 231 });
    expect(computations).toBe(1);
    expect(stub.calls).toHaveLength(2);
    expect((await commitPreview(pool, tripId, randomUUID(), { previewId: body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, tripId)).toMatchObject({ status: "assigned", totals: { matched: 1, totalCost: 231 } });
  } finally {
    release.open();
    await Promise.allSettled([covered, routing]);
    admission.mockRestore();
    restore();
  }
});

test.each([false, true])("ISSUE-128: a failed holder's no-route survives a blocked workspace lookup (fail first: %s)", async failFirst => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const warm = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
  const secondCall = barrier();
  const fail = barrier();
  stub.respondWith((res, body) => {
    if (stub.calls.length === 3) {
      const response = matrix(body);
      response.sources_to_targets[0][0].time = null;
      res.end(JSON.stringify(response));
    } else {
      secondCall.open();
      void fail.reached.then(() => res.writeHead(503).end());
    }
  });
  const joined = barrier();
  const retain = permits.retainForPublication;
  const admission = vi.spyOn(permits, "retainForPublication").mockImplementation((...args) => {
    const handle = retain(...args);
    joined.open();
    return handle;
  });
  const admin = createPool(SETUP, 2);
  const locker = await admin.connect();
  const routing = preview();
  let covered: Promise<Response> | undefined;
  try {
    await secondCall.reached;
    await locker.query("BEGIN");
    await locker.query("LOCK travel_times IN ACCESS EXCLUSIVE MODE");
    covered = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
    await expect.poll(async () => (await admin.query(
      `SELECT 1 FROM pg_locks
       WHERE relation = 'travel_times'::regclass AND mode = 'AccessShareLock' AND NOT granted`,
    )).rowCount, { interval: 10, timeout: 1200 }).toBe(1);
    if (failFirst) {
      fail.open();
      expect((await routing).status).toBe(503);
    }
    await locker.query("ROLLBACK");
    await joined.reached;
    fail.open();
    expect((await routing).status).toBe(503);
    const result = await covered;
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
    expect((await commitPreview(pool, tripId, randomUUID(), { previewId: body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, tripId)).toMatchObject({ totals: { matched: 0, totalCost: 0 } });
    expect(stub.calls).toHaveLength(4);
  } finally {
    fail.open();
    await locker.query("ROLLBACK");
    locker.release();
    await admin.end();
    await Promise.allSettled([routing, covered]);
    admission.mockRestore();
  }
});

test.each([false, true])("ISSUE-130: the first commit wakes both routing waiters (covered peer still paused: %s)", async pausePeer => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const warm = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
  const firstComputed = barrier();
  const peerComputed = barrier();
  const releaseFirst = barrier();
  const releasePeer = barrier();
  const waiting = barrier();
  let computations = 0;
  let admissions = 0;
  const restore = __setPublishBarrier(async () => {
    if (++computations === 1) {
      firstComputed.open();
      await releaseFirst.reached;
    } else {
      peerComputed.open();
      await releasePeer.reached;
    }
  });
  const acquire = permits.acquireRouting;
  const admission = vi.spyOn(permits, "acquireRouting").mockImplementation((...args) => {
    const result = acquire(...args);
    if (++admissions === 2) waiting.open();
    return result;
  });
  const requests = [runPreview(() => publishPreview(pool, tripId, undefined, owner.secret))];
  try {
    await firstComputed.reached;
    requests.push(
      runPreview(() => publishPreview(pool, tripId, new PreviewDeadline(2500))),
      runPreview(() => publishPreview(pool, tripId, new PreviewDeadline(2500))),
    );
    await waiting.reached;
    if (pausePeer) {
      requests.push(runPreview(() => publishPreview(pool, tripId, undefined, owner.secret)));
      await peerComputed.reached;
    }
    releaseFirst.open();
    const published = await Promise.all(requests.slice(0, 3));
    expect(published.map(res => res.status)).toEqual([200, 200, 200]);
    const body = await published[0].json();
    expect(await published[1].json()).toEqual(body);
    expect(await published[2].json()).toEqual(body);
    expect((await pool.query("SELECT id FROM match_previews WHERE trip_id=$1", [tripId])).rows)
      .toEqual([{ id: body.previewId }]);
    releasePeer.open();
    if (pausePeer) expect(await (await requests[3]).json()).toEqual(body);
    expect((await commitPreview(pool, tripId, randomUUID(), { previewId: body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, tripId)).toMatchObject({ totals: { matched: 1, totalCost: 231 } });
    expect(stub.calls).toHaveLength(2);
  } finally {
    releaseFirst.open();
    releasePeer.open();
    await Promise.allSettled(requests);
    admission.mockRestore();
    restore();
  }
});

test("ISSUE-130: a committed newer preview wakes a waiter before the superseded holder exits", async () => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const warm = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
  stub.respondWith((res, body) => {
    const result = matrix(body);
    if (stub.calls.length === 3) result.sources_to_targets[0][0].time = null;
    res.end(JSON.stringify(result));
  });
  const oldComputed = barrier();
  const releaseOld = barrier();
  const waiting = barrier();
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  let first = true;
  const restore = __setPublishBarrier(async () => {
    if (!first) return;
    first = false;
    oldComputed.open();
    await releaseOld.reached;
  });
  const acquire = permits.acquireRouting;
  const admission = vi.spyOn(permits, "acquireRouting").mockImplementation((...args) => {
    const result = acquire(...args);
    if (args[1] === version + 1) waiting.open();
    return result;
  });
  const old = preview();
  let waiter: Promise<Response> | undefined;
  try {
    await oldComputed.reached;
    expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version, seatCapacity: 2 })).httpStatus).toBe(200);
    waiter = runPreview(() => publishPreview(pool, tripId, new PreviewDeadline(2500)));
    await waiting.reached;
    const covered = await publishPreview(pool, tripId, undefined, owner.secret);
    const result = await waiter;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(covered.body);
    expect(covered.body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
    releaseOld.open();
    expect((await old).status).toBe(409);
    expect((await commitPreview(pool, tripId, randomUUID(), { previewId: covered.body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, tripId)).toMatchObject({ totals: { matched: 0, totalCost: 0 } });
    expect(stub.calls).toHaveLength(4);
  } finally {
    releaseOld.open();
    await Promise.allSettled([old, waiter]);
    admission.mockRestore();
    restore();
  }
});

test.each([
  ["superseded routing", false], ["superseded routing", true],
  ["covered publisher", false], ["covered publisher", true],
] as const)("ISSUE-128: blocked lookup retains observations from %s (exit first: %s)", async (source, exitFirst) => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const warm = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
  stub.respondWith((res, body) => {
    const result = matrix(body);
    if (stub.calls.length === 3) result.sources_to_targets[0][0].time = null;
    res.end(JSON.stringify(result));
  });
  const oldReady = barrier();
  const releaseOld = barrier();
  const peerReady = barrier();
  const releasePeer = barrier();
  const targetReady = barrier();
  const releaseTarget = barrier();
  let computations = 0;
  const restore = __setPublishBarrier(async () => {
    const computation = ++computations;
    if (computation === 1) {
      oldReady.open();
      await releaseOld.reached;
    } else if (computation === 2 && source === "covered publisher") {
      peerReady.open();
      await releasePeer.reached;
      throw new Error("Injected covered publication failure.");
    } else {
      targetReady.open();
      await releaseTarget.reached;
    }
  });
  const admin = createPool(SETUP, 2);
  const locker = await admin.connect();
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  const old = preview();
  let peer: Promise<Response> | undefined;
  let target: Promise<Response> | undefined;
  let locked = false;
  try {
    await oldReady.reached;
    expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version, seatCapacity: 2 })).httpStatus).toBe(200);
    if (source === "covered publisher") {
      peer = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
      await peerReady.reached;
      releaseOld.open();
      expect((await old).status).toBe(409);
    }
    await locker.query("BEGIN");
    locked = true;
    await locker.query("LOCK travel_times IN ACCESS EXCLUSIVE MODE");
    target = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
    await expect.poll(async () => (await admin.query(
      `SELECT 1 FROM pg_locks
       WHERE relation = 'travel_times'::regclass AND mode = 'AccessShareLock' AND NOT granted`,
    )).rowCount, { interval: 10, timeout: 1200 }).toBe(1);
    const releaseSource = peer ? releasePeer : releaseOld;
    if (exitFirst) {
      releaseSource.open();
      expect((await (peer ?? old)).status).toBe(peer ? 500 : 409);
    }
    await locker.query("ROLLBACK");
    locked = false;
    await targetReady.reached;
    releaseSource.open();
    expect((await (peer ?? old)).status).toBe(peer ? 500 : 409);
    releaseTarget.open();
    const result = await target;
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
    expect((await commitPreview(pool, tripId, randomUUID(), { previewId: body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, tripId)).toMatchObject({ totals: { matched: 0, totalCost: 0 } });
    expect(stub.calls).toHaveLength(4);
  } finally {
    releaseOld.open();
    releasePeer.open();
    releaseTarget.open();
    if (locked) await locker.query("ROLLBACK");
    locker.release();
    await admin.end();
    await Promise.allSettled([old, peer, target]);
    restore();
  }
});

test.each([false, true])("ISSUE-130: covered waiter reads a committed preview (verification before wait: %s)", async verifyFirst => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const warm = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
  stub.respondWith((res, body) => {
    const result = matrix(body);
    if (stub.calls.length === 3) result.sources_to_targets[0][0].time = null;
    res.end(JSON.stringify(result));
  });
  const computed = barrier();
  const publish = barrier();
  const committed = barrier();
  const acknowledge = barrier();
  const joined = barrier();
  const lookupReady = barrier();
  const releaseLookup = barrier();
  const read = travelTimes.readTravelTimes;
  const lookup = vi.spyOn(travelTimes, "readTravelTimes").mockImplementation(async (...args) => {
    await read(...args);
    lookupReady.open();
    if (verifyFirst) await releaseLookup.reached;
  });
  const restorePublish = __setPublishBarrier(async () => {
    computed.open();
    await publish.reached;
  });
  const retain = permits.retainForPublication;
  const admission = vi.spyOn(permits, "retainForPublication").mockImplementation((...args) => {
    const handle = retain(...args);
    if (handle.routing) joined.open();
    return handle;
  });
  const restoreCommit = __setTransactionCommitFaultHook(async client => {
    if ((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only !== "off") return;
    const real = client.query.bind(client);
    // Withhold the acknowledgement only after PostgreSQL has committed the row.
    client.query = (async (sql: string, values?: unknown[]) => {
      const result = await real(sql, values);
      if (sql === "COMMIT") {
        committed.open();
        await acknowledge.reached;
      }
      return result;
    }) as typeof client.query;
  });
  const routing = preview();
  let covered: Promise<Response> | undefined;
  try {
    await computed.reached;
    covered = runPreview(() => publishPreview(pool, tripId, new PreviewDeadline(2500), owner.secret));
    await lookupReady.reached;
    if (!verifyFirst) await joined.reached;
    publish.open();
    await committed.reached;
    const fresh = await preview();
    expect(fresh.status).toBe(200);
    const body = await fresh.json();
    releaseLookup.open();
    const waiting = await covered;
    expect(waiting.status).toBe(200);
    expect(await waiting.json()).toEqual(body);
    expect(body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
    acknowledge.open();
    expect(await (await routing).json()).toEqual(body);
    restoreCommit();
    expect((await commitPreview(pool, tripId, randomUUID(), { previewId: body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, tripId)).toMatchObject({ totals: { matched: 0, totalCost: 0 } });
    expect(stub.calls).toHaveLength(4);
  } finally {
    publish.open();
    acknowledge.open();
    releaseLookup.open();
    restoreCommit();
    await Promise.allSettled([routing, covered]);
    admission.mockRestore();
    lookup.mockRestore();
    restorePublish();
  }
});

test.each([false, true])("ISSUE-128: a third roster inherits the no-route from an overlapping lookup (middle publishing: %s)", async middlePublishing => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const warm = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);
  stub.respondWith((res, body) => {
    const result = matrix(body);
    if (stub.calls.length === 3) result.sources_to_targets[0][0].time = null;
    res.end(JSON.stringify(result));
  });
  const routed = barrier();
  const releaseRouting = barrier();
  const lookupReady = barrier();
  const releaseLookup = barrier();
  const middleComputed = barrier();
  const releaseMiddle = barrier();
  let computations = 0;
  const restore = __setPublishBarrier(async () => {
    if (++computations === 1) {
      routed.open();
      await releaseRouting.reached;
    } else if (computations === 2 && middlePublishing) {
      middleComputed.open();
      await releaseMiddle.reached;
    }
  });
  const read = travelTimes.readTravelTimes;
  const lookup = vi.spyOn(travelTimes, "readTravelTimes").mockImplementationOnce(async (...args) => {
    await read(...args);
    lookupReady.open();
    await releaseLookup.reached;
  });
  const { version } = (await pool.query("SELECT version FROM trips WHERE id=$1", [tripId])).rows[0];
  const old = preview();
  let middle: Promise<Response> | undefined;
  try {
    await routed.reached;
    expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version, seatCapacity: 2 })).httpStatus).toBe(200);
    middle = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
    await lookupReady.reached;
    releaseRouting.open();
    expect((await old).status).toBe(409);
    if (middlePublishing) {
      releaseLookup.open();
      await middleComputed.reached;
    }
    expect((await editDriver(pool, tripId, firstDriver, randomUUID(), { baseVersion: version + 1, seatCapacity: 3 })).httpStatus).toBe(200);
    const newest = await publishPreview(pool, tripId, undefined, owner.secret);
    expect(newest.body.baseVersion).toBe(version + 2);
    expect(newest.body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
    expect(newest.body.estimate?.legs.fetched).toBe(0);
    expect((await commitPreview(pool, tripId, randomUUID(), { previewId: newest.body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, tripId)).toMatchObject({ totals: { matched: 0, totalCost: 0 } });
    expect(stub.calls).toHaveLength(4);
    releaseLookup.open();
    releaseMiddle.open();
    expect((await middle).status).toBe(409);
  } finally {
    releaseRouting.open();
    releaseLookup.open();
    releaseMiddle.open();
    await Promise.allSettled([old, middle]);
    lookup.mockRestore();
    restore();
  }
});

test.each([false, true])("ISSUE-130: a second cached caller reuses the durable winner (trip row locked: %s)", async locked => {
  const owner = await bootstrapWorkspace(pool);
  await pinToWorkspace(tripId, owner.id);
  const warm = await sameCoordinatesTrip(owner.id);
  expect((await publishPreview(pool, warm, undefined, owner.secret)).body.optimal.totalCost).toBe(231);

  const firstComputed = barrier();
  const publishFirst = barrier();
  let computations = 0;
  const restore = __setPublishBarrier(async () => {
    if (++computations !== 1) return;
    firstComputed.open();
    await publishFirst.reached;
  });
  const lookupReady = barrier();
  const releaseLookup = barrier();
  const read = travelTimes.readTravelTimes;
  let reads = 0;
  const lookup = vi.spyOn(travelTimes, "readTravelTimes").mockImplementation(async (...args) => {
    await read(...args);
    if (++reads !== 2) return;
    lookupReady.open();
    await releaseLookup.reached;
  });
  const admin = createPool(SETUP, 1);
  const locker = await admin.connect();
  const first = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
  let second: Promise<Response> | undefined;
  try {
    await firstComputed.reached;
    second = runPreview(() => publishPreview(pool, tripId, undefined, owner.secret));
    await lookupReady.reached;
    publishFirst.open();
    const winner = await first;
    expect(winner.status).toBe(200);
    const body = await winner.json();
    if (locked) {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [tripId]);
    }
    // A fresh request can see the committed winner even with the row held.
    expect(await (await preview()).json()).toEqual(body);
    releaseLookup.open();
    const reused = await second;
    expect(reused.status).toBe(200);
    expect(await reused.json()).toEqual(body);
    expect(computations).toBe(1);
    expect(stub.calls).toHaveLength(2); // only the separate trip that seeded the store
    if (locked) await locker.query("ROLLBACK");
    expect((await commitPreview(pool, tripId, randomUUID(), { previewId: body.previewId })).httpStatus).toBe(200);
    expect(await getTripSnapshot(pool, tripId)).toMatchObject({ totals: { matched: 1, totalCost: 231 } });
  } finally {
    publishFirst.open();
    releaseLookup.open();
    if (locked) await locker.query("ROLLBACK");
    locker.release();
    await admin.end();
    await Promise.allSettled([first, second]);
    lookup.mockRestore();
    restore();
  }
});
