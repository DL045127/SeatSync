// Policy lookup is local even when credentials or the provider are unavailable.

import type { ProviderName } from "../locations/snapshot.ts";
import type { RoutingAdapter } from "./adapter.ts";
import { FIXTURE_POLICY_ID, fixtureRoutingAdapter } from "./fixture.ts";

import { GEOAPIFY_POLICY_ID, geoapifyRoutingAdapter, isLoopbackRoutingAdapter } from "./geoapify.ts";

export { validateCells, RoutingResultError, RoutingUnavailable } from "./adapter.ts";
export type { RoutingAdapter } from "./adapter.ts";

// Test-only seam: substitute the adapter (and so its policy identifier) for the
// fixture provider, so a test can count upstream cells, inject an outage or
// change the policy. Production never sets it.
let adapterOverride: RoutingAdapter | undefined;
export function __setRoutingAdapterForTests(adapter: RoutingAdapter | undefined): void {
  adapterOverride = adapter;
}

/** The policy identifier recorded with every observation for this provider. */
export function routingPolicyFor(provider: ProviderName): string {
  if (adapterOverride && provider === adapterOverride.provider) return adapterOverride.policyId;
  if (provider === "fixture") return FIXTURE_POLICY_ID;
  if (provider === "geoapify") return GEOAPIFY_POLICY_ID;
  throw new Error(`No routing policy is defined for provider ${provider} in this build.`);
}

export function routingAdapterFor(provider: ProviderName): RoutingAdapter {
  if (adapterOverride && provider === adapterOverride.provider) return adapterOverride;
  if (provider === "fixture") return fixtureRoutingAdapter();
  if (provider === "geoapify") return geoapifyRoutingAdapter();
  throw new Error(`No routing adapter is defined for provider ${provider} in this build.`);
}

/** Live Geoapify cross-trip reuse is disabled pending the owner's retention decision. */
export function canShareTravelTimes(provider: ProviderName): boolean {
  return provider === "fixture" || (process.env.GROUPRIDE_USE_TEST_DATABASE === "1" &&
    adapterOverride?.provider === provider && isLoopbackRoutingAdapter(adapterOverride));
}
