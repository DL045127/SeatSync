import { DatasetMismatch } from "../../../db/dataset.ts";
import { withAppTransaction } from "../../../db/pool.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await withAppTransaction("read", async () => undefined);
    return Response.json({ status: "ready" }, { headers });
  } catch (error) {
    const code = error instanceof DatasetMismatch ? "DATASET_MISMATCH" : "DATABASE_UNAVAILABLE";
    return Response.json({ error: { code } }, { status: 503, headers });
  }
}
