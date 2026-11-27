import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { assertLocalTarget, setupRole, testDatabase } from "../src/db/local-target.ts";
import { createPool } from "../src/db/pool.ts";

const warmup = 10;
const samples = 100;
const workspaces = 16;
const placesPerWorkspace = 500;
const policy = "probe-v1";

function pairs(drivers: number, passengers: number) {
  const starts = Array.from({ length: drivers }, (_, i) => JSON.stringify([-90, 30 + i / 1000]));
  const pickups = Array.from({ length: passengers }, (_, i) => JSON.stringify([-91, 30 + i / 1000]));
  const venue = JSON.stringify([-92, 30]);
  const legs = [...starts.flatMap(from => pickups.map(to => [from, to])),
    ...[...starts, ...pickups].map(from => [from, venue])];
  return [legs.map(([from]) => from), legs.map(([, to]) => to)];
}

async function measure<T>(run: (iteration: number) => Promise<T>, verify: (value: T) => void) {
  const timings = [];
  for (let i = 0; i < warmup + samples; i++) {
    const start = performance.now();
    const result = await run(i);
    const elapsed = performance.now() - start;
    verify(result);
    if (i >= warmup) timings.push(elapsed);
  }
  const sorted = [...timings].sort((a, b) => a - b);
  return { p95Ms: sorted[Math.ceil(samples * 0.95) - 1], timingsMs: timings };
}

async function main() {
  loadEnvFile();
  const url = process.env.TEST_SETUP_DATABASE_URL ?? "";
  assertLocalTarget(url, testDatabase, setupRole);
  const pool = createPool(url, 1);
  const client = await pool.connect().catch(async error => { await pool.end(); throw error; });
  const schema = "reuse_probe_" + randomUUID().replaceAll("-", "");
  let created = false;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await client.query(`SET search_path TO ${schema}, pg_catalog`);
    await client.query(`
      CREATE TABLE workspaces (id uuid PRIMARY KEY);
      CREATE TABLE travel_times (
        workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        routing_policy text NOT NULL,
        from_point text NOT NULL,
        to_point text NOT NULL,
        seconds double precision NOT NULL CHECK (seconds BETWEEN 0 AND 1000000),
        observed_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, routing_policy, from_point, to_point),
        CHECK (from_point <> to_point)
      );
      CREATE INDEX travel_times_observed ON travel_times (observed_at);
      CREATE TABLE saved_places (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider text NOT NULL CHECK (provider IN ('fixture', 'geoapify')),
        kind text NOT NULL CHECK (kind IN ('venue', 'participant')),
        point_key text NOT NULL,
        snapshot jsonb NOT NULL,
        last_used_at timestamptz NOT NULL,
        UNIQUE (workspace_id, provider, kind, point_key, snapshot)
      );
    `);
    const { rows: owners } = await client.query<{ id: string }>(
      "INSERT INTO workspaces SELECT gen_random_uuid() FROM generate_series(1,$1) RETURNING id", [workspaces],
    );
    const [from, to] = pairs(20, 50);
    await client.query(`
      INSERT INTO travel_times
      SELECT id, $1, p.from_point, p.to_point, 90, now() - interval '1 day'
      FROM workspaces CROSS JOIN unnest($2::text[], $3::text[]) AS p(from_point, to_point)
    `, [policy, from, to]);
    await client.query(`
      INSERT INTO saved_places (workspace_id, provider, kind, point_key, snapshot, last_used_at)
      SELECT id, 'fixture', CASE WHEN n % 5 = 0 THEN 'venue' ELSE 'participant' END,
        jsonb_build_array(-90, 30 + n / 10000.0)::text,
        jsonb_build_object('label', 'Example Place ' || n, 'detail', n || ' Example Road',
          'lon', -90, 'lat', 30 + n / 10000.0, 'provider', 'fixture', 'precision', 'building'),
        now() - n * interval '1 minute'
      FROM workspaces CROSS JOIN generate_series(1,$1) AS n
    `, [placesPerWorkspace]);
    await client.query("ANALYZE travel_times; ANALYZE saved_places");
    const lookupSql = `
      SELECT t.from_point, t.to_point, t.seconds, t.observed_at
      FROM unnest($3::text[], $4::text[]) AS p(from_point, to_point)
      JOIN travel_times t USING (from_point, to_point)
      WHERE t.workspace_id = $1 AND t.routing_policy = $2
        AND t.observed_at BETWEEN now() - interval '30 days' AND now() + interval '5 minutes'`;
    const upsertSql = `
      INSERT INTO travel_times
      SELECT $1, $2, p.from_point, p.to_point, 120, $5
      FROM unnest($3::text[], $4::text[]) AS p(from_point, to_point)
      ON CONFLICT (workspace_id, routing_policy, from_point, to_point) DO UPDATE
        SET seconds = EXCLUDED.seconds, observed_at = EXCLUDED.observed_at
        WHERE EXCLUDED.observed_at > travel_times.observed_at
          OR travel_times.observed_at > now() + interval '5 minutes'`;
    const placesSql = `
      SELECT id, kind, snapshot FROM saved_places
      WHERE workspace_id = $1 AND provider = 'fixture' AND kind = ANY($2::text[])
      ORDER BY last_used_at DESC, id LIMIT 500`;
    const results = [];
    for (const [drivers, passengers] of [[2, 5], [20, 50]]) {
      const [starts, ends] = pairs(drivers, passengers);
      const params = [owners[0].id, policy, starts, ends];
      const plan = await client.query("EXPLAIN (COSTS OFF) " + lookupSql, params);
      const lookup = await measure(() => client.query(lookupSql, params),
        result => assert.equal(result.rowCount, starts.length));
      const timestamp = Date.now();
      const upsert = await measure(i => client.query(upsertSql, [...params, new Date(timestamp + i)]),
        result => assert.equal(result.rowCount, starts.length));
      results.push({ drivers, passengers, keys: starts.length, lookupPlan: plan.rows, lookup, upsert });
    }
    const places = [];
    for (const kinds of [["venue"], ["venue", "participant"]]) {
      const expected = kinds.length === 1 ? 100 : 500;
      places.push({ kinds, rows: expected,
        ...await measure(() => client.query(placesSql, [owners[0].id, kinds]),
          result => assert.equal(result.rowCount, expected)) });
    }
    const version = await client.query("SHOW server_version");
    console.log(JSON.stringify({ node: process.version, postgres: version.rows[0].server_version,
      warmup, samples, workspaces, travelRows: workspaces * from.length,
      placeRows: workspaces * placesPerWorkspace, results, places }, null, 2));
  } finally {
    try { if (created) await client.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { client.release(); await pool.end(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
