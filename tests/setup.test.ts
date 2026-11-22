import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalDataset, sameDataset } from "../src/db/dataset.ts";
import { assertLocalTarget, demoDatabase, setupRole, testDatabase } from "../src/db/local-target.ts";

const demoUrl = "postgresql://groupride_setup:local_setup@127.0.0.1:55432/groupride_demo";

test("setup requires the selected database, loopback endpoint, and setup role", () => {
  assert.doesNotThrow(() => assertLocalTarget(demoUrl, demoDatabase, setupRole));
  const unsafeUrls = [
    demoUrl.replace("127.0.0.1", "example.org"),
    demoUrl.replace("55432", "5432"),
    demoUrl.replace("groupride_setup", "groupride_app"),
    demoUrl + "?host=/tmp",
    "invalid-url",
  ];
  for (const url of unsafeUrls) assert.throws(() => assertLocalTarget(url, demoDatabase, setupRole));
  assert.throws(() => assertLocalTarget(demoUrl, testDatabase, setupRole));
});

test("dataset comparison ignores row order and detects unused edge changes", () => {
  const actual = structuredClone(canonicalDataset);
  actual.zones.reverse();
  actual.costs.reverse();
  assert.equal(sameDataset(actual, canonicalDataset), true);
  const reverseEdge = actual.costs.find((row) =>
    row.driver_zone_id === "east" && row.passenger_zone_id === "north");
  assert.ok(reverseEdge);
  assert.equal(reverseEdge.cost, 19);
  reverseEdge.cost = 20;
  assert.equal(sameDataset(actual, canonicalDataset), false);
  assert.equal(sameDataset({ ...canonicalDataset, costs: [] }, canonicalDataset), false);
});
