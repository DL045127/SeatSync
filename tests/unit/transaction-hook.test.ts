// Database-free unit test for ISSUE-020: if the before-COMMIT fault hook
// throws, the transaction helper must roll back (or discard) the client rather
// than release it with an open transaction. Uses a recording client double.

import { afterEach, describe, expect, it } from "vitest";
import {
  __setTransactionCommitFaultHook,
  withTransaction,
} from "../../src/db/transaction.ts";

interface FakePool {
  connect: () => Promise<FakeClient>;
}
interface FakeClient {
  queries: string[];
  released: Array<boolean | undefined>;
  on: () => void;
  off: () => void;
  query: (sql: string) => Promise<{ command: string; rows: never[] }>;
  release: (discard?: boolean) => void;
}

function makeClient(): FakeClient {
  const client: FakeClient = {
    queries: [],
    released: [],
    on: () => {},
    off: () => {},
    async query(sql: string) {
      client.queries.push(sql);
      return { command: sql.trim().split(/\s+/)[0].toUpperCase(), rows: [] };
    },
    release(discard?: boolean) {
      client.released.push(discard);
    },
  };
  return client;
}

afterEach(() => {
  __setTransactionCommitFaultHook(undefined);
});

describe("ISSUE-020: before-COMMIT hook rejection", () => {
  it("rolls back the transaction and does not COMMIT when the hook throws", async () => {
    const client = makeClient();
    const pool: FakePool = { connect: async () => client };
    __setTransactionCommitFaultHook(async () => {
      throw new Error("injected hook failure");
    });

    await expect(
      withTransaction(pool as never, "write", async () => undefined),
    ).rejects.toThrow("injected hook failure");

    // The helper issued a ROLLBACK and never a COMMIT.
    expect(client.queries).toContain("ROLLBACK");
    expect(client.queries).not.toContain("COMMIT");
    // The client was released (not leaked with an open transaction).
    expect(client.released).toHaveLength(1);
  });

  it("discards the client when both the hook and its rollback fail", async () => {
    const client = makeClient();
    const originalQuery = client.query.bind(client);
    client.query = async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("rollback also failed");
      return originalQuery(sql);
    };
    const pool: FakePool = { connect: async () => client };
    __setTransactionCommitFaultHook(async () => {
      throw new Error("injected hook failure");
    });

    await expect(
      withTransaction(pool as never, "write", async () => undefined),
    ).rejects.toThrow("injected hook failure");

    // Rollback failed, so the client is discarded (released with true).
    expect(client.released).toEqual([true]);
  });
});
