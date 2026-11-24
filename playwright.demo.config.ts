// Run against the existing production demo started by npm run demo.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "workflow.spec.ts",
  grep: /WF-\d/,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000", browserName: "chromium" },
});
