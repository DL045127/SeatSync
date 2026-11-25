// Database-free unit tests for the trip page reducer, covering the ordering
// rules behind U-01..U-04 (docs/ARCHITECTURE.md section 5). Run via test:unit.

import { describe, expect, it } from "vitest";
import {
  type PendingOperation,
  type PreviewView,
  type TripSnapshotView,
  type TripState,
  canCommit,
  initialState,
  tripReducer,
} from "../../src/app/trips/reducer.ts";

const TRIP = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6071";

function snap(version: number): TripSnapshotView {
  return { id: TRIP, version, status: "open" };
}
function previewFor(baseVersion: number): PreviewView {
  return { previewId: "p", baseVersion, algorithmVersion: "mincostflow-v1" };
}
function op(key: string): PendingOperation {
  return { key, method: "POST", canonicalRoute: `/api/trips/${TRIP}/drivers`, normalizedBody: {}, tripId: TRIP };
}

/** Drive a GET through the current read generation. */
function receiveGet(state: TripState, version: number): TripState {
  const started = tripReducer(state, { type: "get/start" });
  return tripReducer(started, {
    type: "get/received",
    generation: started.readGeneration,
    snapshot: snap(version),
  });
}

describe("U-01: version floor and preview invalidation", () => {
  it("a GET reporting v6 clears a v5 preview atomically and raises the floor", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 5);
    // Publish a preview for v5.
    s = tripReducer(s, { type: "preview/received", generation: s.previewGeneration, preview: previewFor(5) });
    expect(s.preview).not.toBeNull();

    // A GET reporting v6 raises the floor and clears the v5 preview in one step.
    s = receiveGet(s, 6);
    expect(s.highestObservedVersion).toBe(6);
    expect(s.preview).toBeNull();
    expect(s.snapshot?.version).toBe(6);
  });

  it("a delayed v5 GET after the floor reached 6 is ignored and cannot lower the floor", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 6);
    // A delayed GET for v5 arrives on a NEW generation but below the floor.
    const started = tripReducer(s, { type: "get/start" });
    const after = tripReducer(started, {
      type: "get/received",
      generation: started.readGeneration,
      snapshot: snap(5),
    });
    expect(after.highestObservedVersion).toBe(6);
    expect(after.snapshot?.version).toBe(6); // the v5 snapshot was not accepted
  });

  it("a delayed v5 preview cannot restore a preview once the floor is 6", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 6);
    const stale = tripReducer(s, {
      type: "preview/received",
      generation: s.previewGeneration,
      preview: previewFor(5),
    });
    expect(stale.preview).toBeNull();
    expect(stale.highestObservedVersion).toBe(6);
  });

  it("a conflict reporting v6 clears a v5 preview and raises the floor", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 5);
    s = tripReducer(s, { type: "preview/received", generation: s.previewGeneration, preview: previewFor(5) });
    s = tripReducer(s, { type: "mutation/start", operation: op("k1") });
    // mutation/start already cleared the preview; re-establish via a fresh GET
    // + preview to test conflict specifically.
    s = receiveGet(s, 5);
    s = tripReducer(s, { type: "preview/received", generation: s.previewGeneration, preview: previewFor(5) });
    s = tripReducer(s, { type: "mutation/start", operation: op("k2") });
    const conflicted = tripReducer(s, { type: "mutation/conflict", key: "k2", currentVersion: 6 });
    expect(conflicted.highestObservedVersion).toBe(6);
    expect(conflicted.preview).toBeNull();
    expect(conflicted.pendingOperation).toBeNull();
  });
});

describe("U-04: pending operation lifecycle and Commit gating", () => {
  it("a receipt-backed notApplied (incl. finalized 500) releases the pending op", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 3);
    s = tripReducer(s, { type: "mutation/start", operation: op("k1") });
    expect(s.pendingOperation).not.toBeNull();
    s = tripReducer(s, { type: "mutation/notApplied", key: "k1", currentVersion: 3 });
    expect(s.pendingOperation).toBeNull();
  });

  it("an unknown outcome retains the exact pending operation", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 3);
    s = tripReducer(s, { type: "mutation/start", operation: op("k1") });
    const after = tripReducer(s, { type: "mutation/unknown", key: "k1" });
    expect(after.pendingOperation).toEqual(op("k1"));
  });

  it("a delayed reply for an OLD key cannot clear a newer pending operation", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 3);
    s = tripReducer(s, { type: "mutation/start", operation: op("old") });
    s = tripReducer(s, { type: "mutation/applied", key: "old", mutationVersion: 4 });
    // A new operation starts.
    s = tripReducer(s, { type: "mutation/start", operation: op("new") });
    // A delayed reply for the OLD key must not clear the NEW pending op, but
    // its reported version IS a valid same-trip observation and raises the
    // floor (ISSUE-023: never leave the floor below a reported version).
    const after = tripReducer(s, { type: "mutation/applied", key: "old", mutationVersion: 7 });
    expect(after.pendingOperation).toEqual(op("new"));
    expect(after.highestObservedVersion).toBe(7);
  });

  it("Commit is disabled during a pending mutation and while awaiting a current snapshot", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 5);
    s = tripReducer(s, { type: "preview/received", generation: s.previewGeneration, preview: previewFor(5) });
    expect(canCommit(s)).toBe(true); // current preview, no pending op

    const pending = tripReducer(s, { type: "mutation/start", operation: op("k1") });
    expect(canCommit(pending)).toBe(false); // pending mutation (also clears preview)

    // After a success at v6, the preview is gone and the snapshot is current but
    // there is no preview, so Commit stays disabled until a new preview.
    const applied = tripReducer(pending, { type: "mutation/applied", key: "k1", mutationVersion: 6 });
    expect(canCommit(applied)).toBe(false);
  });

  it("starting a mutation clears the preview and bumps the preview generation", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 5);
    s = tripReducer(s, { type: "preview/received", generation: s.previewGeneration, preview: previewFor(5) });
    const gen = s.previewGeneration;
    const started = tripReducer(s, { type: "mutation/start", operation: op("k1") });
    expect(started.preview).toBeNull();
    expect(started.previewGeneration).toBe(gen + 1);
    // A preview delivered on the OLD generation is ignored.
    const late = tripReducer(started, { type: "preview/received", generation: gen, preview: previewFor(5) });
    expect(late.preview).toBeNull();
  });
});

