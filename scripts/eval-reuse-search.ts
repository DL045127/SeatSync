import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { appRole, assertLocalTarget, testDatabase } from "../src/db/local-target.ts";

const require = createRequire(import.meta.url);
const query = "Example Hall";
const trials = 5;
const pauseMs = 500;
const patterns = [
  { name: "uninterrupted", steps: [query] },
  { name: "two pauses", steps: ["Exam", "Example", query] },
  { name: "correct and repeat", steps: [query, "Example Halls", query] },
];

async function main() {
  loadEnvFile();
  const database = process.env.TEST_DATABASE_URL ?? "";
  assertLocalTarget(database, testDatabase, appRole);

  const requests: string[] = [];
  const provider = createServer((req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/v1/geocode/autocomplete") {
      res.writeHead(404).end();
      return;
    }
    const text = url.searchParams.get("text") ?? "";
    requests.push(text);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      results: text === query ? [{ name: query, housenumber: "42", street: "Example Road",
        formatted: "42 Example Road", result_type: "building", country_code: "us", lon: -90, lat: 30 }] : [],
    }));
  });

  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const preload = fileURLToPath(new URL("./reuse-loopback.mjs", import.meta.url));
  const app = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "0"], {
    env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(preload)}`,
      DATABASE_URL: database, GROUPRIDE_USE_TEST_DATABASE: "1", GROUPRIDE_ADDRESS_PROVIDER: "geoapify",
      GROUPRIDE_SELECTION_SECRET: Buffer.alloc(32, 7).toString("base64url"), GEOAPIFY_API_KEY: "reuse-probe",
      REUSE_PROBE_PORT: String((provider.address() as AddressInfo).port), NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  app.stdout.on("data", chunk => { output += String(chunk); });
  const stopped = once(app, "close");
  let browser;
  try {
    const appUrl = () => /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
    await expect.poll(appUrl, { timeout: 10_000 }).toBeTruthy();
    browser = await chromium.launch();
    const page = await browser.newPage();
    const results = [];
    for (const pattern of patterns) {
      const dispatched: string[][] = [];
      for (let trial = 0; trial < trials; trial++) {
        await page.goto(appUrl()!);
        await page.getByLabel("Trip type").selectOption("address");
        const venue = page.getByRole("combobox", { name: "Venue" });
        const start = requests.length;
        for (const [index, text] of pattern.steps.entries()) {
          if (pattern.name === "uninterrupted") await venue.pressSequentially(text);
          else await venue.fill(text);
          if (index < pattern.steps.length - 1) {
            await delay(pauseMs);
            await expect.poll(() => requests[start + index]).toBe(text);
          }
        }
        await page.getByRole("option", { name: /Example Hall/ }).click();
        await expect(page.getByText(/Selected: Example Hall/)).toBeVisible();
        const actual = requests.slice(start);
        assert.deepEqual(actual, pattern.steps);
        dispatched.push(actual);
      }
      const count = dispatched.flat().length;
      results.push({ pattern: pattern.name, dispatched, selections: trials,
        providerRequests: count, requestsPerSelection: count / trials,
        repeatsWithinSelections: dispatched.reduce((sum, row) => sum + row.length - new Set(row).size, 0) });
    }
    console.log(JSON.stringify({ node: process.version, chromium: browser.version(), pauseMs, results }, null, 2));
  } finally {
    await browser?.close();
    app.kill();
    const force = setTimeout(() => app.kill("SIGKILL"), 3000);
    try { await stopped; } finally { clearTimeout(force); provider.close(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
