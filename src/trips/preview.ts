// Preview publication (docs/ARCHITECTURE.md section 6 "Preview publication").
// Read a consistent snapshot at version v; reuse an existing immutable preview
// for (trip, v, algorithm) or compute outside locks, then lock the trip, recheck
// the version, and publish (or return the concurrently-published) immutable
// preview. Preview has no idempotency key; its natural cache key is the unique
// (trip_id, base_version, algorithm_version) constraint. Preview never changes
// the trip version or status.

import { performance } from "node:perf_hooks";
import type { Pool, PoolClient } from "pg";
import { StoredDataError, TerminalBusinessError, TransientFailure } from "../contracts/errors.ts";
import { recordPreview } from "./preview-telemetry.ts";
import { normalizeUuid } from "../contracts/index.ts";
import { classifyUnkeyedFailure } from "../db/classify.ts";
import { assertDataset } from "../db/dataset.ts";
import { datasetLock } from "../db/local-target.ts";
import { PreviewDeadline } from "../db/deadline.ts";
import { acquireRouting, observeVersion, retainForPublication, stale } from "./routing-permit.ts";
import { identicalCoordinates, legKey, requiredPairs, retentionPairs } from "../matching/address.ts";
import { withTransaction } from "../db/transaction.ts";
import { addressProvider } from "../locations/config.ts";
import {
  ALGORITHM_VERSION,
  type MatchingResult,
  type Roster,
  computeMatch,
  projectMatchInput,
} from "../matching/index.ts";
import type { AddressRoster } from "../matching/address.ts";
import type { ProviderName } from "../locations/snapshot.ts";
import type { Leg } from "../matching/address.ts";
import { AddressEvidenceError } from "../matching/address.ts";
import {
  RoutingResultError,
  RoutingUnavailable,
  routingAdapterFor,
  routingPolicyFor,
} from "../routing/index.ts";
import {
  addressAlgorithmId,
  parseSummary,
  validateCandidate,
  type EstimateSummary,
} from "./address-evidence.ts";
import { addressCounters } from "./address-metrics.ts";
import { toAddressRoster, tripProvider } from "./address-roster.ts";
import { assertResultMatchesRoster, pickResult, type RosterFacts } from "./preview-integrity.ts";
import { computeAddressPreview, type AddressPreviewComputation } from "./address-preview.ts";
import * as repo from "./repository.ts";

/**
 * The preview identifier a trip's mode expects. Zone trips keep the solver
 * identifier. Address trips add the evidence schema and the routing policy of
 * the provider the trip is pinned to by its venue, so a changed policy starts
 * a new preview history. Reading it is local: it needs no provider call.
 */
export function expectedAlgorithm(trip: repo.TripRow): string {
  if (trip.location_mode === "zone") return ALGORITHM_VERSION;
  return addressAlgorithmId(routingPolicyFor(tripProvider(trip)));
}

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
    /** Address previews only: costs are in `costUnit` and `estimate` describes how they were observed. */
    locationMode?: "address";
    costUnit?: "detour_seconds";
    estimate?: EstimateSummary;
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
      zoneId: d.zone_id as string,
      seatCapacity: d.seat_capacity,
      active: d.active,
    })),
    passengers: requests.map((r) => ({ id: r.id, zoneId: r.zone_id as string, active: r.active })),
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

/** What a stored row is checked against before it is served: the roster at its version, and the trip's routing. */
interface ResponseContext {
  facts: RosterFacts;
  /** Present for an address trip: its pinned provider and the CURRENT routing policy for it. */
  address?: { provider: ProviderName; policyId: string };
}

/**
 * Build the response for a stored or freshly published row. Nothing is echoed
 * raw: the results are copied field by field, must describe THIS trip's roster,
 * and an address row's summary must agree with its own row and the applicable
 * policy. Anything inconsistent is a server-side StoredDataError (HTTP 500).
 */