describe("ISSUE-023: newer version in a discarded payload still raises the floor", () => {
  it("an obsolete-generation GET reporting v6 raises the floor and disables Commit on a v5 preview", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 5);
    s = tripReducer(s, { type: "preview/received", generation: s.previewGeneration, preview: previewFor(5) });
    expect(canCommit(s)).toBe(true);

    // Start a new GET (bumps read generation), then deliver an OLDER-generation
    // GET reporting v6. Its data is discarded, but the floor must rise to 6.
    const started = tripReducer(s, { type: "get/start" });
    const obsolete = tripReducer(started, {
      type: "get/received",
      generation: started.readGeneration - 1, // stale generation
      snapshot: snap(6),
    });
    expect(obsolete.highestObservedVersion).toBe(6);
    expect(obsolete.preview).toBeNull(); // v5 preview cleared by the raised floor
    expect(canCommit(obsolete)).toBe(false);
  });

  it("a below-floor GET on the current generation still does not lower the floor", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 6);
    const started = tripReducer(s, { type: "get/start" });
    const below = tripReducer(started, {
      type: "get/received",
      generation: started.readGeneration,
      snapshot: snap(4),
    });
    expect(below.highestObservedVersion).toBe(6);
    expect(below.snapshot?.version).toBe(6);
  });

  it("a stale-generation preview reporting v6 raises the floor even with no snapshot shown", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 5);
    // Deliver a preview on an old generation reporting a newer base version.
    const stale = tripReducer(s, {
      type: "preview/received",
      generation: s.previewGeneration - 1,
      preview: previewFor(6),
    });
    expect(stale.highestObservedVersion).toBe(6);
    expect(stale.preview).toBeNull();
    // The v5 snapshot is now below the floor and hidden.
    expect(stale.snapshot).toBeNull();
  });
});

describe("ISSUE-023: version/observed applies immediately, independent of a refresh", () => {
  it("a preview-error currentVersion disables Commit on an older preview at once", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 5);
    s = tripReducer(s, { type: "preview/received", generation: s.previewGeneration, preview: previewFor(5) });
    expect(canCommit(s)).toBe(true);

    // A preview 409 reports v6. Applying it must clear the v5 preview and
    // disable Commit BEFORE any GET runs (so a failed GET cannot leave it on).
    const observed = tripReducer(s, { type: "version/observed", version: 6 });
    expect(observed.highestObservedVersion).toBe(6);
    expect(observed.preview).toBeNull();
    expect(canCommit(observed)).toBe(false);
  });

  it("never lowers the floor", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 6);
    const observed = tripReducer(s, { type: "version/observed", version: 4 });
    expect(observed.highestObservedVersion).toBe(6);
  });
});

describe("preview acceptance equality (baseVersion == snapshot.version == floor)", () => {
  it("rejects a preview whose baseVersion does not equal the current snapshot", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 6);
    const mismatched = tripReducer(s, {
      type: "preview/received",
      generation: s.previewGeneration,
      preview: previewFor(5),
    });
    expect(mismatched.preview).toBeNull();
  });

  it("accepts a preview exactly matching the snapshot and floor", () => {
    let s = initialState(TRIP);
    s = receiveGet(s, 6);
    const ok = tripReducer(s, {
      type: "preview/received",
      generation: s.previewGeneration,
      preview: previewFor(6),
    });
    expect(ok.preview?.baseVersion).toBe(6);
    expect(canCommit(ok)).toBe(true);
  });
});

describe("L-17: generations own pending, retry and save", () => {
  it("an obsolete error or success cannot finish the new request, but can advance the floor", () => {
    let s = receiveGet(initialState(TRIP), 5);
    s = tripReducer(s, { type: "preview/start" });
    const old = s.previewGeneration;
    s = tripReducer(s, { type: "preview/start" });
    const current = s.previewGeneration;
    for (const action of [
      { type: "preview/failed", generation: old, currentVersion: 5 },
      { type: "preview/received", generation: old, preview: previewFor(5) },
    ] as const) {
      s = tripReducer(s, action);
      expect(s.previewStatus).toBe("pending");
      expect(canCommit(s)).toBe(false);
    }
    s = tripReducer(s, { type: "preview/failed", generation: old, currentVersion: 6 });
    expect(s.highestObservedVersion).toBe(6);
    expect(s.snapshot).toBeNull();
    expect(s.previewGeneration).toBeGreaterThan(current);
    s = receiveGet(s, 6);
    s = tripReducer(s, { type: "preview/start" });
    s = tripReducer(s, { type: "preview/failed", generation: s.previewGeneration });
    expect(s.previewStatus).toBe("retry");
    expect(canCommit(s)).toBe(false);
    s = tripReducer(s, { type: "preview/start" });
    s = tripReducer(s, { type: "preview/received", generation: s.previewGeneration, preview: previewFor(6) });
    expect(canCommit(s)).toBe(true);
    s = tripReducer(s, { type: "preview/start" });
    expect(canCommit(s)).toBe(false);
    expect(s.preview).toBeNull();
  });
});
