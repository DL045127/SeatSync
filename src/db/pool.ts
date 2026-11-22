import { Pool, type PoolClient } from "pg";
import { assertDataset } from "./dataset.ts";
import { appRole, assertLocalTarget, datasetLock, demoDatabase, testDatabase } from "./local-target.ts";
import { withTransaction } from "./transaction.ts";

export function createPool(connectionString: string, max = 5): Pool {
  const pool = new Pool({ connectionString, max, connectionTimeoutMillis: 2_000 });
  pool.on("error", () => console.error("An idle PostgreSQL connection failed."));
  return pool;
}

const globals = globalThis as typeof globalThis & { groupRidePool?: Pool };

function appPool(): Pool {
  if (globals.groupRidePool) return globals.groupRidePool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  const database = process.env.GROUPRIDE_USE_TEST_DATABASE === "1" ? testDatabase : demoDatabase;
  assertLocalTarget(url, database, appRole);
  globals.groupRidePool = createPool(url);
  return globals.groupRidePool;
}

export function withAppTransaction<T>(
  mode: "read" | "write",
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(appPool(), mode, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    return work(client);
  });
}
