import { defineConfig } from "vitest/config";

// Database-free W1 checks: matching engine, oracle agreement, controlled
// mutant, and the shared contract/normalization vectors. These run without
// PostgreSQL, Docker, or .env. The real-database integration suite is selected
// separately by vitest.config.ts via `test:database`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/matching/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
