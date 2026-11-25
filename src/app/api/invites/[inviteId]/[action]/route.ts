import { appPool, readJsonBody, readRequestKey, rejectCrossSite, rejectUntrustedHost, runMutation, runPreview } from "../../../http.ts";
import { searchDeadline } from "../../../../../db/deadline.ts";
import { searchLocations } from "../../../../../locations/selection-service.ts";
import { addDriver, addRequest } from "../../../../../trips/service.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ inviteId: string; action: string }> },
): Promise<Response> {
  const rejected = rejectUntrustedHost(request) ?? rejectCrossSite(request);
  if (rejected) return rejected;
  const { inviteId, action } = await params;
  if (action === "search") {
    const deadline = searchDeadline(request.signal);
    return runPreview(async () => {
      const body = await readJsonBody(request, deadline);
      if (body instanceof Response) return body;
      return searchLocations(appPool(), body, undefined, deadline, inviteId);
    });
  }
  if (action !== "drivers" && action !== "requests") return new Response(null, { status: 404 });
  const key = readRequestKey(request);
  if (key instanceof Response) return key;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const register = action === "drivers" ? addDriver : addRequest;
  return runMutation(key, () => register(appPool(), inviteId, key, body, true));
}
