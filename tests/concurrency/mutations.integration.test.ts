// W2 durable-mutation acceptance checks against real PostgreSQL:
// C-04, C-09, C-10, C-11, C-12, C-17, C-19. Includes deterministic two-client
// interleavings (barriers, not sleeps), HTTP-level checks through the route
// handlers, and both committed-failure and lost/failed-receipt acknowledgement
// cases (ISSUE-019). Each test uses its own app pool, closed before the next
// offline reset so the reset guard never sees a stale session (ISSUE-018).
//
// Requires a running Compose database and a reset test database. Configure
// TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL (see .env.example). Run with
// `npm run test:concurrency` from a shell with PostgreSQL access.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db/pool.ts";
import { appRole, assertLocalTarget, setupRole, testDatabase } from "../../src/db/local-target.ts";
import { runSetup } from "../../src/db/setup.ts";
import { __setFaultHook } from "../../src/trips/mutation.ts";
import { mutationLockId } from "../../src/db/advisory-lock.ts";
import { CommitRejected } from "../../src/db/transaction.ts";
import { OutcomeUnknown, TerminalBusinessError, TransientFailure } from "../../src/contracts/errors.ts";
import {
  addDriver,
  addRequest,
  editDriver,
  getTripSnapshot,
  withdrawRequest,
} from "../../src/trips/service.ts";
import { createTripWithWorkspace as createTrip, newWorkspaceCookie } from "./helpers/workspace.ts";

if (existsSync(".env")) loadEnvFile();
const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!setupUrl || !appUrl) {
  throw new Error("Configure TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL for the concurrency suite.");
}
assertLocalTarget(appUrl, testDatabase, appRole);
assertLocalTarget(setupUrl, testDatabase, setupRole);
const SETUP = setupUrl;
const APP = appUrl;

let pool: Pool;
const key = () => randomUUID();

/**
 * ISSUE-018: open a dedicated app pool per test and close it in afterEach so the
 * NEXT test's offline reset does not observe a lingering app session. Each test
 * reseeds a clean database first (no app sessions open at reset time).
 */
beforeEach(async () => {
  await runSetup(SETUP, testDatabase, "migrate");
  await runSetup(SETUP, testDatabase, "reset");
  pool = createPool(APP, 5);
});

afterEach(async () => {
  __setFaultHook(() => Promise.resolve()); // clear any leftover hook
  await pool?.end();
});

async function freshTrip(): Promise<string> {
  const res = await createTrip(pool, key(), {
    name: "Fixture Trip",
    destinationLabel: "Student Union",
    departAt: "2026-03-01T09:30:00+02:00",
  });
  expect(res.httpStatus).toBe(201);
  return (res.body as { id: string }).id;
}

describe("C-19 creation idempotency", () => {
  test("identical key returns one trip; differing input conflicts; failed creation leaves no trip", async () => {
    const k = key();
    const body = { name: "Launch Day", destinationLabel: "Union", departAt: "2026-05-01T08:00:00+00:00" };
    const first = await createTrip(pool, k, body);
    const replay = await createTrip(pool, k, body);
    expect(replay.replayed).toBe(true);
    expect((replay.body as { id: string }).id).toBe((first.body as { id: string }).id);

    const conflict = await createTrip(pool, k, { ...body, name: "Different" });
    expect(conflict.httpStatus).toBe(409);
    expect((conflict.body as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    // ISSUE-013: a conflict must NOT carry terminal operation metadata.
    expect((conflict.body as { operation?: unknown }).operation).toBeUndefined();

    const failKey = key();
    const clear = __setFaultHook(async (point) => {
      if (point === "after-business-writes") {
        throw new TerminalBusinessError(500, "INTERNAL_ERROR", "Injected creation failure.");
      }
    });
    try {
      const failed = await createTrip(pool, failKey, { name: "Doomed", destinationLabel: "Union", departAt: "2026-05-02T08:00:00+00:00" });
      expect(failed.httpStatus).toBe(500);
    } finally {
      clear();
    }
    expect((await pool.query("SELECT count(*)::int AS c FROM trips WHERE name = 'Doomed'")).rows[0].c).toBe(0);
    // Same key retried replays the failure; still no trip.
    const retry = await createTrip(pool, failKey, { name: "Doomed", destinationLabel: "Union", departAt: "2026-05-02T08:00:00+00:00" });
    expect(retry.replayed).toBe(true);
    expect(retry.httpStatus).toBe(500);
    expect((await pool.query("SELECT count(*)::int AS c FROM trips WHERE name = 'Doomed'")).rows[0].c).toBe(0);
  });

  test("concurrent identical creation keys yield exactly one trip", async () => {
    const k = key();
    const body = { name: "Race", destinationLabel: "Union", departAt: "2026-06-01T08:00:00+00:00" };
    const [a, b] = await Promise.all([createTrip(pool, k, body), createTrip(pool, k, body)]);
    const idA = (a.body as { id?: string }).id;
    const idB = (b.body as { id?: string }).id;
    // One request executes, the other replays the same receipt; both see one id.
    expect(idA).toBe(idB);
    expect((await pool.query("SELECT count(*)::int AS c FROM trips WHERE name = 'Race'")).rows[0].c).toBe(1);
  });
});

describe("C-04 concurrent registration retries", () => {
  test("two concurrent identical driver registrations yield one driver and one version bump", async () => {
    const tripId = await freshTrip();
    const k = key();
    const body = { name: "Alex", zoneId: "north", seatCapacity: 3 };
    const [a, b] = await Promise.all([addDriver(pool, tripId, k, body), addDriver(pool, tripId, k, body)]);
    const idA = (a.body as { id?: string }).id;
    const idB = (b.body as { id?: string }).id;
    expect(idA).toBe(idB);
    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.drivers).toHaveLength(1);
    expect(snap!.version).toBe(1); // exactly one effective change from version 0
  });

  test("two concurrent identical passenger registrations yield one request and one version bump", async () => {
    const tripId = await freshTrip();
    const k = key();
    const body = { name: "Pat", zoneId: "north" };
    const [a, b] = await Promise.all([addRequest(pool, tripId, k, body), addRequest(pool, tripId, k, body)]);
    expect((a.body as { id?: string }).id).toBe((b.body as { id?: string }).id);
    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.requests).toHaveLength(1);
    expect(snap!.version).toBe(1);
  });
});

