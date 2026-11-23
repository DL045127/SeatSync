// Playwright global setup: reset the designated TEST database to a clean,
// correctly seeded state before the browser workflow suite runs. Uses the
// guarded offline reset (setup role) exactly like the integration suites.

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { testDatabase } from "../../src/db/local-target.ts";
import { runSetup } from "../../src/db/setup.ts";

export default async function globalSetup(): Promise<void> {
  if (existsSync(".env")) loadEnvFile();
  const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
  if (!setupUrl) {
    throw new Error("TEST_SETUP_DATABASE_URL is required for the e2e suite (see .env.example).");
  }
  await runSetup(setupUrl, testDatabase, "migrate");
  await runSetup(setupUrl, testDatabase, "reset");
}
