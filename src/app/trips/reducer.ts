// Pure reducer for the trip page's version/preview/pending-operation state
// (docs/ARCHITECTURE.md section 5 "Browser recovery and response ordering").
// No React, DOM, network, or storage here, so the ordering rules (U-01..U-04)
// are unit-testable in isolation. The component wires effects, fetches, and
// sessionStorage around this reducer.

export interface PendingOperation {
  key: string;
  method: "POST" | "PATCH";
  canonicalRoute: string;
  normalizedBody: unknown;
  tripId: string | null;
}

export interface TripSnapshotView {
  id: string;
  version: number;
  status: "open" | "assigned" | "needs_rematch";
  // The component carries the full snapshot; the reducer only needs id/version.
  [key: string]: unknown;
}

export interface PreviewView {
  previewId: string;
  baseVersion: number;
  algorithmVersion: string;
  [key: string]: unknown;
}

export interface TripState {
  tripId: string;
  snapshot: TripSnapshotView | null;
  preview: PreviewView | null;
  highestObservedVersion: number; // the version floor
  readGeneration: number;
  previewGeneration: number;
  pendingOperation: PendingOperation | null;
}

export function initialState(tripId: string): TripState {
  return {
    tripId,
    snapshot: null,
    preview: null,
    highestObservedVersion: 0,
    readGeneration: 0,
    previewGeneration: 0,
    pendingOperation: null,
  };
}

export type TripAction =
  // A GET read returned for a specific read generation.
  | { type: "get/received"; generation: number; snapshot: TripSnapshotView }
  // A preview returned for a specific preview generation.
  | { type: "preview/received"; generation: number; preview: PreviewView }
  // Start a new GET: bump the read generation (older GETs become obsolete).
  | { type: "get/start" }
  // Start a mutation: record the pending op, clear the preview, bump its gen.
  | { type: "mutation/start"; operation: PendingOperation }
  // A mutation succeeded with a known mutation version; clears the pending op.
  | { type: "mutation/applied"; key: string; mutationVersion: number }
  // A terminal not_applied (incl. finalized 500) for this key; clears pending.
  | { type: "mutation/notApplied"; key: string; currentVersion?: number }
  // An unknown/unfinalized outcome: keep the pending op (same key).
  | { type: "mutation/unknown"; key: string }
  // A conflict reporting a newer current version; raises the floor, keeps op?
  | { type: "mutation/conflict"; key: string; currentVersion: number }
  // Restore a pending op from sessionStorage on reload.
  | { type: "pending/restore"; operation: PendingOperation }
  // A version observed from any valid response (e.g. a preview/commit error's
  // currentVersion). Raises the floor and reconciles immediately, independent
  // of fetching new data (ISSUE-023).
  | { type: "version/observed"; version: number };

/** Advance the version floor monotonically; it never decreases. */
function raiseFloor(state: TripState, observed: number | undefined): number {
  if (observed === undefined) return state.highestObservedVersion;
  return Math.max(state.highestObservedVersion, observed);
}

/**
 * In one transition: apply the new floor, then hide any snapshot below it and
 * clear a preview whose base version no longer equals the accepted snapshot and
 * floor. Returns the reconciled snapshot/preview.
 */
function reconcile(
  floor: number,
  snapshot: TripSnapshotView | null,
  preview: PreviewView | null,
): { snapshot: TripSnapshotView | null; preview: PreviewView | null } {
  const visibleSnapshot = snapshot && snapshot.version >= floor ? snapshot : null;
  // The preview is only valid when it matches the accepted snapshot and floor.
  const previewValid =
    preview !== null &&
    visibleSnapshot !== null &&
    preview.baseVersion === visibleSnapshot.version &&
    preview.baseVersion === floor;
  return { snapshot: visibleSnapshot, preview: previewValid ? preview : null };
}

