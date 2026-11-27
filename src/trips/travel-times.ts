import type { Pool, PoolClient } from "pg";
import { TransientFailure } from "../contracts/errors.ts";
import { classifyUnkeyedFailure } from "../db/classify.ts";
import { assertDataset } from "../db/dataset.ts";
import { RequestDeadline } from "../db/deadline.ts";
import { datasetLock } from "../db/local-target.ts";
import { withTransaction } from "../db/transaction.ts";
import { identicalCoordinates, legKey, type AddressPoint, type AddressRoster, type DirectedPair, type Leg } from "../matching/address.ts";
import { coordinateKey } from "../routing/matrix.ts";
import { requireWorkspace } from "../workspaces/service.ts";
import { addressCounters } from "./address-metrics.ts";

const defaultMaxAgeDays = 30;
const purgeBatchSize = 1_000;

export function travelTimeMaxAgeDays(env = process.env): number {
  const value = env.GROUPRIDE_TRAVEL_TIMES_MAX_AGE_DAYS;
  if (value === undefined) return defaultMaxAgeDays;
  return /^\d{1,3}$/.test(value) && Number(value) <= 365 ? Number(value) : 0;
}

type Scope = { workspaceId: string; policyId: string; maxAgeDays: number };
export type TravelTimeWriteScope = Scope & { generation: string; tripId: string; secret: string };
type Observation = { pair: DirectedPair; leg: Leg };

const idKey = ({ from, to }: DirectedPair) => legKey(from.id, to.id);
const pointKey = ({ from, to }: DirectedPair) => legKey(coordinateKey(from), coordinateKey(to));

// Handoff maps share these leg objects until publication. Track the copied
// legs without changing the stored evidence schema or their public shape.
const coordinateCopies = new WeakSet<Leg>();

export function isCoordinateCopy(leg: Leg): boolean {
  return coordinateCopies.has(leg);
}

export function missingTravelPairs(required: readonly DirectedPair[], legs: ReadonlyMap<string, Leg>) {
  return required.filter(pair => !legs.has(idKey(pair)) && !identicalCoordinates(pair.from, pair.to));
}

/** Reuse the earliest observation of a coordinate pair without changing existing ID-keyed legs. */
export function reuseTripCoordinates(
  roster: AddressRoster, retained: readonly DirectedPair[], legs: Map<string, Leg>, historicalPoints: readonly AddressPoint[] = [],
) {
  const locations = new Map(historicalPoints.map(point => [point.id, point]));
  locations.set(roster.venue.id, roster.venue);
  for (const participant of [...roster.drivers, ...roster.passengers]) {
    locations.set(participant.location.id, participant.location);
  }
  const observations = new Map<string, Leg>();
  for (const leg of legs.values()) {
    if (leg.source !== "provider" || leg.observedAt === null) continue;
    const from = locations.get(leg.from);
    const to = locations.get(leg.to);
    if (!from || !to) continue; // Candidate validation has already checked these IDs.
    const key = pointKey({ from, to });
    const previous = observations.get(key);
    if (!previous || leg.observedAt < previous.observedAt!) observations.set(key, leg);
  }
  for (const pair of missingTravelPairs(retained, legs)) {
    const observation = observations.get(pointKey(pair));
    if (!observation) continue;
    const copy = { ...observation, from: pair.from.id, to: pair.to.id };
    coordinateCopies.add(copy);
    legs.set(idKey(pair), copy);
  }
}

export async function readDatasetGeneration(client: PoolClient): Promise<string> {
  const result = await client.query<{ generation: string }>("SELECT generation FROM dataset_generation");
  const generation = result.rows[0]?.generation;
  if (!generation) throw new TransientFailure("DATABASE_UNAVAILABLE", "The dataset generation is unavailable.");
  return generation;
}

export async function readTravelTimes(
  client: PoolClient, scope: Scope, pairs: readonly DirectedPair[], legs: Map<string, Leg>,
): Promise<void> {
  if (!pairs.length || scope.maxAgeDays === 0) return;
  const distinct = [...new Map(pairs.map(pair => [pointKey(pair), pair])).values()];
  try {
    const result = await client.query<{ from_point: string; to_point: string; seconds: number; observed_at: Date }>(
      `SELECT t.from_point, t.to_point, t.seconds, t.observed_at
       FROM unnest($3::text[], $4::text[]) AS p(from_point, to_point)
       JOIN travel_times t USING (from_point, to_point)
       WHERE t.workspace_id = $1 AND t.routing_policy = $2
         AND t.observed_at BETWEEN now() - make_interval(days => $5) AND now() + interval '5 minutes'`,
      [scope.workspaceId, scope.policyId, distinct.map(p => coordinateKey(p.from)),
        distinct.map(p => coordinateKey(p.to)), scope.maxAgeDays],
    );
    const rows = new Map(result.rows.map(row => [legKey(row.from_point, row.to_point), row]));
    for (const pair of pairs) {
      const row = rows.get(pointKey(pair));
      if (row) legs.set(idKey(pair), { from: pair.from.id, to: pair.to.id, seconds: row.seconds,
        observedAt: row.observed_at.toISOString(), source: "provider" });
    }
  } catch (error) {
    const failure = classifyUnkeyedFailure(error);
    if (failure instanceof TransientFailure) throw failure;
    throw new TransientFailure("DATABASE_UNAVAILABLE", "Stored driving times are unavailable. Retry the preview.", error);
  }
}

