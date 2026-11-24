// D-2: outside-lock computation versus long-lock preview generation
// (architecture section 8). Both variants persist the preview and use the SAME
// version-checked commit path; the experiment compares database coordination,
// not CPU speed (that is P-01).
//
//   Initial variant (production `publishPreview`): snapshot/release → compute →
//   lock/recheck/publish. With a controllable gate open after input
//   acquisition, a cancellation commits while computation is paused; on resume
//   publication must return 409 (no stale row).
//
//   Long-lock variant (harness): lock trip → read/compute/publish → release,
//   with the gate held WHILE the trip lock is held. A concurrent cancellation
//   must WAIT on the trip lock (observed via pg_blocking_pids). After release,
//   the published preview describes the pre-cancellation version, so it is
//   stale and the shared commit path must reject it.
//
// A bounded watchdog detects hangs; correctness is never decided by a sleep.
// Requires a running Compose database and the designated reset test database.
// Writes a raw artifact to eval/d2-concurrency.json.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import type { Pool, PoolClient } from "pg";
import { createPool } from "../src/db/pool.ts";
import { appRole, assertLocalTarget, datasetLock, setupRole, testDatabase } from "../src/db/local-target.ts";
import { runSetup } from "../src/db/setup.ts";
import { assertDataset } from "../src/db/dataset.ts";
import { withTransaction } from "../src/db/transaction.ts";
import { ALGORITHM_VERSION, computeMatch, projectMatchInput, type Roster } from "../src/matching/index.ts";
import * as repo from "../src/trips/repository.ts";
import { addDriver, addRequest, createTrip, editDriver, getTripSnapshot } from "../src/trips/service.ts";
import { __setPublishBarrier, publishPreview } from "../src/trips/preview.ts";
import { commitPreview } from "../src/trips/commit.ts";
import { randomUUID } from "node:crypto";

if (existsSync(".env")) loadEnvFile();
const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!setupUrl || !appUrl) {
  throw new Error("Configure TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL for the D-2 experiment.");
}
assertLocalTarget(appUrl, testDatabase, appRole);
assertLocalTarget(setupUrl, testDatabase, setupRole);
const SETUP = setupUrl;
const APP = appUrl;
const key = () => randomUUID();
const WATCHDOG_MS = 5000;

function gitCommit(): string {
  try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

function withWatchdog<T>(label: string, p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`watchdog: ${label} exceeded ${WATCHDOG_MS} ms`)), WATCHDOG_MS);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function readRoster(client: PoolClient, tripId: string): Promise<Roster> {
  const [drivers, requests, costs] = await Promise.all([
    repo.listDrivers(client, tripId),
    repo.listRequests(client, tripId),
    repo.listZoneCosts(client),
  ]);
  return {
    drivers: drivers.map((d) => ({ id: d.id, zoneId: d.zone_id, seatCapacity: d.seat_capacity, active: d.active })),
    passengers: requests.map((r) => ({ id: r.id, zoneId: r.zone_id, active: r.active })),
    zoneCosts: costs.map((c) => ({ driverZoneId: c.driver_zone_id, passengerZoneId: c.passenger_zone_id, cost: c.cost })),
  };
}

async function seedTrip(pool: Pool): Promise<string> {
  const t = await createTrip(pool, key(), {
    name: "D-2 Trip", destinationLabel: "Student Union", departAt: "2026-03-01T09:30:00+02:00",
  });
  const tripId = (t.body as { id: string }).id;
  await addDriver(pool, tripId, key(), { name: "Keep", zoneId: "north", seatCapacity: 2 });
  const cancelDriver = await addDriver(pool, tripId, key(), { name: "Cancel", zoneId: "south", seatCapacity: 1 });
  await addRequest(pool, tripId, key(), { name: "P", zoneId: "east" });
  return JSON.stringify({ tripId, cancelId: (cancelDriver.body as { id: string }).id });
}

async function countPreviews(setup: Pool, tripId: string, baseVersion: number): Promise<number> {
  const r = await setup.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM match_previews WHERE trip_id = $1 AND base_version = $2",
    [tripId, baseVersion],
  );
  return Number(r.rows[0].n);
}

/** The PIDs currently blocking `pid`, per PostgreSQL's own lock graph. */
async function blockingPids(observer: Pool, pid: number): Promise<number[]> {
  const r = await observer.query<{ blockers: number[] }>(
    "SELECT COALESCE(pg_blocking_pids($1::int), '{}') AS blockers",
    [pid],
  );
  return r.rows[0].blockers ?? [];
}

