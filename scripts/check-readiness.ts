import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { appRole, assertLocalTarget, testDatabase } from "../src/db/local-target.ts";
import { createPool } from "../src/db/pool.ts";
import { runSetup } from "../src/db/setup.ts";

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const host = "127.0.0.1";

async function withServer(
  mode: "start" | "dev",
  appUrl: string,
  verify: (origin: string) => Promise<void>,
) {
  const server = spawn(process.execPath, [nextBin, mode, "--hostname", host, "--port", "0"], {
    env: {
      ...process.env,
      DATABASE_URL: appUrl,
      GROUPRIDE_USE_TEST_DATABASE: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  server.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    process.stdout.write(chunk);
  });
  const stopped = new Promise<string>((resolve) => {
    server.once("error", (error) => resolve(error.message));
    server.once("exit", (code, signal) => resolve(String(code ?? signal)));
  });
  try {
    const deadline = Date.now() + 30_000;
    let origin: string | undefined;
    while (Date.now() < deadline) {
      if (server.exitCode !== null || server.signalCode !== null || !server.pid) {
        throw new Error(`Next ${mode} exited before serving HTTP (${await stopped}).`);
      }
      origin = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[0];
      if (origin) break;
      await delay(100);
    }
    if (!origin) throw new Error(`Next ${mode} did not announce its port within 30 seconds.`);
    await verify(origin);
  } finally {
    if (!server.killed) server.kill("SIGTERM");
    const exited = await Promise.race([stopped.then(() => true), delay(5_000, false, { ref: false })]);
    if (!exited) {
      server.kill("SIGKILL");
      await stopped;
    }
  }
}

async function checkReady(origin: string, phase: string) {
  const page = await fetch(origin, { signal: AbortSignal.timeout(30_000) });
  assert.equal(page.status, 200, `${phase}: landing page`);
  assert.ok(/<h1(?:\s[^>]*)?>Create a trip<\/h1>/.test(await page.text()),
    `${phase}: landing page must show the Create a trip heading`);
  const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(30_000) });
  const body: unknown = await health.json();
  assert.equal(health.status, 200, `${phase}: health returned ${JSON.stringify(body)}`);
  assert.deepEqual(body, { status: "ready" });
  console.log(`${phase}: landing page and 200 ready`);
}

async function main() {
  if (!existsSync(".next/BUILD_ID")) throw new Error("Run npm run build first.");
  if (existsSync(".env")) loadEnvFile();
  const setupUrl = process.env.TEST_SETUP_DATABASE_URL;
  const appUrl = process.env.TEST_DATABASE_URL;
  if (!setupUrl || !appUrl) throw new Error("Configure TEST_SETUP_DATABASE_URL and TEST_DATABASE_URL.");
  assertLocalTarget(appUrl, testDatabase, appRole);
  await runSetup(setupUrl, testDatabase, "reset");

  let driftAttempted = false;
  try {
    await withServer("start", appUrl, async (origin) => {
      await checkReady(origin, "Production");
      const setup = createPool(setupUrl, 1);
      try {
        driftAttempted = true;
        const result = await setup.query(`
          UPDATE zone_costs SET cost = 20
          WHERE driver_zone_id = 'east' AND passenger_zone_id = 'north' AND cost = 19
        `);
        assert.equal(result.rowCount, 1, "Expected one fixture cost to change.");
      } finally {
        await setup.end();
      }
      const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(30_000) });
      assert.equal(health.status, 503);
      assert.deepEqual(await health.json(), { error: { code: "DATASET_MISMATCH" } });
      console.log("Production with drift: 503 DATASET_MISMATCH");
    });
  } finally {
    if (driftAttempted) await runSetup(setupUrl, testDatabase, "reset");
  }

  await withServer("dev", appUrl, (origin) => checkReady(origin, "Development after reset"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