async function purgeExpired(client: PoolClient, maxAgeDays: number) {
  const tables = [
    { table: "travel_times", column: "observed_at", days: maxAgeDays + 7 },
    { table: "saved_places", column: "last_used_at", days: 365 },
    { table: "place_passes", column: "last_used_at", days: 180 },
    { table: "workspace_sessions", column: "last_used_at", days: 365 },
  ];
  for (const { table, column, days } of tables) {
    await client.query(
      `WITH expired AS (
         SELECT ctid FROM ${table}
         WHERE ${column} < now() - make_interval(days => $1)
         ORDER BY ${column}, ctid LIMIT $2 FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ${table} t USING expired WHERE t.ctid = expired.ctid`,
      [days, purgeBatchSize],
    );
  }
  // Hold the parent locks before the final emptiness check. A concurrent
  // foreign-key insert cannot slip in and be deleted by a cascade.
  const empty = `
      NOT EXISTS (SELECT 1 FROM travel_times WHERE workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM saved_places WHERE workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM workspace_sessions WHERE workspace_id = w.id)`;
  const workspaces = await client.query<{ id: string }>(
    `SELECT w.id FROM workspaces w WHERE w.last_used_at < now() - interval '365 days' AND ${empty}
     ORDER BY w.last_used_at, w.id LIMIT $1 FOR UPDATE SKIP LOCKED`, [purgeBatchSize],
  );
  if (workspaces.rows.length) await client.query(
    `DELETE FROM workspaces w WHERE w.id = ANY($1::uuid[]) AND ${empty}`, [workspaces.rows.map(row => row.id)],
  );
}

export const travelTimeWriteBudgetMs = 200;

const writeDeadline = () => new RequestDeadline(
  travelTimeWriteBudgetMs, () => new TransientFailure("DATABASE_BUSY", "The optional driving-time write deadline expired."),
);

export async function purgeFixtureTravelTimes(pool: Pool) {
  const maxAgeDays = travelTimeMaxAgeDays();
  if (maxAgeDays === 0) return;
  try {
    await withTransaction(pool, "write", async client => {
      await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
      await assertDataset(client);
      await purgeExpired(client, maxAgeDays);
    }, writeDeadline());
  } catch {
    addressCounters.travelTimePurgeFailed += 1;
  }
}

export async function persistTravelBatch(pool: Pool, scope: TravelTimeWriteScope, observations: readonly Observation[]) {
  if (scope.maxAgeDays === 0) return;
  const cells = new Map<string, Observation>();
  for (const observation of observations) {
    if (observation.leg.seconds !== null && observation.leg.observedAt !== null) {
      cells.set(pointKey(observation.pair), observation);
    }
  }
  if (!cells.size) return;
  const batch = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, cell]) => cell);
  try {
    await withTransaction(pool, "write", async client => {
      await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
      if (await readDatasetGeneration(client) !== scope.generation) return;
      if (await requireWorkspace(client, scope.secret) !== scope.workspaceId) return;
      const owner = await client.query("SELECT 1 FROM trips WHERE id = $1 AND workspace_id = $2", [scope.tripId, scope.workspaceId]);
      if (!owner.rowCount) return;
      await client.query(
        `INSERT INTO travel_times (workspace_id, routing_policy, from_point, to_point, seconds, observed_at)
         SELECT $1, $2, p.* FROM unnest($3::text[], $4::text[], $5::float8[], $6::timestamptz[]) AS p
         ON CONFLICT (workspace_id, routing_policy, from_point, to_point) DO UPDATE
           SET seconds = EXCLUDED.seconds, observed_at = EXCLUDED.observed_at
         WHERE EXCLUDED.observed_at > travel_times.observed_at
            OR travel_times.observed_at > now() + interval '5 minutes'`,
        [scope.workspaceId, scope.policyId, batch.map(o => coordinateKey(o.pair.from)),
          batch.map(o => coordinateKey(o.pair.to)), batch.map(o => o.leg.seconds), batch.map(o => o.leg.observedAt)],
      );
      await purgeExpired(client, scope.maxAgeDays);
    }, writeDeadline());
  } catch {
    addressCounters.travelTimeWriteFailed += 1;
  }
}
