import type { Pool, PoolClient } from "pg";

export class CommitOutcomeUnknown extends Error {
  constructor(cause: unknown) {
    super("Could not confirm the database commit outcome.", { cause });
    this.name = "CommitOutcomeUnknown";
  }
}

export async function withTransaction<T>(
  pool: Pool,
  mode: "read" | "write",
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  let connectionError: Error | undefined;
  const onError = (error: Error) => { connectionError = error; };
  client.on("error", onError);
  try {
    try {
      await client.query(mode === "read"
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        : "BEGIN ISOLATION LEVEL READ COMMITTED");
    } catch (error) {
      discard = true;
      throw error;
    }

    let result: T;
    try {
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
      result = await work(client);
      if (connectionError) throw connectionError;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
      throw error;
    }

    let command: string;
    try {
      ({ command } = await client.query("COMMIT"));
    } catch (error) {
      discard = true;
      throw new CommitOutcomeUnknown(error);
    }
    if (command !== "COMMIT") throw new Error("Database rolled back the transaction.");
    return result;
  } finally {
    client.off("error", onError);
    client.release(discard || connectionError !== undefined);
  }
}
