// Compute an address preview from frozen durations (docs/ARCHITECTURE-v2.md
// sections 5 and 6): carry over the still-relevant observations of an earlier
// preview, resolve identical endpoints locally, fetch missing legs with a
// credit-bounded matrix plan, project edges, run the same exact and greedy
// matchers, and assemble the evidence and public summary.
//
// The routing adapter is touched only when something must actually be fetched.
// A rematch whose required legs are all carried over or local therefore
// publishes even while routing is unavailable.

import { computeMatch, type MatchingResult } from "../matching/index.ts";
import {
  type AddressRoster,
  type DirectedPair,
  type Leg,
  identicalCoordinates,
  legKey,
  projectAddressMatchInput,
  requiredPairs,
  resolveIdentical,
  retentionPairs,
} from "../matching/address.ts";
import type { ProviderName } from "../locations/snapshot.ts";
import { validateCells, type RoutingAdapter } from "../routing/index.ts";
import { planMatrix, type MatrixPrediction } from "../routing/matrix.ts";
import {
  type AddressEvidence,
  type EstimateSummary,
  addressAlgorithmId,
  buildEvidence,
  buildSummary,
} from "./address-evidence.ts";
import { addressCounters } from "./address-metrics.ts";

/** Where fresh observations come from. The adapter is built lazily, only if needed. */
export interface LegSource {
  provider: ProviderName;
  policyId: string;
  adapter: () => RoutingAdapter;
  signal?: AbortSignal;
  settled?: Map<string, Leg>;
  /** Required legs that already had an ID match before coordinate and workspace reuse. */
  baselineKnown?: ReadonlySet<string>;
  recordBatch?: (observations: ReadonlyArray<{ pair: DirectedPair; leg: Leg }>) => void;
}

export interface AddressPreviewComputation {
  algorithmVersion: string;
  optimal: MatchingResult;
  greedy: MatchingResult;
  evidence: AddressEvidence;
  summary: EstimateSummary;
  /** Logical misses filled by routing. A matrix can bill more or fewer physical cells. */
  fetchedCells: number;
  matrix?: MatrixPrediction;
  matcherMs: number;
}

export async function computeAddressPreview(
  roster: AddressRoster,
  source: LegSource,
  /** Validated legs of the most recent compatible earlier preview, if any. */
  candidate: ReadonlyMap<string, Leg> | undefined,
  now: () => Date = () => new Date(),
): Promise<AddressPreviewComputation> {
  const required = requiredPairs(roster);
  const retained = new Set(retentionPairs(roster).map((p) => legKey(p.from.id, p.to.id)));

  // Carry over only what this roster still retains, with original observation times.
  const legs = new Map<string, Leg>();
  for (const [key, leg] of candidate ?? []) {
    if (retained.has(key)) legs.set(key, leg);
  }

  // Classify every REQUIRED leg: carried (reused or local), local now, or to fetch.
  let reused = 0;
  const toFetch: DirectedPair[] = [];
  for (const pair of required) {
    const key = legKey(pair.from.id, pair.to.id);
    const carried = legs.get(key);
    if (carried) {
      if (carried.source === "provider") reused += 1;
      continue;
    }
    const local = resolveIdentical(pair);
    if (local) legs.set(key, local);
    else toFetch.push(pair);
  }

  const matrix = source.provider === "geoapify" && source.baselineKnown
    ? planMatrix(required, required.filter(({ from, to }) =>
      !source.baselineKnown!.has(legKey(from.id, to.id)) && !identicalCoordinates(from, to)), toFetch, roster.venue)
    : undefined;
  // Never fetch to fill a dormant driver's row: only REQUIRED legs reach here.
  if (toFetch.length > 0) {
    const adapter = source.adapter();
    const requested = matrix?.pairs ?? toFetch;
    const batchTimes = new Map<number, string>();
    const cells = validateCells(await adapter.fetchLegs(requested, {
      venueId: roster.venue.id,
      signal: source.signal,
      batches: matrix?.batches,
      onBatch: (observations, observedAt) => {
        const batch = observations.map(({ index, seconds }) => {
          batchTimes.set(index, observedAt);
          const pair = requested[index];
          const leg: Leg = { from: pair.from.id, to: pair.to.id, seconds, observedAt, source: "provider" };
          const key = legKey(leg.from, leg.to);
          if (!legs.has(key)) source.settled?.set(key, leg);
          return { pair, leg };
        });
        source.recordBatch?.(batch);
      },
    }), requested.length);
    const observedAt = now().toISOString();
    requested.forEach((pair, index) => {
      const key = legKey(pair.from.id, pair.to.id);
      if (legs.has(key)) return;
      legs.set(key, {
        from: pair.from.id,
        to: pair.to.id,
        seconds: cells[index],
        source: "provider",
        observedAt: batchTimes.get(index) ?? observedAt,
      });
    });
  }

  const { input, stats } = projectAddressMatchInput(roster, legs);
  addressCounters.negativeDetourClamped += stats.clampedNegative;
  source.signal?.throwIfAborted();
  const start = performance.now();
  const computed = computeMatch(input);
  const matcherMs = performance.now() - start;
  const evidence = buildEvidence(roster, source.policyId, legs);
  const requiredLegs = required.map((pair) => legs.get(legKey(pair.from.id, pair.to.id))!);
  const summary = buildSummary(source.provider, source.policyId, requiredLegs, {
    fetched: toFetch.length,
    reused,
  });
  return {
    algorithmVersion: addressAlgorithmId(source.policyId),
    optimal: computed.optimal,
    greedy: computed.greedy,
    evidence,
    summary,
    fetchedCells: toFetch.length,
    matrix: matrix?.prediction,
    matcherMs,
  };
}
