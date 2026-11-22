export const demoDatabase = "groupride_demo";
export const testDatabase = "groupride_test";
export type LocalDatabase = typeof demoDatabase | typeof testDatabase;

export const appRole = "groupride_app";
export const setupRole = "groupride_setup";

// The two-int namespace is distinct from future bigint request-key locks.
export const datasetLock = [1196575044, 1] as const;

export function assertLocalTarget(
  connectionString: string,
  database: LocalDatabase,
  role: typeof appRole | typeof setupRole,
): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Expected a PostgreSQL URL for the local Compose database.");
  }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55432"
    || url.username !== role || url.pathname !== `/${database}` || url.search || url.hash) {
    throw new Error(`Expected the ${role} URL for ${database} at 127.0.0.1:55432.`);
  }
}
