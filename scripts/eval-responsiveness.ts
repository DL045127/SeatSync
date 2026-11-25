// P-01: application responsiveness (architecture section 8).
//
// Against a local PRODUCTION build after warmup: collect an idle baseline of the
// COMPETING client's workload (reads and alternating capacity edits on one
// trip), then re-run that SAME competing workload while another client drives
// maximum-size UNCACHED preview requests on a DIFFERENT trip. The gate is about
// the competing client: competing-request p95 <= 500 ms AND increase over idle
// p95 <= 250 ms, with no timeouts.
//
// The preview LOAD is the anchor (ISSUE-031): the run requires exactly
// PREVIEW_COUNT previews that each (a) return HTTP 200, (b) within the deadline
// including the response-body read, (c) carry a DISTINCT previewId, and (d) were
// freshly computed, not served from cache (verified from server telemetry:
// cacheHit=false). If fewer than PREVIEW_COUNT such previews complete, or any
// load preview fails / is a cache hit, the run FAILS. A capacity toggle bumps
// the preview trip's version before each preview so the cache cannot hide work.
//
// Server telemetry (ISSUE-034) records per-preview matcher duration and cache
// hits plus event-loop-delay percentiles via GET /api/eval/telemetry (test-DB
// gated). The artifact retains both clients' raw latency arrays and the server
// telemetry; reported numbers derive from the retained run. Every request has a
// hard deadline that also covers body consumption; a breach is a timeout and
// fails the gate; any non-2xx competing response is an error and fails the gate.
//
// P01_NEGATIVE_CONTROL=edits  -> competing workload hits a non-existent trip
//                                (every GET/PATCH 404): MUST fail.
// P01_NEGATIVE_CONTROL=preview -> preview load hits a non-existent trip
//                                (every preview 404): MUST fail.
// Controls write eval/p01-control.json and never overwrite the normal artifact.
//
// Requires a running Compose database, the designated reset test database, and a
// prior production build (`npm run build`). Writes eval/p01-responsiveness.json.

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { loadEnvFile } from "node:process";
import { createPool } from "../src/db/pool.ts";
import { appRole, assertLocalTarget, setupRole, testDatabase } from "../src/db/local-target.ts";
import { runSetup } from "../src/db/setup.ts";
import { addDriver, addRequest, createTrip } from "../src/trips/service.ts";

if (existsSync(".env")) loadEnvFile();
const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!setupUrl || !appUrl) {
  throw new Error("Configure TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL for the P-01 experiment.");
}
assertLocalTarget(appUrl, testDatabase, appRole);
assertLocalTarget(setupUrl, testDatabase, setupRole);
const SETUP = setupUrl;
const APP = appUrl;
const BASE = "http://127.0.0.1:3100";
const key = () => randomUUID();
const COMPETING_COUNT = 100; // competing GET/PATCH requests measured per phase
const PREVIEW_COUNT = 100; // REQUIRED successful, distinct, uncached previews under load
const DEADLINE_MS = 2000; // per-request hard deadline, covering body read

const addressLoad = process.argv.includes("--address");
if (addressLoad) {
  process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
  process.env.GROUPRIDE_USE_TEST_DATABASE = "1";
}

const control = process.env.P01_NEGATIVE_CONTROL ?? ""; // "", "edits", or "preview"

function gitCommit(): string {
  try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}
function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

interface Sample { ms: number; status: number; timedOut: boolean; kind: "GET" | "PATCH" | "PREVIEW"; body: Record<string, unknown>; startedAt: number }

