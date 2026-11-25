// Compute an address preview from frozen durations (docs/ARCHITECTURE-v2.md
// sections 5 and 6): resolve the required directed legs (identical endpoints
// locally, the rest from the routing adapter), project edges, run the same
// exact and greedy matchers, and assemble the evidence and public summary.
//
// Checkpoint A fetches every required leg for each new preview. Trip-local
// reuse of earlier observations belongs to checkpoint B.

import { computeMatch, type MatchingResult } from "../matching/index.ts";
import {
  type AddressRoster,
  type Leg,
  legKey,
  projectAddressMatchInput,
  requiredPairs,
  resolveIdentical,
} from "../matching/address.ts";
import { validateCells, type RoutingAdapter } from "../routing/index.ts";
import {
  type AddressEvidence,
  type EstimateSummary,
  addressAlgorithmId,
  buildEvidence,
  buildSummary,
} from "./address-evidence.ts";

export interface AddressPreviewComputation {
  algorithmVersion: string;
  optimal: MatchingResult;
  greedy: MatchingResult;
  evidence: AddressEvidence;
  summary: EstimateSummary;
  clampedNegative: number;
}

export async function computeAddressPreview(
  roster: AddressRoster,
  adapter: RoutingAdapter,
  now: () => Date = () => new Date(),
): Promise<AddressPreviewComputation> {
  const pairs = requiredPairs(roster);
  const legs = new Map<string, Leg>();
  const toFetch = [];
  for (const pair of pairs) {
    const local = resolveIdentical(pair);
    if (local) legs.set(legKey(pair.from.id, pair.to.id), local);
    else toFetch.push(pair);
  }

  if (toFetch.length > 0) {
    const cells = validateCells(await adapter.fetchLegs(toFetch), toFetch.length);
    const observedAt = now().toISOString();
    toFetch.forEach((pair, index) => {
      legs.set(legKey(pair.from.id, pair.to.id), {
        from: pair.from.id,
        to: pair.to.id,
        seconds: cells[index],
        source: "provider",
        observedAt,
      });
    });
  }

  const { input, stats } = projectAddressMatchInput(roster, legs);
  const computed = computeMatch(input);
  const algorithmVersion = addressAlgorithmId(adapter.policyId);
  const evidence = buildEvidence(roster, adapter.policyId, legs);
  const summary = buildSummary(adapter.provider, adapter.policyId, evidence, {
    fetched: toFetch.length,
    reused: 0,
  });
  return {
    algorithmVersion,
    optimal: computed.optimal,
    greedy: computed.greedy,
    evidence,
    summary,
    clampedNegative: stats.clampedNegative,
  };
}