function toResponse(preview: repo.PreviewRow, context: ResponseContext): PreviewResponse {
  if (!validResult(preview.optimal_result) || !validResult(preview.greedy_result)) {
    // A corrupt cached preview is an invariant violation, not a servable 200.
    throw new StoredDataError("Stored preview result is malformed.");
  }
  assertResultMatchesRoster(preview.optimal_result, context.facts, "optimal");
  assertResultMatchesRoster(preview.greedy_result, context.facts, "greedy");
  const body: PreviewResponse["body"] = {
    previewId: preview.id,
    baseVersion: preview.base_version,
    algorithmVersion: preview.algorithm_version,
    optimal: pickResult(preview.optimal_result),
    greedy: pickResult(preview.greedy_result),
  };
  if ((preview.cost_unit === "detour_seconds") !== (context.address !== undefined)) {
    throw new StoredDataError("A stored preview's cost unit disagrees with its trip's mode.");
  }
  if (preview.cost_unit === "detour_seconds" && context.address) {
    if (preview.routing_policy !== context.address.policyId) {
      throw new StoredDataError("A stored preview's routing policy is not the applicable one.");
    }
    // A display read validates the public summary only; the private evidence is
    // never loaded here (it is checked on publication and at commit).
    body.locationMode = "address";
    body.costUnit = "detour_seconds";
    body.estimate = parseSummary(preview.summary, {
      routingPolicy: context.address.policyId,
      provider: context.address.provider,
      algorithmVersion: preview.algorithm_version,
    });
  }
  return { httpStatus: 200, body };
}


/** Earlier releases' evidence schemas, each with the algorithm identifier that release wrote. */
const LEGACY_ALGORITHMS = new Map<string, (policyId: string) => string>([
  ["address-evidence-1", (policyId) => `${ALGORITHM_VERSION}+address-evidence-1+${policyId}`],
]);

/**
 * Offer the most recent compatible earlier preview's legs for reuse. A candidate
 * that fails validation is DISCARDED WHOLE: counted once as an invariant
 * failure, none of its legs are reused, older rows are not tried, and the
 * attempt takes the ordinary cold path. Only a stored-evidence problem is
 * swallowed here; a database failure keeps its normal classification.
 */
async function readReuseCandidate(
  client: PoolClient,
  tripId: string,
  version: number,
  roster: AddressRoster,
  policyId: string,
): Promise<Map<string, Leg> | null | undefined> {
  const row = await repo.findReuseCandidate(client, tripId, policyId, version);
  if (!row) return undefined;
  // A GENUINE legacy row is simply not a candidate: not a failure, and not a reason to reach for
  // an older row. "Genuine" means the known legacy schema AND that release's own algorithm
  // revision together; a self-declared tag alone proves nothing, so a typo, an unknown future
  // revision, or an old label on a current row is corruption and is counted.
  const schema = (row.evidence as { schema?: unknown } | null)?.schema;
  const legacy = typeof schema === "string" ? LEGACY_ALGORITHMS.get(schema)?.(policyId) : undefined;
  if (legacy !== undefined && row.algorithmVersion === legacy) return undefined;
  try {
    return validateCandidate(row.evidence, roster, policyId);
  } catch (error) {
    if (!(error instanceof AddressEvidenceError)) throw error;
    addressCounters.reuseCandidateDiscarded += 1;
    // Counts and the preview ID only: never an address, coordinate or name.
    console.error(`Discarded a corrupt routing-evidence candidate (preview ${row.id}); rebuilding every leg.`);
    return null; // corrupt evidence requires a cold rebuild, including skipping in-flight handoff
  }
}

/**
 * Publish or reuse a preview for the trip's current version. Throws
 * TerminalBusinessError(404) for an unknown trip and (409 STALE_VERSION) when
 * the trip version changed between the read and the publication lock.
 */
export async function publishPreview(
  pool: Pool,
  tripIdRaw: string,
  deadline = new PreviewDeadline(),
): Promise<PreviewResponse> {
  try {
    return await deadline.wait(publishPreviewInner(pool, tripIdRaw, deadline));
  } catch (error) {
    throw classifyUnkeyedFailure(error);
  }
}

