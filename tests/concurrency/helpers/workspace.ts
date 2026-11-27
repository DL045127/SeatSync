import type { Pool } from "pg";
import { createTrip } from "../../../src/trips/service.ts";
import { bootstrapWorkspace, workspaceCookie } from "../../../src/workspaces/service.ts";

export async function createTripWithWorkspace(pool: Pool, key: string, body: unknown) {
  const { secret } = await bootstrapWorkspace(pool);
  return createTrip(pool, key, body, secret);
}

export async function newWorkspaceCookie(pool: Pool) {
  const { secret } = await bootstrapWorkspace(pool);
  return `${workspaceCookie}=${secret}`;
}