async function poll(fn: () => Promise<boolean>, timeoutMs = WATCHDOG_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

/** Initial variant: the production publish path, gate held between compute and the publication lock. */
async function runOutsideLock(setup: Pool): Promise<Record<string, unknown>> {
  // Reset BEFORE any app session exists (the reset guard refuses connected
  // app clients, ISSUE-018), then open a fresh pool for this variant.
  await runSetup(SETUP, testDatabase, "reset");
  const pool = createPool(APP, 5);
  const mutator = createPool(APP, 1);
  try {
    const { tripId, cancelId } = JSON.parse(await seedTrip(pool));
    const startVersion = (await getTripSnapshot(pool, tripId))!.version;

    let paused = false;
    let committedCancel = false;
    const clear = __setPublishBarrier(async () => {
      if (paused) return;
      paused = true;
      // Cancellation finishes while computation is paused outside the lock.
      const cancel = await editDriver(mutator, tripId, cancelId, key(), { baseVersion: startVersion, active: false });
      committedCancel = cancel.httpStatus === 200;
    });
    let status = 0;
    let errorCode = "";
    try {
      const res = await withWatchdog("outside-lock publish", publishPreview(pool, tripId));
      status = res.httpStatus;
    } catch (e) {
      const err = e as { httpStatus?: number; code?: string };
      status = err.httpStatus ?? 0;
      errorCode = err.code ?? (e as Error).name;
    } finally {
      clear();
    }
    const rowsAtStart = await countPreviews(setup, tripId, startVersion);
    return {
      variant: "outside-lock (initial, production)",
      cancellationCommittedDuringCompute: committedCancel,
      publishOutcome: status === 200 ? "published-200" : `rejected-${status}${errorCode ? `/${errorCode}` : ""}`,
      publishErrorCode: errorCode,
      staleRowsForStartVersion: rowsAtStart,
      conflicts: status === 409 ? 1 : 0,
      // Require the EXACT stale-version rejection, not any 409 (ISSUE-033): an
      // ALGORITHM_CHANGED 409 would be a different, non-equivalent outcome.
      invariantHeld: committedCancel && status === 409 && errorCode === "STALE_VERSION" && rowsAtStart === 0,
    };
  } finally {
    await pool.end();
    await mutator.end();
  }
}

/** Long-lock variant harness: lock the trip, then compute/publish while holding it. */
async function runLongLock(): Promise<Record<string, unknown>> {
  await runSetup(SETUP, testDatabase, "reset");
  const pool = createPool(APP, 5);
  const { tripId, cancelId } = JSON.parse(await seedTrip(pool));
  const startVersion = (await getTripSnapshot(pool, tripId))!.version;

  const holder = createPool(APP, 1);
  const mutator = createPool(APP, 1);
  const observer = createPool(APP, 1);
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  let lockHeld = false;
  let holderPid = 0;
  let previewId = "";

  // The long-lock publish: lock → (gate while holding the lock) → read/compute/publish.
  const publishPromise = withTransaction(holder, "write", async (client) => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    const trip = await repo.lockTrip(client, tripId);
    if (!trip) throw new Error("trip missing");
    // The backend that HOLDS the trip row lock, captured on the same client.
    holderPid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    lockHeld = true;
    await gate; // hold the trip row lock across the gate
    const roster = await readRoster(client, tripId);
    const computation = computeMatch(projectMatchInput(roster));
    const row = await repo.insertPreview(client, {
      tripId,
      baseVersion: trip.version, // the version observed UNDER the lock (startVersion)
      algorithmVersion: computation.algorithmVersion,
      optimalResult: computation.optimal,
      greedyResult: computation.greedy,
    });
    previewId = row.id;
    return row;
  });

  // A cancellation must WAIT on the trip row lock held by the publish backend.
  const mc = await mutator.connect();
  const mutatorPid = (await mc.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  mc.release();
  await withWatchdog("long-lock: wait for lock", poll(() => Promise.resolve(lockHeld)));
  const cancelPromise = editDriver(mutator, tripId, cancelId, key(), { baseVersion: startVersion, active: false });

  // Observe PostgreSQL's own lock graph: the cancellation backend must be
  // blocked SPECIFICALLY by the holder backend (not just any lock wait), and
  // record how long the wait lasted.
  let observedBlockers: number[] = [];
  const waitStart = Date.now();
  const blockedByHolder = await withWatchdog(
    "long-lock: observe cancel blocked by holder",
    poll(async () => {
      observedBlockers = await blockingPids(observer, mutatorPid);
      return observedBlockers.includes(holderPid);
    }),
  );
  // Time to merely DETECT the block (diagnostic only).
  const blockDetectMs = Date.now() - waitStart;

  // Release the gate: publication finishes, THEN the waiting cancellation
  // proceeds. The true BLOCKING INTERVAL is from the start of the wait until the
  // cancellation actually completes (acquires the lock and runs) — it spans the
  // whole time the holder kept the lock, not just until detection (ISSUE-033).
  releaseGate();
  await withWatchdog("long-lock publish", publishPromise);
  const cancel = await withWatchdog("long-lock cancel", cancelPromise);
  const blockingIntervalMs = Date.now() - waitStart;
  // The harness issues one blocking cancellation call; it waits on the lock
  // rather than retrying, so there are no client-side retries to record here.
  const cancelRetries = 0;

  const afterSnap = (await getTripSnapshot(pool, tripId))!;
  const afterVersion = afterSnap.version;
  const cancelledDriverActive = afterSnap.drivers.find((d) => d.id === cancelId)?.active;

  // The published preview was computed at startVersion; the cancellation then
  // bumped the version, so the preview is stale. The shared commit path must
  // reject it. Confirm the final durable state after the rejected commit.
  const commit = await commitPreview(pool, tripId, key(), { previewId });
  const finalSnap = (await getTripSnapshot(pool, tripId))!;

  await holder.end();
  await mutator.end();
  await observer.end();
  await pool.end();

  const staleCode = (commit.body as { error?: { code?: string } }).error?.code ?? "applied";
  return {
    variant: "long-lock (harness alternative)",
    holderPid,
    cancellationPid: mutatorPid,
    cancellationBlockedByHolder: blockedByHolder,
    observedBlockerPids: observedBlockers,
    blockDetectMs,
    blockingIntervalMs,
    cancellationOutcome: cancel.httpStatus,
    cancellationRetries: cancelRetries,
    cancelledDriverActiveAfter: cancelledDriverActive,
    publishedBaseVersion: startVersion,
    tripVersionAfterCancel: afterVersion,
    staleCommitOutcome: `${commit.httpStatus}/${staleCode}`,
    finalDurableState: {
      version: finalSnap.version,
      status: finalSnap.status,
      assignments: finalSnap.assignments.length,
    },
    conflicts: commit.httpStatus === 409 ? 1 : 0,
    invariantHeld:
      blockedByHolder &&
      cancel.httpStatus === 200 &&
      cancelledDriverActive === false &&
      afterVersion === startVersion + 1 &&
      commit.httpStatus === 409 &&
      staleCode === "STALE_VERSION" &&
      // The rejected commit left no plan: version unchanged, still needs_rematch.
      finalSnap.version === startVersion + 1 &&
      finalSnap.assignments.length === 0,
  };
}

async function main(): Promise<void> {
  await runSetup(SETUP, testDatabase, "migrate");
  const setup = createPool(SETUP, 1);
  try {
    const outsideLock = await runOutsideLock(setup);
    const longLock = await runLongLock();
    const pass = (outsideLock.invariantHeld as boolean) && (longLock.invariantHeld as boolean);
    const artifact = {
      experiment: "D-2 outside-lock versus long-lock preview generation",
      algorithm: ALGORITHM_VERSION,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      commit: gitCommit(),
      watchdogMs: WATCHDOG_MS,
      generatedAt: new Date().toISOString(),
      outsideLock,
      longLock,
      conclusion:
        "Both variants preserve invariants: the outside-lock publish rejects a stale result with 409 and writes no stale row; the long-lock publish blocks the concurrent writer, and its stale preview is rejected at commit. Keep short locks — writes progress during the gate and stale results are rejected. Fewer conflicts alone do not establish a better design; CPU responsiveness is measured separately by P-01.",
      pass,
    };
    mkdirSync("eval", { recursive: true });
    writeFileSync("eval/d2-concurrency.json", JSON.stringify(artifact, null, 2) + "\n");
    console.log(JSON.stringify({
      experiment: artifact.experiment,
      outsideLock: outsideLock.invariantHeld,
      longLock: longLock.invariantHeld,
      pass,
    }, null, 2));
    if (!pass) process.exitCode = 1;
    else console.log("\nD-2 passed: both variants preserve invariants; artifact at eval/d2-concurrency.json");
  } finally {
    await setup.end();
  }
}

main();
