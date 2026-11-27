export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.GROUPRIDE_ADDRESS_PROVIDER !== "fixture" || !process.env.DATABASE_URL) return;

  const { appDatabaseUrl, createPool } = await import("./db/pool.ts");
  const { purgeFixtureTravelTimes } = await import("./trips/travel-times.ts");
  const pool = createPool(appDatabaseUrl(), 1);
  try { await purgeFixtureTravelTimes(pool); } finally { await pool.end(); }
}
