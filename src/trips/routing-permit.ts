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

interface Lookup {
  version: number;
  policy: string;
  readers: number;
  routing?: Holder;
  settled: Map<string, { version: number; leg: Leg }>;
  published: boolean;
  committed: Promise<true>;
  signalCommit(): void;
}
const lookups = new Map<string, Map<string, Lookup>>();
const lookupKey = (version: number, policy: string) => `${version}:${policy}`;

/** Keep settled observations reachable until concurrent lookups finish. */
export function retainForLookup(trip: string, version: number, policy: string) {
  const key = lookupKey(version, policy);
  const tripLookups = lookups.get(trip) ?? new Map<string, Lookup>();
  lookups.set(trip, tripLookups);
  let lookup = tripLookups.get(key);
  if (!lookup) {
    const holder = active.get(trip);
    const routing = holder?.version === version && holder.policy === policy ? holder : undefined;
    let signalCommit!: () => void;
    const committed = new Promise<true>(resolve => { signalCommit = () => resolve(true); });
    lookup = { version, policy, readers: 0, routing, settled: new Map(), published: false, committed, signalCommit };
    // The original holder can already have exited. Copy from overlapping
    // older lookups while preserving each observation's source version.
    for (const other of tripLookups.values()) {
      if (other.version > version || other.policy !== policy) continue;
      for (const [key, observation] of other.settled) {
        const previous = lookup.settled.get(key);
        if (!previous || previous.version <= observation.version) lookup.settled.set(key, observation);
      }
    }
    tripLookups.set(key, lookup);
  }
  const retained = lookup;
  retained.readers++;
  return () => {
    if (--retained.readers !== 0) return;
    tripLookups.delete(key);
    if (!tripLookups.size) lookups.delete(trip);
  };
}

function retainSettled(trip: string, version: number, policy: string, cells: ReadonlyMap<string, Leg>) {
  for (const lookup of lookups.get(trip)?.values() ?? []) {
    if (lookup.version < version || lookup.policy !== policy) continue;
    for (const [key, leg] of cells) {
      const previous = lookup.settled.get(key);
      if (!previous || previous.version <= version) lookup.settled.set(key, { version, leg });
    }
  }
}

// Covered publishers do not own the routing permit. Keep their eligible
// observations reachable independently until the last publisher finishes.
interface Publication {
  version: number;
  policy: string;
  sources: Set<ReadonlyMap<string, Leg>>;
  routing?: Holder;
  done: Promise<boolean>;
  finish(published: boolean): void;
  publishers: number;
}
const publishing = new Map<string, Publication>();

function publicationCells(publication: Publication): ReadonlyMap<string, Leg> {
  const combined = new Map<string, Leg>();
  for (const cells of publication.sources) {
    for (const [key, leg] of cells) combined.set(key, leg);
  }
  for (const [key, leg] of publication.routing?.settled ?? []) combined.set(key, leg);
  return combined;
}

/** Signal durable success independently of publisher lifetime. */
export function notifyPublished(trip: string, version: number, policy: string) {
  const lookup = lookups.get(trip)?.get(lookupKey(version, policy));
  if (lookup) {
    lookup.published = true;
    lookup.signalCommit();
  }
  const publication = publishing.get(trip);
  if (publication?.version === version && publication.policy === policy) publication.finish(true);
}