export function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case "get/start":
      return { ...state, readGeneration: state.readGeneration + 1 };

    case "get/received": {
      // ISSUE-023: a newer version observed in ANY valid response raises the
      // floor, even when the payload itself is discarded as obsolete. So
      // compute the floor first, then decide whether to accept the data.
      const floor = raiseFloor(state, action.snapshot.version);
      const dataAcceptable =
        action.generation === state.readGeneration &&
        action.snapshot.version >= state.highestObservedVersion;
      const nextSnapshot = dataAcceptable ? action.snapshot : state.snapshot;
      const { snapshot, preview } = reconcile(floor, nextSnapshot, state.preview);
      return { ...state, snapshot, preview, highestObservedVersion: floor };
    }

    case "preview/received": {
      // A preview's baseVersion is a valid observed version: raise the floor
      // first, regardless of whether this preview is accepted for display.
      const floor = raiseFloor(state, action.preview.baseVersion);
      const acceptable =
        action.generation === state.previewGeneration &&
        state.pendingOperation === null &&
        state.snapshot !== null &&
        action.preview.baseVersion === state.snapshot.version &&
        action.preview.baseVersion === floor;
      if (!acceptable) {
        // Discard the obsolete/stale preview but keep the raised floor, which
        // in one transition clears any now-stale preview and disables Commit.
        const { snapshot, preview } = reconcile(floor, state.snapshot, state.preview);
        return { ...state, snapshot, preview, highestObservedVersion: floor };
      }
      return { ...state, preview: action.preview, highestObservedVersion: floor };
    }

    case "mutation/start": {
      // Starting any mutation clears the preview and increments its generation.
      return {
        ...state,
        preview: null,
        previewGeneration: state.previewGeneration + 1,
        pendingOperation: action.operation,
      };
    }

    case "pending/restore":
      return { ...state, pendingOperation: action.operation };

    case "version/observed": {
      // Raise the floor from an observed version and reconcile in one
      // transition: a stale snapshot is hidden and a now-stale preview cleared,
      // so Commit is disabled immediately even before a refresh completes.
      const floor = raiseFloor(state, action.version);
      const { snapshot, preview } = reconcile(floor, state.snapshot, state.preview);
      return { ...state, snapshot, preview, highestObservedVersion: floor };
    }

    // For every mutation reply we raise the floor from its observed version
    // FIRST — a valid same-trip version observation counts even from an old key
    // (ISSUE-023) — then clear the pending op ONLY when the key still matches
    // (a delayed old-key reply cannot resolve a newer operation).
    case "mutation/applied": {
      const floor = raiseFloor(state, action.mutationVersion);
      const matches = state.pendingOperation?.key === action.key;
      const { snapshot, preview } = reconcile(floor, state.snapshot, state.preview);
      return {
        ...state,
        snapshot,
        preview,
        highestObservedVersion: floor,
        pendingOperation: matches ? null : state.pendingOperation,
      };
    }

    case "mutation/notApplied": {
      const floor = raiseFloor(state, action.currentVersion);
      const matches = state.pendingOperation?.key === action.key;
      const { snapshot, preview } = reconcile(floor, state.snapshot, state.preview);
      return {
        ...state,
        snapshot,
        preview,
        highestObservedVersion: floor,
        pendingOperation: matches ? null : state.pendingOperation,
      };
    }

    case "mutation/conflict": {
      const floor = raiseFloor(state, action.currentVersion);
      const matches = state.pendingOperation?.key === action.key;
      const { snapshot, preview } = reconcile(floor, state.snapshot, state.preview);
      return {
        ...state,
        snapshot,
        preview,
        highestObservedVersion: floor,
        pendingOperation: matches ? null : state.pendingOperation,
      };
    }

    case "mutation/unknown": {
      // Unknown/unfinalized: keep the exact pending operation (same key). A
      // stale reply for an old key cannot clear a newer pending operation.
      if (state.pendingOperation?.key !== action.key) return state;
      return state;
    }

    default:
      return state;
  }
}

/** Commit is allowed only with a current preview and no pending mutation. */
export function canCommit(state: TripState): boolean {
  return (
    state.pendingOperation === null &&
    state.snapshot !== null &&
    state.preview !== null &&
    state.preview.baseVersion === state.snapshot.version &&
    state.snapshot.version === state.highestObservedVersion
  );
}
