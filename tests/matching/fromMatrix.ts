// Build a MatchInput from a driver-row / passenger-column cost matrix, matching
// the fixture convention in tests/fixtures/matching.json: rows are drivers,
// columns are passengers, `null` is a missing (incompatible) edge, and `0` is a
// usable zero-cost edge. Seeded UUIDs preserve the A-before-B / D1-before-D2
// label ordering under ASCII sort.

import type { MatchEdge, MatchInput } from "../../src/matching/types.ts";

/** Deterministic UUIDs ordered so index 0 < index 1 < ... under ASCII sort. */
export function seededId(prefix: "d" | "p", index: number): string {
  const n = index.toString(16).padStart(2, "0");
  // prefix keeps drivers and passengers in disjoint, ordered ranges.
  const tag = prefix === "d" ? "0" : "1";
  return `${tag}0000000-0000-4000-8000-0000000000${n}`;
}

export interface MatrixCase {
  capacities: number[]; // one per driver row
  driverRowsPassengerColumns: (number | null)[][];
}

export function fromMatrix(matrix: MatrixCase): MatchInput {
  const { capacities, driverRowsPassengerColumns: rows } = matrix;
  const drivers = capacities.map((seatCapacity, i) => ({
    id: seededId("d", i),
    seatCapacity,
  }));
  const passengerCount = rows[0]?.length ?? 0;
  const passengers = Array.from({ length: passengerCount }, (_, j) => ({
    id: seededId("p", j),
  }));
  const edges: MatchEdge[] = [];
  rows.forEach((row, i) => {
    row.forEach((cost, j) => {
      if (cost === null) return;
      edges.push({
        driverId: drivers[i].id,
        passengerId: passengers[j].id,
        cost,
      });
    });
  });
  return { drivers, passengers, edges };
}
