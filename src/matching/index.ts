// Public entry point for the pure matching engine. No database or network
// dependencies. The service projects directional zone costs into MatchEdge
// values and filters inactive participants before calling these functions.

import { greedyMatch } from "./greedy.ts";
import { ALGORITHM_VERSION, minCostFlowMatch } from "./mincostflow.ts";
import { type MatchInput, type MatchingResult } from "./types.ts";
import { assertFeasible } from "./validate.ts";

export { ALGORITHM_VERSION } from "./mincostflow.ts";
export { greedyMatch } from "./greedy.ts";
export { minCostFlowMatch } from "./mincostflow.ts";
export { assertFeasible, FeasibilityError } from "./validate.ts";
export { projectMatchInput } from "./project.ts";
export {
  type Roster,
  type RosterDriver,
  type RosterPassenger,
  type ZoneCost,
} from "./project.ts";
export {
  type Assignment,
  type MatchDriver,
  type MatchEdge,
  type MatchInput,
  type MatchingResult,
  type MatchPassenger,
  MATCH_LIMITS,
  MatchInputError,
} from "./types.ts";

export interface MatchComputation {
  algorithmVersion: string;
  optimal: MatchingResult;
  greedy: MatchingResult;
}

/**
 * Compute both the optimal and greedy results for one snapshot. The optimal
 * result is validated against the input before it is returned; a validator
 * failure is an invariant violation, never a silently returned empty plan.
 */
export function computeMatch(input: MatchInput): MatchComputation {
  const optimal = minCostFlowMatch(input);
  assertFeasible(input, optimal);
  const greedy = greedyMatch(input);
  assertFeasible(input, greedy);
  return { algorithmVersion: ALGORITHM_VERSION, optimal, greedy };
}
