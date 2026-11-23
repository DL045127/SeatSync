// W3 preview/commit acceptance checks against real PostgreSQL:
// WF-1 (persist + totals), WF-4 (directional cost 1/7), C-02 (cancel then stale
// commit), C-03 (register then stale commit), C-07 (capacity reduction clears
// plan), C-14 (algorithm/stale/invalid-JSON commit rejections). Each test uses
// its own app pool, reset before the next test (ISSUE-018 pattern).

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db/pool.ts";
import { appRole, assertLocalTarget, setupRole, testDatabase } from "../../src/db/local-target.ts";
import { runSetup } from "../../src/db/setup.ts";
import { addDriver, addRequest, createTrip, editDriver, getTripSnapshot } from "../../src/trips/service.ts";
import { publishPreview } from "../../src/trips/preview.ts";
import { commitPreview } from "../../src/trips/commit.ts";

if (existsSync(".env")) loadEnvFile();
const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!setupUrl || !appUrl) {
  throw new Error("Configure TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL for the preview/commit suite.");
}
assertLocalTarget(appUrl, testDatabase, appRole);
assertLocalTarget(setupUrl, testDatabase, setupRole);
const SETUP = setupUrl;
const APP = appUrl;

let pool: Pool;
const key = () => randomUUID();

beforeEach(async () => {
  await runSetup(SETUP, testDatabase, "migrate");
  await runSetup(SETUP, testDatabase, "reset");
  pool = createPool(APP, 5);
});

afterEach(async () => {
  await pool?.end();
});

async function freshTrip(): Promise<string> {
  const res = await createTrip(pool, key(), {
    name: "W3 Trip",
    destinationLabel: "Student Union",
    departAt: "2026-03-01T09:30:00+02:00",
  });
  return (res.body as { id: string }).id;
}

async function addActiveDriver(tripId: string, zoneId: string, seatCapacity: number): Promise<string> {
  const r = await addDriver(pool, tripId, key(), { name: "D", zoneId, seatCapacity });
  expect(r.httpStatus).toBe(201);
  return (r.body as { id: string }).id;
}

async function addActivePassenger(tripId: string, zoneId: string): Promise<string> {
  const r = await addRequest(pool, tripId, key(), { name: "P", zoneId });
  expect(r.httpStatus).toBe(201);
  return (r.body as { id: string }).id;
}

describe("WF-4 directional zone cost", () => {
  test("one North driver and one East passenger preview/commit/reload at 1 match, cost 7", async () => {
    const tripId = await freshTrip();
    await addActiveDriver(tripId, "north", 1);
    await addActivePassenger(tripId, "east");

    const preview = await publishPreview(pool, tripId);
    expect(preview.body.optimal.matchedCount).toBe(1);
    expect(preview.body.optimal.totalCost).toBe(7); // North->East = 7, not the reverse 19
    expect(preview.body.baseVersion).toBe((await getTripSnapshot(pool, tripId))!.version);

    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(200);
    expect((commit.body as { totalCost: number }).totalCost).toBe(7);

    // Reload: the stored plan reflects 1 match at cost 7.
    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.status).toBe("assigned");
    expect(snap!.assignments).toHaveLength(1);
    expect(snap!.totals.totalCost).toBe(7);
  });
});

describe("WF-1 persistence and totals", () => {
  test("create/register/preview/commit/reload persists a valid roster and consistent totals", async () => {
    const tripId = await freshTrip();
    await addActiveDriver(tripId, "south", 2);
    await addActivePassenger(tripId, "west");
    await addActivePassenger(tripId, "south");

    const preview = await publishPreview(pool, tripId);
    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(200);

    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.status).toBe("assigned");
    expect(snap!.planVersion).toBe(snap!.version);
    // Totals derive from assignment rows; matched count equals stored assignments.
    expect(snap!.totals.matched).toBe(snap!.assignments.length);
    expect(snap!.totals.totalCost).toBe(
      snap!.assignments.reduce((s, a) => s + a.pickupCost, 0),
    );
  });

  test("an empty optimal plan is committable (assigned means a computation was saved)", async () => {
    const tripId = await freshTrip();
    await addActivePassenger(tripId, "north"); // no drivers
    const preview = await publishPreview(pool, tripId);
    expect(preview.body.optimal.matchedCount).toBe(0);
    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(200);
    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.status).toBe("assigned");
    expect(snap!.assignments).toHaveLength(0);
  });
});

