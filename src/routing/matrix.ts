// Collect directed cells and group sources into billable rectangles. The
// baseline keeps the original destination-ID families for credit comparison.
import { identicalCoordinates, type AddressPoint, type DirectedPair } from "../matching/address.ts";

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

const maxCells = 1000;

export function coordinateKey(point: AddressPoint): string {
  return JSON.stringify([point.lon, point.lat]);
}

type MatrixMode = "baseline" | "residual" | { coverVenue: AddressPoint };

export function matrixBatches(pairs: readonly DirectedPair[], venueId: string, mode: MatrixMode = "residual"): MatrixBatch[] {
  const pickupRows = new Map<string, SourceRow>();
  const venueRows = new Map<string, SourceRow>();
  const targets = new Map<string, Coordinate>();
  const venuePairs = mode === "baseline" ? undefined : new Set(pairs.filter(({ to }) => to.id === venueId)
    .map(({ from, to }) => coordinateKey(from) + "\u0000" + coordinateKey(to)));
  const coverVenue = typeof mode === "object" ? mode.coverVenue : undefined;
  const venueCoordinate = coverVenue && coordinateKey(coverVenue);
  pairs.forEach(({ from, to }, index) => {
    const source = coordinateKey(from);
    const target = coordinateKey(to);
    const isVenue = to.id === venueId || target === venueCoordinate || venuePairs?.has(source + "\u0000" + target);
    const rows = isVenue ? venueRows : pickupRows;
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
    const coveredTargets = coverVenue ? [...new Set([...rows.values()].flatMap(row => [...row.indexes.keys()]))].sort() : undefined;
    const groups = new Map<string, MatrixBatch>();
    for (const row of rows.values()) {
      const keys = coveredTargets ?? [...row.indexes.keys()].sort();
      const group = JSON.stringify(keys);
      let batch = groups.get(group);
      // Each target set is bounded by the 50-passenger roster.
      if (!batch || (batch.sources.length + 1) * keys.length > maxCells) {
        batch = { sources: [], targets: keys.map((k) => targets.get(k)!), indexes: [] };
        groups.set(group, batch);
        batches.push(batch);
      }
      batch.sources.push(row.location);
      batch.indexes.push(keys.map(k => row.indexes.get(k) ?? []));
    }
  }
  return batches;
}

type RequestShape = [sources: number, targets: number];

export interface MatrixPrediction {
  plan: "P0" | "P1" | "P2";
  requests: RequestShape[];
  cells: number;
  predictedBaseCredits: number;
}

/** Select and index the exact rectangles dispatched by the adapter. */
export function planMatrix(
  required: readonly DirectedPair[], baseline: readonly DirectedPair[], misses: readonly DirectedPair[], venue: AddressPoint,
) {
  const candidates = ([
    ["P1", matrixBatches(misses, venue.id)],
    ["P2", matrixBatches(misses, venue.id, { coverVenue: venue })],
    ["P0", matrixBatches(baseline, venue.id, "baseline")],
  ] as const).map(([plan, batches]) => {
    const requests: RequestShape[] = batches.map(({ sources, targets }) => [sources.length, targets.length]);
    const cells = requests.reduce((sum, [s, t]) => sum + s * t, 0);
    const predictedBaseCredits = requests.reduce((sum, [s, t]) => sum + Math.max(s, t) * Math.min(s, t, 10), 0);
    return { batches, prediction: { plan, requests, cells, predictedBaseCredits } satisfies MatrixPrediction };
  });
  const chosen = candidates.reduce((best, candidate) =>
    candidate.prediction.predictedBaseCredits < best.prediction.predictedBaseCredits ? candidate : best);

  // The first physical cell owns every logical alias at its coordinates.
  // Overlapping baseline cells and padding are decoded and billed without
  // introducing a second observation.
  const pointPair = (from: Coordinate, to: Coordinate) => JSON.stringify([from, to]);
  const byCoordinates = new Map<string, DirectedPair[]>();
  for (const pair of required) {
    if (identicalCoordinates(pair.from, pair.to)) continue;
    const { from, to } = pair;
    const key = pointPair([from.lon, from.lat], [to.lon, to.lat]);
    const colocated = byCoordinates.get(key) ?? [];
    colocated.push(pair);
    byCoordinates.set(key, colocated);
  }
  const pairs: DirectedPair[] = [];
  for (const batch of chosen.batches) {
    batch.indexes = batch.sources.map(from => batch.targets.map(to => {
      const key = pointPair(from, to);
      const mapped = byCoordinates.get(key) ?? [];
      byCoordinates.delete(key);
      return mapped.map(pair => pairs.push(pair) - 1);
    }));
  }
  return { ...chosen, pairs, alternatives: candidates.map(candidate => candidate.prediction) };
}
