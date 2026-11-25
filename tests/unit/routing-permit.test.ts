import { expect, test } from "vitest";
import { PreviewDeadline } from "../../src/db/deadline.ts";
import { acquireRouting, observeVersion, retainForPublication } from "../../src/trips/routing-permit.ts";

test("handoff is scoped to a trip and policy, with independent trip admission", async () => {
  const deadline = new PreviewDeadline();
  const first = await acquireRouting("one", 1, "a", deadline);
  first.settled.set("leg", { from: "driver", to: "pickup", source: "provider", seconds: 17, observedAt: "2026-11-24T00:00:00.000Z" });
  const second = await acquireRouting("two", 2, "a", deadline);
  const newer = acquireRouting("one", 2, "b", deadline);
  try {
    expect(first.controller.signal.aborted).toBe(true);
    expect(second.settled.size).toBe(0);
    expect(second.controller.signal.aborted).toBe(false);
    first.release();
    const changed = await newer;
    expect(changed.settled.size).toBe(0);
    changed.release();
  } finally { first.release(); second.release(); }
});

test("a nonwaiting handoff snapshots only a strictly older holder of the same trip and policy", async () => {
  const holder = await acquireRouting("one", 3, "a", new PreviewDeadline());
  holder.settled.set("leg", { from: "driver", to: "pickup", source: "provider", seconds: null, observedAt: "2026-11-24T00:00:00.000Z" });
  try {
    expect(observeVersion("two", 4, "a")).toBeUndefined();
    expect(observeVersion("one", 3, "a")).toBeUndefined();
    expect(holder.controller.signal.aborted).toBe(false);
    expect(observeVersion("one", 4, "b")).toBeUndefined();
    expect(holder.controller.signal.aborted).toBe(true);
    const snapshot = observeVersion("one", 4, "a");
    expect(snapshot?.get("leg")).toEqual(holder.settled.get("leg"));
    holder.settled.clear();
    expect(snapshot?.size).toBe(1);
  } finally { holder.release(); }
});

test("a covered handoff survives peer cleanup, stays scoped and expires when its last publisher exits", async () => {
  const trip = "covered";
  const leg = { from: "driver", to: "pickup", source: "provider" as const, seconds: 17, observedAt: "2026-11-24T00:00:00.000Z" };
  const cells = new Map([["leg", leg]]);
  const releaseFirst = retainForPublication(trip, 2, "a", cells);
  const releasePeer = retainForPublication(trip, 2, "a", cells);
  releaseFirst();
  expect(observeVersion(trip, 2, "a")).toEqual(cells);
  expect(observeVersion("other", 2, "a")).toBeUndefined();
  expect(observeVersion(trip, 2, "b")).toBeUndefined();
  expect(() => observeVersion(trip, 1, "a")).toThrow();

  // A further seat edit can need the cells before any zero-seat row commits.
  const live = await acquireRouting(trip, 3, "a", new PreviewDeadline());
  expect(live.settled).toEqual(cells);
  live.release();
  const releaseNewer = retainForPublication(trip, 3, "a", cells);
  releasePeer();
  expect(observeVersion(trip, 3, "a")).toEqual(cells);
  releaseNewer();
  expect(observeVersion(trip, 3, "a")).toBeUndefined();
});