describe("C-09 key reuse and stale edits", () => {
  test("canonical-equivalent payload replays; differing payload conflicts; stale new-key edit rejects", async () => {
    const tripId = await freshTrip();
    const k = key();
    const d = await addDriver(pool, tripId, k, { name: "Sam", zoneId: "east", seatCapacity: 2 });
    const driverId = (d.body as { id: string }).id;

    const replay = await addDriver(pool, tripId, k, { seatCapacity: 2, zoneId: "east", name: "Sam" });
    expect(replay.replayed).toBe(true);

    const conflict = await addDriver(pool, tripId, k, { name: "Sam", zoneId: "east", seatCapacity: 4 });
    expect(conflict.httpStatus).toBe(409);
    expect((conflict.body as { operation?: unknown }).operation).toBeUndefined();

    const stale = await editDriver(pool, tripId, driverId, key(), { baseVersion: 0, seatCapacity: 5 });
    expect(stale.httpStatus).toBe(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe("STALE_VERSION");
  });
});

describe("C-10 lost success response then retry", () => {
  test("retrying the original key after another mutation replays once", async () => {
    const tripId = await freshTrip();
    const driverKey = key();
    const body = { name: "Robin", zoneId: "north", seatCapacity: 1 };
    const first = await addDriver(pool, tripId, driverKey, body);
    const firstId = (first.body as { id: string }).id;

    await addRequest(pool, tripId, key(), { name: "Pat", zoneId: "north" });

    const retry = await addDriver(pool, tripId, driverKey, body);
    expect(retry.replayed).toBe(true);
    expect((retry.body as { id: string }).id).toBe(firstId);
    expect((await getTripSnapshot(pool, tripId))!.drivers).toHaveLength(1);
  });
});

describe("C-11 no-ops and replay never reactivates", () => {
  test("no-op edit and repeat cancellation do not bump; registration replay never reactivates", async () => {
    const tripId = await freshTrip();
    const regKey = key();
    const d = await addDriver(pool, tripId, regKey, { name: "Lee", zoneId: "north", seatCapacity: 3 });
    const driverId = (d.body as { id: string }).id;
    const v = (await getTripSnapshot(pool, tripId))!.version;

    const noop = await editDriver(pool, tripId, driverId, key(), { baseVersion: v, seatCapacity: 3 });
    expect(noop.httpStatus).toBe(200);
    expect((await getTripSnapshot(pool, tripId))!.version).toBe(v);

    const cancel = await editDriver(pool, tripId, driverId, key(), { baseVersion: v, active: false });
    expect(cancel.httpStatus).toBe(200);
    const vCanceled = (await getTripSnapshot(pool, tripId))!.version;
    const repeat = await editDriver(pool, tripId, driverId, key(), { baseVersion: vCanceled, active: false });
    expect(repeat.httpStatus).toBe(200);
    expect((await getTripSnapshot(pool, tripId))!.version).toBe(vCanceled);

    // Replaying the ORIGINAL registration key must replay the create receipt
    // and never reactivate the now-canceled driver.
    const replay = await addDriver(pool, tripId, regKey, { name: "Lee", zoneId: "north", seatCapacity: 3 });
    expect(replay.replayed).toBe(true);
    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.drivers[0].active).toBe(false);
    expect(snap!.version).toBe(vCanceled);
  });

  test("repeated passenger withdrawal is a no-op after the first", async () => {
    const tripId = await freshTrip();
    const r = await addRequest(pool, tripId, key(), { name: "Kim", zoneId: "north" });
    const reqId = (r.body as { id: string }).id;
    const v = (await getTripSnapshot(pool, tripId))!.version;
    const withdraw = await withdrawRequest(pool, tripId, reqId, key(), { baseVersion: v, active: false });
    expect(withdraw.httpStatus).toBe(200);
    const vAfter = (await getTripSnapshot(pool, tripId))!.version;
    expect(vAfter).toBe(v + 1);
    const repeat = await withdrawRequest(pool, tripId, reqId, key(), { baseVersion: vAfter, active: false });
    expect(repeat.httpStatus).toBe(200);
    expect((await getTripSnapshot(pool, tripId))!.version).toBe(vAfter);
  });
});

