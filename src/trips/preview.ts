// Preview publication (docs/ARCHITECTURE.md section 6 "Preview publication").
// Read a consistent snapshot at version v; reuse an existing immutable preview
// for (trip, v, algorithm) or compute outside locks, then lock the trip, recheck
// the version, and publish (or return the concurrently-published) immutable
// preview. Preview has no idempotency key; its natural cache key is the unique
// (trip_id, base_version, algorithm_version) constraint. Preview never changes
// the trip version or status.

import type { Pool, PoolClient } from "pg";
import { TerminalBusinessError, TransientFailure } from "../contracts/errors.ts";
import { normalizeUuid } from "../contracts/index.ts";
import {
  isRetryableQueryError,
  isTransportError,
} from "../db/commit-outcome.ts";
import { assertDataset, DatasetMismatch } from "../db/dataset.ts";
import { datasetLock } from "../db/local-target.ts";
import {
  CommitOutcomeUnknown,
  CommitRetryable,
  withTransaction,
} from "../db/transaction.ts";
import {
  ALGORITHM_VERSION,
  type MatchingResult,
  type Roster,
  computeMatch,
  projectMatchInput,
} from "../matching/index.ts";
import * as repo from "./repository.ts";

// Test-only barrier for the preview stale window (C-13). The W4 concurrency
// suite installs a one-shot hook that commits a roster mutation between the read
// snapshot and the publication lock, then clears it. Production never sets it.
let publishBarrier: () => Promise<void> = () => Promise.resolve();
export function __setPublishBarrier(hook: () => Promise<void>): () => void {
  publishBarrier = hook;
  return () => { publishBarrier = () => Promise.resolve(); };
}

export interface PreviewResponse {
  httpStatus: number;
  body: {
    previewId: string;
    baseVersion: number;
    algorithmVersion: string;
    optimal: MatchingResult;
    greedy: MatchingResult;
  };
}

/** Read the roster and costs needed to project a MatchInput, at one snapshot. */
async function readRoster(client: PoolClient, tripId: string): Promise<Roster> {
  const [drivers, requests, costs] = await Promise.all([
    repo.listDrivers(client, tripId),
    repo.listRequests(client, tripId),
    repo.listZoneCosts(client),
  ]);
  return {
    drivers: drivers.map((d) => ({
      id: d.id,
      zoneId: d.zone_id,
      seatCapacity: d.seat_capacity,
      active: d.active,
    })),
    passengers: requests.map((r) => ({ id: r.id, zoneId: r.zone_id, active: r.active })),
    zoneCosts: costs.map((c) => ({
      driverZoneId: c.driver_zone_id,
      passengerZoneId: c.passenger_zone_id,
      cost: c.cost,
    })),
  };
}

/**
 * Validate a stored/computed result shape, including each nested element,
 * before serving it (ISSUE-025). A cached row with, e.g., `assignments: [null]`
 * is corrupt and must not be served as 200.
 */
function nonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/**
 * Participant IDs in a stored result must be canonical lowercase UUIDs, the
 * same form the matching domain requires on input. Checking the canonical form
 * (not just "a string") before the uniqueness scan makes that scan correct:
 * two spellings of one UUID (e.g. upper- vs lowercase) can no longer slip
 * through `seen` as distinct passengers (ISSUE-025).
 */
const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function canonicalUuid(id: unknown): id is string {
  return typeof id === "string" && CANONICAL_UUID_RE.test(id);
}

/**
 * A valid assignment: canonical-UUID IDs and a cost that is an INTEGER within
 * the matching contract's [0, 10000] range. Fractional (0.5) or negative (-1)
 * costs are invalid even when a pair happens to sum to a plausible total
 * (ISSUE-025).
 */
function validAssignment(a: unknown): boolean {
  if (!a || typeof a !== "object") return false;
  const x = a as { passengerId?: unknown; driverId?: unknown; cost?: unknown };
  return (
    canonicalUuid(x.passengerId) &&
    canonicalUuid(x.driverId) &&
    typeof x.cost === "number" &&
    Number.isInteger(x.cost) &&
    x.cost >= 0 &&
    x.cost <= 10_000
  );
}

function validResult(value: unknown): value is MatchingResult {
  const r = value as MatchingResult;
  if (
    !r || typeof r !== "object" ||
    !Array.isArray(r.assignments) ||
    !r.assignments.every(validAssignment) ||
    !Array.isArray(r.unassignedPassengerIds) ||
    !r.unassignedPassengerIds.every(canonicalUuid) ||
    !nonNegInt(r.matchedCount) ||
    !nonNegInt(r.totalCost)
  ) {
    return false;
  }
  // Each passenger appears at most once across assignments AND the unassigned
  // list, and never in both (ISSUE-025: a passenger assigned twice is corrupt).
  const seen = new Set<string>();
  for (const a of r.assignments) {
    if (seen.has(a.passengerId)) return false;
    seen.add(a.passengerId);
  }
  for (const id of r.unassignedPassengerIds) {
    if (seen.has(id)) return false;
    seen.add(id);
  }
  // Aggregate invariants: matchedCount equals the assignment count, and
  // totalCost equals the summed assignment costs.
  if (r.matchedCount !== r.assignments.length) return false;
  const summed = r.assignments.reduce((s, a) => s + a.cost, 0);
  if (r.totalCost !== summed) return false;
  return true;
}

