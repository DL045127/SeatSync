// Controlled-mutant sensitivity check. Substituting the greedy matcher for the
// optimizer must fail M-01 and M-08: this proves the acceptance fixtures detect
// a plausible defect (using a suboptimal matcher). The real optimizer is still
// exercised by matching.test.ts; nothing here mutates shipped code.

import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/matching.json" with { type: "json" };
import { greedyMatch, minCostFlowMatch } from "../../src/matching/index.ts";
import { fromMatrix } from "./fromMatrix.ts";

const m01 = fromMatrix(fixtures["M-01"]);
const m08 = fromMatrix(fixtures["M-08"]);

describe("mutant: greedy substituted for the optimizer", () => {
  it("fails the M-01 cost expectation", () => {
    const mutant = greedyMatch(m01);
    expect(mutant.totalCost).not.toBe(fixtures["M-01"].optimal.cost); // 101 != 4
    expect(minCostFlowMatch(m01).totalCost).toBe(fixtures["M-01"].optimal.cost);
  });

  it("fails the M-08 coverage expectation", () => {
    const mutant = greedyMatch(m08);
    expect(mutant.matchedCount).not.toBe(fixtures["M-08"].optimal.matched); // 1 != 2
    expect(minCostFlowMatch(m08).matchedCount).toBe(fixtures["M-08"].optimal.matched);
  });
});
