import { defineConfig } from "vitest/config";

// Database-free unit checks for the contracts/db/http layers (outcome
// classifier, body limit, response shapes). These run without PostgreSQL,
// Docker, or .env. The real-database suite is selected by
// vitest.concurrency.config.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
