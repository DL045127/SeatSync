import type { PoolClient } from "pg";
import fixture from "../../data/zones.json" with { type: "json" };

export type Dataset = typeof fixture;
export const canonicalDataset: Dataset = fixture;

export class DatasetMismatch extends Error {
  constructor() {
    super("The database zone data differs from the bundled fixture. Run the offline reset.");
    this.name = "DatasetMismatch";
  }
}

export function sameDataset(actual: Dataset, expected: Dataset): boolean {
  const normalize = ({ zones, costs }: Dataset) => JSON.stringify([
    zones.map(({ id, label }) => JSON.stringify([id, label])).sort(),
    costs.map(({ driver_zone_id, passenger_zone_id, cost }) =>
      JSON.stringify([driver_zone_id, passenger_zone_id, cost])).sort(),
  ]);
  return normalize(actual) === normalize(expected);
}

export async function readDataset(client: PoolClient): Promise<Dataset> {
  const zones = await client.query<Dataset["zones"][number]>("SELECT id, label FROM zones");
  const costs = await client.query<Dataset["costs"][number]>(
    "SELECT driver_zone_id, passenger_zone_id, cost FROM zone_costs",
  );
  return { zones: zones.rows, costs: costs.rows };
}

export async function assertDataset(client: PoolClient): Promise<void> {
  if (!sameDataset(await readDataset(client), canonicalDataset)) throw new DatasetMismatch();
}
