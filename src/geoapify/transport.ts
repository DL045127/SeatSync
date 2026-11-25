// Next's instrumented global fetch records the full URL. Geoapify requires
// sensitive query parameters, so these two server-only requests use Node HTTP.
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

export async function requestProviderJson(url: URL, signal: AbortSignal, body?: string) {
  signal.throwIfAborted();
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { "accept-encoding": "identity", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      signal,
    }, resolve);
    req.once("error", reject);
    req.end(body);
  });
  const status = response.statusCode!;
  const retryAfter = response.headers["retry-after"] ?? null;
  if (status < 200 || status >= 300) {
    response.destroy(); // Includes redirects; credentials stay at the original endpoint.
    return { status, retryAfter, data: undefined };
  }
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk);
  signal.throwIfAborted();
  return { status, retryAfter, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
}