/** A fetch with a hard deadline that also covers the response-body read. */
async function timed(kind: Sample["kind"], url: string, init?: RequestInit): Promise<Sample> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEADLINE_MS);
  const startedAt = performance.now();
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    // Body read is inside the deadline: a 200 whose body stalls is a timeout.
    const text = await r.text();
    let body: Record<string, unknown> = {};
    try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { body = {}; }
    return { ms: performance.now() - startedAt, status: r.status, timedOut: false, kind, body, startedAt };
  } catch (e) {
    // Always return a well-formed Sample with an empty body so callers that
    // read body fields never throw on a timeout/transport failure.
    const timedOut = (e as Error).name === "AbortError";
    return { ms: performance.now() - startedAt, status: timedOut ? 0 : -1, timedOut, kind, body: {}, startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function seed(): Promise<{ previewTrip: string; competeTrip: string; toggleDriver: string; competeDriver: string; previewDrivers: number; previewPassengers: number }> {
  await runSetup(SETUP, testDatabase, "migrate");
  await runSetup(SETUP, testDatabase, "reset");
  const pool = createPool(APP, 5);
  try {
    const zones = ["north", "south", "east", "west"];
    const mk = async (name: string, dest: string) => {
      const t = await createTrip(pool, key(), { name, destinationLabel: dest, departAt: "2026-03-01T09:30:00+02:00" });
      return (t.body as { id: string }).id;
    };
    const passengerTarget = control === "roster" ? 5 : 50;
    let previewTrip: string;
    let toggleDriver = "";
    if (addressLoad) {
      // Reuse the real fixture search, fresh token and registration paths. Each
      // participant owns a distinct confirmed location ID in the evidence.
      const { createAddressTrip, registerDriver, registerPassenger } = await import("../tests/concurrency/helpers/address.ts");
      previewTrip = await createAddressTrip(pool);
      for (let i = 0; i < 20; i++) {
        const id = await registerDriver(pool, previewTrip, `D${i}`, "Driver Start Delta", 8);
        if (i === 0) toggleDriver = id;
      }
      for (let i = 0; i < passengerTarget; i++) {
        await registerPassenger(pool, previewTrip, `P${i}`, "Pickup Alpha");
      }
    } else {
      previewTrip = await mk("P01 preview", "Student Union");
      for (let i = 0; i < 20; i++) {
        const r = await addDriver(pool, previewTrip, key(), { name: `D${i}`, zoneId: zones[i % 4], seatCapacity: 8 });
        // ISSUE-035: a rejected insert must abort seeding, not be silently ignored.
        if (r.httpStatus !== 201) throw new Error(`driver seed ${i} failed: ${r.httpStatus} ${JSON.stringify(r.body)}`);
        if (i === 0) toggleDriver = (r.body as { id: string }).id;
      }
      // The `roster` control seeds only 5 passengers so the persisted-roster
      // check (ISSUE-035) must fail even though the harness intended 50.
      for (let j = 0; j < passengerTarget; j++) {
        const r = await addRequest(pool, previewTrip, key(), { name: `P${j}`, zoneId: zones[j % 4] });
        if (r.httpStatus !== 201) throw new Error(`passenger seed ${j} failed: ${r.httpStatus} ${JSON.stringify(r.body)}`);
      }
    }
    const competeTrip = await mk("P01 compete", "Library");
    const cd = await addDriver(pool, competeTrip, key(), { name: "C", zoneId: "north", seatCapacity: 4 });
    if (cd.httpStatus !== 201) throw new Error(`compete driver seed failed: ${cd.httpStatus}`);
    const cp = await addRequest(pool, competeTrip, key(), { name: "CP", zoneId: "east" });
    if (cp.httpStatus !== 201) throw new Error(`compete passenger seed failed: ${cp.httpStatus}`);
    return { previewTrip, competeTrip, toggleDriver, competeDriver: (cd.body as { id: string }).id, previewDrivers: 20, previewPassengers: passengerTarget };
  } finally {
    await pool.end();
  }
}

/** Count the ACTIVE persisted roster of a trip, read directly from the database. */
async function persistedRoster(tripId: string): Promise<{ drivers: number; passengers: number }> {
  const s = createPool(SETUP, 1);
  try {
    const d = await s.query<{ n: string }>("SELECT count(*)::text AS n FROM drivers WHERE trip_id = $1 AND active", [tripId]);
    const p = await s.query<{ n: string }>("SELECT count(*)::text AS n FROM ride_requests WHERE trip_id = $1 AND active", [tripId]);
    return { drivers: Number(d.rows[0].n), passengers: Number(p.rows[0].n) };
  } finally {
    await s.end();
  }
}

async function waitForHealth(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Server did not become healthy in time.");
}

async function currentVersion(tripId: string): Promise<number | null> {
  const s = await timed("GET", `${BASE}/api/trips/${tripId}`);
  return s.status === 200 ? ((s.body as { version?: number }).version ?? null) : null;
}

function patchCapacity(tripId: string, driverId: string, baseVersion: number, seat: number): Promise<Sample> {
  return timed("PATCH", `${BASE}/api/trips/${tripId}/drivers/${driverId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "idempotency-key": key() },
    body: JSON.stringify({ baseVersion, seatCapacity: seat }),
  });
}

type Telemetry = { records: Array<{ cacheHit: boolean; matcherMs: number | null }>; eventLoopDelayMs: { p50: number; p95: number; max: number } | null };
const EMPTY_TELEMETRY: Telemetry = { records: [], eventLoopDelayMs: null };

async function telemetry(enable = false): Promise<Telemetry> {
  // Bounded read (ISSUE-036): the telemetry fetch gets its own deadline, and a
  // non-JSON response (e.g. a plain-text 503) resolves to EMPTY telemetry rather
  // than throwing — the gate already treats absent telemetry as a failure, so a
  // transient server error degrades to a clean gate failure instead of an
  // unhandled rejection that would leave the spawned server running.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), DEADLINE_MS);
  // Self-test (ISSUE-036): P01_FAULT=telemetry points the DRAIN read (enable=false)
  // at a non-JSON endpoint to simulate a plain-text 503. The harness must then
  // fail the gate cleanly (empty telemetry) and still release the port.
  const url = !enable && process.env.P01_FAULT === "telemetry"
    ? `${BASE}/`
    : `${BASE}/api/eval/telemetry${enable ? "?enable=1" : ""}`;
  try {
    const r = await fetch(url, { signal: ac.signal });
    const text = await r.text();
    if (!r.ok) return EMPTY_TELEMETRY;
    try { return JSON.parse(text) as Telemetry; } catch { return EMPTY_TELEMETRY; }
  } catch {
    return EMPTY_TELEMETRY;
  } finally {
    clearTimeout(t);
  }
}

/** The competing client's workload: COMPETING_COUNT iterations of GET then PATCH. */
async function competingWorkload(competeTrip: string, competeDriver: string): Promise<Sample[]> {
  const samples: Sample[] = [];
  let version = (await currentVersion(competeTrip)) ?? 0;
  let seat = 4;
  for (let i = 0; i < COMPETING_COUNT; i++) {
    samples.push(await timed("GET", `${BASE}/api/trips/${competeTrip}`));
    seat = seat === 4 ? 3 : 4;
    const patch = await patchCapacity(competeTrip, competeDriver, version, seat);
    samples.push(patch);
    if (patch.status === 200 && (patch.body as { mutationVersion?: number }).mutationVersion) {
      version = (patch.body as { mutationVersion: number }).mutationVersion;
    } else {
      version = (await currentVersion(competeTrip)) ?? version + 1;
    }
  }
  return samples;
}

/**
 * Drive previews until `required` SUCCESSFUL, DISTINCT, UNCACHED previews are
 * collected or `giveUp` fires. Returns every preview sample and the distinct
 * successful previewIds. Each preview is preceded by a capacity toggle to bump
 * the version (cache-bust); the toggle target is `previewTrip` so a control that
 * points previews at a bogus trip makes both the toggle and the preview fail.
 */
async function previewLoad(
  previewTrip: string,
  toggleTrip: string,
  toggleDriver: string,
  attempts: number,
  opts: { bustCache: boolean } = { bustCache: true },
): Promise<{ samples: Sample[]; distinctIds: Set<string> }> {
  const samples: Sample[] = [];
  const distinctIds = new Set<string>();
  let version = (await currentVersion(toggleTrip)) ?? 0;
  let seat = 8;
  // Exactly `attempts` preview requests (ISSUE-031): a fixed, explicit window.
  for (let i = 0; i < attempts; i++) {
    if (opts.bustCache) {
      // Bump the trip version so this preview is uncached. The DUPLICATE control
      // (bustCache=false) skips the bump, so the version repeats and the server
      // serves a cache hit — which the gate must reject.
      seat = seat === 8 ? 7 : 8;
      const patch = await patchCapacity(toggleTrip, toggleDriver, version, seat);
      if (patch.status === 200 && (patch.body as { mutationVersion?: number }).mutationVersion) {
        version = (patch.body as { mutationVersion: number }).mutationVersion;
      } else {
        version = (await currentVersion(toggleTrip)) ?? version + 1;
      }
    }
    const prev = await timed("PREVIEW", `${BASE}/api/trips/${previewTrip}/match/preview`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "",
    });
    samples.push(prev);
    const id = (prev.body as { previewId?: string }).previewId;
    if (prev.status === 200 && id) distinctIds.add(id);
  }
  return { samples, distinctIds };
}

function summarize(samples: Sample[]): Record<string, unknown> {
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300);
  const latencies = ok.map((s) => s.ms).sort((a, b) => a - b);
  return {
    total: samples.length,
    successful: ok.length,
    errors: samples.filter((s) => !(s.status >= 200 && s.status < 300) && !s.timedOut).length,
    timeouts: samples.filter((s) => s.timedOut).length,
    get: samples.filter((s) => s.kind === "GET").length,
    patch: samples.filter((s) => s.kind === "PATCH").length,
    medianMs: latencies.length ? Number(percentile(latencies, 50).toFixed(1)) : null,
    p95Ms: latencies.length ? Number(percentile(latencies, 95).toFixed(1)) : null,
    rawMs: latencies.map((n) => Number(n.toFixed(2))),
  };
}

async function main(): Promise<void> {
  const seeded = await seed();
  const competeTrip = control === "edits" ? randomUUID() : seeded.competeTrip;
  const competeDriver = control === "edits" ? randomUUID() : seeded.competeDriver;
  const previewTrip = control === "preview" ? randomUUID() : seeded.previewTrip;
  const bustCache = control !== "duplicate"; // the duplicate control reuses one version
  // A fault self-test (e.g. P01_FAULT=telemetry) is also a non-normal run: it
  // must NOT overwrite the passing artifact (ISSUE-037). Route it to the control
  // file with a descriptive label.
  const faultLabel = process.env.P01_FAULT ? `fault:${process.env.P01_FAULT}` : "";
  const isControlRun = Boolean(control) || Boolean(faultLabel);
  const runLabel = control || faultLabel || "none";
  if (control) console.log(`NEGATIVE CONTROL (${control}): expecting pass:false.`);
  else if (faultLabel) console.log(`FAULT SELF-TEST (${faultLabel}): expecting pass:false.`);

  // `detached: true` gives the server its OWN process group, so shutdown can
  // signal the whole group (the npm wrapper AND the `next start` child that
  // actually owns the socket), not just the wrapper (ISSUE-036).
  const server: ChildProcess = spawn("npm", ["run", "start", "--", "--port", "3100"], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, DATABASE_URL: APP, GROUPRIDE_USE_TEST_DATABASE: "1", PORT: "3100" },
  });
  try {
    await waitForHealth();
    await telemetry(true); // enable server telemetry + event-loop monitor

    // Warmup (not recorded).
    await previewLoad(seeded.previewTrip, seeded.previewTrip, seeded.toggleDriver, 3);
    await competingWorkload(seeded.competeTrip, seeded.competeDriver);
    // Clear any preview rows the warmup cached, so a measured toggle can never
    // land on a warmup-computed version and be served from cache.
    {
      const s = createPool(SETUP, 1);
      try { await s.query("DELETE FROM match_previews WHERE trip_id = $1", [seeded.previewTrip]); }
      finally { await s.end(); }
    }

    // ISSUE-035: verify the ACTUAL persisted roster of the preview trip before
    // timing. The experiment requires the maximum roster (20 drivers / 50
    // passengers); if seeding didn't persist that, the run fails rather than
    // reporting an assumed size. (Skipped for the `preview` control, whose
    // preview trip is intentionally a non-existent id.)
    const roster = control === "preview" ? { drivers: 0, passengers: 0 } : await persistedRoster(previewTrip);
    const rosterIsMax = roster.drivers === 20 && roster.passengers === 50;

    // Idle baseline: the competing workload alone (no preview load).
    const idleSamples = await competingWorkload(competeTrip, competeDriver);

    // ---- Measured window ----
    // Reset the server telemetry + event-loop histogram so they reflect ONLY
    // this window (not warmup/idle), then open the window.
    await fetch(`${BASE}/api/eval/telemetry?reset=1`);
    const windowStart = performance.now();
    // The preview load does EXACTLY PREVIEW_COUNT attempts and DEFINES the
    // window end: the instant it finishes we capture `windowEnd` and DRAIN the
    // server telemetry (so the event-loop histogram covers only the load window,
    // ISSUE-034). The competing workload runs concurrently; only competing
    // requests STARTED within [windowStart, windowEnd] count (ISSUE-031 — the
    // trailing batch that runs after the load finishes is excluded).
    let loadDone = false;
    let windowEnd = 0;
    let tele: Telemetry = EMPTY_TELEMETRY;
    let loadError: unknown;
    let load: Awaited<ReturnType<typeof previewLoad>> = { samples: [], distinctIds: new Set<string>() };
    // Attach the result/rejection handler IMMEDIATELY (ISSUE-036). If the
    // preview load (or its telemetry snapshot) fails while the harness is still
    // awaiting a competing batch, the error is captured here and the promise
    // still settles, so it can never surface as an unhandled rejection that
    // exits the process before the finally-cleanup kills the spawned server.
    const loadPromise = previewLoad(previewTrip, previewTrip, seeded.toggleDriver, PREVIEW_COUNT, { bustCache })
      .then(async (r) => {
        windowEnd = performance.now();
        tele = await telemetry(); // snapshot telemetry AT preview completion (bounded, never throws)
        load = r;
      })
      .catch((e: unknown) => { loadError = e; })
      .finally(() => { loadDone = true; });
    const busyChunks: Sample[] = [];
    while (!loadDone) {
      const chunk = await competingWorkload(competeTrip, competeDriver);
      busyChunks.push(...chunk);
      if (control === "edits") break; // a failing competing control need not loop
    }
    await loadPromise;
    if (loadError) throw loadError instanceof Error ? loadError : new Error(String(loadError));
    if (windowEnd === 0) windowEnd = performance.now();

    // Keep only competing samples that STARTED inside the measured window
    // (ISSUE-031: requests started after the preview load finished must not
    // count as "under load").
    const busySamples = busyChunks.filter((s) => s.startedAt >= windowStart && s.startedAt <= windowEnd);

    const idle = summarize(idleSamples);
    const busy = summarize(busySamples);
    const previewSummary = summarize(load.samples);
    const idleP95 = (idle.p95Ms as number) ?? Infinity;
    const busyP95 = (busy.p95Ms as number) ?? Infinity;
    const increaseP95 = busyP95 - idleP95;

    // Server telemetry for the measured window.
    const loadRecords = tele.records;
    const cacheHits = loadRecords.filter((r) => r.cacheHit).length;
    const computedCount = loadRecords.filter((r) => !r.cacheHit).length;
    const matcherMsValues = loadRecords.filter((r) => !r.cacheHit && r.matcherMs !== null).map((r) => r.matcherMs as number).sort((a, b) => a - b);
    const matcherMs = matcherMsValues.length
      ? { p50: Number(percentile(matcherMsValues, 50).toFixed(3)), p95: Number(percentile(matcherMsValues, 95).toFixed(3)), samples: matcherMsValues.length }
      : null;

    // Gate conditions. The competing client (idle AND under-load window) must
    // have samples, zero errors, zero timeouts, and every request successful.
    const competingHaveSamples = (idle.successful as number) > 0 && (busy.successful as number) > 0;
    const competingNoErrors = (idle.errors as number) === 0 && (busy.errors as number) === 0;
    const competingNoTimeouts = (idle.timeouts as number) === 0 && (busy.timeouts as number) === 0;
    const competingAllSucceeded = (idle.successful as number) === (idle.total as number)
      && (busy.successful as number) === (busy.total as number);
    // The preview LOAD must be EXACTLY PREVIEW_COUNT attempts, all 200 within
    // deadline, all distinct, with ZERO cache hits and exactly PREVIEW_COUNT
    // freshly-computed telemetry records.
    const previewExactAttempts = (previewSummary.total as number) === PREVIEW_COUNT;
    const previewAllDistinct = load.distinctIds.size === PREVIEW_COUNT;
    const previewNoFailures = (previewSummary.successful as number) === PREVIEW_COUNT
      && (previewSummary.errors as number) === 0 && (previewSummary.timeouts as number) === 0;
    const previewNoCacheHits = cacheHits === 0;
    const previewFullyComputed = computedCount === PREVIEW_COUNT;
    // Required telemetry (ISSUE-034): EVERY computed preview must carry a finite
    // matcher duration (not just "some matcher percentile exists"), and the
    // event-loop histogram must be present. Keeping one duration for 100
    // computes must NOT pass.
    const finiteMatcherCount = loadRecords.filter((r) => !r.cacheHit && typeof r.matcherMs === "number" && Number.isFinite(r.matcherMs)).length;
    const everyComputeTimed = computedCount > 0 && finiteMatcherCount === computedCount;
    const telemetryPresent = matcherMs !== null && tele.eventLoopDelayMs !== null && everyComputeTimed;
    const gatesMet = busyP95 <= 500 && increaseP95 <= 250;
    const addressSamples = addressLoad ? load.samples.map(({ body, ms }) => {
      const estimate = body.estimate as { provider?: string; legs?: { required: number; fetched: number; reused: number } } | undefined;
      const optimal = body.optimal as { matchedCount?: number; totalCost?: number } | undefined;
      return { ms, provider: estimate?.provider, legs: estimate?.legs, matched: optimal?.matchedCount, cost: optimal?.totalCost };
    }) : undefined;
    const addressVerified = !addressSamples || addressSamples.every((s, index) =>
      s.provider === "fixture" && s.matched === 50 && s.cost === 50 * 230 && s.legs?.required === 1070
      && s.legs.fetched === (index === 0 ? 1070 : 0) && s.legs.reused === (index === 0 ? 0 : 1070));
    const pass = addressVerified && competingHaveSamples && competingNoErrors && competingNoTimeouts && competingAllSucceeded
      && previewExactAttempts && previewAllDistinct && previewNoFailures && previewNoCacheHits
      && previewFullyComputed && telemetryPresent && rosterIsMax && gatesMet;

    const artifact = {
      experiment: addressLoad ? "L-17 address fixture responsiveness" : "P-01 application responsiveness",
      ...(addressSamples ? { addressSamples, addressVerified, sourceState: execSync("git status --short", { encoding: "utf8" }).trim() } : {}),
      measuredClient: "competing GET/PATCH on a separate trip (the gate client)",
      load: "concurrent uncached maximum-size previews on a separate trip (exactly PREVIEW_COUNT, all fresh)",
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      commit: gitCommit(),
      build: "production (next start)",
      deadlineMs: DEADLINE_MS,
      control: runLabel,
      measuredWindowMs: Number((windowEnd - windowStart).toFixed(1)),
      previewTrip: { persistedDrivers: roster.drivers, persistedPassengers: roster.passengers, rosterIsMax, requiredUncachedPreviews: PREVIEW_COUNT, attempts: previewSummary.total, distinctServed: load.distinctIds.size, cacheHits, computed: computedCount, finiteMatcherDurations: finiteMatcherCount },
      competeTrip: { workloadPerPhase: `${COMPETING_COUNT} iterations of GET then PATCH`, underLoadSamplesInWindow: busySamples.length, competingStartedTotal: busyChunks.length, competingAfterWindow: busyChunks.length - busySamples.length },
      generatedAt: new Date().toISOString(),
      idle,
      competing: busy,
      previewLoad: previewSummary,
      increaseOverIdleP95Ms: Number.isFinite(increaseP95) ? Number(increaseP95.toFixed(1)) : null,
      serverTelemetry: {
        previewRecords: loadRecords.length,
        cacheHits,
        computed: computedCount,
        matcherMs,
        eventLoopDelayMs: tele.eventLoopDelayMs,
      },
      gates: { competingP95MaxMs: 500, increaseOverIdleP95MaxMs: 250 },
      checks: {
        competingHaveSamples, competingNoErrors, competingNoTimeouts, competingAllSucceeded,
        previewExactAttempts, previewAllDistinct, previewNoFailures, previewNoCacheHits,
        previewFullyComputed, everyComputeTimed, telemetryPresent, rosterIsMax, gatesMet,
      },
      pass,
    };

    mkdirSync("eval", { recursive: true });
    const experiment = addressLoad ? "l17" : "p01";
    const outFile = `eval/${experiment}-${isControlRun ? "control" : "responsiveness"}.json`;
    writeFileSync(outFile, JSON.stringify(artifact, null, 2) + "\n");
    console.log(JSON.stringify({
      experiment: artifact.experiment,
      control: artifact.control,
      competingP95Ms: busy.p95Ms,
      increaseOverIdleP95Ms: artifact.increaseOverIdleP95Ms,
      roster: `${roster.drivers}d/${roster.passengers}p`,
      underLoadSamplesInWindow: busySamples.length,
      competingAfterWindow: busyChunks.length - busySamples.length,
      previewAttempts: previewSummary.total,
      previewDistinct: `${load.distinctIds.size}/${PREVIEW_COUNT}`,
      cacheHits,
      computed: computedCount,
      finiteMatcherDurations: finiteMatcherCount,
      matcherP95Ms: matcherMs ? matcherMs.p95 : null,
      eventLoopDelayP95Ms: tele.eventLoopDelayMs?.p95 ?? null,
      pass,
    }, null, 2));
    if (!pass) { console.error("\nP-01 FAILED. checks:", JSON.stringify(artifact.checks)); process.exitCode = 1; }
    else console.log(`\nP-01 passed: ${PREVIEW_COUNT} distinct uncached previews served while the competing client met its deadline and p95 gates; artifact at ${outFile}.`);
  } finally {
    await shutdownServer(server);
  }
}

/** Is port 3100 free? Free means a TCP connect is REFUSED (ISSUE-036) — a
 * connection that is accepted (even if HTTP later stalls) means a live
 * listener. A connect timeout is treated as "not confirmed free". */
function portRefused(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const done = (refused: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(refused);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(false)); // accepted → NOT free
    socket.once("timeout", () => done(false)); // accepted-but-stalled → NOT free
    socket.once("error", (err: NodeJS.ErrnoException) => done(err.code === "ECONNREFUSED"));
  });
}

/** Signal the server's whole process GROUP (npm wrapper + `next start` child). */
function killGroup(server: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (server.pid) process.kill(-server.pid, signal); // negative pid = the group
  } catch {
    try { server.kill(signal); } catch { /* already gone */ }
  }
}

/**
 * Stop the spawned server GROUP and VERIFY port 3100 is released by a refused
 * TCP connect (ISSUE-036). SIGINT the group first; on timeout, SIGKILL the
 * group; then poll a TCP probe until the port is actually refused.
 */
async function shutdownServer(server: ChildProcess): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve();
    server.once("exit", () => resolve());
  });
  killGroup(server, "SIGINT");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
  ]);
  if (!graceful) {
    killGroup(server, "SIGKILL");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
  }
  // Confirm the port is actually free via a TCP connect probe.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await portRefused(3100)) return; // connection refused: released
    await new Promise((r) => setTimeout(r, 150));
  }
  // Last resort: SIGKILL the group again, then re-probe. If the port is STILL
  // bound, cleanup failed — throw so the caller exits non-zero (ISSUE-036). A
  // warning alone let automation exit 0 with a stale listener still holding the
  // port.
  killGroup(server, "SIGKILL");
  if (await portRefused(3100)) return;
  throw new Error("Cleanup failed: port 3100 still accepts connections after shutdown; a stale server process remains.");
}

main().catch((e: unknown) => {
  // Cleanup already ran in main's finally; report and exit non-zero.
  console.error("\nP-01 harness error:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