describe("C-02 cancellation after preview", () => {
  test("commit rejects the stale preview and no canceled driver is assigned", async () => {
    const tripId = await freshTrip();
    const driverId = await addActiveDriver(tripId, "north", 1);
    await addActivePassenger(tripId, "east");
    const preview = await publishPreview(pool, tripId);

    // Cancel the driver after previewing: trip version advances.
    const v = (await getTripSnapshot(pool, tripId))!.version;
    const cancel = await editDriver(pool, tripId, driverId, key(), { baseVersion: v, active: false });
    expect(cancel.httpStatus).toBe(200);

    // The stale preview must be rejected.
    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(409);
    expect((commit.body as { error: { code: string } }).error.code).toBe("STALE_VERSION");

    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.status).not.toBe("assigned");
    expect(snap!.assignments).toHaveLength(0);
  });
});

describe("C-03 registration after preview", () => {
  test("commit rejects the stale preview", async () => {
    const tripId = await freshTrip();
    await addActiveDriver(tripId, "north", 2);
    await addActivePassenger(tripId, "north");
    const preview = await publishPreview(pool, tripId);

    // Register another passenger after previewing.
    await addActivePassenger(tripId, "north");

    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(409);
    expect((commit.body as { error: { code: string } }).error.code).toBe("STALE_VERSION");
  });
});

describe("C-07 capacity reduction clears the plan", () => {
  test("reducing capacity clears all assignments, bumps version, sets needs_rematch; rematch respects capacity", async () => {
    const tripId = await freshTrip();
    const driverId = await addActiveDriver(tripId, "north", 2);
    await addActivePassenger(tripId, "north");
    await addActivePassenger(tripId, "north");

    const preview = await publishPreview(pool, tripId);
    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(200);
    const assigned = await getTripSnapshot(pool, tripId);
    expect(assigned!.status).toBe("assigned");
    expect(assigned!.assignments).toHaveLength(2);

    // Reduce capacity to 1: the whole plan is invalidated.
    const reduce = await editDriver(pool, tripId, driverId, key(), {
      baseVersion: assigned!.version,
      seatCapacity: 1,
    });
    expect(reduce.httpStatus).toBe(200);
    const rematchNeeded = await getTripSnapshot(pool, tripId);
    expect(rematchNeeded!.status).toBe("needs_rematch");
    expect(rematchNeeded!.assignments).toHaveLength(0);
    expect(rematchNeeded!.version).toBe(assigned!.version + 1);

    // Manual rematch produces a valid plan respecting the reduced capacity.
    const preview2 = await publishPreview(pool, tripId);
    expect(preview2.body.optimal.matchedCount).toBe(1); // only one seat now
    const commit2 = await commitPreview(pool, tripId, key(), { previewId: preview2.body.previewId });
    expect(commit2.httpStatus).toBe(200);
    const final = await getTripSnapshot(pool, tripId);
    expect(final!.status).toBe("assigned");
    expect(final!.assignments).toHaveLength(1);
  });
});

