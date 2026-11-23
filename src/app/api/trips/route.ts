import { appPool, readJsonBody, readRequestKey, runMutation } from "../http.ts";
import { createTrip } from "../../../trips/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const key = readRequestKey(request);
  if (key instanceof Response) return key;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return runMutation(key, () => createTrip(appPool(), key, body));
}
