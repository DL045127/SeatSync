import { expect, test } from "vitest";
import type { AddressPoint } from "../../src/matching/address.ts";
import { matrixBatches } from "../../src/routing/matrix.ts";

const point = (n: number): AddressPoint => ({ id: String(n), providerRef: String(n), lat: 30, lon: -100 + n / 100 });
const venue = point(0);
const drivers = Array.from({ length: 20 }, (_, i) => point(1 + i));
const pickups = Array.from({ length: 50 }, (_, i) => point(21 + i));

test("cold maximum roster buys exactly 20×50 and 70×1", () => {
  const pairs = drivers.flatMap((from) => pickups.map((to) => ({ from, to })));
  pairs.push(...[...drivers, ...pickups].map((from) => ({ from, to: venue })));
  const batches = matrixBatches(pairs, venue.id);
  expect(batches.map((b) => [b.sources.length, b.targets.length])).toEqual([[20, 50], [70, 1]]);
  const indexes = batches.flatMap((batch) => batch.indexes.flat(2));
  expect(indexes.sort((a, b) => a - b)).toEqual(Array.from({ length: 1070 }, (_, i) => i));
  for (const batch of batches) {
    batch.indexes.forEach((row, i) => row.forEach(([index], j) => {
      const { from, to } = pairs[index];
      expect([batch.sources[i], batch.targets[j]]).toEqual([[from.lon, from.lat], [to.lon, to.lat]]);
    }));
  }
});

test("different target sets stay sparse and coincident locations share one cell", () => {
  const [d, e] = drivers;
  const [p, q] = pickups;
  const batches = matrixBatches([
    { from: d, to: p }, { from: { ...d, id: "alias" }, to: { ...p, id: "second" } },
    { from: e, to: p }, { from: e, to: q },
  ], venue.id);
  expect(batches).toHaveLength(2);
  expect(batches[0].indexes).toEqual([[[0, 1]]]);
  const sparse = batches[1];
  expect(sparse.sources).toEqual([[e.lon, e.lat]]);
  expect(sparse.targets).toHaveLength(2);
  for (const [point, expectedIndex] of [[p, 2], [q, 3]] as const) {
    const column = sparse.targets.findIndex(([lon, lat]) => lon === point.lon && lat === point.lat);
    expect(sparse.indexes[0][column]).toEqual([expectedIndex]);
  }
});

test("five dispatches share one rolling window and a canceled waiter takes no slot", async () => {
  const { GeoapifyRateLimit } = await import("../../src/routing/geoapify.ts");
  const limit = new GeoapifyRateLimit();
  const signal = new AbortController().signal;
  const start = performance.now();
  await Promise.all(Array.from({ length: 5 }, () => limit.acquire(signal)));
  const stop = new AbortController();
  const waiting = limit.acquire(stop.signal);
  stop.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  await limit.acquire(signal);
  expect(performance.now() - start).toBeGreaterThanOrEqual(1000);
  limit.backoff(7);
  await expect(limit.acquire(signal)).rejects.toMatchObject({ code: "ROUTING_QUOTA", retryAfterSeconds: 7 });
});
