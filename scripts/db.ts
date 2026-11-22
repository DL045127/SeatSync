import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { demoDatabase, testDatabase } from "../src/db/local-target.ts";
import { runSetup } from "../src/db/setup.ts";

async function main() {
  const [action, target = "demo", ...extra] = process.argv.slice(2);
  if (extra.length || (action !== "migrate" && action !== "reset") || (target !== "demo" && target !== "test")) {
    throw new Error("Expected: npm run <db:migrate|demo:reset> -- [demo|test]");
  }
  if (existsSync(".env")) loadEnvFile();
  const key = target === "demo" ? "SETUP_DATABASE_URL" : "TEST_SETUP_DATABASE_URL";
  const url = process.env[key];
  if (!url) throw new Error(`${key} is required. See .env.example.`);
  const database = target === "demo" ? demoDatabase : testDatabase;
  const tripId = await runSetup(url, database, action);
  console.log(tripId ? `Reset ${database}. Starter trip: ${tripId}` : `Migrated ${database} and verified zone data.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database setup failed.");
  process.exitCode = 1;
});
