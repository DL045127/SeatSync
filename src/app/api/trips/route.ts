import { appPool, readJsonBody, readRequestKey, runMutation, rejectCrossSite } from "../http.ts";
import { createTrip } from "../../../trips/service.ts";

import { workspaceSecret } from "../../../workspaces/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const key = readRequestKey(request);
  if (key instanceof Response) return key;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const expectedWorkspaceId = request.headers.get("x-groupride-workspace") ?? undefined;
  return runMutation(key, () => createTrip(appPool(), key, body, workspaceSecret(request), expectedWorkspaceId));
}
