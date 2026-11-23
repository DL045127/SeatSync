// Matching commit (docs/ARCHITECTURE.md section 6 "Matching commit"). Commit a
// stored preview by id through the shared keyed-mutation helper. There is NO
// optimizer invocation here: the stored optimal result is re-validated for
// feasibility against the current roster, then copied. Optimality comes from the
// trusted server computation and an unchanged input version.

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { TerminalBusinessError } from "../contracts/errors.ts";
import { normalizeCommit, normalizeUuid } from "../contracts/index.ts";
import {
  ALGORITHM_VERSION,
  type MatchingResult,
  type Roster,
  assertFeasible,
  projectMatchInput,
} from "../matching/index.ts";
import { type AppliedResult, type MutationResponse, runKeyedMutation } from "./mutation.ts";
import * as repo from "./repository.ts";

// Test-only sensitivity mutant (C-01). When disabled, the stale-version guard
// below is skipped, letting two commits at one input version both apply. The
// W4 concurrency suite flips this on to prove C-01 detects the double
// commitment, then restores the guard and asserts the normal path passes. It is
// never toggled by production code; the symbol is prefixed `__` like the other
// test seams (`__setFaultHook`, `__setTransactionCommitFaultHook`).
let commitVersionGuardEnabled = true;
export function __setCommitVersionGuardEnabled(enabled: boolean): void {
  commitVersionGuardEnabled = enabled;
}

const requestId = () => randomUUID();

export function commitPreview(
  pool: Pool,
  tripIdRaw: string,
  requestKey: string,
  rawBody: unknown,
): Promise<MutationResponse> {
  const tripId = normalizeUuid(tripIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeCommit(rawBody);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/match/commit`,
      normalizedBody: body,
    },
    lockTrip: (client) => lockTripOr404(client, tripId),
    work: async ({ client, locked: trip }): Promise<AppliedResult> => {
      // Fetch the immutable preview belonging to this trip.
      const preview = await repo.findPreviewById(client, tripId, body.previewId);
      if (!preview) {
        throw new TerminalBusinessError(404, "NOT_FOUND", "Preview not found in this trip.");
      }
      // A superseded algorithm cannot commit (old success receipts still replay).
      if (preview.algorithm_version !== ALGORITHM_VERSION) {
        throw new TerminalBusinessError(
          409,
          "ALGORITHM_CHANGED",
          "This preview was produced by a superseded algorithm; create a new preview.",
        );
      }
      // The preview must describe the current input version.
      if (commitVersionGuardEnabled && preview.base_version !== trip.version) {
        throw new TerminalBusinessError(
          409,
          "STALE_VERSION",
          "The trip changed since this preview; review a new preview.",
          { currentVersion: trip.version },
        );
      }

      // Re-validate the stored optimal result against the CURRENT authoritative
      // roster/costs under the lock. Invalid stored JSON surfaces as an internal
      // error (no mutation), per C-14.
      const optimal = parseStoredResult(preview.optimal_result);
      const roster = await readRoster(client, tripId);
      const input = projectMatchInput(roster);
      assertFeasible(input, optimal); // throws on any infeasibility

      // Copy the stored optimal assignments atomically at version v+1.
      const committedVersion = trip.version + 1;
      await repo.commitPlan(client, {
        tripId,
        previewId: preview.id,
        algorithmVersion: ALGORITHM_VERSION,
        committedVersion,
        assignments: optimal.assignments.map((a) => ({
          requestId: a.passengerId,
          driverId: a.driverId,
          pickupCost: a.cost,
        })),
      });

      return {
        httpStatus: 200,
        body: {
          previewId: preview.id,
          mutationVersion: committedVersion,
          matchedCount: optimal.matchedCount,
          totalCost: optimal.totalCost,
          operation: { key, outcome: "applied" },
        },
      };
    },
    makeRequestId: requestId,
  });
}

async function lockTripOr404(client: Parameters<typeof repo.lockTrip>[0], tripId: string) {
  const trip = await repo.lockTrip(client, tripId);
  if (!trip) throw new TerminalBusinessError(404, "NOT_FOUND", "Trip not found.");
  return trip;
}

async function readRoster(
  client: Parameters<typeof repo.listDrivers>[0],
  tripId: string,
): Promise<Roster> {
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
 * Parse a stored preview result. Only the server ever wrote this JSON, but we
 * validate its shape at the service boundary; malformed JSON is an invariant
 * violation (internal error), never a silently accepted plan (C-14).
 */
function parseStoredResult(value: unknown): MatchingResult {
  if (
    !value || typeof value !== "object" ||
    !Array.isArray((value as MatchingResult).assignments) ||
    !Array.isArray((value as MatchingResult).unassignedPassengerIds) ||
    typeof (value as MatchingResult).matchedCount !== "number" ||
    typeof (value as MatchingResult).totalCost !== "number"
  ) {
    throw new Error("Stored preview result is malformed.");
  }
  return value as MatchingResult;
}
