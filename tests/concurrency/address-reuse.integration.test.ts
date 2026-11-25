// Checkpoint B against real PostgreSQL: L-05 (hand fixtures through projection, preview, commit
// and reload), L-07 (reused vs forced cold), L-08 (2 -> 0 -> 2 seats through an outage), L-09
// (dormant rows, restoration, pruning and the 0 / 51 / 21 incremental cell counts) and the
// service-level L-10 cases. Every expected number is derived BY HAND from the raw directed
// seconds given to the routing double, never from the code under test.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db/pool.ts";
import { commitPreview } from "../../src/trips/commit.ts";
import { publishPreview } from "../../src/trips/preview.ts";
import { addressCounters, resetAddressCounters } from "../../src/trips/address-metrics.ts";
import { editDriver, getTripSnapshot, withdrawRequest } from "../../src/trips/service.ts";
import { addRequest } from "../../src/trips/service.ts";
import {
  APP,
  SETUP,
  addSyntheticDriver,
  addSyntheticPassenger,
  createSyntheticTrip,
  hashSeconds,
  installRouting,
  key,
  mint,
  resetTestDatabase,
  spots,
  useFixtureEnvironment,
  type FixtureEnv,
  type RoutingDouble,
  type Spot,
} from "./helpers/address.ts";

let env: FixtureEnv;
let pool: Pool;
let admin: Pool;
let routing: RoutingDouble | undefined;

