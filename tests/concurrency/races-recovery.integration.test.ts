// W4 — races and failure recovery. Controlled, deterministic interleavings
// against real PostgreSQL with separate clients: C-01 (double-commit guard,
// with a controlled sensitivity mutant), C-05 (savepoint rollback preserves the
// prior plan/version/receipt), C-06 (a second connection makes progress while a
// trip row lock is held), C-08 (a consistent dashboard read is wholly before or
// after a cancellation, never a mixture), C-13 (publication version recheck
// refuses a stale preview and writes no row), C-15 (concurrent previews at one
// version converge on one stored preview and do not bump the trip version), and
// C-16 (a lost COMMIT acknowledgement around a mutation replays to one effect
// and the pool stays usable). Interleavings are forced with barriers,
// pg_locks/pg_blocking_pids and bounded watchdogs — never timing-only sleeps.
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
import {
  __setSnapshotBarrier,
  addDriver,
  addRequest,
  editDriver,
  getTripSnapshot,
} from "../../src/trips/service.ts";
import { createTripWithWorkspace as createTrip } from "./helpers/workspace.ts";
import { __setCommitPlanMidHook } from "../../src/trips/repository.ts";
import { __setPublishBarrier, publishPreview } from "../../src/trips/preview.ts";
import { __setCommitVersionGuardEnabled, commitPreview } from "../../src/trips/commit.ts";
import { __setFaultHook } from "../../src/trips/mutation.ts";
import { CommitRejected } from "../../src/db/transaction.ts";
import { OutcomeUnknown, TerminalBusinessError } from "../../src/contracts/errors.ts";

if (existsSync(".env")) loadEnvFile();
const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!setupUrl || !appUrl) {
  throw new Error("Configure TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL for the races suite.");
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
  __setFaultHook(() => Promise.resolve()); // clear any leftover hook
  __setCommitVersionGuardEnabled(true); // restore the guard after the mutant
  __setCommitPlanMidHook(undefined);
  __setSnapshotBarrier(() => Promise.resolve());
  await pool?.end();
});

async function freshTrip(): Promise<string> {
  const res = await createTrip(pool, key(), {
    name: "W4 Trip",
    destinationLabel: "Student Union",
    departAt: "2026-03-01T09:30:00+02:00",
  });
  expect(res.httpStatus).toBe(201);
  return (res.body as { id: string }).id;
}

/** Seed one North driver (2 seats) and one East passenger → 1 match at cost 7. */
async function seedMatchable(tripId: string): Promise<void> {
  const d = await addDriver(pool, tripId, key(), { name: "D", zoneId: "north", seatCapacity: 2 });
  expect(d.httpStatus).toBe(201);
  const p = await addRequest(pool, tripId, key(), { name: "P", zoneId: "east" });
  expect(p.httpStatus).toBe(201);
}

/**
 * Run two distinct-key commits of ONE preview that genuinely CONTEND for the
 * trip row (ISSUE-026): commit A pauses at before-success-commit holding the
 * trip row lock; commit B, on a separate connection, is launched and observed
 * BLOCKED by A's backend (pg_blocking_pids) before A is released. Returns both
 * HTTP results and the final version. The same scenario drives the guard-on and
 * guard-off assertions, so the mutant is detected under real contention rather
 * than by a separate sequential path.
 */
