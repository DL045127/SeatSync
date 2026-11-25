// Driving-time adapter boundary (docs/ARCHITECTURE-v2.md section 2). The
// adapter owns coordinate order, units and translation of provider errors, and
// returns exactly one cell per requested pair, in request order: a finite
// nonnegative duration in seconds, or null for a confirmed no-route. An HTTP
// success alone never validates a result; callers re-check it with
// validateCells before using it.

import type { DirectedPair } from "../matching/address.ts";
import type { ProviderName } from "../locations/snapshot.ts";

export interface RoutingAdapter {
  provider: ProviderName;
  /** Identifies the provider, profile and interpretation of every observation. */
  policyId: string;
  /** Resolve each pair, in order. Never receives pairs with identical coordinates. */
  fetchLegs(pairs: readonly DirectedPair[]): Promise<Array<number | null>>;
}

export class RoutingResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingResultError";
  }
}

const MAX_CELL_SECONDS = 1_000_000;

/** One cell per requested pair, each a finite nonnegative number or null. */
export function validateCells(cells: unknown, expected: number): Array<number | null> {
  if (!Array.isArray(cells) || cells.length !== expected) {
    throw new RoutingResultError("The routing result does not have one cell per requested pair.");
  }
  for (const cell of cells) {
    if (cell === null) continue;
    if (typeof cell !== "number" || !Number.isFinite(cell) || cell < 0 || cell > MAX_CELL_SECONDS) {
      throw new RoutingResultError("The routing result has a malformed duration.");
    }
  }
  return cells as Array<number | null>;
}