describe("C-12 cross-trip references and record caps", () => {
  test("cross-trip reference rejects; the 20-driver cap holds under concurrent attempts", async () => {
    const tripA = await freshTrip();
    const tripB = await freshTrip();
    const d = await addDriver(pool, tripA, key(), { name: "Ana", zoneId: "north", seatCapacity: 2 });
    const driverId = (d.body as { id: string }).id;

    const bVersion = (await getTripSnapshot(pool, tripB))!.version;
    const crossTrip = await editDriver(pool, tripB, driverId, key(), { baseVersion: bVersion, seatCapacity: 1 });
    expect(crossTrip.httpStatus).toBe(404);

    // Fill to the cap (A already has 1 driver), then two concurrent attempts at
    // the boundary must not both succeed.
    for (let i = 1; i < 19; i++) {
      const r = await addDriver(pool, tripA, key(), { name: `D${i}`, zoneId: "north", seatCapacity: 1 });
      expect(r.httpStatus).toBe(201);
    }
    // 19 drivers now; two concurrent adds compete for the 20th slot.
    const [x, y] = await Promise.all([
      addDriver(pool, tripA, key(), { name: "D19a", zoneId: "north", seatCapacity: 1 }),
      addDriver(pool, tripA, key(), { name: "D19b", zoneId: "north", seatCapacity: 1 }),
    ]);
    const statuses = [x.httpStatus, y.httpStatus].sort();
    expect(statuses).toEqual([201, 422]); // exactly one succeeds
    expect((await pool.query("SELECT count(*)::int AS c FROM drivers WHERE trip_id = $1", [tripA])).rows[0].c).toBe(20);
  });

  test("the passenger cap counts retained inactive records (50 lifetime records)", async () => {
    const tripId = await freshTrip();
    // Register 50 passengers; withdraw some so the roster mixes active and
    // inactive records. The cap is on lifetime records, so the 51st rejects
    // even though some are withdrawn.
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const r = await addRequest(pool, tripId, key(), { name: `P${i}`, zoneId: "north" });
      expect(r.httpStatus).toBe(201);
      ids.push((r.body as { id: string }).id);
    }
    // Withdraw five; they remain as inactive records.
    for (let i = 0; i < 5; i++) {
      const v = (await getTripSnapshot(pool, tripId))!.version;
      const w = await withdrawRequest(pool, tripId, ids[i], key(), { baseVersion: v, active: false });
      expect(w.httpStatus).toBe(200);
    }
    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.requests).toHaveLength(50); // inactive records retained
    expect(snap!.requests.filter((r) => !r.active)).toHaveLength(5);

    // The 51st registration rejects on the lifetime cap.
    const over = await addRequest(pool, tripId, key(), { name: "P50", zoneId: "north" });
    expect(over.httpStatus).toBe(422);
    expect((over.body as { error: { code: string } }).error.code).toBe("ROSTER_LIMIT");
  });
});