async function contendTwoCommits(
  tripId: string,
  previewId: string,
): Promise<{ aStatus: number; bStatus: number; finalVersion: number }> {
  const bPool = createPool(APP, 1);
  const observer = createPool(APP, 1);
  let releaseA: () => void = () => {};
  const aPaused = new Promise<void>((resolve) => { releaseA = resolve; });
  let aHoldsLock = false;
  let armed = true;
  // Capture B's backend pid so we can confirm A is blocking exactly B.
  const bc = await bPool.connect();
  const bPid = (await bc.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  bc.release();

  const clear = __setFaultHook(async (point) => {
    if (point === "before-success-commit" && armed) {
      armed = false; // pause only commit A, not commit B
      aHoldsLock = true;
      await aPaused;
    }
  });
  try {
    const aPromise = commitPreview(pool, tripId, key(), { previewId });
    await expect.poll(() => aHoldsLock, { interval: 10, timeout: 3000 }).toBe(true);

    // B starts and must block on A's trip row lock. Confirm A is a blocker of B.
    const bPromise = commitPreview(bPool, tripId, key(), { previewId });
    await expect.poll(async () => {
      const r = await observer.query<{ blocked: boolean }>(
        "SELECT count(*) > 0 AS blocked FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
        [bPid],
      );
      return r.rows[0].blocked;
    }, { interval: 10, timeout: 3000 }).toBe(true);

    releaseA();
    const [a, b] = await Promise.all([aPromise, bPromise]);
    const snap = await getTripSnapshot(pool, tripId);
    return { aStatus: a.httpStatus, bStatus: b.httpStatus, finalVersion: snap!.version };
  } finally {
    releaseA();
    clear();
    await bPool.end();
    await observer.end();
  }
}

describe("C-01 competing commits at one input version", () => {
  test("under real contention one commit applies and the other gets 409 STALE_VERSION", async () => {
    const tripId = await freshTrip();
    await seedMatchable(tripId);
    const preview = await publishPreview(pool, tripId);
    const baseVersion = preview.body.baseVersion;

    const { aStatus, bStatus, finalVersion } = await contendTwoCommits(tripId, preview.body.previewId);

    // Exactly one success and one stale-version conflict, regardless of which
    // contender won the row lock race.
    const statuses = [aStatus, bStatus].sort();
    expect(statuses).toEqual([200, 409]);
    // Exactly one effective commit: the version advanced by one, one plan.
    expect(finalVersion).toBe(baseVersion + 1);
    const snap = await getTripSnapshot(pool, tripId);
    expect(snap!.assignments).toHaveLength(1);
    expect(snap!.status).toBe("assigned");
  });

  test("MUTANT: with the version guard removed the SAME contended scenario double-commits; restored it rejects", async () => {
    const tripId = await freshTrip();
    await seedMatchable(tripId);
    const preview = await publishPreview(pool, tripId);
    const baseVersion = preview.body.baseVersion;

    // Guard OFF: the loser's version recheck is skipped, so BOTH contending
    // commits apply. The acceptance assertion (exactly one 200 / one 409) now
    // fails and the double commitment is observable as version +2.
    __setCommitVersionGuardEnabled(false);
    const mutant = await contendTwoCommits(tripId, preview.body.previewId);
    expect([mutant.aStatus, mutant.bStatus].sort()).toEqual([200, 200]);
    expect(mutant.finalVersion).toBe(baseVersion + 2);

    // Guard restored: a fresh preview at the current version, run through the
    // identical contended path, yields one 200 and one 409.
    __setCommitVersionGuardEnabled(true);
    const preview2 = await publishPreview(pool, tripId);
    const v2 = preview2.body.baseVersion;
    const restored = await contendTwoCommits(tripId, preview2.body.previewId);
    expect([restored.aStatus, restored.bStatus].sort()).toEqual([200, 409]);
    expect(restored.finalVersion).toBe(v2 + 1);
  });
});

describe("C-05 savepoint rollback during plan replacement preserves the prior plan and receipts", () => {
  test("a terminal failure BETWEEN assignment DELETE and INSERT rolls back to the prior plan; both receipts persist", async () => {
    const tripId = await freshTrip();
    await seedMatchable(tripId);
    const preview = await publishPreview(pool, tripId);

    // Commit once with a known key so a durable SUCCESS receipt and a stored
    // plan exist to be preserved.
    const firstKey = key();
    const first = await commitPreview(pool, tripId, firstKey, { previewId: preview.body.previewId });
    expect(first.httpStatus).toBe(200);
    const afterFirst = await getTripSnapshot(pool, tripId);
    const committedVersion = afterFirst!.version;
    expect(afterFirst!.assignments).toHaveLength(1);

    // A fresh preview at the new version, then a second commit that fails
    // precisely BETWEEN the assignment DELETE and the INSERT loop inside
    // commitPlan. The failure is a TerminalBusinessError, so it takes the
    // SAVEPOINT recovery path (ROLLBACK TO SAVEPOINT + a not_applied receipt),
    // NOT the whole-transaction rollback. If the savepoint did not restore the
    // deleted rows, the trip would be left with zero assignments.
    const preview2 = await publishPreview(pool, tripId);
    const failKey = key();
    __setCommitPlanMidHook(async () => {
      throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Injected failure after the plan delete, before insert.");
    });
    let failResult: Awaited<ReturnType<typeof commitPreview>>;
    try {
      failResult = await commitPreview(pool, tripId, failKey, { previewId: preview2.body.previewId });
    } finally {
      __setCommitPlanMidHook(undefined);
    }
    // The terminal failure finalized as a not_applied receipt (not thrown).
    expect(failResult.httpStatus).toBe(422);
    expect((failResult.body as { error: { code: string } }).error.code).toBe("ROSTER_LIMIT");

    // The prior plan survived the mid-replacement rollback: assignments, version,
    // plan version, and status are exactly as the first commit left them.
    const afterFail = await getTripSnapshot(pool, tripId);
    expect(afterFail!.version).toBe(committedVersion);
    expect(afterFail!.planVersion).toBe(committedVersion);
    expect(afterFail!.status).toBe("assigned");
    expect(afterFail!.assignments).toHaveLength(1);
    expect(afterFail!.assignments).toEqual(afterFirst!.assignments);

    // Both receipts are durable and distinct: the original applied receipt and
    // the new not_applied receipt. Read them directly from the test database.
    const reader = createPool(SETUP, 1);
    try {
      const rows = await reader.query<{ request_key: string; outcome: string; http_status: number }>(
        "SELECT request_key, outcome, http_status FROM mutation_receipts WHERE request_key = ANY($1::uuid[]) ORDER BY request_key",
        [[firstKey, failKey]],
      );
      const byKey = new Map(rows.rows.map((r) => [r.request_key, r]));
      expect(byKey.get(firstKey)).toMatchObject({ outcome: "applied", http_status: 200 });
      expect(byKey.get(failKey)).toMatchObject({ outcome: "not_applied", http_status: 422 });
    } finally {
      await reader.end();
    }

    // The original success receipt still replays under its key with no new effect.
    const replay = await commitPreview(pool, tripId, firstKey, { previewId: preview.body.previewId });
    expect(replay.replayed).toBe(true);
    expect(replay.httpStatus).toBe(200);
    expect((await getTripSnapshot(pool, tripId))!.version).toBe(committedVersion);
  });
});

describe("C-06 a second connection makes progress while a trip row lock is held", () => {
  test("trip B's writes finish while trip A's row lock is held by a paused mutation", async () => {
    const tripA = await freshTrip();
    const tripB = await freshTrip();

    const bPool = createPool(APP, 1);
    let releaseA: () => void = () => {};
    const aPaused = new Promise<void>((resolve) => { releaseA = resolve; });
    let aHoldsLock = false;

    // The fault hook is global, so pause ONLY the first mutation to reach the
    // success commit (writer A). Writer B, which starts after A is confirmed
    // paused, must not be caught by the barrier — it has to make progress. A
    // one-shot gate (disarm on first hit) guarantees that.
    let armed = true;
    const clear = __setFaultHook(async (point) => {
      if (point === "before-success-commit" && armed) {
        armed = false; // disarm so B is never paused by this hook
        aHoldsLock = true;
        await aPaused;
      }
    });

    try {
      const aPromise = addDriver(pool, tripA, key(), { name: "A", zoneId: "north", seatCapacity: 1 });
      await expect.poll(() => aHoldsLock, { interval: 10, timeout: 2000 }).toBe(true);

      // B makes progress and commits while A still holds trip A's lock.
      const b = await addDriver(bPool, tripB, key(), { name: "B", zoneId: "south", seatCapacity: 1 });
      expect(b.httpStatus).toBe(201);
      const bSnap = await getTripSnapshot(bPool, tripB);
      expect(bSnap!.drivers).toHaveLength(1);

      releaseA();
      const a = await aPromise;
      expect(a.httpStatus).toBe(201);
    } finally {
      releaseA();
      clear();
      await bPool.end();
    }
  });
});

describe("C-08 the actual dashboard read is wholly before or after a cancellation", () => {
  test("getTripSnapshot paused after its trip-row read returns a snapshot with no newly-canceled driver", async () => {
    const tripId = await freshTrip();
    const d = await addDriver(pool, tripId, key(), { name: "Keep", zoneId: "north", seatCapacity: 1 });
    expect(d.httpStatus).toBe(201);
    const cancelDriver = await addDriver(pool, tripId, key(), { name: "Cancel", zoneId: "south", seatCapacity: 1 });
    const cancelId = (cancelDriver.body as { id: string }).id;
    const before = await getTripSnapshot(pool, tripId);
    expect(before!.drivers).toHaveLength(2);
    const startVersion = before!.version;

    // Pause the ACTUAL getTripSnapshot read AFTER it has read the trip row but
    // BEFORE it reads the drivers/requests/assignments. Commit a cancellation
    // on another connection while it is paused, then let it continue. Whatever
    // its transaction isolation, the returned snapshot must be internally
    // consistent: it must NOT show the trip's old version together with the
    // newly-canceled driver. Under REPEATABLE READ it sees the whole
    // pre-cancellation world; a regression to READ COMMITTED would surface the
    // mixture and fail this assertion.
    const mutator = createPool(APP, 1);
    let paused = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const clear = __setSnapshotBarrier(async () => {
      if (paused) return; // one-shot
      paused = true;
      await gate;
    });
    try {
      const snapshotPromise = getTripSnapshot(pool, tripId);
      await expect.poll(() => paused, { interval: 10, timeout: 3000 }).toBe(true);

      const cancel = await editDriver(mutator, tripId, cancelId, key(), {
        baseVersion: startVersion,
        active: false,
      });
      expect(cancel.httpStatus).toBe(200);
      expect((await getTripSnapshot(mutator, tripId))!.version).toBe(startVersion + 1);

      release();
      const snapshot = await snapshotPromise;

      // Internal consistency: the snapshot's trip version and its driver set
      // agree. It reflects the pre-cancellation state wholly (version unchanged,
      // the second driver still active), never a mixture.
      expect(snapshot!.version).toBe(startVersion);
      expect(snapshot!.drivers).toHaveLength(2);
      expect(snapshot!.drivers.every((x) => x.active)).toBe(true);
      const cancelled = snapshot!.drivers.find((x) => x.id === cancelId);
      expect(cancelled?.active).toBe(true);
    } finally {
      release();
      clear();
      await mutator.end();
    }
  });
});

describe("C-13 publication version recheck refuses a stale preview", () => {
  test("a roster mutation DURING preview computation rejects publication and writes no stale row", async () => {
    const tripId = await freshTrip();
    await seedMatchable(tripId);
    const startVersion = (await getTripSnapshot(pool, tripId))!.version;

    const counter = createPool(SETUP, 1);
    // A second connection commits a roster change inside the stale window:
    // after the publish read its snapshot at startVersion and computed, but
    // before it takes the publication lock. The version recheck must then throw
    // STALE_VERSION and insert no preview row.
    const mutator = createPool(APP, 1);
    let mutated = false;
    const clear = __setPublishBarrier(async () => {
      if (mutated) return; // one-shot
      mutated = true;
      const add = await addDriver(mutator, tripId, key(), { name: "Late", zoneId: "north", seatCapacity: 1 });
      expect(add.httpStatus).toBe(201);
    });
    try {
      const before = Number(
        (await counter.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM match_previews WHERE trip_id = $1 AND base_version = $2",
          [tripId, startVersion],
        )).rows[0].n,
      );

      await expect(publishPreview(pool, tripId)).rejects.toMatchObject({ httpStatus: 409 });

      // No preview row was inserted for the now-stale start version.
      const after = Number(
        (await counter.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM match_previews WHERE trip_id = $1 AND base_version = $2",
          [tripId, startVersion],
        )).rows[0].n,
      );
      expect(after).toBe(before);
      expect(before).toBe(0);

      // The roster change did land (version advanced), and a retry publishes
      // cleanly at the new version.
      expect((await getTripSnapshot(pool, tripId))!.version).toBe(startVersion + 1);
      const retry = await publishPreview(pool, tripId);
      expect(retry.body.baseVersion).toBe(startVersion + 1);
    } finally {
      clear();
      await mutator.end();
      await counter.end();
    }
  });
});