async function publishPreviewInner(
  pool: Pool,
  tripIdRaw: string,
  deadline: PreviewDeadline,
): Promise<PreviewResponse> {
  const tripId = normalizeUuid(tripIdRaw);

  // Step 1: consistent read snapshot at version v; reuse an existing preview.
  const snapshot = await withTransaction(pool, "read", async (client) => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    const trip = await repo.readTrip(client, tripId);
    if (!trip) throw new TerminalBusinessError(404, "NOT_FOUND", "Trip not found.");
    const algorithm = expectedAlgorithm(trip);
    const existing = await repo.findPreviewByKey(client, tripId, trip.version, algorithm);
    let roster: Roster | undefined;
    let addressRoster: AddressRoster | undefined;
    let provider: ReturnType<typeof tripProvider> | undefined;
    let candidate: Map<string, Leg> | null | undefined;
    let hit: ResponseContext | undefined;
    if (existing) {
      // A stored hit is judged against the roster at its version before it is served.
      hit = {
        facts: await repo.listParticipantFacts(client, tripId),
        address: trip.location_mode === "address"
          ? { provider: tripProvider(trip), policyId: routingPolicyFor(tripProvider(trip)) }
          : undefined,
      };
    } else {
      if (trip.location_mode === "address") {
        const [drivers, requests] = await Promise.all([
          repo.listDrivers(client, tripId),
          repo.listRequests(client, tripId),
        ]);
        addressRoster = toAddressRoster(trip, drivers, requests);
        provider = tripProvider(trip);
        candidate = await readReuseCandidate(client, tripId, trip.version, addressRoster, routingPolicyFor(provider));
      } else {
        roster = await readRoster(client, tripId);
      }
    }
    return { version: trip.version, algorithm, existing, hit, roster, addressRoster, provider, candidate };
  }, deadline);

  const { addressRoster, provider, version } = snapshot;
  const candidate = snapshot.candidate ?? new Map<string, Leg>();
  const livePolicy = provider === "geoapify" ? routingPolicyFor(provider) : undefined;
  const needsLive = livePolicy !== undefined && addressRoster && requiredPairs(addressRoster).some(
    ({ from, to }) => !identicalCoordinates(from, to) && !candidate.has(legKey(from.id, to.id)),
  );
  // A covered solve can publish now, even when its retention set includes
  // dormant legs from the old holder. Only upstream work requires a permit.
  const immediate = observeVersion(tripId, version, needsLive || snapshot.candidate === null ? undefined : livePolicy);
  if (snapshot.existing) {
    recordPreview({ cacheHit: true, matcherMs: null });
    return toResponse(snapshot.existing, snapshot.hit!);
  }

  const holder = needsLive ? await acquireRouting(tripId, version, livePolicy, deadline) : undefined;
  let releasePublication: (() => void) | undefined;
  try {
    if (holder) {
      // The first read may have preceded another holder's publication or a roster edit.
      const winner = await withTransaction(pool, "read", async (client) => {
        await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
        await assertDataset(client);
        const trip = await repo.readTrip(client, tripId);
        if (!trip) throw new TerminalBusinessError(404, "NOT_FOUND", "Trip not found.");
        if (trip.version !== version) throw stale(trip.version);
        const row = await repo.findPreviewByKey(client, tripId, version, snapshot.algorithm);
        if (row) return toResponse(row, {
          facts: await repo.listParticipantFacts(client, tripId),
          address: { provider: "geoapify", policyId: holder.policy },
        });
      }, deadline);
      if (winner) {
        recordPreview({ cacheHit: true, matcherMs: null });
        return winner;
      }
    }
    const settled = holder?.settled ?? immediate;
    if (settled?.size && addressRoster) {
      if (snapshot.candidate === null) {
        settled.clear(); // a corrupt reuse candidate requires a fully cold attempt
      } else {
        const retained = new Set(retentionPairs(addressRoster).map(({ from, to }) => legKey(from.id, to.id)));
        for (const [key, leg] of settled) {
          if (candidate.has(key) || !retained.has(key)) settled.delete(key);
          else candidate.set(key, leg);
        }
        if (immediate?.size && livePolicy) {
          releasePublication = retainForPublication(tripId, version, livePolicy, immediate);
        }
      }
    }
    const controller = holder?.controller;
    const routingSignal = controller ? AbortSignal.any([
      controller.signal, deadline.signal, AbortSignal.timeout(Math.max(1, deadline.remaining() - 100)),
    ]) : deadline.signal;
    controller?.signal.throwIfAborted();
    deadline.remaining();
    let matcherMs: number;
    let computation: { algorithmVersion: string; optimal: MatchingResult; greedy: MatchingResult };
    let addressResult: AddressPreviewComputation | undefined;
    if (snapshot.addressRoster) {
      const provider = snapshot.provider!;
      try {
        addressResult = await computeAddressPreview(
          snapshot.addressRoster,
          {
            provider,
            signal: routingSignal,
            settled: holder?.settled,
            policyId: routingPolicyFor(provider),
            // Built lazily: a rematch that needs no new observation never touches routing,
            // so it still publishes while routing is unavailable.
            adapter: () => {
              if (addressProvider() !== provider) {
                throw new RoutingUnavailable("This trip's address provider is not available, so new driving times cannot be fetched.");
              }
              return routingAdapterFor(provider);
            },
          },
          candidate,
        );
      } catch (error) {
        controller?.signal.throwIfAborted();
        if (routingSignal.aborted) throw new TransientFailure("ROUTING_UNAVAILABLE", "The driving-time request timed out.");
        // An outage or a malformed matrix is a retryable availability failure that publishes nothing.
        if (error instanceof RoutingUnavailable || error instanceof RoutingResultError) {
          const retry = error instanceof RoutingUnavailable ? error.retryAfterSeconds : undefined;
          throw new TransientFailure("ROUTING_UNAVAILABLE", error.message, error, retry);
        }
        throw error;
      }
      computation = addressResult;
      matcherMs = addressResult.matcherMs;
    } else {
      const start = performance.now();
      computation = computeMatch(projectMatchInput(snapshot.roster!));
      matcherMs = performance.now() - start;
    }
    controller?.signal.throwIfAborted();
    deadline.remaining();
    recordPreview({ cacheHit: false, matcherMs: Number(matcherMs.toFixed(3)) });
    if (computation.algorithmVersion !== snapshot.algorithm) {
      // The computed identifier and the key looked up under the lock must agree.
      throw new Error("Computed preview identifier does not match the trip's expected identifier.");
    }

    // Test-only barrier (C-13). Fires in the stale window AFTER the read snapshot
    // and compute, BEFORE the publication lock, so a test can commit a roster
    // mutation here and prove the version recheck below rejects and inserts no
    // stale row. Never set by production code.
    await deadline.wait(publishBarrier());
    controller?.signal.throwIfAborted();

    // Step 3-4: lock the trip, recheck the version, then publish or reuse.
    return await withTransaction(pool, "write", async (client) => {
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
      if (expectedAlgorithm(trip) !== snapshot.algorithm) {
        throw new TerminalBusinessError(409, "ALGORITHM_CHANGED", "The routing policy changed. Retry the preview.");
      }
      // Recheck the unique key: another request may have published concurrently.
      const concurrent = await repo.findPreviewByKey(client, tripId, trip.version, snapshot.algorithm);
      const preview = concurrent ?? (await repo.insertPreview(client, {
        tripId,
        baseVersion: trip.version,
        algorithmVersion: computation.algorithmVersion,
        optimalResult: computation.optimal,
        greedyResult: computation.greedy,
        address: addressResult && {
          routingPolicy: addressResult.evidence.policy,
          summary: addressResult.summary,
          evidence: addressResult.evidence,
        },
      }));
      // Whether inserted just now or published by a concurrent request, the row is checked the
      // same way before it is returned.
      return toResponse(preview, {
        facts: await repo.listParticipantFacts(client, tripId),
        address: snapshot.provider ? { provider: snapshot.provider, policyId: routingPolicyFor(snapshot.provider) } : undefined,
      });
    }, deadline);
  } finally {
    releasePublication?.();
    holder?.release();
  }
}