function toResponse(preview: repo.PreviewRow): PreviewResponse {
  if (!validResult(preview.optimal_result) || !validResult(preview.greedy_result)) {
    // A corrupt cached preview is an invariant violation, not a servable 200.
    throw new Error("Stored preview result is malformed.");
  }
  return {
    httpStatus: 200,
    body: {
      previewId: preview.id,
      baseVersion: preview.base_version,
      algorithmVersion: preview.algorithm_version,
      optimal: preview.optimal_result as MatchingResult,
      greedy: preview.greedy_result as MatchingResult,
    },
  };
}

/**
 * Classify a failure from the preview transactions. Transient database
 * conditions (lock/statement timeout, serialization, connection loss, a
 * retryable or unknown commit) become a retryable TransientFailure; a dataset
 * mismatch and a terminal business error pass through unchanged.
 */
function classifyPreviewFailure(error: unknown): unknown {
  if (error instanceof TerminalBusinessError) return error;
  if (error instanceof DatasetMismatch) return error;
  if (error instanceof TransientFailure) return error;
  if (error instanceof CommitRetryable) {
    return new TransientFailure("DATABASE_BUSY", "A serialization conflict occurred; retry.", error);
  }
  if (error instanceof CommitOutcomeUnknown) {
    return new TransientFailure("DATABASE_UNAVAILABLE", "The database is unavailable; retry.", error);
  }
  if (isTransportError(error) || isRetryableQueryError(error)) {
    return new TransientFailure("DATABASE_BUSY", "The database is busy; retry.", error);
  }
  return error;
}

/**
 * Publish or reuse a preview for the trip's current version. Throws
 * TerminalBusinessError(404) for an unknown trip and (409 STALE_VERSION) when
 * the trip version changed between the read and the publication lock.
 */
export async function publishPreview(
  pool: Pool,
  tripIdRaw: string,
): Promise<PreviewResponse> {
  try {
    return await publishPreviewInner(pool, tripIdRaw);
  } catch (error) {
    throw classifyPreviewFailure(error);
  }
}

async function publishPreviewInner(
  pool: Pool,
  tripIdRaw: string,
): Promise<PreviewResponse> {
  const tripId = normalizeUuid(tripIdRaw);

  // Step 1: consistent read snapshot at version v; reuse an existing preview.
  const snapshot = await withTransaction(pool, "read", async (client) => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    const trip = await repo.readTrip(client, tripId);
    if (!trip) throw new TerminalBusinessError(404, "NOT_FOUND", "Trip not found.");
    const existing = await repo.findPreviewByKey(client, tripId, trip.version, ALGORITHM_VERSION);
    const roster = existing ? undefined : await readRoster(client, tripId);
    return { version: trip.version, existing, roster };
  });

  if (snapshot.existing) return toResponse(snapshot.existing);

  // Step 2: compute optimal and greedy outside any lock; validated internally.
  const computation = computeMatch(projectMatchInput(snapshot.roster!));

  // Test-only barrier (C-13). Fires in the stale window AFTER the read snapshot
  // and compute, BEFORE the publication lock, so a test can commit a roster
  // mutation here and prove the version recheck below rejects and inserts no
  // stale row. Never set by production code.
  await publishBarrier();

  // Step 3-4: lock the trip, recheck the version, then publish or reuse.
  return withTransaction(pool, "write", async (client) => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    const trip = await repo.lockTrip(client, tripId);
    if (!trip) throw new TerminalBusinessError(404, "NOT_FOUND", "Trip not found.");
    if (trip.version !== snapshot.version) {
      // The input changed while computing; do not publish a stale result.
      throw new TerminalBusinessError(
        409,
        "STALE_VERSION",
        "The trip changed during preview computation; refresh and retry.",
        { currentVersion: trip.version },
      );
    }
    // Recheck the unique key: another request may have published concurrently.
    const concurrent = await repo.findPreviewByKey(client, tripId, trip.version, ALGORITHM_VERSION);
    const preview = concurrent ?? (await repo.insertPreview(client, {
      tripId,
      baseVersion: trip.version,
      algorithmVersion: computation.algorithmVersion,
      optimalResult: computation.optimal,
      greedyResult: computation.greedy,
    }));
    return toResponse(preview);
  });
}
