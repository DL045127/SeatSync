import { appPool, readJsonBody, readRequestKey, runMutation } from "../../../http.ts";
import { addRequest } from "../../../../../trips/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tripId: string }> },
): Promise<Response> {
  const key = readRequestKey(request);
  if (key instanceof Response) return key;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { tripId } = await params;
  return runMutation(key, () => addRequest(appPool(), tripId, key, body));
}
