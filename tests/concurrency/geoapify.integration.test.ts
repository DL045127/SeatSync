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
import { legKey, type Leg } from "../../src/matching/address.ts";
import { editDriver } from "../../src/trips/service.ts";
import { runPreview } from "../../src/app/api/http.ts";
import { createPool } from "../../src/db/pool.ts";
import { geoapifyRoutingAdapter, GeoapifyRateLimit } from "../../src/routing/geoapify.ts";
import { __setRoutingAdapterForTests, routingPolicyFor } from "../../src/routing/index.ts";
import { __setPublishBarrier, publishPreview } from "../../src/trips/preview.ts";
import {
  APP, SETUP, addSyntheticDriver, addSyntheticPassenger, createSyntheticTrip,
  resetTestDatabase, spots, useFixtureEnvironment, type FixtureEnv,
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
  const old = await permits.acquireRouting(tripId, prior.baseVersion, routingPolicyFor("geoapify"), new PreviewDeadline());
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
    const result = await newer;
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
