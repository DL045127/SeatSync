// Acceptance checks M-01 through M-10 for the pure matching engine.
// See docs/ARCHITECTURE.md section 7 "Acceptance checks" for the definitions.
// These are database-free and run via `npm run test:matching`.

import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/matching.json" with { type: "json" };
import {
  type MatchInput,
  type Roster,
  FeasibilityError,
  MATCH_LIMITS,
  MatchInputError,
  assertFeasible,
  computeMatch,
  greedyMatch,
  minCostFlowMatch,
  projectMatchInput,
} from "../../src/matching/index.ts";
import { fromMatrix, seededId } from "./fromMatrix.ts";
import { oracleObjective } from "./oracle.ts";
import { randomCase } from "./random.ts";

const m01 = fromMatrix(fixtures["M-01"]);
const m08 = fromMatrix(fixtures["M-08"]);

describe("M-01 cost fixture", () => {
  it("optimizer serves 2 for total cost 4", () => {
    const result = minCostFlowMatch(m01);
    expect(result.matchedCount).toBe(2);
    expect(result.totalCost).toBe(4);
    assertFeasible(m01, result);
  });

  it("matches the hand-checked expectation and greedy costs 101", () => {
    expect(minCostFlowMatch(m01).totalCost).toBe(fixtures["M-01"].optimal.cost);
    const greedy = greedyMatch(m01);
    expect(greedy.matchedCount).toBe(fixtures["M-01"].greedy.matched);
    expect(greedy.totalCost).toBe(fixtures["M-01"].greedy.cost);
  });
});

describe("M-02 capacity limits coverage", () => {
  it("one 2-seat driver and 5 compatible passengers matches exactly 2", () => {
    const driverId = seededId("d", 0);
    const passengers = Array.from({ length: 5 }, (_, j) => ({ id: seededId("p", j) }));
    const input: MatchInput = {
      drivers: [{ id: driverId, seatCapacity: 2 }],
      passengers,
      edges: passengers.map((p, j) => ({ driverId, passengerId: p.id, cost: j })),
    };
    const result = minCostFlowMatch(input);
    expect(result.matchedCount).toBe(2);
    // Cheapest two compatible passengers (cost 0 and 1).
    expect(result.totalCost).toBe(1);
    assertFeasible(input, result);
  });
});

describe("M-03 empty supply", () => {
  it("no drivers yields 0 matched and cost 0", () => {
    const input: MatchInput = {
      drivers: [],
      passengers: [{ id: seededId("p", 0) }],
      edges: [],
    };
    const result = minCostFlowMatch(input);
    expect(result).toMatchObject({ matchedCount: 0, totalCost: 0 });
    expect(result.unassignedPassengerIds).toEqual([seededId("p", 0)]);
  });

  it("zero-capacity drivers yield 0 matched and cost 0", () => {
    const driverId = seededId("d", 0);
    const passengerId = seededId("p", 0);
    const input: MatchInput = {
      drivers: [{ id: driverId, seatCapacity: 0 }],
      passengers: [{ id: passengerId }],
      edges: [{ driverId, passengerId, cost: 5 }],
    };
    const result = minCostFlowMatch(input);
    expect(result).toMatchObject({ matchedCount: 0, totalCost: 0 });
    expect(result.unassignedPassengerIds).toEqual([passengerId]);
  });
});

describe("M-04 edge presence semantics", () => {
  it("missing edges are excluded and zero-cost edges are usable", () => {
    // Driver 0 compatible only via a zero-cost edge; driver 1 incompatible.
    const input = fromMatrix({
      capacities: [1, 1],
      driverRowsPassengerColumns: [
        [0, null],
        [null, null],
      ],
    });
    const result = minCostFlowMatch(input);
    expect(result.matchedCount).toBe(1);
    expect(result.totalCost).toBe(0); // zero-cost edge was used, not rejected
    expect(result.unassignedPassengerIds).toEqual([seededId("p", 1)]);
    assertFeasible(input, result);
  });
});

