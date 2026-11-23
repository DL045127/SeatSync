import { defineConfig, devices } from "@playwright/test";

// Browser workflow checks (W3). The app runs a production build against the
// designated TEST database on a loopback port; global setup resets that
// database first. Serial, single worker, so each spec starts from the reset
// seed without cross-test interference. Requires Chromium installed via
// `npx playwright install chromium` and a running Compose database.

const PORT = 3100;
const TEST_DB = "postgresql://groupride_app:local_app@127.0.0.1:55432/groupride_test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm start -- --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DB,
      GROUPRIDE_USE_TEST_DATABASE: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