describe("C-17 terminal failure, durable receipt, and acknowledgement loss", () => {
  test("terminal failure after writes leaves prior state and a durable failure receipt", async () => {
    const tripId = await freshTrip();
    await addDriver(pool, tripId, key(), { name: "Base", zoneId: "north", seatCapacity: 2 });
    const before = await getTripSnapshot(pool, tripId);

    const failKey = key();
    const clear = __setFaultHook(async (point) => {
      if (point === "after-business-writes") {
        throw new TerminalBusinessError(500, "INTERNAL_ERROR", "Injected post-write failure.");
      }
    });
    try {
      const failed = await addDriver(pool, tripId, failKey, { name: "Ghost", zoneId: "north", seatCapacity: 1 });
      expect(failed.httpStatus).toBe(500);
    } finally {
      clear();
    }
    const after = await getTripSnapshot(pool, tripId);
    expect(after!.drivers).toHaveLength(before!.drivers.length);
    expect(after!.version).toBe(before!.version);

    // Durable failure receipt: a same-key retry replays the failure and never
    // applies, even though the input could now succeed.
    const retry = await addDriver(pool, tripId, failKey, { name: "Ghost", zoneId: "north", seatCapacity: 1 });
    expect(retry.replayed).toBe(true);
    expect(retry.httpStatus).toBe(500);
    expect((await getTripSnapshot(pool, tripId))!.drivers).toHaveLength(before!.drivers.length);
  });

  test("lost result AFTER a committed failure resolves by replay to the stored failure", async () => {
    // The failure receipt commits for real; the client then loses the delivered
    // result (fault AFTER commit). The row is durable, so a replay resolves to
    // the stored 422. Verify the receipt from a SEPARATE connection.
    const tripId = await freshTrip();
    const failKey = key();
    const other = createPool(APP, 1);
    try {
      const clear = __setFaultHook(async (point) => {
        if (point === "after-business-writes") {
          throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Injected terminal failure.");
        }
        if (point === "after-failure-commit") {
          // The failure receipt COMMIT already returned; simulate the client
          // losing that delivered result.
          throw new Error("client lost the delivered result after the failure COMMIT");
        }
      });
      let threw: unknown;
      try {
        await addDriver(pool, tripId, failKey, { name: "LostFail", zoneId: "north", seatCapacity: 1 });
      } catch (error) {
        threw = error;
      } finally {
        clear();
      }
      expect(threw).toBeInstanceOf(OutcomeUnknown);

      // The failure receipt is durable, observed from another connection.
      const row = await other.query(
        "SELECT outcome, http_status FROM mutation_receipts WHERE request_key = $1",
        [failKey],
      );
      expect(row.rows[0]).toMatchObject({ outcome: "not_applied", http_status: 422 });

      // Same-key replay resolves to the stored failure; nothing applied.
      const replay = await addDriver(pool, tripId, failKey, { name: "LostFail", zoneId: "north", seatCapacity: 1 });
      expect(replay.replayed).toBe(true);
      expect(replay.httpStatus).toBe(422);
      expect((await getTripSnapshot(pool, tripId))!.drivers).toHaveLength(0);
    } finally {
      await other.end();
    }
  });

  test("a REAL failed failure-receipt INSERT aborts the transaction (no receipt, recoverable)", async () => {
    // Cause the actual not_applied-receipt INSERT to fail with a genuine
    // duplicate-key (23505): just before the helper inserts, insert a row with
    // the SAME request_key on the helper's own transaction client. The helper's
    // INSERT then conflicts, the whole transaction rolls back, and no receipt
    // survives, so a same-key retry can execute.
    const tripId = await freshTrip();
    const failKey = key();
    const other = createPool(APP, 1);
    try {
      const clear = __setFaultHook(async (point, client) => {
        if (point === "after-business-writes") {
          throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Injected terminal failure.");
        }
        if (point === "before-failure-receipt-insert") {
          await client.query(
            `INSERT INTO mutation_receipts (request_key, request_fingerprint, outcome, http_status, response_json)
             VALUES ($1, 'injected-duplicate', 'applied', 200, '{}'::jsonb)`,
            [failKey],
          );
        }
      });
      let threw: unknown;
      try {
        await addDriver(pool, tripId, failKey, { name: "NoReceipt", zoneId: "north", seatCapacity: 1 });
      } catch (error) {
        threw = error;
      } finally {
        clear();
      }
      // A duplicate key at the receipt INSERT aborts the whole transaction, so
      // the injected row does NOT survive either: nothing is finalized. The
      // error must be the specific unique-violation (23505), not any Error.
      expect(threw).toBeInstanceOf(Error);
      expect((threw as { code?: string }).code).toBe("23505");
      const row = await other.query("SELECT 1 FROM mutation_receipts WHERE request_key = $1", [failKey]);
      expect(row.rowCount).toBe(0);

      // Same-key retry now executes normally (no fault), proving no finalization.
      const retry = await addDriver(pool, tripId, failKey, { name: "NoReceipt", zoneId: "north", seatCapacity: 1 });
      expect(retry.httpStatus).toBe(201);
      expect((await getTripSnapshot(pool, tripId))!.drivers).toHaveLength(1);
    } finally {
      await other.end();
    }
  });

  test("a retryable lock timeout inside business work does NOT finalize the key (ISSUE-014)", async () => {
    const tripId = await freshTrip();
    const busyKey = key();
    const other = createPool(APP, 1);
    try {
      const clear = __setFaultHook(async (point) => {
        if (point === "after-business-writes") {
          throw Object.assign(new Error("lock_not_available"), { code: "55P03" });
        }
      });
      let threw: unknown;
      try {
        await addDriver(pool, tripId, busyKey, { name: "Locked", zoneId: "north", seatCapacity: 1 });
      } catch (error) {
        threw = error;
      } finally {
        clear();
      }
      expect(threw).toBeInstanceOf(TransientFailure);
      // No terminal receipt was written, so the same key can still apply.
      const row = await other.query("SELECT 1 FROM mutation_receipts WHERE request_key = $1", [busyKey]);
      expect(row.rowCount).toBe(0);
      const retry = await addDriver(pool, tripId, busyKey, { name: "Locked", zoneId: "north", seatCapacity: 1 });
      expect(retry.httpStatus).toBe(201);
    } finally {
      await other.end();
    }
  });

  test("a REAL connection loss during business work is retryable, leaves no state or receipt, and retries once (ISSUE-014)", async () => {
    const tripId = await freshTrip();
    const lossKey = key();
    const other = createPool(APP, 1);
    try {
      const before = await getTripSnapshot(pool, tripId);
      const clear = __setFaultHook(async (point, client) => {
        if (point === "after-business-writes") {
          // Destroy the real backing socket mid-transaction, before COMMIT, so
          // the transaction cannot complete. This is a genuine transport error,
          // not a synthesized JS error.
          type WithStream = { connection?: { stream?: { destroy?: () => void } } };
          (client as unknown as WithStream).connection?.stream?.destroy?.();
          // Give the socket teardown a tick to surface on the next statement.
          await new Promise((r) => setImmediate(r));
        }
      });
      let threw: unknown;
      try {
        await addDriver(pool, tripId, lossKey, { name: "Dropped", zoneId: "north", seatCapacity: 1 });
      } catch (error) {
        threw = error;
      } finally {
        clear();
      }
      // The drop happens BEFORE COMMIT, so the transaction never committed:
      // this is a retryable transport failure, never a finalized terminal
      // failure and never an unknown-commit outcome (which only arises after a
      // COMMIT has been issued).
      expect(threw).toBeInstanceOf(TransientFailure);
      expect((threw as TransientFailure).code).toBe("DATABASE_UNAVAILABLE");

      // Observed from a separate connection: no driver added, no receipt.
      const after = await getTripSnapshot(pool, tripId);
      expect(after!.drivers).toHaveLength(before!.drivers.length);
      expect(after!.version).toBe(before!.version);
      const receipt = await other.query("SELECT 1 FROM mutation_receipts WHERE request_key = $1", [lossKey]);
      expect(receipt.rowCount).toBe(0);

      // Same-key retry applies exactly once.
      const retry = await addDriver(pool, tripId, lossKey, { name: "Dropped", zoneId: "north", seatCapacity: 1 });
      expect(retry.httpStatus).toBe(201);
      const final = await getTripSnapshot(pool, tripId);
      expect(final!.drivers).toHaveLength(before!.drivers.length + 1);
    } finally {
      await other.end();
    }
  });

  test("a REAL server-rejected COMMIT (deferred-constraint violation) leaves no business change or receipt (ISSUE-006)", async () => {
    // The app role lacks TEMPORARY, so the deferrable-FK fixture is created by
    // the SETUP role (the database owner) and the app is granted INSERT on it.
    // The app's fault hook inserts a row referencing a missing parent: the FK
    // is DEFERRABLE INITIALLY DEFERRED, so the INSERT succeeds but PostgreSQL
    // rejects the transaction AT COMMIT with SQLSTATE 23503. This proves the
    // COMMIT-phase rejection path, which a duplicate-key-at-INSERT test cannot.
    const tripId = await freshTrip();
    const rejectKey = key();
    const other = createPool(APP, 1);
    const setup = createPool(SETUP, 1);
    try {
      await setup.query("DROP TABLE IF EXISTS issue006_child, issue006_parent");
      await setup.query("CREATE TABLE issue006_parent (id int PRIMARY KEY)");
      await setup.query(
        `CREATE TABLE issue006_child (
           pid int REFERENCES issue006_parent(id) DEFERRABLE INITIALLY DEFERRED
         )`,
      );
      await setup.query("GRANT INSERT ON issue006_child TO groupride_app");

      const before = await getTripSnapshot(pool, tripId);
      const clear = __setFaultHook(async (point, client) => {
        if (point === "before-success-commit") {
          // Deferred FK: passes at INSERT, violates at COMMIT (parent is empty).
          await client.query("INSERT INTO issue006_child VALUES (999)");
        }
      });
      let threw: unknown;
      try {
        await addDriver(pool, tripId, rejectKey, { name: "Rejected", zoneId: "north", seatCapacity: 1 });
      } catch (error) {
        threw = error;
      } finally {
        clear();
      }

      // The server rejected the COMMIT: a definite, non-retryable rollback.
      expect(threw).toBeInstanceOf(CommitRejected);
      expect((threw as CommitRejected).code).toBe("23503");

      // Independent durable-state checks from a separate connection: neither the
      // business change nor a receipt survived.
      const after = await getTripSnapshot(pool, tripId);
      expect(after!.drivers).toHaveLength(before!.drivers.length);
      expect(after!.version).toBe(before!.version);
      const receipt = await other.query("SELECT 1 FROM mutation_receipts WHERE request_key = $1", [rejectKey]);
      expect(receipt.rowCount).toBe(0);
    } finally {
      await setup.query("DROP TABLE IF EXISTS issue006_child, issue006_parent").catch(() => {});
      await other.end();
      await setup.end();
    }
  });

  test("a second same-key request WAITS on the advisory key lock, then replays (ISSUE-019)", async () => {
    // Deterministic: request A pauses just before its success COMMIT while
    // holding the transaction-scoped advisory key lock. Request B, on a
    // separate connection with the SAME key, must block on that advisory lock.
    // We observe B waiting in pg_locks (granted = false) before releasing A,
    // then assert B replays A's applied receipt with no second effect.
    const tripId = await freshTrip();
    const sharedKey = key();
    const lockId = mutationLockId(sharedKey);
    const bPool = createPool(APP, 1);
    const observer = createPool(APP, 1);

    let releaseA: () => void = () => {};
    const aPaused = new Promise<void>((resolve) => { releaseA = resolve; });
    let aReached = false;
    const clear = __setFaultHook(async (point) => {
      if (point === "before-success-commit") {
        aReached = true;
        await aPaused; // hold the advisory key lock until B is observed waiting
      }
    });

    try {
      const aPromise = addDriver(pool, tripId, sharedKey, { name: "Winner", zoneId: "north", seatCapacity: 1 });

      // Wait until A is paused holding the key lock (bounded).
      await expect.poll(() => aReached, { interval: 10, timeout: 2000 }).toBe(true);

      // Start B with the same key; it must block acquiring the advisory lock.
      const bPromise = addDriver(bPool, tripId, sharedKey, { name: "Winner", zoneId: "north", seatCapacity: 1 });

      // Observe B's backend waiting on exactly this advisory lock (not granted).
      await expect.poll(async () => {
        const waiting = await observer.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_locks
             WHERE locktype = 'advisory' AND NOT granted
               AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
          [lockId],
        );
        return Number(waiting.rows[0].n);
      }, { interval: 10, timeout: 2000 }).toBeGreaterThan(0);

      releaseA();
      const [a, b] = await Promise.all([aPromise, bPromise]);

      // A executed and applied once; B waited then replayed the same receipt.
      expect(a.httpStatus).toBe(201);
      expect(a.replayed).toBe(false);
      expect(b.httpStatus).toBe(201);
      expect(b.replayed).toBe(true);
      expect((a.body as { id: string }).id).toBe((b.body as { id: string }).id);
      expect((await getTripSnapshot(pool, tripId))!.drivers).toHaveLength(1);
    } finally {
      releaseA();
      clear();
      await bPool.end();
      await observer.end();
    }
  });

  test("a same-key retry ALREADY WAITING while A finalizes a FAILURE replays the identical 422 (C-17)", async () => {
    // The exact C-17 interleaving: writer A takes a terminal failure and pauses
    // at before-failure-commit while holding the advisory key lock (its
    // not_applied receipt is written but not yet committed). Writer B, same key,
    // is observed WAITING on that advisory lock before A is released. B must
    // then replay A's identical 422, with the roster and version unchanged.
    const tripId = await freshTrip();
    const sharedKey = key();
    const lockId = mutationLockId(sharedKey);
    const before = await getTripSnapshot(pool, tripId);
    const bPool = createPool(APP, 1);
    const observer = createPool(APP, 1);

    let releaseA: () => void = () => {};
    const aPaused = new Promise<void>((resolve) => { releaseA = resolve; });
    let aReachedFailureCommit = false;
    const clear = __setFaultHook(async (point) => {
      if (point === "after-business-writes") {
        throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Injected terminal failure in A.");
      }
      if (point === "before-failure-commit") {
        // The not_applied receipt is inserted; the key lock is still held.
        aReachedFailureCommit = true;
        await aPaused;
      }
    });

    try {
      const aPromise = addDriver(pool, tripId, sharedKey, { name: "FailFirst", zoneId: "north", seatCapacity: 1 });
      await expect.poll(() => aReachedFailureCommit, { interval: 10, timeout: 2000 }).toBe(true);

      // B is launched and must block on A's advisory key lock while A is still
      // finalizing its failure.
      const bPromise = addDriver(bPool, tripId, sharedKey, { name: "FailFirst", zoneId: "north", seatCapacity: 1 });
      await expect.poll(async () => {
        const waiting = await observer.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_locks
             WHERE locktype = 'advisory' AND NOT granted
               AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
          [lockId],
        );
        return Number(waiting.rows[0].n);
      }, { interval: 10, timeout: 2000 }).toBeGreaterThan(0);

      // Release A: it commits the not_applied receipt and returns 422. B, which
      // was already waiting, then resolves by replaying the identical failure.
      releaseA();
      const [a, b] = await Promise.all([aPromise, bPromise]);

      expect(a.httpStatus).toBe(422);
      expect(a.replayed).toBe(false);
      expect(b.httpStatus).toBe(422);
      expect(b.replayed).toBe(true);
      // The replay contains every field of A's failure response, including its request ID.
      expect(b.body).toEqual(a.body);

      // Neither attempt applied anything: roster and version are unchanged.
      const after = await getTripSnapshot(pool, tripId);
      expect(after!.drivers).toHaveLength(before!.drivers.length);
      expect(after!.version).toBe(before!.version);
    } finally {
      releaseA();
      clear();
      await bPool.end();
      await observer.end();
    }
  });

  test("the trip row lock is held through failure finalization, blocking a concurrent writer (ISSUE-015)", async () => {
    const tripId = await freshTrip();
    const base = await addDriver(pool, tripId, key(), { name: "Base", zoneId: "north", seatCapacity: 2 });
    const driverId = (base.body as { id: string }).id;
    const version = (await getTripSnapshot(pool, tripId))!.version;

    // With a one-connection pool the edit uses the backend identified here.
    const editor = createPool(APP, 1);
    try {
      const backend = await editor.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const editorPid = backend.rows[0].pid;
      let startEdit!: () => void;
      const readyForEdit = new Promise<void>((resolve) => { startEdit = resolve; });

      const clear = __setFaultHook(async (point, client) => {
        if (point === "after-business-writes") {
          throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Injected failure in writer A.");
        }
        if (point === "before-failure-commit") {
          clear(); // Disarm the injection before starting writer B.
          startEdit();
          // A is past ROLLBACK TO SAVEPOINT. Keep its transaction open until
          // PostgreSQL identifies A as a blocker of B's same-trip edit.
          await expect.poll(async () => {
            const wait = await client.query<{ blocked: boolean }>(
              "SELECT pg_backend_pid() = ANY(pg_blocking_pids($1::int)) AS blocked",
              [editorPid],
            );
            return wait.rows[0].blocked;
          }, { interval: 10, timeout: 1500 }).toBe(true);
        }
      });

      const writerA = addDriver(pool, tripId, key(), { name: "Afail", zoneId: "north", seatCapacity: 1 });
      // If A exits before reaching the hook, fail B immediately as well.
      const writerB = Promise.race([
        readyForEdit,
        writerA.then(() => { throw new Error("Writer A finished before the edit was released."); }),
      ]).then(() => editDriver(editor, tripId, driverId, key(), { baseVersion: version, seatCapacity: 1 }));
      try {
        const [failed, edited] = await Promise.all([writerA, writerB]);
        expect(failed.httpStatus).toBe(422);
        expect(edited.httpStatus).toBe(200);
        const after = await getTripSnapshot(pool, tripId);
        expect(after?.version).toBe(version + 1);
        expect(after?.drivers).toEqual([expect.objectContaining({ id: driverId, seatCapacity: 1 })]);
      } finally {
        clear();
        await Promise.allSettled([writerA, writerB]);
      }
    } finally {
      await editor.end();
    }
  });
});

