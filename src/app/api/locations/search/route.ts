import { appPool, readJsonBody, rejectCrossSite, runPreview } from "../../http.ts";
import { searchLocations } from "../../../../locations/selection-service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Address search is stateless: it writes nothing to the database. It is an
// unkeyed POST (the query travels in the body, never in a URL) and is never
// cached.
export async function POST(request: Request): Promise<Response> {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return runPreview(() => searchLocations(appPool(), body));
}