describe("C-14 commit input and preview validation", () => {
  test("a malformed preview ID is rejected as invalid input", async () => {
    const tripId = await freshTrip();
    // Normalization rejects synchronously before the keyed mutation runs.
    expect(() => commitPreview(pool, tripId, key(), { previewId: "junk" })).toThrow();
  });

  test("an unknown field in the commit body is rejected", async () => {
    const tripId = await freshTrip();
    expect(() =>
      commitPreview(pool, tripId, key(), { previewId: randomUUID(), extra: 1 }),
    ).toThrow();
  });

  test("a preview from a superseded algorithm cannot commit (ALGORITHM_CHANGED)", async () => {
    const tripId = await freshTrip();
    await addActiveDriver(tripId, "north", 1);
    await addActivePassenger(tripId, "east");
    const preview = await publishPreview(pool, tripId);

    // Simulate algorithm supersession by rewriting the stored algorithm id with
    // the setup role (the app role cannot update match_previews).
    const setup = createPool(SETUP, 1);
    try {
      await setup.query(
        "UPDATE match_previews SET algorithm_version = 'mincostflow-v0' WHERE id = $1",
        [preview.body.previewId],
      );
    } finally {
      await setup.end();
    }
    const commit = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(commit.httpStatus).toBe(409);
    expect((commit.body as { error: { code: string } }).error.code).toBe("ALGORITHM_CHANGED");
  });

  test("invalid stored preview JSON causes an internal error without mutating the trip", async () => {
    const tripId = await freshTrip();
    await addActiveDriver(tripId, "north", 1);
    await addActivePassenger(tripId, "east");
    const preview = await publishPreview(pool, tripId);
    const before = await getTripSnapshot(pool, tripId);

    // Corrupt the stored optimal result via the setup role.
    const setup = createPool(SETUP, 1);
    try {
      await setup.query(
        "UPDATE match_previews SET optimal_result = '{\"bogus\":true}'::jsonb WHERE id = $1",
        [preview.body.previewId],
      );
    } finally {
      await setup.end();
    }
    // Invalid stored JSON is an internal invariant failure finalized as a 500
    // not_applied receipt (ISSUE-014 terminal path); the business work is rolled
    // back, so the trip is not mutated.
    const result = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(result.httpStatus).toBe(500);
    const after = await getTripSnapshot(pool, tripId);
    expect(after!.status).toBe(before!.status);
    expect(after!.version).toBe(before!.version);
    expect(after!.assignments).toHaveLength(0);
  });
});

describe("preview reuse and idempotent commit", () => {
  test("two previews at one version return the same stored preview id", async () => {
    const tripId = await freshTrip();
    await addActiveDriver(tripId, "north", 1);
    await addActivePassenger(tripId, "east");
    const a = await publishPreview(pool, tripId);
    const b = await publishPreview(pool, tripId);
    expect(b.body.previewId).toBe(a.body.previewId);
  });

  test("a same-key commit retry applies exactly once (replay)", async () => {
    const tripId = await freshTrip();
    await addActiveDriver(tripId, "north", 1);
    await addActivePassenger(tripId, "east");
    const preview = await publishPreview(pool, tripId);
    const commitKey = key();
    const first = await commitPreview(pool, tripId, commitKey, { previewId: preview.body.previewId });
    const replay = await commitPreview(pool, tripId, commitKey, { previewId: preview.body.previewId });
    expect(first.httpStatus).toBe(200);
    expect(replay.replayed).toBe(true);
    expect((await getTripSnapshot(pool, tripId))!.version).toBe(
      (first.body as { mutationVersion: number }).mutationVersion,
    );
  });
});