describe("C-17/C-09 through the HTTP route handlers", () => {
  test("POST and PATCH routes return the documented status, replay header, and metadata", async () => {
    process.env.DATABASE_URL = APP;
    process.env.GROUPRIDE_USE_TEST_DATABASE = "1";
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    const tripsRoute = await import("../../src/app/api/trips/route.ts");
    const driversRoute = await import("../../src/app/api/trips/[tripId]/drivers/route.ts");
    await __resetAppPoolForTests();

    try {
      const k = randomUUID();
      const cookie = await newWorkspaceCookie(pool!);
      const createReq = new Request("http://127.0.0.1/api/trips", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": k, cookie },
        body: JSON.stringify({ name: "HTTP Trip", destinationLabel: "Union", departAt: "2026-07-01T08:00:00+00:00" }),
      });
      const created = await tripsRoute.POST(createReq);
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as { id: string };

      // Replaying the create key sets the replay header.
      const replayReq = new Request("http://127.0.0.1/api/trips", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": k },
        body: JSON.stringify({ name: "HTTP Trip", destinationLabel: "Union", departAt: "2026-07-01T08:00:00+00:00" }),
      });
      const replayed = await tripsRoute.POST(replayReq);
      expect(replayed.headers.get("idempotency-replayed")).toBe("true");

      // A missing Idempotency-Key is INVALID_INPUT.
      const noKey = await driversRoute.POST(
        new Request("http://127.0.0.1/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "A", zoneId: "north", seatCapacity: 1 }),
        }),
        { params: Promise.resolve({ tripId: createdBody.id }) },
      );
      expect(noKey.status).toBe(400);

      // Register a driver, then exercise the PATCH driver route: a valid
      // capacity edit (200) and a stale-version edit (409 STALE_VERSION).
      const addedDriver = await driversRoute.POST(
        new Request("http://127.0.0.1/x", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
          body: JSON.stringify({ name: "Drv", zoneId: "north", seatCapacity: 2 }),
        }),
        { params: Promise.resolve({ tripId: createdBody.id }) },
      );
      expect(addedDriver.status).toBe(201);
      const driverBody = (await addedDriver.json()) as { id: string; mutationVersion: number };

      const patchRoute = await import("../../src/app/api/trips/[tripId]/drivers/[driverId]/route.ts");
      const okEdit = await patchRoute.PATCH(
        new Request("http://127.0.0.1/x", {
          method: "PATCH",
          headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
          body: JSON.stringify({ baseVersion: driverBody.mutationVersion, seatCapacity: 4 }),
        }),
        { params: Promise.resolve({ tripId: createdBody.id, driverId: driverBody.id }) },
      );
      expect(okEdit.status).toBe(200);

      const staleEdit = await patchRoute.PATCH(
        new Request("http://127.0.0.1/x", {
          method: "PATCH",
          headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
          body: JSON.stringify({ baseVersion: 0, seatCapacity: 5 }),
        }),
        { params: Promise.resolve({ tripId: createdBody.id, driverId: driverBody.id }) },
      );
      expect(staleEdit.status).toBe(409);
      expect(((await staleEdit.json()) as { error: { code: string } }).error.code).toBe("STALE_VERSION");
    } finally {
      await __resetAppPoolForTests();
      delete process.env.GROUPRIDE_USE_TEST_DATABASE;
    }
  });

  test("GET returns 503 when the read COMMIT acknowledgement is lost (ISSUE-016)", async () => {
    process.env.DATABASE_URL = APP;
    process.env.GROUPRIDE_USE_TEST_DATABASE = "1";
    const { __resetAppPoolForTests } = await import("../../src/db/pool.ts");
    const { __setTransactionCommitFaultHook } = await import("../../src/db/transaction.ts");
    const tripsRoute = await import("../../src/app/api/trips/route.ts");
    const getRoute = await import("../../src/app/api/trips/[tripId]/route.ts");
    await __resetAppPoolForTests();

    try {
      // Create a trip to read back.
      const cookie = await newWorkspaceCookie(pool!);
      const created = await tripsRoute.POST(
        new Request("http://127.0.0.1/api/trips", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": randomUUID(), cookie },
          body: JSON.stringify({ name: "ReadMe", destinationLabel: "Union", departAt: "2026-08-01T08:00:00+00:00" }),
        }),
      );
      const tripId = ((await created.json()) as { id: string }).id;

      // A normal GET succeeds first.
      const okGet = await getRoute.GET(new Request("http://127.0.0.1/x"), {
        params: Promise.resolve({ tripId }),
      });
      expect(okGet.status).toBe(200);

      // Now lose the read transaction's COMMIT: the read itself succeeds, but
      // the connection drops at COMMIT. For a READ-ONLY transaction this must
      // be a retryable 503, never a 500.
      const clearFault = __setTransactionCommitFaultHook(async (client) => {
        type WithStream = { connection?: { stream?: { destroy?: () => void } } };
        (client as unknown as WithStream).connection?.stream?.destroy?.();
        await new Promise((r) => setImmediate(r));
      });
      let lostGet: Response;
      try {
        lostGet = await getRoute.GET(new Request("http://127.0.0.1/x"), {
          params: Promise.resolve({ tripId }),
        });
      } finally {
        clearFault();
      }
      expect(lostGet.status).toBe(503);
      expect(((await lostGet.json()) as { error: { code: string } }).error.code).toBe("DATABASE_UNAVAILABLE");

      // A subsequent GET on a fresh connection succeeds again.
      const recovered = await getRoute.GET(new Request("http://127.0.0.1/x"), {
        params: Promise.resolve({ tripId }),
      });
      expect(recovered.status).toBe(200);
    } finally {
      __setTransactionCommitFaultHook(undefined);
      await __resetAppPoolForTests();
      delete process.env.GROUPRIDE_USE_TEST_DATABASE;
    }
  });
});
