// Eval-only telemetry endpoint for W5/P-01. Returns preview matcher durations,
// cache-hit flags, and event-loop-delay percentiles collected in the server
// process. Gated to the designated test database so it is inert in any demo or
// production deployment. GET ?enable=1 starts collection (and the event-loop
// monitor); GET with no query drains and returns the records collected so far.
import { rejectCrossSite, rejectUntrustedHost } from "../../http.ts";
import {
  drainPreviewTelemetry,
  enablePreviewTelemetry,
  isPreviewTelemetryEnabled,
  resetPreviewTelemetry,
} from "../../../../trips/preview-telemetry.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function evalEnabled(): boolean {
  return process.env.GROUPRIDE_USE_TEST_DATABASE === "1";
}

export async function GET(request: Request): Promise<Response> {
  if (!evalEnabled()) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  // This GET enables collection, resets it or drains it, so it is a state
  // change: a foreign page must not trigger it (ISSUE-054). The guard runs
  // before any of those effects.
  // A same-origin GET has no Origin header, so a rebound page also needs its Host checked.
  const crossSite = rejectCrossSite(request) ?? rejectUntrustedHost(request);
  if (crossSite) return crossSite;
  const url = new URL(request.url);
  if (url.searchParams.get("enable") === "1") {
    enablePreviewTelemetry();
    return Response.json({ enabled: true }, { headers: { "cache-control": "no-store" } });
  }
  if (url.searchParams.get("reset") === "1") {
    resetPreviewTelemetry();
    return Response.json({ reset: true }, { headers: { "cache-control": "no-store" } });
  }
  const drained = drainPreviewTelemetry();
  return Response.json(
    { enabled: isPreviewTelemetryEnabled(), ...drained },
    { headers: { "cache-control": "no-store" } },
  );
}