describe("M-05 tie handling and stable output", () => {
  it("repeated and permuted input yields identical output", () => {
    const input = randomCase(7, { compatibility: 0.9 });
    const permuted: MatchInput = {
      drivers: [...input.drivers].reverse(),
      passengers: [...input.passengers].reverse(),
      edges: [...input.edges].reverse(),
    };
    const a = minCostFlowMatch(input);
    const b = minCostFlowMatch(input);
    const c = minCostFlowMatch(permuted);
    expect(a).toEqual(b); // deterministic
    expect(c.matchedCount).toBe(a.matchedCount);
    expect(c.totalCost).toBe(a.totalCost);
    expect(c.assignments).toEqual(a.assignments); // stable regardless of order
    expect(c.unassignedPassengerIds).toEqual(a.unassignedPassengerIds);
  });

  it("chooses the correct objective on a symmetric tie", () => {
    // Two drivers, one passenger, equal cost: one match at that cost.
    const input = fromMatrix({
      capacities: [1, 1],
      driverRowsPassengerColumns: [[3], [3]],
    });
    const result = minCostFlowMatch(input);
    expect(result.matchedCount).toBe(1);
    expect(result.totalCost).toBe(3);
    // First driver by ASCII order wins the tie deterministically.
    expect(result.assignments[0].driverId).toBe(seededId("d", 0));
  });
});

describe("M-06 oracle agreement on tiny cases", () => {
  it("matches the independent oracle on 100 retained seeds", () => {
    for (let seed = 0; seed < 100; seed++) {
      const input = randomCase(seed);
      const result = minCostFlowMatch(input);
      assertFeasible(input, result);
      const expected = oracleObjective(input);
      expect({ seed, ...pick(result) }).toEqual({ seed, ...expected });
    }
  });
});

describe("M-07 validator rejects infeasible plans", () => {
  const base = fromMatrix({
    capacities: [1, 1],
    driverRowsPassengerColumns: [
      [1, 2],
      [3, 4],
    ],
  });
  const [d0, d1] = base.drivers.map((d) => d.id);
  const [p0, p1] = base.passengers.map((p) => p.id);

  it("rejects a duplicate passenger assignment", () => {
    expect(() =>
      assertFeasible(base, {
        assignments: [
          { passengerId: p0, driverId: d0, cost: 1 },
          { passengerId: p0, driverId: d1, cost: 3 },
        ],
        unassignedPassengerIds: [p1],
        matchedCount: 2,
        totalCost: 4,
      }),
    ).toThrow(FeasibilityError);
  });

  it("rejects overcapacity", () => {
    const single = fromMatrix({
      capacities: [1],
      driverRowsPassengerColumns: [[1, 1]],
    });
    const [dd] = single.drivers.map((d) => d.id);
    const [pp0, pp1] = single.passengers.map((p) => p.id);
    expect(() =>
      assertFeasible(single, {
        assignments: [
          { passengerId: pp0, driverId: dd, cost: 1 },
          { passengerId: pp1, driverId: dd, cost: 1 },
        ],
        unassignedPassengerIds: [],
        matchedCount: 2,
        totalCost: 2,
      }),
    ).toThrow(/capacity/);
  });

  it("rejects wrong totals", () => {
    expect(() =>
      assertFeasible(base, {
        assignments: [{ passengerId: p0, driverId: d0, cost: 1 }],
        unassignedPassengerIds: [p1],
        matchedCount: 1,
        totalCost: 99,
      }),
    ).toThrow(/totalCost/);
  });

  it("rejects an unknown member", () => {
    expect(() =>
      assertFeasible(base, {
        assignments: [{ passengerId: "unknown", driverId: d0, cost: 1 }],
        unassignedPassengerIds: [p0, p1],
        matchedCount: 1,
        totalCost: 1,
      }),
    ).toThrow(FeasibilityError);
  });

  it("rejects an incomplete partition", () => {
    expect(() =>
      assertFeasible(base, {
        assignments: [{ passengerId: p0, driverId: d0, cost: 1 }],
        unassignedPassengerIds: [], // p1 is missing from both lists
        matchedCount: 1,
        totalCost: 1,
      }),
    ).toThrow(/partition/);
  });

  it("rejects an incompatible assigned pair", () => {
    const sparse = fromMatrix({
      capacities: [1],
      driverRowsPassengerColumns: [[null]],
    });
    const [dd] = sparse.drivers.map((d) => d.id);
    const [pp] = sparse.passengers.map((p) => p.id);
    expect(() =>
      assertFeasible(sparse, {
        assignments: [{ passengerId: pp, driverId: dd, cost: 0 }],
        unassignedPassengerIds: [],
        matchedCount: 1,
        totalCost: 0,
      }),
    ).toThrow(/Incompatible/);
  });
});

