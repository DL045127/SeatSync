// Guarded offline reset of the DEMO database, then start the production server
// and print the demo URL and the exact browser click-path. Stop the app before
// running this (the reset refuses while app clients are connected).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { demoDatabase } from "../src/db/local-target.ts";
import { runSetup } from "../src/db/setup.ts";

async function main(): Promise<void> {
  if (existsSync(".env")) loadEnvFile();
  const setupUrl = process.env.SETUP_DATABASE_URL;
  if (!setupUrl) throw new Error("SETUP_DATABASE_URL is required. See .env.example.");

  const tripId = await runSetup(setupUrl, demoDatabase, "reset");
  console.log(`Reset ${demoDatabase}. Fresh starter trip: ${tripId}`);
  console.log("\nStarting the production server on http://127.0.0.1:3000 …");
  console.log("Open http://127.0.0.1:3000 and follow the demo steps in the README.\n");

  const server = spawn("npm", ["run", "start"], { stdio: "inherit" });
  const stop = () => server.kill("SIGINT");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo startup failed.");
  process.exitCode = 1;
});