beforeEach(async () => {
  env = useFixtureEnvironment();
  await resetTestDatabase();
  pool = createPool(APP, 4);
  admin = createPool(SETUP, 1);
  resetAddressCounters();
});
afterEach(async () => {
  routing?.restore();
  routing = undefined;
  await pool.end();
  await admin.end();
  env.dispose();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- helpers over the real service ------------------------------------------

async function version(tripId: string): Promise<number> {
  return (await getTripSnapshot(pool, tripId))!.version;
}
async function setSeats(tripId: string, driverId: string, seats: number): Promise<void> {
  const res = await editDriver(pool, tripId, driverId, key(), { baseVersion: await version(tripId), seatCapacity: seats });
  expect(res.httpStatus).toBe(200);
}
async function cancelDriver(tripId: string, driverId: string): Promise<void> {
  const res = await editDriver(pool, tripId, driverId, key(), { baseVersion: await version(tripId), active: false });
  expect(res.httpStatus).toBe(200);
}
async function withdraw(tripId: string, passengerId: string): Promise<void> {
  const res = await withdrawRequest(pool, tripId, passengerId, key(), { baseVersion: await version(tripId), active: false });
  expect(res.httpStatus).toBe(200);
}

interface StoredEvidence {
  venue: { id: string; providerRef: string };
  drivers: Array<{ id: string; seats: number; location: { id: string; providerRef: string } }>;
  passengers: Array<{ id: string; location: { id: string; providerRef: string } }>;
  legs: Array<{ from: string; to: string; seconds: number | null; source: string; observedAt: string | null }>;
}
async function evidenceOf(previewId: string): Promise<StoredEvidence> {
  return (await admin.query<{ evidence: StoredEvidence }>("SELECT evidence FROM match_previews WHERE id = $1", [previewId])).rows[0].evidence;
}
/** Legs keyed by `fromRef>toRef`, translating location IDs through the evidence's own participants. */
function legsByRef(e: StoredEvidence): Map<string, StoredEvidence["legs"][number]> {
  const ref = new Map<string, string>([[e.venue.id, e.venue.providerRef]]);
  for (const d of e.drivers) ref.set(d.location.id, d.location.providerRef);
  for (const p of e.passengers) ref.set(p.location.id, p.location.providerRef);
  return new Map(e.legs.map((l) => [`${ref.get(l.from)}>${ref.get(l.to)}`, l]));
}
const previewCount = async (tripId: string) =>
  Number((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM match_previews WHERE trip_id = $1", [tripId])).rows[0].n);

// ============================ L-05: the hand fixtures ============================

describe("L-05: both hand fixtures through projection, preview, commit and reload", () => {
  test("fixture 1 (minutes in the design): the optimum is D1->P2 (2 min) + D2->P1 (1 min) = 180 s", async () => {
    const [V, S1, S2, Q1, Q2] = spots("f1", 5);
    const minutes = (m: number) => m * 60;
    const table = new Map<string, number>([
      [`${S1.ref}>${V.ref}`, minutes(20)], [`${S2.ref}>${V.ref}`, minutes(24)],
      [`${Q1.ref}>${V.ref}`, minutes(10)], [`${Q2.ref}>${V.ref}`, minutes(12)],
      [`${S1.ref}>${Q1.ref}`, minutes(15)], [`${S1.ref}>${Q2.ref}`, minutes(10)],
      [`${S2.ref}>${Q1.ref}`, minutes(15)], [`${S2.ref}>${Q2.ref}`, minutes(20)],
    ]);
    routing = installRouting((f, t) => table.get(`${f.providerRef}>${t.providerRef}`) ?? null);
    const tripId = await createSyntheticTrip(pool, V);
    await addSyntheticDriver(pool, tripId, "D1", S1, 1, 15);
    await addSyntheticDriver(pool, tripId, "D2", S2, 1, 15);
    await addSyntheticPassenger(pool, tripId, "P1", Q1);
    await addSyntheticPassenger(pool, tripId, "P2", Q2);

    const preview = await publishPreview(pool, tripId);
    expect(preview.body.optimal).toMatchObject({ matchedCount: 2, totalCost: 180 });
    const snap = (await getTripSnapshot(pool, tripId))!;
    const name = (id: string) => [...snap.drivers, ...snap.requests].find((m) => m.id === id)!.name;
    expect(preview.body.optimal.assignments.map((a) => `${name(a.passengerId)}->${name(a.driverId)}:${a.cost}`).sort())
      .toEqual(["P1->D2:60", "P2->D1:120"]); // 1 and 2 minutes, as derived by hand
    expect(routing.stats.cells).toBe(8 + 0); // 2x2 driver->pickup, 2 driver->venue, 2 pickup->venue = 8

    const committed = await commitPreview(pool, tripId, key(), { previewId: preview.body.previewId });
    expect(committed.httpStatus).toBe(200);
    const saved = (await getTripSnapshot(pool, tripId))!;
    expect(saved).toMatchObject({ status: "assigned", costUnit: "detour_seconds", totals: { matched: 2, totalCost: 180 } });
    expect(saved.assignments.map((a) => `${name(a.requestId)}->${name(a.driverId)}:${a.pickupCost}`).sort())
      .toEqual(["P1->D2:60", "P2->D1:120"]);
  });

  /** Fixture 2 in seconds. The ROLE of each pickup follows its UUID order, so greedy's choice is well defined. */
  async function fixture2(direction: "forward" | "reversed") {
    const [W, T1, T2, RA, RB] = spots(`f2${direction}`, 5);
    const roles = { first: RA.ref, second: RB.ref };
    const forward = (e1: number, e2: number) => (f: { providerRef: string }, t: { providerRef: string }): number | null => {
      const key = `${f.providerRef}>${t.providerRef}`;
      const table: Record<string, number> = {
        [`${T1.ref}>${W.ref}`]: 1200, [`${T2.ref}>${W.ref}`]: 1200, [`${roles.first}>${W.ref}`]: 600, [`${roles.second}>${W.ref}`]: 600,
        [`${T1.ref}>${roles.first}`]: 660, [`${T1.ref}>${roles.second}`]: e1, [`${T2.ref}>${roles.first}`]: 720, [`${T2.ref}>${roles.second}`]: e2,
      };
      return table[key] ?? null;
    };
    // The reversed adapter reads the P->D time wherever D->P is wanted.
    const backward: Record<string, () => number> = {
      [`${T1.ref}>${roles.first}`]: () => 660, [`${T1.ref}>${roles.second}`]: () => 1550,
      [`${T2.ref}>${roles.first}`]: () => 1600, [`${T2.ref}>${roles.second}`]: () => 720,
    };
    const correct = forward(1500, 1501);
    routing = installRouting((f, t) => {
      const key = `${f.providerRef}>${t.providerRef}`;
      return direction === "reversed" && backward[key] ? backward[key]() : correct(f, t);
    });
    const tripId = await createSyntheticTrip(pool, W);
    const e1 = await addSyntheticDriver(pool, tripId, "E1", T1, 1, 15);
    const e2 = await addSyntheticDriver(pool, tripId, "E2", T2, 1, 15);
    const ida = await addSyntheticPassenger(pool, tripId, "Pa", RA);
    const idb = await addSyntheticPassenger(pool, tripId, "Pb", RB);
    // The pickup with the smaller UUID is processed first by greedy: it plays the doc's P1.
    if (ida < idb) Object.assign(roles, { first: RA.ref, second: RB.ref });
    else Object.assign(roles, { first: RB.ref, second: RA.ref });
    const firstId = ida < idb ? ida : idb;
    const secondId = ida < idb ? idb : ida;
    return { tripId, e1, e2, firstId, secondId };
  }

  test("fixture 2: coverage before cost (2 for 1,020 s, greedy 1 for 60 s), the inclusive 900 s limit and the 901 s exclusion", async () => {
    const f = await fixture2("forward");
    const preview = await publishPreview(pool, f.tripId);
    expect(preview.body.optimal).toMatchObject({ matchedCount: 2, totalCost: 1020 });
    // P1 (first) -> E2 at 120 s, P2 (second) -> E1 at EXACTLY 900 s (1500 + 600 - 1200).
    expect(preview.body.optimal.assignments.map((a) => [a.passengerId, a.driverId, a.cost]))
      .toEqual([[f.firstId, f.e2, 120], [f.secondId, f.e1, 900]].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
    // If E2->P2 (901 s) were eligible the optimum would be 60 + 901 = 961: the exclusion is observable.
    expect(preview.body.optimal.totalCost).not.toBe(961);
    expect(preview.body.greedy).toMatchObject({ matchedCount: 1, totalCost: 60, unassignedPassengerIds: [f.secondId] });

    const committed = await commitPreview(pool, f.tripId, key(), { previewId: preview.body.previewId });
    expect(committed.httpStatus).toBe(200);
    const saved = (await getTripSnapshot(pool, f.tripId))!;
    expect(saved).toMatchObject({ status: "assigned", totals: { matched: 2, totalCost: 1020 } });
    expect(saved.assignments.map((a) => [a.requestId, a.driverId, a.pickupCost]).sort())
      .toEqual([[f.firstId, f.e2, 120], [f.secondId, f.e1, 900]].sort());
  });

  test("fixture 2: an adapter that asks for the REVERSE direction falsely reports 2 matches for 180 s", async () => {
    const f = await fixture2("reversed");
    const preview = await publishPreview(pool, f.tripId);
    expect(preview.body.optimal).toMatchObject({ matchedCount: 2, totalCost: 180 });
    expect(preview.body.optimal.totalCost).not.toBe(1020); // the defect is visible, so this fixture would catch it
  });
});

// ============================ L-07: reused equals forced cold ============================

describe("L-07: a reused preview after edits equals a forced cold preview on the same roster IDs", () => {
  test("identical legs, edges, optimal and greedy results; timestamps and call counts differ", async () => {
    routing = installRouting();
    const [V] = spots("v", 1);
    const D = spots("d", 4, 10);
    const P = spots("p", 5, 30);
    const tripId = await createSyntheticTrip(pool, V);
    const d0 = await addSyntheticDriver(pool, tripId, "D0", D[0], 1, 120);
    const d1 = await addSyntheticDriver(pool, tripId, "D1", D[1], 2, 120);
    await addSyntheticDriver(pool, tripId, "D2", D[2], 1, 120);
    await addSyntheticPassenger(pool, tripId, "P0", P[0]);
    const p1 = await addSyntheticPassenger(pool, tripId, "P1", P[1]);
    await addSyntheticPassenger(pool, tripId, "P2", P[2]);
    await addSyntheticPassenger(pool, tripId, "P3", P[3]);

    const history: Array<[string, number]> = [];
    const step = async (label: string) => {
      await sleep(8); // distinct millisecond timestamps for each observation batch
      const before = routing!.stats.cells;
      const preview = await publishPreview(pool, tripId);
      history.push([label, routing!.stats.cells - before]);
      return preview;
    };
    await step("first (cold)");
    await addSyntheticDriver(pool, tripId, "D3", D[3], 1, 120);
    await step("add a driver");
    await withdraw(tripId, p1);
    await step("withdraw a passenger");
    await setSeats(tripId, d1, 0);
    await step("seats 2 -> 0");
    await setSeats(tripId, d1, 2);
    await step("seats 0 -> 2");
    await addSyntheticPassenger(pool, tripId, "P4", P[4]);
    const reused = await step("add a passenger");
    expect(history.map(([, cells]) => cells)).toEqual([
      3 * 4 + 3 + 4, // cold: 3 drivers x 4 passengers + 3 driver->venue + 4 pickup->venue
      4 + 1,         // D3: four driver->pickup + one driver->venue
      0, 0, 0,       // withdrawal, 2 -> 0 and 0 -> 2 need no new observation
      4 + 1,         // P4: four driver->pickup (D0, D1, D2, D3) + one pickup->venue
    ]);
    const reusedEvidence = await evidenceOf(reused.body.previewId);
    const reusedDelta = history[history.length - 1][1];

    // Forced cold control on the SAME roster IDs: delete every preview of the trip, then preview again.
    await admin.query("DELETE FROM match_previews WHERE trip_id = $1", [tripId]);
    expect(await previewCount(tripId)).toBe(0);
    routing.reset();
    await sleep(8);
    const cold = await publishPreview(pool, tripId);
    const coldEvidence = await evidenceOf(cold.body.previewId);
    const requiredCold = 4 * 4 + 4 + 4; // 4 driving drivers x 4 active passengers + 4 + 4
    expect(routing.stats.cells).toBe(requiredCold);
    expect(reusedDelta).toBeLessThan(requiredCold); // call counts, compared separately

    // Identical results.
    expect(cold.body.optimal).toEqual(reused.body.optimal);
    expect(cold.body.greedy).toEqual(reused.body.greedy);
    expect(cold.body.baseVersion).toBe(reused.body.baseVersion);
    expect(d0).toBeDefined();

    // Identical REQUIRED leg values (seconds, no-route and source); timestamps compared separately.
    const requiredRefs = (e: StoredEvidence) => {
      const driving = e.drivers.filter((d) => d.seats > 0).map((d) => d.location.providerRef);
      const pickups = e.passengers.map((p) => p.location.providerRef);
      return [
        ...driving.flatMap((d) => pickups.map((p) => `${d}>${p}`)),
        ...driving.map((d) => `${d}>${e.venue.providerRef}`),
        ...pickups.map((p) => `${p}>${e.venue.providerRef}`),
      ].sort();
    };
    expect(requiredRefs(coldEvidence)).toEqual(requiredRefs(reusedEvidence));
    const a = legsByRef(reusedEvidence);
    const b = legsByRef(coldEvidence);
    for (const ref of requiredRefs(coldEvidence)) {
      expect({ s: a.get(ref)?.seconds, src: a.get(ref)?.source }, ref).toEqual({ s: b.get(ref)?.seconds, src: b.get(ref)?.source });
    }
    // The reused history kept OLDER observation times for the carried legs; the cold control is all new.
    const earliest = (e: StoredEvidence) => e.legs.map((l) => l.observedAt).filter((t): t is string => t !== null).sort()[0];
    expect(earliest(reusedEvidence) < earliest(coldEvidence)).toBe(true);
    const reusedSummary = reused.body.estimate!;
    const coldSummary = cold.body.estimate!;
    expect(reusedSummary.legs).toMatchObject({ required: requiredCold, fetched: reusedDelta });
    expect(reusedSummary.legs.reused).toBe(requiredCold - reusedDelta);
    expect(coldSummary.legs).toMatchObject({ required: requiredCold, fetched: requiredCold, reused: 0 });
    expect(reusedSummary.observedFrom! < coldSummary.observedFrom!).toBe(true);
  });
});

// ============================ L-08: 2 -> 0 -> 2 through an outage ============================

describe.each([
  ["the provider is disabled", (rt: RoutingDouble) => { process.env.GROUPRIDE_ADDRESS_PROVIDER = "off"; void rt; }],
  ["routing fails", (rt: RoutingDouble) => rt.setOutage(true)],
])("L-08: seats 2 -> 0 -> 2 while %s", (_mode, breakRouting) => {
  test.each([["X is the only driver", false], ["another driver Y also serves", true]])("%s", async (_who, withY) => {
    routing = installRouting();
    const [V, XS, YS, PS] = spots("l8", 4);
    const tripId = await createSyntheticTrip(pool, V);
    const x = await addSyntheticDriver(pool, tripId, "X", XS, 2, 120);
    if (withY) await addSyntheticDriver(pool, tripId, "Y", YS, 1, 120);
    const p = await addSyntheticPassenger(pool, tripId, "P", PS);

    const v3 = await publishPreview(pool, tripId); // observed while routing worked
    const e3 = legsByRef(await evidenceOf(v3.body.previewId));
    const cellsAtV3 = routing.stats.cells;
    expect(cellsAtV3).toBe(withY ? 5 : 3);
    const h = (a: Spot, b: Spot) => hashSeconds({ providerRef: a.ref }, { providerRef: b.ref });
    const detourOf = (driver: Spot) => Math.max(0, Math.round(h(driver, PS) + h(PS, V) - h(driver, V)));

    breakRouting(routing);
    const attemptsBefore = routing.stats.attempts;

    await setSeats(tripId, x, 0);
    const v4 = await publishPreview(pool, tripId); // must publish even though routing is down
    const e4 = legsByRef(await evidenceOf(v4.body.previewId));
    if (withY) {
      expect(v4.body.optimal.assignments).toHaveLength(1); // Y carries P; X is assigned nothing
      expect(v4.body.optimal.totalCost).toBe(detourOf(YS));
    } else {
      expect(v4.body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0, unassignedPassengerIds: [p] });
    }
    expect(v4.body.estimate!.legs).toEqual(withY
      ? { required: 3, fetched: 0, reused: 3, local: 0 }
      : { required: 0, fetched: 0, reused: 0, local: 0 });
    // X's legs are RETAINED while dormant, with their original observation times.
    for (const ref of [`${XS.ref}>${PS.ref}`, `${XS.ref}>${V.ref}`, `${PS.ref}>${V.ref}`]) {
      expect(e4.get(ref), ref).toBeDefined();
      expect(e4.get(ref)!.observedAt).toBe(e3.get(ref)!.observedAt);
    }

    await setSeats(tripId, x, 2);
    const v5 = await publishPreview(pool, tripId);
    const e5 = legsByRef(await evidenceOf(v5.body.previewId));
    // The cold-equivalent plan: the cheaper of X and Y (or X alone) carries P.
    const best = withY ? Math.min(detourOf(XS), detourOf(YS)) : detourOf(XS);
    expect(v5.body.optimal).toMatchObject({ matchedCount: 1, totalCost: best });
    expect(v5.body.estimate!.legs).toEqual({ required: withY ? 5 : 3, fetched: 0, reused: withY ? 5 : 3, local: 0 });
    for (const ref of [`${XS.ref}>${PS.ref}`, `${XS.ref}>${V.ref}`, `${PS.ref}>${V.ref}`]) {
      expect(e5.get(ref)!.observedAt, ref).toBe(e3.get(ref)!.observedAt); // original times survive two previews
    }
    expect(routing.stats.cells).toBe(cellsAtV3); // zero new upstream cells
    expect(routing.stats.attempts).toBe(attemptsBefore); // routing was never even asked
  });
});

// ============================ L-09: dormant rows, restoration, pruning ============================

describe("L-09: retention, restoration and pruning", () => {
  test("a dormant driver's row is never fetched; restoration fetches only the missing required legs", async () => {
    routing = installRouting();
    const [V, XS, PS, QS] = spots("l9", 4);
    const tripId = await createSyntheticTrip(pool, V);
    const x = await addSyntheticDriver(pool, tripId, "X", XS, 2, 120);
    await addSyntheticPassenger(pool, tripId, "P", PS);
    await publishPreview(pool, tripId); // XP, XV, PV observed
    expect(routing.stats.cells).toBe(3);

    await setSeats(tripId, x, 0);
    await publishPreview(pool, tripId);
    await addSyntheticPassenger(pool, tripId, "Q", QS); // a new pickup while X offers no seats
    const dormant = await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(3); // NOTHING was requested for X's dormant row (X->Q) or for Q->V
    expect(routing.stats.attempts).toBe(1);
    const dormantLegs = legsByRef(await evidenceOf(dormant.body.previewId));
    expect([...dormantLegs.keys()].sort()).toEqual([`${PS.ref}>${V.ref}`, `${XS.ref}>${PS.ref}`, `${XS.ref}>${V.ref}`].sort());

    // Restoring capacity with routing DOWN: a genuinely missing leg prevents publication.
    await setSeats(tripId, x, 2);
    routing.setOutage(true);
    const rowsBefore = await previewCount(tripId);
    await expect(publishPreview(pool, tripId)).rejects.toMatchObject({ code: "ROUTING_UNAVAILABLE" });
    expect(await previewCount(tripId)).toBe(rowsBefore); // no partial row
    expect((await getTripSnapshot(pool, tripId))!.drivers[0].seatCapacity).toBe(2); // the dashboard stays readable

    // Routing back: exactly the two missing required legs are fetched.
    routing.setOutage(false);
    routing.reset();
    const restored = await publishPreview(pool, tripId);
    expect(routing.stats.requested.sort()).toEqual([`${QS.ref}>${V.ref}`, `${XS.ref}>${QS.ref}`].sort());
    expect(restored.body.estimate!.legs).toEqual({ required: 5, fetched: 2, reused: 3, local: 0 });
  });

  test("withdrawal prunes legs of an unused location, while a SHARED active location keeps them", async () => {
    routing = installRouting();
    const [V, XS, PS] = spots("l9p", 3);
    const tripId = await createSyntheticTrip(pool, V);
    await addSyntheticDriver(pool, tripId, "X", XS, 3, 120);
    // One pickup token serves two passengers: they share one location ID.
    const shared = await mint(pool, "pickup", tripId, PS);
    const ids: string[] = [];
    for (const name of ["Pa", "Pb"]) {
      const res = await addRequest(pool, tripId, key(), { name, pickupSelectionToken: shared });
      expect(res.httpStatus).toBe(201);
      ids.push((res.body as { id: string }).id);
    }
    const first = await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(3);
    expect(legsByRef(await evidenceOf(first.body.previewId)).has(`${PS.ref}>${V.ref}`)).toBe(true);

    await withdraw(tripId, ids[0]); // Pb still references the location
    const kept = await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(3);
    expect(legsByRef(await evidenceOf(kept.body.previewId)).has(`${XS.ref}>${PS.ref}`)).toBe(true);

    await withdraw(tripId, ids[1]); // the last reference: its legs are pruned from the next preview
    const pruned = await publishPreview(pool, tripId);
    const prunedLegs = legsByRef(await evidenceOf(pruned.body.previewId));
    expect([...prunedLegs.keys()]).toEqual([`${XS.ref}>${V.ref}`]);
    expect(pruned.body.optimal).toMatchObject({ matchedCount: 0 });
  });

  test("incremental cells on distinct coordinates: 0 for a cut, withdrawal or cancellation; 51 for the 20th driver", async () => {
    routing = installRouting();
    const [V] = spots("v", 1);
    const D = spots("d", 20, 100);
    const P = spots("p", 50, 200);
    const tripId = await createSyntheticTrip(pool, V);
    const driverIds: string[] = [];
    const passengerIds: string[] = [];
    for (let i = 0; i < 19; i += 1) driverIds.push(await addSyntheticDriver(pool, tripId, `D${i}`, D[i], 1, 120));
    for (let i = 0; i < 50; i += 1) passengerIds.push(await addSyntheticPassenger(pool, tripId, `P${i}`, P[i]));

    await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(19 * 50 + 19 + 50); // cold

    routing.reset();
    await addSyntheticDriver(pool, tripId, "D19", D[19], 1, 120);
    await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(50 + 1); // the 20th driver: 50 driver->pickup + 1 driver->venue
    expect(routing.stats.requested.every((r) => r.startsWith(`${D[19].ref}>`))).toBe(true);

    routing.reset();
    await setSeats(tripId, driverIds[2], 0); // a capacity cut
    await publishPreview(pool, tripId);
    await cancelDriver(tripId, driverIds[3]); // a cancellation
    await publishPreview(pool, tripId);
    await withdraw(tripId, passengerIds[7]); // a withdrawal
    await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(0);
    expect(routing.stats.attempts).toBe(0);
  }, 60_000);

  test("incremental cells on distinct coordinates: 21 for the 50th pickup", async () => {
    routing = installRouting();
    const [V] = spots("v", 1);
    const D = spots("d", 20, 100);
    const P = spots("p", 50, 200);
    const tripId = await createSyntheticTrip(pool, V);
    for (let i = 0; i < 20; i += 1) await addSyntheticDriver(pool, tripId, `D${i}`, D[i], 1, 120);
    for (let i = 0; i < 49; i += 1) await addSyntheticPassenger(pool, tripId, `P${i}`, P[i]);
    await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(20 * 49 + 20 + 49);

    routing.reset();
    await addSyntheticPassenger(pool, tripId, "P49", P[49]);
    await publishPreview(pool, tripId);
    expect(routing.stats.cells).toBe(20 + 1); // 20 driver->pickup + 1 pickup->venue
    expect(routing.stats.requested.every((r) => r.includes(P[49].ref))).toBe(true);
  }, 60_000);
});

// ============================ L-10: the service-level cases ============================

describe("L-10: equal and nearby coordinates, no-route on each leg, empties, rounding, clamping", () => {
  /** Run one scenario and return the preview and what the double was asked. */
  async function scenario(opts: {
    venue: Spot;
    drivers: Array<{ name: string; spot: Spot; seats: number; limit: number }>;
    passengers: Array<{ name: string; spot: Spot }>;
    seconds: (f: { providerRef: string }, t: { providerRef: string }) => number | null;
  }) {
    routing = installRouting((f, t) => opts.seconds(f, t));
    const tripId = await createSyntheticTrip(pool, opts.venue);
    for (const d of opts.drivers) await addSyntheticDriver(pool, tripId, d.name, d.spot, d.seats, d.limit);
    for (const p of opts.passengers) await addSyntheticPassenger(pool, tripId, p.name, p.spot);
    const preview = await publishPreview(pool, tripId);
    const snap = (await getTripSnapshot(pool, tripId))!;
    const name = (id: string) => [...snap.drivers, ...snap.requests].find((m) => m.id === id)!.name;
    return {
      preview,
      stats: routing.stats,
      pairs: preview.body.optimal.assignments.map((a) => `${name(a.passengerId)}->${name(a.driverId)}:${a.cost}`).sort(),
      unassigned: preview.body.optimal.unassignedPassengerIds.map(name).sort(),
    };
  }
  const [V, S, A, B] = spots("l10", 4);
  const flat = (n: number) => () => n;

  test("equal coordinates under DIFFERENT location IDs add zero upstream cells, are local zeros and a usable zero-cost edge", async () => {
    // P1 shares the driver's coordinates (and place) under its own token; with limit 0 only a zero-cost edge fits.
    const r = await scenario({ venue: V, drivers: [{ name: "D", spot: S, seats: 2, limit: 0 }], passengers: [{ name: "P1", spot: S }, { name: "P2", spot: A }], seconds: (f, t) => 500 + f.providerRef.length * 0 + (t.providerRef === V.ref ? 0 : 7) });
    // Required: S->S' (local), S->A, S->V, S'->V, A->V: only four need the provider.
    expect(r.stats.cells).toBe(4);
    expect(r.stats.requested.includes(`${S.ref}>${S.ref}`)).toBe(false);
    expect(r.preview.body.estimate!.legs).toEqual({ required: 5, fetched: 4, reused: 0, local: 1 });
    // P1: dp = 0 (local), pv = dv (same place): extra is exactly 0, which a 0-minute limit admits.
    expect(r.pairs).toContain("P1->D:0");
    expect(r.unassigned).toEqual(["P2"]); // P2's detour (S->A 507 + A->V 500 - S->V 500 = 507 s) exceeds a 0-minute limit
  });

  test("NEARLY equal coordinates are NOT identical: the leg is routed", async () => {
    const near: Spot = { ref: "near", lon: S.lon + 1e-7, lat: S.lat };
    const r = await scenario({ venue: V, drivers: [{ name: "D", spot: S, seats: 1, limit: 120 }], passengers: [{ name: "P", spot: near }], seconds: flat(600) });
    expect(r.stats.cells).toBe(3); // S->near is a real routed leg
    expect(r.stats.requested).toContain(`${S.ref}>${near.ref}`);
    expect(r.preview.body.estimate!.legs.local).toBe(0);
  });

  test.each([
    ["driver -> pickup", (f: { providerRef: string }, t: { providerRef: string }) => (f.providerRef === S.ref && t.providerRef === A.ref ? null : 600), ["Pa"], ["Pb"]],
    ["pickup -> venue", (f: { providerRef: string }, t: { providerRef: string }) => (f.providerRef === A.ref && t.providerRef === V.ref ? null : 600), ["Pa"], ["Pb"]],
    ["driver -> venue", (f: { providerRef: string }, t: { providerRef: string }) => (f.providerRef === S.ref && t.providerRef === V.ref ? null : 600), [], ["Pa", "Pb"]],
  ])("a confirmed no-route on the %s leg excludes only its dependent pairs, never a free edge", async (_leg, seconds, excluded, expectedMatched) => {
    void expectedMatched;
    const r = await scenario({ venue: V, drivers: [{ name: "D", spot: S, seats: 2, limit: 120 }], passengers: [{ name: "Pa", spot: A }, { name: "Pb", spot: B }], seconds });
    if (_leg === "driver -> venue") {
      expect(r.pairs).toEqual([]); // the driver cannot reach the venue at all
      expect(r.unassigned).toEqual(["Pa", "Pb"]);
    } else {
      expect(r.unassigned).toEqual(excluded); // only Pa's pair is excluded
      expect(r.pairs).toHaveLength(1);
      expect(r.pairs[0].startsWith("Pb->D:")).toBe(true);
    }
  });

  test("a separate unreachable leg still excludes a pair whose other legs are local", async () => {
    // P shares the driver's coordinates (D->P local zero) but P->V has no route: the pair stays ineligible.
    const r = await scenario({ venue: V, drivers: [{ name: "D", spot: S, seats: 1, limit: 120 }], passengers: [{ name: "P", spot: S }], seconds: (f, t) => (f.providerRef === S.ref && t.providerRef === V.ref ? null : 600) });
    expect(r.pairs).toEqual([]);
    expect(r.unassigned).toEqual(["P"]);
    expect(r.preview.body.estimate!.legs.local).toBe(1);
  });

  test("empty demand makes no provider request at all; exhausted seats leave the rest unassigned", async () => {
    const none = await scenario({ venue: V, drivers: [{ name: "D", spot: S, seats: 2, limit: 120 }], passengers: [], seconds: flat(600) });
    expect(none.stats.attempts).toBe(0);
    expect(none.preview.body.optimal).toMatchObject({ matchedCount: 0, totalCost: 0 });
    const full = await scenario({ venue: V, drivers: [{ name: "D", spot: S, seats: 1, limit: 120 }], passengers: [{ name: "Pa", spot: A }, { name: "Pb", spot: B }, { name: "Pc", spot: spots("c", 1, 900)[0] }], seconds: flat(600) });
    expect(full.preview.body.optimal.matchedCount).toBe(1);
    expect(full.unassigned).toHaveLength(2);
  });

  test("ISSUE-069: a FRACTIONAL negative estimate (-0.25 s) is counted even though it rounds to a zero-cost edge", async () => {
    // dp = 100, pv = 50, dv = 150.25  =>  -0.25 s: rounds to 0, but the estimate IS negative.
    resetAddressCounters();
    const r = await scenario({ venue: V, drivers: [{ name: "D", spot: S, seats: 1, limit: 0 }], passengers: [{ name: "P", spot: A }], seconds: (f, t) => (t.providerRef === A.ref ? 100 : f.providerRef === A.ref ? 50 : 150.25) });
    expect(r.pairs).toEqual(["P->D:0"]); // the edge is zero-cost and fits a 0-minute limit
    expect(addressCounters.negativeDetourClamped).toBe(1);
  });

  test("the FINAL difference is rounded half-up, and a negative difference clamps to zero and is counted", async () => {
    // dp = 100.5, pv = 200, dv = 250  =>  50.5 rounds up to 51.
    const rounded = await scenario({ venue: V, drivers: [{ name: "D", spot: S, seats: 1, limit: 120 }], passengers: [{ name: "P", spot: A }], seconds: (f, t) => (t.providerRef === A.ref ? 100.5 : f.providerRef === A.ref ? 200 : 250) });
    expect(rounded.pairs).toEqual(["P->D:51"]);
    // dp = 100, pv = 100, dv = 2000  =>  -1800 clamps to 0.
    resetAddressCounters();
    routing?.restore();
    const clamped = await scenario({ venue: spots("cv", 1, 910)[0], drivers: [{ name: "D", spot: spots("cs", 1, 911)[0], seats: 1, limit: 0 }], passengers: [{ name: "P", spot: spots("cp", 1, 912)[0] }], seconds: (f, t) => (t.providerRef.startsWith("cv") ? (f.providerRef.startsWith("cs") ? 2000 : 100) : 100) });
    expect(clamped.pairs).toEqual(["P->D:0"]);
    expect(addressCounters.negativeDetourClamped).toBe(1);
  });
});