describe("M-08 coverage before cost fixture", () => {
  it("serves 2 for cost 3 while greedy serves only 1", () => {
    const result = minCostFlowMatch(m08);
    expect(result.matchedCount).toBe(2);
    expect(result.totalCost).toBe(3);
    assertFeasible(m08, result);
    // The only full plan is A->D2 / B->D1 per the fixture basis.
    const byPassenger = Object.fromEntries(
      result.assignments.map((a) => [a.passengerId, a.driverId]),
    );
    expect(byPassenger[seededId("p", 0)]).toBe(seededId("d", 1)); // A -> D2
    expect(byPassenger[seededId("p", 1)]).toBe(seededId("d", 0)); // B -> D1

    const greedy = greedyMatch(m08);
    expect(greedy.matchedCount).toBe(fixtures["M-08"].greedy.matched);
    expect(greedy.totalCost).toBe(fixtures["M-08"].greedy.cost);
  });
});

describe("M-09 input bounds", () => {
  it("rejects duplicate driver ids", () => {
    const id = seededId("d", 0);
    expect(() =>
      minCostFlowMatch({
        drivers: [
          { id, seatCapacity: 1 },
          { id, seatCapacity: 1 },
        ],
        passengers: [],
        edges: [],
      }),
    ).toThrow(MatchInputError);
  });

  it("rejects an out-of-range seat capacity", () => {
    expect(() =>
      minCostFlowMatch({
        drivers: [{ id: seededId("d", 0), seatCapacity: 9 }],
        passengers: [],
        edges: [],
      }),
    ).toThrow(MatchInputError);
  });

  it("rejects an out-of-range cost", () => {
    const driverId = seededId("d", 0);
    const passengerId = seededId("p", 0);
    expect(() =>
      minCostFlowMatch({
        drivers: [{ id: driverId, seatCapacity: 1 }],
        passengers: [{ id: passengerId }],
        edges: [{ driverId, passengerId, cost: 10_001 }],
      }),
    ).toThrow(MatchInputError);
  });

  it("rejects an edge referencing an unknown member", () => {
    const driverId = seededId("d", 0);
    expect(() =>
      minCostFlowMatch({
        drivers: [{ id: driverId, seatCapacity: 1 }],
        passengers: [{ id: seededId("p", 0) }],
        edges: [{ driverId, passengerId: "ghost", cost: 1 }],
      }),
    ).toThrow(MatchInputError);
  });

  it("accepts boundary inputs (seat 0, seat 8, cost 0, cost 10000)", () => {
    const d0 = seededId("d", 0);
    const d1 = seededId("d", 1);
    const p0 = seededId("p", 0);
    const p1 = seededId("p", 1);
    const input: MatchInput = {
      drivers: [
        { id: d0, seatCapacity: 0 },
        { id: d1, seatCapacity: 8 },
      ],
      passengers: [{ id: p0 }, { id: p1 }],
      edges: [
        { driverId: d1, passengerId: p0, cost: 0 },
        { driverId: d1, passengerId: p1, cost: 10_000 },
      ],
    };
    const result = minCostFlowMatch(input);
    expect(result.matchedCount).toBe(2);
    expect(result.totalCost).toBe(10_000);
    assertFeasible(input, result);
  });
});

describe("computeMatch entry point", () => {
  it("returns validated optimal and greedy results with the algorithm version", () => {
    const computation = computeMatch(m01);
    expect(computation.algorithmVersion).toBe("mincostflow-v1");
    expect(computation.optimal.totalCost).toBe(4);
    expect(computation.greedy.totalCost).toBe(101);
  });
});