describe("C-15 concurrent previews at one version converge on one stored preview", () => {
  test("two publishers that BOTH observe a cache miss converge on one stored row; both responses equal it", async () => {
    const tripId = await freshTrip();
    await seedMatchable(tripId);
    const versionBefore = (await getTripSnapshot(pool, tripId))!.version;

    const bPool = createPool(APP, 1);
    const counter = createPool(SETUP, 1);
    // A 2-party rendezvous in the publish stale window: each publisher, after
    // reading its snapshot (a cache MISS, since no row exists yet) and
    // computing, waits here until BOTH have arrived, then both race for the
    // publication lock. This guarantees neither found the other's row during
    // the read — the convergence is decided by the unique-key recheck under the
    // lock, not by one simply finishing first.
    let arrived = 0;
    let releaseBoth: () => void = () => {};
    const bothArrived = new Promise<void>((resolve) => { releaseBoth = resolve; });
    const clear = __setPublishBarrier(async () => {
      arrived += 1;
      if (arrived >= 2) releaseBoth();
      await bothArrived;
    });
    try {
      const [a, b] = await Promise.all([
        publishPreview(pool, tripId),
        publishPreview(bPool, tripId),
      ]);

      // Both callers converged on the same stored preview at the base version.
      expect(a.body.previewId).toBe(b.body.previewId);
      expect(a.body.baseVersion).toBe(versionBefore);
      expect(b.body.baseVersion).toBe(versionBefore);

      // Publication is not a mutation: the trip version is unchanged.
      expect((await getTripSnapshot(pool, tripId))!.version).toBe(versionBefore);

      // Exactly one row exists, and BOTH responses' optimal AND greedy results
      // equal the stored row — not just the id. A loser that returned its own
      // freshly-computed result instead of the stored one would fail here.
      const rows = await counter.query<{
        id: string;
        optimal_result: unknown;
        greedy_result: unknown;
      }>(
        "SELECT id, optimal_result, greedy_result FROM match_previews WHERE trip_id = $1 AND base_version = $2",
        [tripId, versionBefore],
      );
      expect(rows.rows).toHaveLength(1);
      const stored = rows.rows[0];
      expect(stored.id).toBe(a.body.previewId);
      for (const r of [a, b]) {
        expect(r.body.optimal).toEqual(stored.optimal_result);
        expect(r.body.greedy).toEqual(stored.greedy_result);
      }
    } finally {
      releaseBoth();
      clear();
      await bPool.end();
      await counter.end();
    }
  });
});

