import { defineConfig } from "vitest/config";

// Real-PostgreSQL W2+ durability and concurrency checks. Requires a running
// Compose database and a reset test database (TEST_SETUP_DATABASE_URL and
// TEST_DATABASE_URL). Runs serially so each check reseeds without interference.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/concurrency/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