describe("M-10 inactive exclusion and independent summation", () => {
  // Exercise the production projection step with BOTH an inactive driver and an
  // inactive passenger. If the filter were omitted, the assigned/unassigned IDs
  // would differ, so the exact-ID assertions below detect the omission.
  const activeDriver = seededId("d", 0);
  const inactiveDriver = seededId("d", 1);
  const activePassenger = seededId("p", 0);
  const inactivePassenger = seededId("p", 1);
  const roster: Roster = {
    drivers: [
      { id: activeDriver, zoneId: "south", seatCapacity: 1, active: true },
      // Would otherwise serve the active passenger cheaply; must be excluded.
      { id: inactiveDriver, zoneId: "west", seatCapacity: 5, active: false },
    ],
    passengers: [
      { id: activePassenger, zoneId: "west", active: true },
      // Would otherwise consume the only seat; must be excluded.
      { id: inactivePassenger, zoneId: "south", active: false },
    ],
    zoneCosts: [
      { driverZoneId: "south", passengerZoneId: "west", cost: 2 },
      { driverZoneId: "south", passengerZoneId: "south", cost: 0 },
      { driverZoneId: "west", passengerZoneId: "west", cost: 0 },
      { driverZoneId: "west", passengerZoneId: "south", cost: 2 },
    ],
  };

  it("projects only active members and matches them", () => {
    const input = projectMatchInput(roster);
    expect(input.drivers.map((d) => d.id)).toEqual([activeDriver]);
    expect(input.passengers.map((p) => p.id)).toEqual([activePassenger]);
    const result = minCostFlowMatch(input);
    assertFeasible(input, result);
    expect(result.assignments).toEqual([
      { passengerId: activePassenger, driverId: activeDriver, cost: 2 },
    ]);
    expect(result.unassignedPassengerIds).toEqual([]);
    expect(result.totalCost).toBe(2);
  });

  it("reconstructed flow and independently summed cost agree with the oracle", () => {
    const input = fromMatrix({
      capacities: [1, 2],
      driverRowsPassengerColumns: [
        [5, 3, null],
        [1, null, 2],
      ],
    });
    const result = minCostFlowMatch(input);
    assertFeasible(input, result);
    const summed = result.assignments.reduce((s, a) => s + a.cost, 0);
    expect(summed).toBe(result.totalCost);
    expect(pick(result)).toEqual(oracleObjective(input));
  });

  it("negative control: an active member is NOT filtered out", () => {
    // If the projection wrongly dropped active members, this passenger would go
    // unassigned. It must be assigned.
    const control = projectMatchInput({
      drivers: [{ id: activeDriver, zoneId: "west", seatCapacity: 1, active: true }],
      passengers: [{ id: activePassenger, zoneId: "west", active: true }],
      zoneCosts: [{ driverZoneId: "west", passengerZoneId: "west", cost: 0 }],
    });
    const result = minCostFlowMatch(control);
    expect(result.matchedCount).toBe(1);
  });
});

describe("ISSUE-010 regression: matcher input bounds and canonical IDs", () => {
  it("rejects more than 20 drivers", () => {
    const drivers = Array.from({ length: 21 }, (_, i) => ({
      id: seededId("d", i),
      seatCapacity: 1,
    }));
    expect(() =>
      minCostFlowMatch({ drivers, passengers: [], edges: [] }),
    ).toThrow(/Too many drivers/);
  });

  it("accepts exactly 20 drivers and 50 passengers", () => {
    const drivers = Array.from({ length: 20 }, (_, i) => ({
      id: seededId("d", i),
      seatCapacity: 0,
    }));
    const passengers = Array.from({ length: 50 }, (_, j) => ({ id: seededId("p", j) }));
    const result = minCostFlowMatch({ drivers, passengers, edges: [] });
    expect(result.matchedCount).toBe(0);
    expect(result.unassignedPassengerIds).toHaveLength(50);
  });

  it("rejects more than 50 passengers", () => {
    const passengers = Array.from({ length: 51 }, (_, j) => ({ id: seededId("p", j) }));
    expect(() =>
      minCostFlowMatch({ drivers: [], passengers, edges: [] }),
    ).toThrow(/Too many passengers/);
  });

  it("rejects non-canonical IDs that could collide in the edge key", () => {
    // Malformed IDs containing the NUL separator must be rejected before the
    // lookup is built, so no phantom assignment can arise from a key collision.
    expect(() =>
      minCostFlowMatch({
        drivers: [
          { id: "a", seatCapacity: 1 },
          { id: "a\u0000b", seatCapacity: 1 },
        ],
        passengers: [{ id: "b\u0000c" }, { id: "c" }],
        edges: [{ driverId: "a", passengerId: "b\u0000c", cost: 1 }],
      }),
    ).toThrow(MatchInputError);
  });

  it("exposes the enforced match limits", () => {
    expect(MATCH_LIMITS).toEqual({ maxDrivers: 20, maxPassengers: 50 });
  });

  it("rejects a non-string (array) id that coerces to a valid UUID", () => {
    // `[id]` stringifies to `id` and would pass a regex / edge-key coercion,
    // but the capacity and membership maps treat it as distinct. The type
    // guard rejects it before any phantom assignment can form.
    const id = seededId("d", 0);
    const p0 = seededId("p", 0);
    const p1 = seededId("p", 1);
    expect(() =>
      // deliberately malformed runtime input at the matcher trust boundary
      minCostFlowMatch({
        drivers: [
          { id, seatCapacity: 1 },
          { id: [id] as unknown as string, seatCapacity: 1 },
        ],
        passengers: [{ id: p0 }, { id: p1 }],
        edges: [
          { driverId: id, passengerId: p0, cost: 1 },
          { driverId: id, passengerId: p1, cost: 1 },
        ],
      }),
    ).toThrow(MatchInputError);
  });
});

function pick(r: { matchedCount: number; totalCost: number }) {
  return { matchedCount: r.matchedCount, totalCost: r.totalCost };
}
