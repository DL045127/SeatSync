import { TerminalBusinessError } from "../contracts/errors.ts";
import type { PreviewDeadline } from "../db/deadline.ts";
import type { Leg } from "../matching/address.ts";

export function stale(currentVersion: number) {
  return new TerminalBusinessError(409, "STALE_VERSION", "The trip changed. Refresh and retry.", { currentVersion });
}

interface Holder {
  version: number;
  policy: string;
  controller: AbortController;
  settled: Map<string, Leg>;
  done: Promise<void>;
  release(): void;
}
const active = new Map<string, Holder>();

// Covered publishers do not own the routing permit. Keep their eligible
// observations reachable independently until the last publisher finishes.
interface Publication {
  version: number;
  policy: string;
  settled: ReadonlyMap<string, Leg>;
  publishers: number;
}
const publishing = new Map<string, Publication>();

export function retainForPublication(trip: string, version: number, policy: string, settled: ReadonlyMap<string, Leg>) {
  let publication = publishing.get(trip);
  if (!publication || publication.version !== version || publication.policy !== policy) {
    publication = { version, policy, settled, publishers: 0 };
    publishing.set(trip, publication);
  }
  publication.publishers++;
  return () => {
    if (--publication.publishers === 0 && publishing.get(trip) === publication) publishing.delete(trip);
  };
}

/** Supersede older dispatch even on a stored hit. A covered preview can take
 * an immediate copy from the routing holder or a publisher still using its handoff. */
export function observeVersion(trip: string, version: number, snapshotPolicy?: string): Map<string, Leg> | undefined {
  const publication = publishing.get(trip);
  if (publication && publication.version > version) throw stale(publication.version);
  const holder = active.get(trip);
  if (holder && holder.version > version) throw stale(holder.version);
  let snapshot = publication && publication.policy === snapshotPolicy ? new Map(publication.settled) : undefined;
  if (holder && holder.version < version) {
    holder.controller.abort(stale(version));
    if (holder.policy === snapshotPolicy) {
      snapshot ??= new Map();
      for (const [key, leg] of holder.settled) if (!snapshot.has(key)) snapshot.set(key, leg);
    }
  }
  return snapshot;
}

export async function acquireRouting(trip: string, version: number, policy: string, deadline: PreviewDeadline) {
  const publication = publishing.get(trip);
  let handoff = publication?.policy === policy ? publication.settled : undefined;
  for (;;) {
    deadline.remaining();
    observeVersion(trip, version);
    const previous = active.get(trip);
    if (!previous) break;
    if (previous.version === version) {
      throw new TerminalBusinessError(429, "PREVIEW_BUSY", "A preview is already estimating this trip. Retry shortly.");
    }
    await deadline.wait(previous.done);
    handoff = previous.policy === policy ? previous.settled : undefined;
  }
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const holder: Holder = {
    version, policy, controller: new AbortController(), done,
    // Take ownership before the DB recheck: even a holder that immediately
    // exits stale must be able to pass validated observations to its successor.
    settled: new Map(handoff),
    release() {
      if (active.get(trip) === holder) active.delete(trip);
      finish();
    },
  };
  active.set(trip, holder);
  return holder;
}
