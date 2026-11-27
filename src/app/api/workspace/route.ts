import { z } from "zod";
import { appPool, readJsonBody, rejectCrossSite, rejectUntrustedHost, runPreview } from "../http.ts";
import {
  bootstrapWorkspace, manageWorkspace, readRecoveryVersion, recoverWorkspace, workspaceCookie, workspaceSecret,
} from "../../../workspaces/service.ts";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bootstrap") }).strict(),
  z.object({ action: z.literal("recover"), code: z.string() }).strict(),
  z.object({
    action: z.literal("rotate"),
    expectedWorkspaceId: z.uuid(),
    // PostgreSQL stores recovery_version as a signed four-byte integer.
    expectedRecoveryVersion: z.int().min(0).max(2_147_483_647),
  }).strict(),
  z.object({ action: z.literal("revoke"), expectedWorkspaceId: z.uuid() }).strict(),
]);

export function POST(request: Request): Promise<Response> {
  const rejected = rejectUntrustedHost(request) ?? rejectCrossSite(request);
  if (rejected) return Promise.resolve(rejected);
  return runPreview(async () => {
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const command = schema.parse(body);
    const secret = workspaceSecret(request);
    if (command.action === "rotate" || command.action === "revoke") {
      return { httpStatus: 200, body: await manageWorkspace(appPool(), secret, command) };
    }
    const session = command.action === "recover"
      ? await recoverWorkspace(appPool(), command.code)
      : await bootstrapWorkspace(appPool(), secret);
    const response = Response.json({ workspaceId: session.id }, { headers: { "cache-control": "no-store" } });
    if (session.secret) {
      const secure = new URL(request.url).protocol === "https:" || request.headers.get("origin")?.startsWith("https://");
      response.headers.append("set-cookie", `${workspaceCookie}=${session.secret}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`);
    }
    return response;
  });
}

export function GET(request: Request): Promise<Response> {
  const rejected = rejectUntrustedHost(request) ?? rejectCrossSite(request);
  if (rejected) return Promise.resolve(rejected);
  return runPreview(async () => ({
    httpStatus: 200,
    body: await readRecoveryVersion(appPool(), workspaceSecret(request)),
  }));
}