/** The backend PID the next statement on this pool runs on. */
async function backendPid(p: Pool): Promise<number> {
  const r = await p.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return r.rows[0].pid;
}

describe("C-16 an uncertain COMMIT discards the connection and resolves by same-key replay", () => {
  test("a transport failure AT the COMMIT call is unknown-outcome; the backend is replaced; replay applies once", async () => {
    const tripId = await freshTrip();
    // A single-connection pool so the discarded backend is observable: the next
    // request must run on a NEW backend pid if (and only if) the faulted client
    // was discarded rather than returned to the pool.
    const single = createPool(APP, 1);
    try {
      const pidBefore = await backendPid(single);
      const sharedKey = key();

      // Destroy the real backing socket at before-success-commit, so the very
      // next statement — the COMMIT in commitOrClassify — fails with a genuine
      // transport error (no SQLSTATE). That is an UNKNOWN commit outcome: the
      // server may or may not have committed, so the key stays open for replay.
      const clear = __setFaultHook(async (point, client) => {
        if (point === "before-success-commit") {
          type WithStream = { connection?: { stream?: { destroy?: () => void } } };
          (client as unknown as WithStream).connection?.stream?.destroy?.();
          await new Promise((r) => setImmediate(r));
        }
      });
      let threw: unknown;
      try {
        await addDriver(single, tripId, sharedKey, { name: "Once", zoneId: "north", seatCapacity: 1 });
      } catch (error) {
        threw = error;
      } finally {
        clear();
      }
      // The COMMIT outcome was genuinely unknown (not a fresh internal error,
      // not a terminal receipt).
      expect(threw).toBeInstanceOf(OutcomeUnknown);

      // The faulted client was discarded: the pool hands out a different backend.
      const pidAfter = await backendPid(single);
      expect(pidAfter).not.toBe(pidBefore);

      // Resolve the uncertain outcome by same-key replay on the (now healthy)
      // pool. Whether the lost COMMIT landed or not, exactly one driver exists
      // afterward and the replay reports a terminal 201.
      const replay = await addDriver(single, tripId, sharedKey, { name: "Once", zoneId: "north", seatCapacity: 1 });
      expect(replay.httpStatus).toBe(201);
      const snap = await getTripSnapshot(single, tripId);
      expect(snap!.drivers).toHaveLength(1);

      // The pool remains usable for an unrelated later request.
      const later = await addRequest(single, tripId, key(), { name: "Later", zoneId: "east" });
      expect(later.httpStatus).toBe(201);
      expect((await getTripSnapshot(single, tripId))!.requests).toHaveLength(1);
    } finally {
      await single.end();
    }
  });

  test("a lost DATABASE acknowledgement of a COMMIT that landed is OutcomeUnknown; the receipt already exists; replay returns it", async () => {
    const tripId = await freshTrip();
    const single = createPool(APP, 1);
    const reader = createPool(SETUP, 1);
    try {
      const pidBefore = await backendPid(single);
      const before = await getTripSnapshot(single, tripId);
      const sharedKey = key();

      // Lose the DATABASE acknowledgement of a COMMIT that actually landed,
      // exercising the helper's commit-classification path (not the later
      // application-response loss). At before-success-commit we wrap the
      // client's query so the helper's own `client.query("COMMIT")` runs the
      // REAL commit on the server (durably writing the driver and the applied
      // receipt), then rejects the returned promise with a transport error
      // (ECONNRESET) before the helper sees the result. The server committed;
      // the client cannot know that, so commitOrClassify must classify it as an
      // unknown outcome and the key resolves by replay.
      const clear = __setFaultHook(async (point, client) => {
        if (point !== "before-success-commit") return;
        type Queryable = { query: (...args: unknown[]) => Promise<unknown> };
        const q = client as unknown as Queryable;
        const realQuery = q.query.bind(q);
        q.query = async (...args: unknown[]) => {
          const sql = args[0];
          if (typeof sql === "string" && sql.trim().toUpperCase().startsWith("COMMIT")) {
            q.query = realQuery; // one-shot: only intercept this COMMIT
            await realQuery(...args); // let PostgreSQL durably commit
            const err = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
            throw err; // acknowledgement lost AFTER the server committed
          }
          return realQuery(...args);
        };
      });
      let threw: unknown;
      try {
        await addDriver(single, tripId, sharedKey, { name: "Durable", zoneId: "north", seatCapacity: 1 });
      } catch (error) {
        threw = error;
      } finally {
        clear();
      }
      // A lost acknowledgement with no server SQLSTATE is an unknown outcome.
      expect(threw).toBeInstanceOf(OutcomeUnknown);

      // The commit is DURABLE: the driver and an applied receipt both exist,
      // observed from independent connections, even before any retry.
      const applied = await getTripSnapshot(reader, tripId);
      expect(applied!.drivers).toHaveLength(before!.drivers.length + 1);
      const committedVersion = applied!.version;
      const receiptBefore = await reader.query<{ outcome: string; http_status: number }>(
        "SELECT outcome, http_status FROM mutation_receipts WHERE request_key = $1",
        [sharedKey],
      );
      expect(receiptBefore.rows).toHaveLength(1);
      expect(receiptBefore.rows[0]).toMatchObject({ outcome: "applied", http_status: 201 });

      // The faulted connection was discarded and replaced.
      expect(await backendPid(single)).not.toBe(pidBefore);

      // The durably-committed driver's identity, read independently.
      const storedDriverId = applied!.drivers.find(
        (d) => !before!.drivers.some((b) => b.id === d.id),
      )!.id;
      // The stored receipt body is exactly what the replay must return.
      const storedBody = (await reader.query<{ response_json: unknown }>(
        "SELECT response_json FROM mutation_receipts WHERE request_key = $1",
        [sharedKey],
      )).rows[0].response_json;

      // Same-key replay on the replacement connection returns the STORED receipt
      // (replayed === true) with the IDENTICAL response body, and no second
      // effect: the roster, the committed driver's id, and the trip version are
      // unchanged from the durable commit.
      const replay = await addDriver(single, tripId, sharedKey, { name: "Durable", zoneId: "north", seatCapacity: 1 });
      expect(replay.replayed).toBe(true);
      expect(replay.httpStatus).toBe(201);
      expect(replay.body).toEqual(storedBody);
      expect((replay.body as { id: string }).id).toBe(storedDriverId);
      const after = await getTripSnapshot(single, tripId);
      expect(after!.drivers).toHaveLength(before!.drivers.length + 1);
      expect(after!.drivers.map((d) => d.id)).toContain(storedDriverId);
      expect(after!.version).toBe(committedVersion);
      // Exactly one receipt for the key; the replay did not insert a second.
      const receiptAfter = await reader.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM mutation_receipts WHERE request_key = $1",
        [sharedKey],
      );
      expect(Number(receiptAfter.rows[0].n)).toBe(1);
    } finally {
      await single.end();
      await reader.end();
    }
  });

  test("a server-confirmed COMMIT rollback (deferred constraint) discards the connection; no state, retry applies", async () => {
    const tripId = await freshTrip();
    const single = createPool(APP, 1);
    const setup = createPool(SETUP, 1);
    try {
      // Deferred-FK fixture: the INSERT passes but PostgreSQL rejects the
      // transaction AT COMMIT (SQLSTATE 23503), a definite, provable rollback.
      await setup.query("DROP TABLE IF EXISTS w4_c16_child, w4_c16_parent");
      await setup.query("CREATE TABLE w4_c16_parent (id int PRIMARY KEY)");
      await setup.query(
        "CREATE TABLE w4_c16_child (pid int REFERENCES w4_c16_parent(id) DEFERRABLE INITIALLY DEFERRED)",
      );
      await setup.query("GRANT INSERT ON w4_c16_child TO groupride_app");

      const pidBefore = await backendPid(single);
      const before = await getTripSnapshot(single, tripId);
      const rejectKey = key();
      const clear = __setFaultHook(async (point, client) => {
        if (point === "before-success-commit") {
          await client.query("INSERT INTO w4_c16_child VALUES (999)"); // violates at COMMIT
        }
      });
      let threw: unknown;
      try {
        await addDriver(single, tripId, rejectKey, { name: "Rejected", zoneId: "north", seatCapacity: 1 });
      } catch (error) {
        threw = error;
      } finally {
        clear();
      }
      // A server-confirmed rollback at COMMIT.
      expect(threw).toBeInstanceOf(CommitRejected);
      expect((threw as CommitRejected).code).toBe("23503");

      // The connection is discarded and replaced.
      expect(await backendPid(single)).not.toBe(pidBefore);

      // Nothing persisted (neither the business change nor a receipt), and a
      // same-key retry now applies cleanly on a healthy connection.
      const after = await getTripSnapshot(single, tripId);
      expect(after!.drivers).toHaveLength(before!.drivers.length);
      expect(after!.version).toBe(before!.version);
      const receipt = await setup.query("SELECT 1 FROM mutation_receipts WHERE request_key = $1", [rejectKey]);
      expect(receipt.rowCount).toBe(0);
      const retry = await addDriver(single, tripId, rejectKey, { name: "Rejected", zoneId: "north", seatCapacity: 1 });
      expect(retry.httpStatus).toBe(201);
      expect((await getTripSnapshot(single, tripId))!.drivers).toHaveLength(before!.drivers.length + 1);
    } finally {
      await setup.query("DROP TABLE IF EXISTS w4_c16_child, w4_c16_parent").catch(() => {});
      await single.end();
      await setup.end();
    }
  });
});
