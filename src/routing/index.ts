// Provider -> routing policy and adapter. Checkpoint A ships only the offline
// fixture; the live adapter arrives with checkpoint C.

import type { ProviderName } from "../locations/snapshot.ts";
import type { RoutingAdapter } from "./adapter.ts";
import { FIXTURE_POLICY_ID, fixtureRoutingAdapter } from "./fixture.ts";

export { validateCells, RoutingResultError } from "./adapter.ts";
export type { RoutingAdapter } from "./adapter.ts";

/** The policy identifier recorded with every observation for this provider. */
export function routingPolicyFor(provider: ProviderName): string {
  if (provider === "fixture") return FIXTURE_POLICY_ID;
  throw new Error(`No routing policy is defined for provider ${provider} in this build.`);
}

export function routingAdapterFor(provider: ProviderName): RoutingAdapter {
  if (provider === "fixture") return fixtureRoutingAdapter();
  throw new Error(`No routing adapter is defined for provider ${provider} in this build.`);
}
