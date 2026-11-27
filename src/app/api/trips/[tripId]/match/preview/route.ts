import { appPool, readEmptyBody, runPreview, rejectCrossSite } from "../../../../http.ts";
import { publishPreview } from "../../../../../../trips/preview.ts";

import { workspaceSecret } from "../../../../../../workspaces/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tripId: string }> },
): Promise<Response> {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  // The preview contract takes no body ({}); reject non-empty/oversized/
  // malformed input (ISSUE-025) before doing any work.
  const bodyCheck = await readEmptyBody(request);
  if (bodyCheck instanceof Response) return bodyCheck;
  const { tripId } = await params;
  return runPreview(() => publishPreview(appPool(), tripId, undefined, workspaceSecret(request)));
}