describe("ISSUE-025 preview route input, integrity, and availability", () => {
  test("the preview route rejects non-empty, oversized, and malformed bodies, and serves a valid preview", async () => {
    process.env.DATABASE_URL = APP;
    process.env.GROUPRIDE_USE_TEST_DATABASE = "1";
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    const route = await import("../../src/app/api/trips/[tripId]/match/preview/route.ts");
    await __resetAppPoolForTests();
    try {
      const tripId = await freshTrip();
      await addActiveDriver(tripId, "north", 1);
      await addActivePassenger(tripId, "east");
      const params = { params: Promise.resolve({ tripId }) };

      // Unknown field in the body.
      const unknownField = await route.POST(
        new Request("http://127.0.0.1/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ unexpected: true }),
        }),
        params,
      );
      expect(unknownField.status).toBe(400);

      // A whitespace-only body is not valid JSON (distinct from an absent
      // body) and must be 400, not silently accepted (ISSUE-025).
      const whitespace = await route.POST(
        new Request("http://127.0.0.1/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "   ",
        }),
        params,
      );
      expect(whitespace.status).toBe(400);

      // JSON scalars and an array are not an empty object: all 400 (ISSUE-025).
      for (const literal of ["null", "42", '"x"', "[]"]) {
        const res = await route.POST(
          new Request("http://127.0.0.1/x", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: literal,
          }),
          params,
        );
        expect(res.status, `body ${literal}`).toBe(400);
      }

      // Malformed JSON.
      const malformed = await route.POST(
        new Request("http://127.0.0.1/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{not json",
        }),
        params,
      );
      expect(malformed.status).toBe(400);

      // Oversized body (> 16 KiB).
      const oversized = await route.POST(
        new Request("http://127.0.0.1/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pad: "a".repeat(17_000) }),
        }),
        params,
      );
      expect(oversized.status).toBe(400);

      // An empty body is accepted and returns the preview.
      const ok = await route.POST(
        new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: "" }),
        params,
      );
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { optimal: { matchedCount: number; totalCost: number } };
      expect(body.optimal).toMatchObject({ matchedCount: 1, totalCost: 7 });
    } finally {
      await __resetAppPoolForTests();
      delete process.env.GROUPRIDE_USE_TEST_DATABASE;
    }
  });

  test("a corrupt cached preview is not served as 200", async () => {
    process.env.DATABASE_URL = APP;
    process.env.GROUPRIDE_USE_TEST_DATABASE = "1";
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    const route = await import("../../src/app/api/trips/[tripId]/match/preview/route.ts");
    await __resetAppPoolForTests();
    const setup = createPool(SETUP, 1);
    try {
      const tripId = await freshTrip();
      await addActiveDriver(tripId, "north", 1);
      await addActivePassenger(tripId, "east");
      // Publish a preview, then corrupt its cached optimal result.
      const preview = await publishPreview(pool, tripId);
      await setup.query(
        "UPDATE match_previews SET optimal_result = '{\"bogus\":true}'::jsonb WHERE id = $1",
        [preview.body.previewId],
      );
      const res = await route.POST(
        new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: "" }),
        { params: Promise.resolve({ tripId }) },
      );
      // A corrupt cache is a deterministic invariant violation: 500
      // INTERNAL_ERROR, not a retryable 503.
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe(
        "INTERNAL_ERROR",
      );

      // A structurally-complete result with a null nested assignment is also
      // corrupt and must not be served (ISSUE-025 nested validation).
      await setup.query(
        `UPDATE match_previews
           SET optimal_result = '{"assignments":[null],"unassignedPassengerIds":[],"matchedCount":1,"totalCost":0}'::jsonb
         WHERE id = $1`,
        [preview.body.previewId],
      );
      const nested = await route.POST(
        new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: "" }),
        { params: Promise.resolve({ tripId }) },
      );
      expect(nested.status).toBe(500);
      expect(((await nested.json()) as { error?: { code?: string } }).error?.code).toBe(
        "INTERNAL_ERROR",
      );

      // Semantic corruption: zero assignments but matchedCount 5 / totalCost -7
      // violates the count/cost invariants and must not be served (ISSUE-025).
      await setup.query(
        `UPDATE match_previews
           SET optimal_result = '{"assignments":[],"unassignedPassengerIds":[],"matchedCount":5,"totalCost":-7}'::jsonb
         WHERE id = $1`,
        [preview.body.previewId],
      );
      const semantic = await route.POST(
        new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: "" }),
        { params: Promise.resolve({ tripId }) },
      );
      expect(semantic.status).toBe(500);
      expect(((await semantic.json()) as { error?: { code?: string } }).error?.code).toBe(
        "INTERNAL_ERROR",
      );

      // Per-assignment corruption that aggregates to a plausible total must also
      // be refused (ISSUE-025): a negative+positive pair summing to a valid
      // total, a fractional pair, a duplicate passenger, and the same UUID in
      // two letter cases (which must NOT be treated as two distinct passengers).
      //
      // These fixtures use real canonical UUIDs, not placeholders like "a"/"d":
      // the validator now requires canonical lowercase UUIDs, so a placeholder
      // ID would be rejected on its own and could mask a broken cost/uniqueness
      // check. With valid UUIDs, the only reason each row is refused is the
      // specific semantic defect under test.
      const pA = "11111111-1111-1111-1111-111111111111";
      const pB = "22222222-2222-2222-2222-222222222222";
      const dA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const dB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      const pMixed = "ABCDEF12-3456-7890-ABCD-EF1234567890";
      const corrupt = [
        `{"assignments":[{"passengerId":"${pA}","driverId":"${dA}","cost":-1},{"passengerId":"${pB}","driverId":"${dA}","cost":2}],"unassignedPassengerIds":[],"matchedCount":2,"totalCost":1}`,
        `{"assignments":[{"passengerId":"${pA}","driverId":"${dA}","cost":0.5},{"passengerId":"${pB}","driverId":"${dA}","cost":0.5}],"unassignedPassengerIds":[],"matchedCount":2,"totalCost":1}`,
        `{"assignments":[{"passengerId":"${pA}","driverId":"${dA}","cost":1},{"passengerId":"${pA}","driverId":"${dB}","cost":0}],"unassignedPassengerIds":[],"matchedCount":2,"totalCost":1}`,
        // Same UUID, differing letter case, across the two assignments: the
        // uppercase form is not a canonical UUID, so the row is corrupt and must
        // never be served as two distinct assigned passengers (ISSUE-025).
        `{"assignments":[{"passengerId":"${pMixed.toLowerCase()}","driverId":"${dA}","cost":1},{"passengerId":"${pMixed}","driverId":"${dB}","cost":0}],"unassignedPassengerIds":[],"matchedCount":2,"totalCost":1}`,
        // Same UUID appearing assigned (lowercase) and unassigned (uppercase):
        // must not pass as two different passengers either.
        `{"assignments":[{"passengerId":"${pMixed.toLowerCase()}","driverId":"${dA}","cost":1}],"unassignedPassengerIds":["${pMixed}"],"matchedCount":1,"totalCost":1}`,
      ];
      // Restore the untested column to the preview's ACTUAL published result
      // (not a synthetic empty one, which omits the seeded passenger) so each
      // row is refused only because of the corruption under test, never because
      // the sibling column is independently invalid.
      const published = {
        optimal_result: JSON.stringify(preview.body.optimal),
        greedy_result: JSON.stringify(preview.body.greedy),
      } as const;
      for (const column of ["optimal_result", "greedy_result"] as const) {
        const other = column === "optimal_result" ? "greedy_result" : "optimal_result";
        for (const bad of corrupt) {
          await setup.query(
            `UPDATE match_previews SET ${column} = $2::jsonb, ${other} = $3::jsonb WHERE id = $1`,
            [preview.body.previewId, bad, published[other]],
          );
          const res = await route.POST(
            new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: "" }),
            { params: Promise.resolve({ tripId }) },
          );
          // A corrupt cache is a deterministic invariant violation: it must be
          // 500 INTERNAL_ERROR, not a retryable 503 (which a loose `>= 500`
          // assertion would wrongly accept).
          const body = (await res.json()) as { error?: { code?: string } };
          expect(res.status, `corrupt ${column} ${bad}`).toBe(500);
          expect(body.error?.code, `corrupt ${column} ${bad}`).toBe("INTERNAL_ERROR");
        }
      }
    } finally {
      await setup.end();
      await __resetAppPoolForTests();
      delete process.env.GROUPRIDE_USE_TEST_DATABASE;
    }
  });

  test("a transient database failure maps to a retryable 503, not 500", async () => {
    // Inject a lock-timeout (55P03) into the preview read transaction via the
    // transaction commit fault hook and confirm the service classifies it.
    const { publishPreview: publish } = await import("../../src/trips/preview.ts");
    const { TransientFailure } = await import("../../src/contracts/errors.ts");
    const tripId = await freshTrip();
    await addActiveDriver(tripId, "north", 1);
    await addActivePassenger(tripId, "east");
    const { __setTransactionCommitFaultHook } = await import("../../src/db/transaction.ts");
    const clear = __setTransactionCommitFaultHook(async () => {
      throw Object.assign(new Error("lock_not_available"), { code: "55P03" });
    });
    let threw: unknown;
    try {
      await publish(pool, tripId);
    } catch (error) {
      threw = error;
    } finally {
      clear();
    }
    expect(threw).toBeInstanceOf(TransientFailure);
  });
});
