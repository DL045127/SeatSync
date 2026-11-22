import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import demoTrip from "../../data/demo-trip.json" with { type: "json" };
import { canonicalDataset, DatasetMismatch, readDataset, sameDataset } from "./dataset.ts";
import { appRole, assertLocalTarget, datasetLock, type LocalDatabase, setupRole } from "./local-target.ts";
import { createPool } from "./pool.ts";
import { withTransaction } from "./transaction.ts";

const migrationDirectory = new URL("../../db/migrations/", import.meta.url);

async function migrate(client: PoolClient): Promise<boolean> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const applied = await client.query<{ name: string; checksum: string }>(
    "SELECT name, checksum FROM schema_migrations",
  );
  const checksums = new Map(applied.rows.map(({ name, checksum }) => [name, checksum]));
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d{3}_\w+\.sql$/.test(name)).sort();
  if (files.length === 0 || applied.rows.some(({ name }) => !files.includes(name))) {
    throw new Error("Database migration files are missing.");
  }
  for (const name of files) {
    const sql = await readFile(new URL(name, migrationDirectory), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (checksums.has(name)) {
      if (checksums.get(name) !== checksum) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
  }
  return checksums.size === 0;
}

async function seed(client: PoolClient): Promise<void> {
  for (const { id, label } of canonicalDataset.zones) {
    await client.query("INSERT INTO zones (id, label) VALUES ($1, $2)", [id, label]);
  }
  for (const { driver_zone_id, passenger_zone_id, cost } of canonicalDataset.costs) {
    await client.query(
      "INSERT INTO zone_costs (driver_zone_id, passenger_zone_id, cost) VALUES ($1, $2, $3)",
      [driver_zone_id, passenger_zone_id, cost],
    );
  }
}

export async function runSetup(
  url: string,
  database: LocalDatabase,
  action: "migrate" | "reset",
): Promise<string | undefined> {
  assertLocalTarget(url, database, setupRole);
  const pool = createPool(url, 1);
  try {
    return await withTransaction(pool, "write", async (client) => {
      const identity = await client.query<{ valid: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM groupride_local.designation
          WHERE name = $1 AND name = current_database() AND current_user = $2
        ) AS valid
      `, [database, setupRole]);
      if (!identity.rows[0]?.valid) throw new Error("Database lacks the matching local setup designation.");

      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS acquired", [...datasetLock],
      );
      if (!lock.rows[0]?.acquired) throw new Error("Database is busy. Stop the app and retry setup.");

      const sessions = await client.query<{ present: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND usename = $1
        ) AS present
      `, [appRole]);
      if (sessions.rows[0]?.present) throw new Error("Stop the app and disconnect app clients before setup.");

      const fresh = await migrate(client);
      if (action === "migrate") {
        if (fresh) await seed(client);
        if (!sameDataset(await readDataset(client), canonicalDataset)) throw new DatasetMismatch();
        return;
      }

      await client.query(`
        TRUNCATE assignments, match_previews, drivers, ride_requests, trips, mutation_receipts,
          zone_costs, zones
      `);
      await seed(client);
      const trip = await client.query<{ id: string }>(
        "INSERT INTO trips (name, destination_label, depart_at) VALUES ($1, $2, $3) RETURNING id",
        [demoTrip.name, demoTrip.destinationLabel, demoTrip.departAt],
      );
      return trip.rows[0].id;
    });
  } finally {
    await pool.end();
  }
}
