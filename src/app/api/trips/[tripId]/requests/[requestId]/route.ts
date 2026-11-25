import { appPool, readJsonBody, readRequestKey, runMutation, rejectCrossSite } from "../../../../http.ts";
import { withdrawRequest } from "../../../../../../trips/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tripId: string; requestId: string }> },
): Promise<Response> {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const key = readRequestKey(request);
  if (key instanceof Response) return key;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const { tripId, requestId } = await params;
  return runMutation(key, () => withdrawRequest(appPool(), tripId, requestId, key, body));
}
