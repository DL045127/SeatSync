import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { expect, test } from "vitest";
import { assertDataset, DatasetMismatch } from "../src/db/dataset.ts";
import { appRole, assertLocalTarget, testDatabase } from "../src/db/local-target.ts";
import { createPool } from "../src/db/pool.ts";
import { runSetup } from "../src/db/setup.ts";
import { withTransaction } from "../src/db/transaction.ts";

test("C-18: protects seed costs, refuses changes with retained trips, and resets the designated test database", async () => {
  if (existsSync(".env")) loadEnvFile();
  const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
  const appUrl = process.env.TEST_DATABASE_URL;
  if (!setupUrl || !appUrl) throw new Error("Configure TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL.");
  assertLocalTarget(appUrl, testDatabase, appRole);
  const oldTripId = await runSetup(setupUrl, testDatabase, "reset");
  await runSetup(setupUrl, testDatabase, "migrate");
  const setup = createPool(setupUrl, 1);

  try {
    const app = createPool(appUrl, 1);
    try {
      await withTransaction(app, "read", assertDataset);
      // Pool.query discards its client on error. Keep this session checked out for the reset check.
      const connectedApp = await app.connect();
      try {
        await expect(connectedApp.query("UPDATE zone_costs SET cost = 20 WHERE cost = 19"))
          .rejects.toMatchObject({ code: "42501" });
        await expect(runSetup(setupUrl, testDatabase, "reset")).rejects.toThrow("disconnect app clients");
      } finally {
        connectedApp.release();
      }
      await app.query(`
        INSERT INTO mutation_receipts (request_key, request_fingerprint, outcome, http_status, response_json)
        VALUES (gen_random_uuid(), 'setup-test', 'applied', 200, '{}')
      `);
      await setup.query(`
        UPDATE zone_costs SET cost = 20
        WHERE driver_zone_id = 'east' AND passenger_zone_id = 'north'
      `);
      await expect(withTransaction(app, "read", assertDataset)).rejects.toBeInstanceOf(DatasetMismatch);
    } finally {
      await app.end();
    }

    await expect(runSetup(setupUrl, testDatabase, "migrate")).rejects.toBeInstanceOf(DatasetMismatch);
    expect((await setup.query("SELECT id FROM trips")).rows).toEqual([{ id: oldTripId }]);
    const newTripId = await runSetup(setupUrl, testDatabase, "reset");
    expect(newTripId).not.toBe(oldTripId);
    expect((await setup.query("SELECT id FROM trips")).rows).toEqual([{ id: newTripId }]);
    expect((await setup.query("SELECT request_key FROM mutation_receipts")).rows).toEqual([]);
    await withTransaction(setup, "read", assertDataset);
  } finally {
    await setup.end();
  }
});
