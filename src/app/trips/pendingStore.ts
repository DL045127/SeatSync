// One tab-wide unresolved-operation record in sessionStorage, shared by trip
// creation and trip mutations (docs/ARCHITECTURE.md section 5: "Allow one
// unresolved mutation per tab"). A single key per tab enforces the one-pending
// invariant across the create page and the trip page, so a lost creation is
// recoverable with its original key and a second submission cannot bypass it.

import type { PendingOperation } from "./reducer.ts";

// Versioned, tab-wide (not per-trip): the invariant is one operation per TAB.
const KEY = "groupride.pending.v1";

export function readPending(): PendingOperation | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingOperation) : null;
  } catch {
    return null;
  }
}

/** Returns false if the write fails (mutations must then be blocked). */
export function writePending(op: PendingOperation): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(op));
    return true;
  } catch {
    return false;
  }
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: "blocked" }
  | { ok: false; reason: "occupied"; owner: PendingOperation };

/**
 * Claim the tab's single pending slot for `op` (ISSUE-021). Refuses to
 * overwrite a slot already owned by a DIFFERENT key, regardless of which page
 * or trip owns it, and reports the current owner so the caller can direct the
 * user to resolve it. Writing the same key again (a retry) is allowed. Returns
 * `blocked` when storage cannot be written at all.
 */
export function claimSlot(op: PendingOperation): ClaimResult {
  const existing = readPending();
  if (existing && existing.key !== op.key) {
    return { ok: false, reason: "occupied", owner: existing };
  }
  if (!writePending(op)) return { ok: false, reason: "blocked" };
  return { ok: true };
}

/** Clear the slot only if it is still owned by `key` (release guard). */
export function clearPendingIfOwner(key: string): void {
  if (readPending()?.key === key) clearPending();
}

export function clearPending(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Best effort: a failed clear leaves the record for a later reload to see.
  }
}

/** The shape of a response body relevant to receipt resolution. */
export interface OperationResponse {
  operation?: { key?: string; outcome?: string };
  error?: { currentVersion?: number };
}

/**
 * The single receipt check used by BOTH pages (ISSUE-022). A pending operation
 * is resolved (and its storage slot cleared) ONLY when the response carries a
 * receipt-backed terminal outcome for the SAME key: `operation.key === sentKey`
 * and `operation.outcome` is `applied` or `not_applied`. Everything else —
 * a 503, an `unknown` outcome, missing metadata (incl. a bare 500 or a
 * key-reuse 409), a mismatched key, or a network error — retains the exact
 * operation for same-key retry.
 */
export function isTerminalForKey(sentKey: string, body: OperationResponse): boolean {
  const op = body.operation;
  if (!op || op.key === undefined) return false;
  if (op.key.toLowerCase() !== sentKey.toLowerCase()) return false;
  return op.outcome === "applied" || op.outcome === "not_applied";
}

/** Whether sessionStorage can be written at all (SSR returns true optimistically). */
export function storageWritable(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const probe = "groupride.probe";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