export function retainForPublication(trip: string, version: number, policy: string, settled: ReadonlyMap<string, Leg>) {
  let publication = publishing.get(trip);
  if (!publication || publication.version !== version || publication.policy !== policy) {
    if (publication) retainSettled(trip, publication.version, publication.policy, publicationCells(publication));
    const holder = active.get(trip);
    const routing = holder?.version === version && holder.policy === policy
      ? holder : lookups.get(trip)?.get(lookupKey(version, policy))?.routing;
    let finish!: (published: boolean) => void;
    const done = new Promise<boolean>(resolve => { finish = resolve; });
    publication = { version, policy, sources: new Set(), routing, done, finish, publishers: 0 };
    publishing.set(trip, publication);
  }
  publication.sources.add(settled);
  publication.publishers++;
  const retained = publication;
  const lookup = lookups.get(trip)?.get(lookupKey(version, policy));
  return {
    routing: retained.routing,
    get published() { return lookup?.published === true; },
    async waitForRouting(deadline: PreviewDeadline) {
      if (!retained.routing) return;
      const completion = [retained.routing.done, retained.done];
      if (lookup) completion.push(lookup.committed);
      await deadline.wait(Promise.race(completion));
    },
    release() {
      if (--retained.publishers !== 0) return;
      retainSettled(trip, retained.version, retained.policy, publicationCells(retained));
      if (publishing.get(trip) === retained) publishing.delete(trip);
      retained.finish(false);
    },
  };
}

/** Supersede older dispatch even on a stored hit. A covered preview can take
 * an immediate copy from the routing holder or a publisher still using its handoff. */
export function observeVersion(trip: string, version: number, snapshotPolicy?: string): Map<string, Leg> | undefined {
  const publication = publishing.get(trip);
  if (publication && publication.version > version) throw stale(publication.version);
  const holder = active.get(trip);
  if (holder && holder.version > version) throw stale(holder.version);
  let snapshot = publication && publication.policy === snapshotPolicy ? new Map(publicationCells(publication)) : undefined;
  if (holder && holder.version < version) {
    holder.controller.abort(stale(version));
    if (holder.policy === snapshotPolicy) {
      snapshot ??= new Map();
      for (const [key, leg] of holder.settled) if (!snapshot.has(key)) snapshot.set(key, leg);
    }
  }
  const lookup = snapshotPolicy && lookups.get(trip)?.get(lookupKey(version, snapshotPolicy));
  if (!lookup || !lookup.settled.size) return snapshot;
  return new Map([
    ...Array.from(lookup.settled, ([key, { leg }]) => [key, leg] as const),
    ...(snapshot ?? []),
  ]);
}

/** Returns no permit when a durable winner is known. The caller must reread it. */
export async function acquireRouting(trip: string, version: number, policy: string, deadline: PreviewDeadline) {
  const key = lookupKey(version, policy);
  const publication = publishing.get(trip);
  let handoff = publication?.policy === policy ? publicationCells(publication) : undefined;
  for (;;) {
    deadline.remaining();
    observeVersion(trip, version);
    const lookup = lookups.get(trip)?.get(key);
    if (lookup?.published) return undefined;
    const previous = active.get(trip);
    if (previous?.version === version) {
      throw new TerminalBusinessError(429, "PREVIEW_BUSY", "A preview is already estimating this trip. Retry shortly.");
    }
    if (previous) {
      const released = previous.done.then(() => false);
      // A covered preview of our version can commit while the superseded
      // holder is still unwinding. Do not wait on the older holder alone.
      if (await deadline.wait(lookup ? Promise.race([released, lookup.committed]) : released)) return undefined;
      handoff = previous.policy === policy ? previous.settled : undefined;
      continue;
    }
    // A covered request that arrived first is already publishing. Wait for
    // its decision before dispatching new routing for that same version.
    const covered = publishing.get(trip);
    if (covered?.version !== version || covered.policy !== policy) break;
    if (await deadline.wait(covered.done)) return undefined;
    handoff = publicationCells(covered);
  }
  const lookup = lookups.get(trip)?.get(key);
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const holder: Holder = {
    version, policy, controller: new AbortController(), done,
    // Take ownership before the DB recheck: even a holder that immediately
    // exits stale must be able to pass validated observations to its successor.
    settled: new Map([
      ...Array.from(lookup?.settled ?? [], ([key, { leg }]) => [key, leg] as const),
      ...(handoff ?? []),
      ...(lookup?.routing?.settled ?? []),
    ]),
    release() {
      if (active.get(trip) === holder) {
        retainSettled(trip, version, policy, holder.settled);
        active.delete(trip);
      }
      finish();
    },
  };
  active.set(trip, holder);
  if (lookup) lookup.routing = holder;
  return holder;
}
