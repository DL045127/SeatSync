// L-03 (stateless search) and L-04 (token outcomes) against real PostgreSQL:
// zero suggestion writes, the outcome matrix with durable receipts and row
// counts, replay after expiry/restart/master replacement, retryable key
// unavailability, reuse and lifetime caps, and HTTP-level 400/403 with no receipt.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Pool } from "pg";
import { TransientFailure } from "../../src/contracts/errors.ts";
import { createPool } from "../../src/db/pool.ts";
import { __clearMasterCacheForTests, loadMaster } from "../../src/locations/master-key.ts";
import { __setSelectionDeps, searchLocations } from "../../src/locations/selection-service.ts";
import { TOKEN_LIFETIME_MS, assembleToken, keyIdentifier, signSegments } from "../../src/locations/selection-token.ts";
import { addDriver, addRequest, createTrip, editDriver, getTripSnapshot, withdrawRequest } from "../../src/trips/service.ts";
import {
  APP,
  SETUP,
  createAddressTrip,
  key,
  registerDriver,
  resetTestDatabase,
  tokenFor,
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

const count = async (table: string, where = "true") =>
  Number((await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE ${where}`)).rows[0].n);
const receipts = () => count("mutation_receipts");

// ---- L-03 -----------------------------------------------------------------

describe("L-03 search is stateless and writes nothing", () => {
  test("every statement is a non-mutating READ ONLY statement and no row changes", async () => {
    const statements: string[] = [];
    const realConnect = pool.connect.bind(pool);
    // Record the SQL of every client this pool hands out.
    (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => {
      const client = (await realConnect()) as { query: (...a: unknown[]) => Promise<unknown> };
      const query = client.query.bind(client);
      client.query = (...args: unknown[]) => {
        if (typeof args[0] === "string") statements.push(args[0]);
        return query(...args);
      };
      return client;
    };
    const tablesBefore = await Promise.all(["trips", "drivers", "ride_requests", "match_previews", "mutation_receipts", "assignments", "dataset_generation"].map((t) => count(t)));
    await searchLocations(pool, { query: "alpha", purpose: "venue" });
    await searchLocations(pool, { query: "alpha", purpose: "venue" });
    const tablesAfter = await Promise.all(["trips", "drivers", "ride_requests", "match_previews", "mutation_receipts", "assignments", "dataset_generation"].map((t) => count(t)));
    expect(tablesAfter).toEqual(tablesBefore);
    expect(statements.some((s) => /^\s*BEGIN/i.test(s) && /READ ONLY/i.test(s))).toBe(true);
    for (const sql of statements) {
      expect(sql, sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i);
    }
  });

  test("selectable suggestions carry a signed token and unusable precisions do not", async () => {
    const { body } = await searchLocations(pool, { query: "alpha", purpose: "venue" });
    expect(body.provider).toBe("fixture");
    expect(body.suggestions.map((s) => [s.selectable, s.precision])).toEqual([
      [false, "street"], [true, "building"], [true, "entrance"],
    ]);
    for (const s of body.suggestions) expect(Boolean(s.token)).toBe(s.selectable);
    const tokens = body.suggestions.flatMap((s) => (s.token ? [s.token] : []));
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  test("no match is an empty list, results are capped at five, short or odd queries are 400-class", async () => {
    expect((await searchLocations(pool, { query: "zzzz nothing", purpose: "venue" })).body.suggestions).toEqual([]);
    expect((await searchLocations(pool, { query: "fixture", purpose: "venue" })).body.suggestions.length).toBe(5);
    for (const raw of [
      { query: "a", purpose: "venue" },
      { query: "x".repeat(101), purpose: "venue" },
      { query: "ok\u0000bad", purpose: "venue" },
      { query: "alpha", purpose: "venue", tripId: key() },
      { query: "alpha", purpose: "pickup" },
      { query: "alpha", purpose: "nowhere" },
      { query: "alpha", purpose: "venue", extra: 1 },
    ]) {
      await expect(searchLocations(pool, raw)).rejects.toBeTruthy();
    }
  });

  test("a trip-scoped search needs an existing address trip and ranks the venue's neighbours first", async () => {
    await expect(searchLocations(pool, { query: "pickup", purpose: "pickup", tripId: key() })).rejects.toMatchObject({ httpStatus: 404 });
    const zone = await createTrip(pool, key(), { name: "Z", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+00:00" });
    await expect(searchLocations(pool, { query: "pickup", purpose: "pickup", tripId: (zone.body as { id: string }).id }))
      .rejects.toMatchObject({ httpStatus: 422, code: "LOCATION_MODE_MISMATCH" });
    const tripId = await createAddressTrip(pool);
    const found = await searchLocations(pool, { query: "pickup", purpose: "pickup", tripId });
    expect(found.body.suggestions).toHaveLength(5);
  });

  test("a disabled provider is a retryable 503, not an empty result", async () => {
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    await expect(searchLocations(pool, { query: "alpha", purpose: "venue" }))
      .rejects.toMatchObject({ code: "ADDRESS_PROVIDER_UNAVAILABLE" });
  });
});

// ---- L-04: token outcomes -----------------------------------------------------

async function tripWithDriverToken() {
  const tripId = await createAddressTrip(pool);
  const token = await tokenFor(pool, "Driver Start Delta", "driver_start", tripId);
  const driverBody = (startSelectionToken: string) => ({ name: "Dana", startSelectionToken, seatCapacity: 1, maxDetourMinutes: 15 });
  return { tripId, token, driverBody };
}

describe("L-04 outcome matrix: terminal 422 with one receipt, no business write, identical replay", () => {
  async function master() {
    return (await loadMaster({ mode: "fixture", target: "test", rootDir: env.dir })).master;
  }
  const generation = async () => (await admin.query<{ generation: string }>("SELECT generation FROM dataset_generation")).rows[0].generation;

  test("bad tokens: oversize, framing, short tag, wrong MAC, validly signed non-JSON and bad contents", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const [h, p, t] = token.split(".");
    const m = await master();
    const context = { master: m, generation: await generation() };
    const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    const bad: Array<[string, string]> = [
      ["oversize", "A".repeat(5000)],
      ["not three segments", "not-a-token"],
      ["padded segment", `${h}=.${p}.${t}`],
      ["short tag", `${h}.${p}.${t.slice(0, 10)}`],
      ["wrong MAC", `${h}.${p}.${Buffer.alloc(32, 9).toString("base64url")}`],
      ["valid MAC, header not JSON", signSegments(context, encode("{nope"), p)],
      ["valid MAC, payload not JSON", signSegments(context, h, encode("also not json"))],
      ["valid MAC, unsupported version", assembleToken(context, { v: 9, kid: keyIdentifier(m), gen: context.generation }, payload)],
      ["valid MAC, unknown payload field", assembleToken(context, { v: 1, kid: keyIdentifier(m), gen: context.generation }, { ...payload, extra: 1 })],
      ["valid MAC, wrong purpose", assembleToken(context, { v: 1, kid: keyIdentifier(m), gen: context.generation }, { ...payload, purpose: "pickup" })],
    ];
    for (const [name, badToken] of bad) {
      const before = { drivers: await count("drivers"), receipts: await receipts() };
      const k = key();
      const first = await addDriver(pool, tripId, k, driverBody(badToken));
      expect(first.httpStatus, name).toBe(422);
      expect((first.body as { error: { code: string } }).error.code, name).toBe("LOCATION_SELECTION_INVALID");
      expect((first.body as { operation: { outcome: string } }).operation.outcome, name).toBe("not_applied");
      expect(await count("drivers"), name).toBe(before.drivers);
      expect(await receipts(), name).toBe(before.receipts + 1);
      // An identical retry replays the failure with no business write and no second receipt.
      const retry = await addDriver(pool, tripId, k, driverBody(badToken));
      expect(retry.replayed, name).toBe(true);
      expect(retry.body, name).toEqual(first.body);
      expect(await receipts(), name).toBe(before.receipts + 1);
    }
  });

  test("scope: another trip's token, another purpose, a zone trip, and the wrong form for the mode", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const otherTrip = await createAddressTrip(pool);
    const otherToken = await tokenFor(pool, "Driver Start Delta", "driver_start", otherTrip);
    const pickupToken = await tokenFor(pool, "Pickup Alpha", "pickup", tripId);
    const venueToken = await tokenFor(pool, "Event Hall", "venue");
    const expectInvalid = async (name: string, op: Promise<{ httpStatus: number; body: unknown }>, code = "LOCATION_SELECTION_INVALID") => {
      const res = await op;
      expect(res.httpStatus, name).toBe(422);
      expect((res.body as { error: { code: string } }).error.code, name).toBe(code);
      // The rejection reveals nothing about the other trip.
      expect(JSON.stringify(res.body), name).not.toContain(otherTrip);
    };
    await expectInvalid("token minted for another trip", addDriver(pool, tripId, key(), driverBody(otherToken)));
    await expectInvalid("pickup token on a driver", addDriver(pool, tripId, key(), driverBody(pickupToken)));
    await expectInvalid("venue token on a driver", addDriver(pool, tripId, key(), driverBody(venueToken)));
    await expectInvalid("driver token on a passenger", addRequest(pool, tripId, key(), { name: "Pat", pickupSelectionToken: token }));
    await expectInvalid("pickup token as a venue", createTrip(pool, key(), { name: "V", departAt: "2027-03-05T17:30:00-06:00", locationMode: "address", venueSelectionToken: pickupToken }));
    // Mode mismatches are receipted 422s under the trip lock.
    const zone = (await createTrip(pool, key(), { name: "Z", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+00:00" })).body as { id: string };
    await expectInvalid("address form on a zone trip", addDriver(pool, zone.id, key(), driverBody(token)), "LOCATION_MODE_MISMATCH");
    await expectInvalid("zone form on an address trip", addDriver(pool, tripId, key(), { name: "D", zoneId: "north", seatCapacity: 1 }), "LOCATION_MODE_MISMATCH");
    await expectInvalid("zone passenger on an address trip", addRequest(pool, tripId, key(), { name: "P", zoneId: "north" }), "LOCATION_MODE_MISMATCH");
    expect(await count("drivers")).toBe(0);
    expect(await count("ride_requests")).toBe(0);
  });

  test("a token is valid from issue until expiry (exclusive) by the injected clock", async () => {
    const t0 = 1_900_000_000_000;
    const restore = __setSelectionDeps({ now: () => t0 });
    const tripId = await createAddressTrip(pool);
    const token = await tokenFor(pool, "Driver Start Delta", "driver_start", tripId);
    const body = (startSelectionToken: string) => ({ name: "Dana", startSelectionToken, seatCapacity: 1, maxDetourMinutes: 15 });
    restore();
    const at = (now: number) => __setSelectionDeps({ now: () => now });
    let undo = at(t0 + TOKEN_LIFETIME_MS - 1);
    expect((await addDriver(pool, tripId, key(), body(token))).httpStatus).toBe(201);
    undo();
    undo = at(t0 + TOKEN_LIFETIME_MS);
    const expired = await addDriver(pool, tripId, key(), body(token));
    undo();
    expect(expired.httpStatus).toBe(422);
    expect((expired.body as { error: { code: string } }).error.code).toBe("LOCATION_SELECTION_INVALID");
    undo = at(t0 - 1); // not yet issued
    expect((await addDriver(pool, tripId, key(), body(token))).httpStatus).toBe(422);
    undo();
  });

  test("replay precedes expiry, restart and master replacement; a NEW key with the old token is rejected", async () => {
    const t0 = 1_900_000_000_000;
    let restore = __setSelectionDeps({ now: () => t0 });
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const k = key();
    const first = await addDriver(pool, tripId, k, driverBody(token));
    expect(first.httpStatus).toBe(201);
    restore();

    // After expiry: the same key still replays the original 201.
    restore = __setSelectionDeps({ now: () => t0 + 2 * TOKEN_LIFETIME_MS });
    const afterExpiry = await addDriver(pool, tripId, k, driverBody(token));
    expect(afterExpiry.replayed).toBe(true);
    expect(afterExpiry.body).toEqual(first.body);
    restore();

    // After a restart (cold master cache).
    __clearMasterCacheForTests();
    const afterRestart = await addDriver(pool, tripId, k, driverBody(token));
    expect(afterRestart.replayed).toBe(true);
    expect(afterRestart.body).toEqual(first.body);

    // After the master secret is replaced: still replays; a NEW key with the old token gets 422.
    rmSync(path.join(env.dir, "test", "fixture-signing.key"));
    __clearMasterCacheForTests();
    const afterReplacement = await addDriver(pool, tripId, k, driverBody(token));
    expect(afterReplacement.replayed).toBe(true);
    expect(afterReplacement.body).toEqual(first.body);
    const newKey = await addDriver(pool, tripId, key(), driverBody(token));
    expect(newKey.httpStatus).toBe(422);
    expect(await count("drivers")).toBe(1);
  });

  test("a token survives a restart: a new process with the same secret and generation still accepts it", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    __clearMasterCacheForTests(); // restart: the master is re-read from its file
    expect((await addDriver(pool, tripId, key(), driverBody(token))).httpStatus).toBe(201);
    // ...and a restart of the DATABASE connection pool changes nothing either.
    await pool.end();
    pool = createPool(APP, 4);
    expect((await addDriver(pool, tripId, key(), driverBody(token))).httpStatus).toBe(201);
  });

  test("unreadable key: a new key gets retryable 503 and no receipt; replays still work; repair then retry succeeds once", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const done = key();
    const original = await addDriver(pool, tripId, done, driverBody(token));
    expect(original.httpStatus).toBe(201);

    const keyPath = path.join(env.dir, "test", "fixture-signing.key");
    const good = readFileSync(keyPath, "utf8");
    writeFileSync(keyPath, "this is not a key\n");
    __clearMasterCacheForTests(); // a new process

    // Matching prior receipts replay: receipt lookup precedes key loading.
    const replay = await addDriver(pool, tripId, done, driverBody(token));
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(original.body);

    const receiptsBefore = await receipts();
    const pending = key();
    await expect(addDriver(pool, tripId, pending, driverBody(token)))
      .rejects.toMatchObject({ code: "SELECTION_KEY_UNAVAILABLE" });
    await expect(addDriver(pool, tripId, pending, driverBody(token))).rejects.toBeInstanceOf(TransientFailure);
    expect(await receipts()).toBe(receiptsBefore); // no receipt: the key is not finalized
    expect(await count("drivers")).toBe(1);

    // Repair the ORIGINAL secret, then the SAME key and body succeed exactly once.
    writeFileSync(keyPath, good);
    const first = await addDriver(pool, tripId, pending, driverBody(token));
    expect(first.httpStatus).toBe(201);
    const again = await addDriver(pool, tripId, pending, driverBody(token));
    expect(again.replayed).toBe(true);
    expect(await count("drivers")).toBe(2);
  });

  // ISSUE-048: a generation SELECT that RAISES (not one that returns no row) must also be a
  // retryable 503 with no receipt. Otherwise the keyed helper finalizes a terminal 500 that the
  // same key then replays forever, even after the database fault is repaired.
  describe.each([
    ["the app role loses SELECT on the table (42501)", "REVOKE SELECT ON dataset_generation FROM groupride_app", "GRANT SELECT ON dataset_generation TO groupride_app"],
    ["the table is missing (42P01)", "ALTER TABLE dataset_generation RENAME TO dataset_generation_x", "ALTER TABLE dataset_generation_x RENAME TO dataset_generation"],
  ])("ISSUE-048: a generation query that raises when %s", (_name, breakIt, repair) => {
    test("trip creation, registration and search are retryable 503s with no receipt; the same key succeeds after repair", async () => {
      const { tripId, token, driverBody } = await tripWithDriverToken();
      const venueToken = await tokenFor(pool, "Event Hall", "venue");
      const createBody = { name: "Repair", departAt: "2027-03-05T17:30:00-06:00", locationMode: "address" as const, venueSelectionToken: venueToken };
      const createKey = key();
      const driverKey = key();
      const receiptsBefore = await receipts();
      await admin.query(breakIt);
      try {
        await expect(createTrip(pool, createKey, createBody)).rejects.toMatchObject({ code: "SELECTION_KEY_UNAVAILABLE" });
        await expect(addDriver(pool, tripId, driverKey, driverBody(token))).rejects.toMatchObject({ code: "SELECTION_KEY_UNAVAILABLE" });
        await expect(searchLocations(pool, { query: "alpha", purpose: "venue" })).rejects.toMatchObject({ code: "SELECTION_KEY_UNAVAILABLE" });
        expect(await receipts()).toBe(receiptsBefore); // nothing was finalized
      } finally {
        await admin.query(repair);
      }
      // Repaired: the SAME keys and bodies now succeed, exactly once each.
      const created = await createTrip(pool, createKey, createBody);
      expect(created.httpStatus).toBe(201);
      const driver = await addDriver(pool, tripId, driverKey, driverBody(token));
      expect(driver.httpStatus).toBe(201);
      expect((await createTrip(pool, createKey, createBody)).replayed).toBe(true);
      expect(await count("trips", "location_mode = 'address'")).toBe(2);
      expect(await count("drivers")).toBe(1);
    });
  });

  test("an unavailable generation row is a retryable 503 with no receipt", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const saved = await generation();
    await admin.query("DELETE FROM dataset_generation");
    try {
      const before = await receipts();
      await expect(addDriver(pool, tripId, key(), driverBody(token))).rejects.toMatchObject({ code: "SELECTION_KEY_UNAVAILABLE" });
      expect(await receipts()).toBe(before);
    } finally {
      await admin.query("INSERT INTO dataset_generation (generation) VALUES ($1)", [saved]);
    }
    expect((await addDriver(pool, tripId, key(), driverBody(token))).httpStatus).toBe(201);
  });

  test("a disabled provider is a retryable 503 with no receipt for a new key, while replays still work", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const k = key();
    const original = await addDriver(pool, tripId, k, driverBody(token));
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "off";
    const receiptsBefore = await receipts();
    await expect(addDriver(pool, tripId, key(), driverBody(token))).rejects.toMatchObject({ code: "ADDRESS_PROVIDER_UNAVAILABLE" });
    expect(await receipts()).toBe(receiptsBefore);
    expect((await addDriver(pool, tripId, k, driverBody(token))).body).toEqual(original.body);
  });
});

describe("L-04 reuse, identity and lifetime caps", () => {
  test("one pickup token serves two passengers; one venue token serves two trips; a different token on one key conflicts", async () => {
    const tripId = await createAddressTrip(pool);
    const pickup = await tokenFor(pool, "Pickup Alpha", "pickup", tripId);
    const a = await addRequest(pool, tripId, key(), { name: "Ann", pickupSelectionToken: pickup });
    const b = await addRequest(pool, tripId, key(), { name: "Ben", pickupSelectionToken: pickup });
    expect([a.httpStatus, b.httpStatus]).toEqual([201, 201]);
    const rows = (await admin.query<{ location: { id: string } }>("SELECT location FROM ride_requests ORDER BY name")).rows;
    expect(rows[0].location.id).toBe(rows[1].location.id); // one immutable location ID, two participants

    const venue = await tokenFor(pool, "Event Hall", "venue");
    const mk = (venueSelectionToken: string) => ({ name: "Two", departAt: "2027-03-05T17:30:00-06:00", locationMode: "address" as const, venueSelectionToken });
    expect((await createTrip(pool, key(), mk(venue))).httpStatus).toBe(201);
    expect((await createTrip(pool, key(), mk(venue))).httpStatus).toBe(201);

    const k = key();
    const first = await addRequest(pool, tripId, k, { name: "Cy", pickupSelectionToken: pickup });
    expect(first.httpStatus).toBe(201);
    const other = await tokenFor(pool, "Pickup Bravo", "pickup", tripId);
    const conflict = await addRequest(pool, tripId, k, { name: "Cy", pickupSelectionToken: other });
    expect(conflict.httpStatus).toBe(409);
    expect((conflict.body as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  test("the stored snapshot is the verified allowlist copy, immutable and independent of the token", async () => {
    const tripId = await createAddressTrip(pool);
    const driverId = await registerDriver(pool, tripId, "Dana", "Driver Start Delta", 1, 7);
    const row = (await admin.query<{ location: Record<string, unknown>; max_detour_minutes: number; zone_id: string | null; location_mode: string }>(
      "SELECT location, max_detour_minutes, zone_id, location_mode FROM drivers WHERE id = $1", [driverId])).rows[0];
    expect(row).toMatchObject({ max_detour_minutes: 7, zone_id: null, location_mode: "address" });
    expect(Object.keys(row.location).sort()).toEqual(
      ["address", "attribution", "countryCode", "id", "issuedAt", "label", "lat", "lon", "precision", "provider", "providerRef"].sort());
    expect(row.location).toMatchObject({ providerRef: "fx-delta", provider: "fixture", countryCode: "US", precision: "building" });
  });

  test("the 50-passenger lifetime cap counts inactive records and gives a receipted 422", async () => {
    const tripId = await createAddressTrip(pool);
    const pickup = await tokenFor(pool, "Pickup Alpha", "pickup", tripId);
    let firstId = "";
    for (let i = 0; i < 50; i += 1) {
      const res = await addRequest(pool, tripId, key(), { name: `P${i}`, pickupSelectionToken: pickup });
      expect(res.httpStatus).toBe(201);
      if (i === 0) firstId = (res.body as { id: string }).id;
    }
    const over = key();
    const rejected = await addRequest(pool, tripId, over, { name: "P50", pickupSelectionToken: pickup });
    expect(rejected.httpStatus).toBe(422);
    expect((rejected.body as { error: { code: string } }).error.code).toBe("ROSTER_LIMIT");
    // Withdrawing frees no slot: an inactive record still consumes its lifetime slot.
    const snapshot = (await getTripSnapshot(pool, tripId))!;
    const withdrawn = await withdrawRequest(pool, tripId, firstId, key(), { baseVersion: snapshot.version, active: false });
    expect(withdrawn.httpStatus).toBe(200);
    expect((await addRequest(pool, tripId, key(), { name: "P51", pickupSelectionToken: pickup })).httpStatus).toBe(422);
    expect(await count("ride_requests")).toBe(50);
    expect((await addRequest(pool, tripId, over, { name: "P50", pickupSelectionToken: pickup })).replayed).toBe(true);
  });

  test("a driver edit or cancellation works on an address driver like a zone driver", async () => {
    const tripId = await createAddressTrip(pool);
    const driverId = await registerDriver(pool, tripId, "Dana", "Driver Start Delta", 2);
    const version = (await getTripSnapshot(pool, tripId))!.version;
    const edit = await editDriver(pool, tripId, driverId, key(), { baseVersion: version, seatCapacity: 1 });
    expect(edit.httpStatus).toBe(200);
    const cancel = await editDriver(pool, tripId, driverId, key(), { baseVersion: version + 1, active: false });
    expect(cancel.httpStatus).toBe(200);
    const snapshot = (await getTripSnapshot(pool, tripId))!;
    expect(snapshot.drivers[0]).toMatchObject({ active: false, seatCapacity: 1, maxDetourMinutes: 15 });
    expect(snapshot.drivers[0].location?.label).toBe("GROUPRIDE FIXTURE — Driver Start Delta");
  });
});

// ---- HTTP-level boundary: 400 and 403 never create a receipt --------------------

describe("HTTP boundary", () => {
  test("trip and invite write, preview, and search endpoints reject cross-site requests without receipts", async () => {
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    await __resetAppPoolForTests();
    const id = "00000000-0000-4000-8000-0000000000aa";
    const params = Promise.resolve({ tripId: id, driverId: id, requestId: id });
    const [trips, drivers, driver, requests, request, preview, commit, clear, search, invites] = await Promise.all([
      import("../../src/app/api/trips/route.ts"),
      import("../../src/app/api/trips/[tripId]/drivers/route.ts"),
      import("../../src/app/api/trips/[tripId]/drivers/[driverId]/route.ts"),
      import("../../src/app/api/trips/[tripId]/requests/route.ts"),
      import("../../src/app/api/trips/[tripId]/requests/[requestId]/route.ts"),
      import("../../src/app/api/trips/[tripId]/match/preview/route.ts"),
      import("../../src/app/api/trips/[tripId]/match/commit/route.ts"),
      import("../../src/app/api/trips/[tripId]/match/clear/route.ts"),
      import("../../src/app/api/locations/search/route.ts"),
      import("../../src/app/api/invites/[inviteId]/[action]/route.ts"),
    ]);
    const trip = `/api/trips/${id}`;
    const invite = `/api/invites/${id}`;
    const routes = [
      ["POST", "/api/trips", trips.POST],
      ["POST", `${trip}/drivers`, (req: Request) => drivers.POST(req, { params })],
      ["PATCH", `${trip}/drivers/${id}`, (req: Request) => driver.PATCH(req, { params })],
      ["POST", `${trip}/requests`, (req: Request) => requests.POST(req, { params })],
      ["PATCH", `${trip}/requests/${id}`, (req: Request) => request.PATCH(req, { params })],
      ["POST", `${trip}/match/preview`, (req: Request) => preview.POST(req, { params })],
      ["POST", `${trip}/match/commit`, (req: Request) => commit.POST(req, { params })],
      ["POST", `${trip}/match/clear`, (req: Request) => clear.POST(req, { params })],
      ["POST", "/api/locations/search", search.POST],
      ...["search", "drivers", "requests"].map((action) => [
        "POST", `${invite}/${action}`, (req: Request) => invites.POST(req, {
          params: Promise.resolve({ inviteId: id, action }),
        }),
      ] as const),
    ] as const;
    try {
      const before = await receipts();
      const rejectedHeaders: Record<string, string>[] = [
        { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" },
      ];
      for (const [method, path, handler] of routes) {
        for (const headers of rejectedHeaders) {
          const response = await handler(new Request(`http://127.0.0.1:3100${path}`, {
            method,
            headers: { "content-type": "application/json", host: "127.0.0.1:3100", "idempotency-key": key(), ...headers },
            body: "{}",
          }));
          const label = `${method} ${path} (${Object.keys(headers)[0]})`;
          expect(response.status, label).toBe(403);
          expect(await response.json(), label).toMatchObject({ error: { code: "CROSS_SITE_REQUEST" } });
        }
      }
      expect(await receipts()).toBe(before);
    } finally {
      await __resetAppPoolForTests();
    }
  });

  test("invalid outer requests are 400 and cross-site writes are 403, all without a receipt", async () => {
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    await __resetAppPoolForTests();
    const tripsRoute = await import("../../src/app/api/trips/route.ts");
    const searchRoute = await import("../../src/app/api/locations/search/route.ts");
    try {
      const post = (route: { POST: (r: Request) => Promise<Response> }, url: string, init: { headers?: Record<string, string>; body: string }) =>
        route.POST(new Request(url, { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:3100", ...init.headers }, body: init.body }));
      const before = await receipts();
      const bodyFor = async (token: string) => JSON.stringify({ name: "H", departAt: "2027-03-05T17:30:00-06:00", locationMode: "address", venueSelectionToken: token });
      const token = await tokenFor(pool, "Event Hall", "venue");

      const notJson = await post(tripsRoute, "http://127.0.0.1:3100/api/trips", { headers: { "idempotency-key": key() }, body: "{nope" });
      const wrongType = await post(tripsRoute, "http://127.0.0.1:3100/api/trips", { headers: { "idempotency-key": key() }, body: JSON.stringify({ name: "H", departAt: "x", locationMode: "address", venueSelectionToken: 5 }) });
      const tooBig = await post(tripsRoute, "http://127.0.0.1:3100/api/trips", { headers: { "idempotency-key": key() }, body: JSON.stringify({ name: "H", departAt: "x", locationMode: "address", venueSelectionToken: "A".repeat(17_000) }) });
      const noKey = await post(tripsRoute, "http://127.0.0.1:3100/api/trips", { body: await bodyFor(token) });
      expect([notJson.status, wrongType.status, tooBig.status, noKey.status]).toEqual([400, 400, 400, 400]);

      const crossSite = await post(tripsRoute, "http://127.0.0.1:3100/api/trips", { headers: { "idempotency-key": key(), origin: "https://evil.example" }, body: await bodyFor(token) });
      const crossFetch = await post(tripsRoute, "http://127.0.0.1:3100/api/trips", { headers: { "idempotency-key": key(), "sec-fetch-site": "cross-site" }, body: await bodyFor(token) });
      const searchCross = await post(searchRoute, "http://127.0.0.1:3100/api/locations/search", { headers: { origin: "https://evil.example" }, body: JSON.stringify({ query: "alpha", purpose: "venue" }) });
      expect([crossSite.status, crossFetch.status, searchCross.status]).toEqual([403, 403, 403]);
      expect(await receipts()).toBe(before);
      expect(await count("trips", "location_mode = 'address'")).toBe(0);

      // The same write without either header, and with a same-host Origin, proceeds.
      const ok = await post(tripsRoute, "http://127.0.0.1:3100/api/trips", { headers: { "idempotency-key": key() }, body: await bodyFor(token) });
      const sameOrigin = await post(tripsRoute, "http://127.0.0.1:3100/api/trips", { headers: { "idempotency-key": key(), origin: "http://127.0.0.1:3100" }, body: await bodyFor(token) });
      expect([ok.status, sameOrigin.status]).toEqual([201, 201]);
      expect(await receipts()).toBe(before + 2);

      // A search through the route returns tokens and sets no cache headers that allow storing.
      const search = await post(searchRoute, "http://127.0.0.1:3100/api/locations/search", { body: JSON.stringify({ query: "alpha", purpose: "venue" }) });
      expect(search.status).toBe(200);
      expect(search.headers.get("cache-control")).toBe("no-store");
      const bad = await post(searchRoute, "http://127.0.0.1:3100/api/locations/search", { body: JSON.stringify({ query: "a", purpose: "venue" }) });
      expect(bad.status).toBe(400);
    } finally {
      await __resetAppPoolForTests();
    }
  });
});


// ISSUE-058: replacing a lost master secret warns once, on WHICHEVER path creates it first.
describe("ISSUE-058: a recreated master secret is reported once, on either path", () => {
  const keyPath = () => path.join(env.dir, "test", "fixture-signing.key");

  async function loseTheSecret() {
    rmSync(keyPath());
    __clearMasterCacheForTests(); // a new process
    const warnings: string[] = [];
    const restore = __setSelectionDeps({ warn: (m) => warnings.push(m) });
    return { warnings, restore };
  }

  test("verification is the first operation: the old token gets 422 AND one warning, and the next search adds none", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken(); // an address trip exists
    const { warnings, restore } = await loseTheSecret();
    try {
      const rejected = await addDriver(pool, tripId, key(), driverBody(token));
      expect(rejected.httpStatus).toBe(422);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("earlier selections are no longer valid");
      await searchLocations(pool, { query: "alpha", purpose: "venue" });
      expect(warnings).toHaveLength(1); // the secret already exists: no second warning
    } finally {
      restore();
    }
  });

  test("a search is the first operation: one warning, and a later verification adds none", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const { warnings, restore } = await loseTheSecret();
    try {
      await searchLocations(pool, { query: "alpha", purpose: "venue" });
      expect(warnings).toHaveLength(1);
      expect((await addDriver(pool, tripId, key(), driverBody(token))).httpStatus).toBe(422);
      expect(warnings).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("no address trip exists: creating the very first secret warns about nothing, on both paths", async () => {
    const warnings: string[] = [];
    const restore = __setSelectionDeps({ warn: (m) => warnings.push(m) });
    try {
      const token = await tokenFor(pool, "Event Hall", "venue"); // creates the secret
      rmSync(keyPath());
      __clearMasterCacheForTests();
      const first = await createTrip(pool, key(), { name: "First", departAt: "2027-03-05T17:30:00-06:00", locationMode: "address", venueSelectionToken: token });
      expect(first.httpStatus).toBe(422); // the old token; the secret was recreated by VERIFICATION
      expect(warnings).toEqual([]); // there was no address trip to invalidate
    } finally {
      restore();
    }
  });

  test("a failing probe cannot abort a request that goes on to SUCCEED (the probe has its own savepoint)", async () => {
    // Force the "just created" branch for a VALID token. In production a freshly created secret
    // implies a rejected token, whose terminal path would heal the transaction anyway; this
    // reaches the case the probe's own savepoint exists for.
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const warnings: string[] = [];
    const restore = __setSelectionDeps({
      warn: (m) => warnings.push(m),
      loadMaster: async () => ({ ...(await loadMaster({ mode: "fixture", target: "test", rootDir: env.dir })), created: true }),
    });
    const realConnect = pool.connect.bind(pool);
    (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => {
      const client = (await realConnect()) as { query: (...a: unknown[]) => Promise<unknown> };
      const query = client.query.bind(client);
      client.query = (...args: unknown[]) =>
        typeof args[0] === "string" && /location_mode\s*=\s*'address'\s+LIMIT 1/i.test(args[0])
          ? query("SELECT 1 FROM no_such_table_for_the_probe") // a REAL server-side error
          : query(...args);
      return client;
    };
    try {
      const added = await addDriver(pool, tripId, key(), driverBody(token));
      expect(added.httpStatus).toBe(201); // the request still succeeds
      expect(await count("drivers")).toBe(1);
      expect(warnings).toEqual([]); // the best-effort warning was skipped
    } finally {
      restore();
    }
  });

  test("a failing warning probe can never turn a rejected token into a permanent failure", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const { warnings, restore } = await loseTheSecret();
    try {
      const probeFailure = key();
      // Make ONLY the probe statement fail, and fail it for REAL on the server: PostgreSQL
      // aborts the transaction on a failed statement, so without the probe's own
      // savepoint the later receipt write would fail too.
      const realConnect = pool.connect.bind(pool);
      (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => {
        const client = (await realConnect()) as { query: (...a: unknown[]) => Promise<unknown> };
        const query = client.query.bind(client);
        client.query = (...args: unknown[]) =>
          typeof args[0] === "string" && /location_mode\s*=\s*'address'\s+LIMIT 1/i.test(args[0])
            ? query("SELECT 1 FROM no_such_table_for_the_probe")
            : query(...args);
        return client;
      };
      const rejected = await addDriver(pool, tripId, probeFailure, driverBody(token));
      expect(rejected.httpStatus).toBe(422); // still the ordinary rejection and receipt, not a 500
      expect(warnings).toEqual([]); // the warning is best-effort and was skipped
      expect((await addDriver(pool, tripId, probeFailure, driverBody(token))).replayed).toBe(true);
    } finally {
      restore();
    }
  });
});

// ISSUE-059 and ISSUE-061: database lock timeouts around search. Another session holds a REAL
// ACCESS EXCLUSIVE lock; the app's 2 s lock_timeout then fires inside the search transaction.
describe("ISSUE-059/061: a table lock around search is a retryable 503, and only needed tables are touched", () => {
  // The route handler keeps a process-global pool; an early assertion failure must not leak it
  // into the next test's offline reset.
  afterEach(async () => {
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    await __resetAppPoolForTests();
  });

  /** Hold an ACCESS EXCLUSIVE lock on `table` from a separate session until released. */
  async function holdLock(table: string) {
    const holder = createPool(SETUP, 1);
    const client = await holder.connect();
    await client.query("BEGIN");
    await client.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    return {
      release: async () => {
        await client.query("ROLLBACK");
        client.release();
        await holder.end();
      },
    };
  }

  async function searchRoute() {
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    await __resetAppPoolForTests();
    const route = await import("../../src/app/api/locations/search/route.ts");
    const call = (body: unknown) =>
      route.POST(new Request("http://127.0.0.1:3100/api/locations/search", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:3100" },
        body: JSON.stringify(body),
      }));
    return { call, done: () => __resetAppPoolForTests() };
  }

  test("ISSUE-059: a generation read that times out is a retryable 503 on search, at the service AND over HTTP", async () => {
    const { call, done } = await searchRoute();
    const lock = await holdLock("dataset_generation");
    try {
      await expect(searchLocations(pool, { query: "alpha", purpose: "venue" }))
        .rejects.toMatchObject({ code: "DATABASE_BUSY" }); // a typed, retryable failure, not a raw pg error
      const response = await call({ query: "alpha", purpose: "venue" });
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("DATABASE_BUSY");
    } finally {
      await lock.release();
    }
    const recovered = await call({ query: "alpha", purpose: "venue" }); // immediately fine after release
    expect(recovered.status).toBe(200);
    await done();
  }, 30_000);

  test("ISSUE-059: the same timeout inside KEYED work keeps same-key recovery (no receipt, then success)", async () => {
    const { tripId, token, driverBody } = await tripWithDriverToken();
    const k = key();
    const lock = await holdLock("dataset_generation");
    const before = await receipts();
    try {
      await expect(addDriver(pool, tripId, k, driverBody(token))).rejects.toMatchObject({ code: "DATABASE_BUSY" });
    } finally {
      await lock.release();
    }
    expect(await receipts()).toBe(before);
    expect((await addDriver(pool, tripId, k, driverBody(token))).httpStatus).toBe(201);
  }, 30_000);

  test("ISSUE-061: a venue search with a warm key touches NO trip data, so a locked trips table cannot break it", async () => {
    await searchLocations(pool, { query: "alpha", purpose: "venue" }); // warm the key
    const statements: string[] = [];
    const realConnect = pool.connect.bind(pool);
    (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => {
      const client = (await realConnect()) as { query: (...a: unknown[]) => Promise<unknown> };
      const query = client.query.bind(client);
      client.query = (...args: unknown[]) => {
        if (typeof args[0] === "string") statements.push(args[0]);
        return query(...args);
      };
      return client;
    };
    await searchLocations(pool, { query: "alpha", purpose: "venue" });
    expect(statements.filter((sql) => /\btrips\b/i.test(sql))).toEqual([]);

    const lock = await holdLock("trips");
    try {
      const search = await searchLocations(pool, { query: "alpha", purpose: "venue" });
      expect(search.body.suggestions.some((s) => s.selectable)).toBe(true);
    } finally {
      await lock.release();
    }
  }, 30_000);

  test("ISSUE-061: a trip-scoped search genuinely needs trips, and a locked trips table is a retryable 503 for it", async () => {
    const tripId = await createAddressTrip(pool);
    const { call, done } = await searchRoute();
    const lock = await holdLock("trips");
    try {
      const response = await call({ query: "pickup", purpose: "pickup", tripId });
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("DATABASE_BUSY");
    } finally {
      await lock.release();
    }
    expect((await call({ query: "pickup", purpose: "pickup", tripId })).status).toBe(200);
    await done();
  }, 30_000);

  test("ISSUE-061: when the key IS just created, an unreadable trips table only skips the optional warning", async () => {
    await createAddressTrip(pool); // an address trip exists, so a healthy probe WOULD warn
    rmSync(path.join(env.dir, "test", "fixture-signing.key"));
    __clearMasterCacheForTests();
    const warnings: string[] = [];
    const restore = __setSelectionDeps({ warn: (m) => warnings.push(m) });
    const lock = await holdLock("trips");
    try {
      const search = await searchLocations(pool, { query: "alpha", purpose: "venue" }); // still 200
      expect(search.body.suggestions.some((s) => s.selectable)).toBe(true);
      expect(warnings).toEqual([]); // the best-effort probe failed and was skipped
    } finally {
      await lock.release();
      restore();
    }
  }, 30_000);
});
