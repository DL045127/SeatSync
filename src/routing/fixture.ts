// Offline fixture routing: directed seconds from the shipped catalog. No
// network, account or key. The policy identifier names the catalog revision, so
// a changed catalog starts a new duration history.

import { fixtureSeconds, FIXTURE_REVISION } from "../locations/fixture-catalog.ts";
import { coordinateKey } from "./matrix.ts";
import { validateCells, type RoutingAdapter } from "./adapter.ts";

export const FIXTURE_POLICY_ID = `fixture/drive/${FIXTURE_REVISION}/rounding-1`;

export function fixtureRoutingAdapter(): RoutingAdapter {
  return {
    provider: "fixture",
    policyId: FIXTURE_POLICY_ID,
    async fetchLegs(pairs, request) {
      request.signal?.throwIfAborted();
      const observed = new Map<string, number | null>();
      const cells = validateCells(pairs.map(({ from, to }) => {
        const key = coordinateKey(from) + "\u0000" + coordinateKey(to);
        if (!observed.has(key)) observed.set(key, fixtureSeconds(from.providerRef, to.providerRef));
        return observed.get(key)!;
      }), pairs.length);
      if (cells.length) {
        request.onBatch?.(cells.map((seconds, index) => ({ seconds, index })), new Date().toISOString());
      }
      request.signal?.throwIfAborted();
      return cells;
    },
  };
}
