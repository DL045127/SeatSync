// Offline fixture routing: directed seconds from the shipped catalog. No
// network, account or key. The policy identifier names the catalog revision, so
// a changed catalog starts a new duration history.

import { fixtureSeconds, FIXTURE_REVISION } from "../locations/fixture-catalog.ts";
import type { RoutingAdapter } from "./adapter.ts";

export const FIXTURE_POLICY_ID = `fixture/drive/${FIXTURE_REVISION}/rounding-1`;

export function fixtureRoutingAdapter(): RoutingAdapter {
  return {
    provider: "fixture",
    policyId: FIXTURE_POLICY_ID,
    async fetchLegs(pairs) {
      return pairs.map(({ from, to }) => fixtureSeconds(from.providerRef, to.providerRef));
    },
  };
}
