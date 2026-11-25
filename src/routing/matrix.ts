// Collect only requested directed cells. Different immutable location IDs at
// the same coordinates share a cell within a rectangle.
import type { AddressPoint, DirectedPair } from "../matching/address.ts";

type Coordinate = [number, number];
interface SourceRow {
  location: Coordinate;
  indexes: Map<string, number[]>;
}

export interface MatrixBatch {
  sources: Coordinate[];
  targets: Coordinate[];
  /** Each cell expands to one or more positions in the caller's pair list. */
  indexes: number[][][];
}

function coordinateKey(point: AddressPoint): string {
  return JSON.stringify([point.lon, point.lat]);
}

export function matrixBatches(pairs: readonly DirectedPair[], venueId: string): MatrixBatch[] {
  const pickupRows = new Map<string, SourceRow>();
  const venueRows = new Map<string, SourceRow>();
  const targets = new Map<string, Coordinate>();
  pairs.forEach(({ from, to }, index) => {
    const rows = to.id === venueId ? venueRows : pickupRows;
    const source = coordinateKey(from);
    const target = coordinateKey(to);
    let row = rows.get(source);
    if (!row) {
      row = { location: [from.lon, from.lat], indexes: new Map() };
      rows.set(source, row);
    }
    targets.set(target, [to.lon, to.lat]);
    const indexes = row.indexes.get(target);
    if (indexes) indexes.push(index);
    else row.indexes.set(target, [index]);
  });

  const batches: MatrixBatch[] = [];
  for (const rows of [pickupRows, venueRows]) {
    const groups = new Map<string, MatrixBatch>();
    for (const row of rows.values()) {
      const keys = [...row.indexes.keys()].sort();
      const group = JSON.stringify(keys);
      let batch = groups.get(group);
      // Each target set is bounded by the 50-passenger roster.
      if (!batch || (batch.sources.length + 1) * keys.length > 1000) {
        batch = { sources: [], targets: keys.map((k) => targets.get(k)!), indexes: [] };
        groups.set(group, batch);
        batches.push(batch);
      }
      batch.sources.push(row.location);
      batch.indexes.push(keys.map((k) => row.indexes.get(k)!));
    }
  }
  return batches;
}
