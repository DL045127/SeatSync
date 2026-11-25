// Exercise the installed Next fetch instrumentation with a local-only tracer,
// full-URL development logging, and synthetic inputs on both real adapters.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, test, vi } from "vitest";
import { geoapifySearch } from "../../src/locations/geoapify.ts";
import { geoapifyRoutingAdapter } from "../../src/routing/geoapify.ts";
import * as transport from "../../src/geoapify/transport.ts";

test("ISSUE-083: Next records the control fetch but no provider URL, query, key or coordinates", async () => {
  const require = createRequire(import.meta.url);
  const otel = require("next/dist/compiled/@opentelemetry/api");
  const { createPatchedFetcher } = require("next/dist/server/lib/patch-fetch");
  const { logRequests } = require("next/dist/server/dev/log-requests");
  const spans: { name: string; attributes: Record<string, unknown> }[] = [];
  const tracer = {
    startActiveSpan(name: string, options: { attributes: Record<string, unknown> }, run: (span: object) => unknown) {
      const attributes = { ...options.attributes };
      spans.push({ name, attributes });
      const span = otel.trace.wrapSpanContext(otel.INVALID_SPAN_CONTEXT);
      span.setAttributes = (attrs: object) => Object.assign(attributes, attrs);
      return run(span);
    },
  };
  const store = { shouldTrackFetchMetrics: true, route: "/probe", fetchMetrics: [] };
  const control = "visible-control-marker";
  const key = "synthetic-private-key-marker";
  const query = "synthetic-private-query-marker";
  const bias = { lon: -95.123456, lat: 35.654321 };
  const a = { id: "driver", providerRef: "driver", lon: -96.123456, lat: 36.654321 };
  const b = { id: "venue", providerRef: "venue", lon: -96.321654, lat: 36.456123 };
  const calls: { url: URL; body: string }[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ url, body });
    res.end(JSON.stringify(url.pathname === "/v1/routematrix"
      ? { sources_to_targets: [[{ source_index: 0, target_index: 0, time: 10 }]] }
      : { results: [] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const local = (url: URL) => new URL(url.pathname + url.search, `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  const send = globalThis.fetch;
  const patched = createPatchedFetcher((input: URL, init: RequestInit) => send(local(new URL(input)), init), {
    workAsyncStorage: { getStore: () => store }, workUnitAsyncStorage: { getStore: () => undefined },
  });
  const requestJson = transport.requestProviderJson;
  const redirect = vi.spyOn(transport, "requestProviderJson").mockImplementation((url, signal, body) => requestJson(local(url), signal, body));
  try {
    vi.stubEnv("NEXT_OTEL_VERBOSE", "1");
    vi.stubEnv("NEXT_OTEL_FETCH_DISABLED", "0");
    vi.stubEnv("GEOAPIFY_API_KEY", key);
    vi.stubGlobal("fetch", patched);
    expect(otel.trace.setGlobalTracerProvider({ getTracer: () => tracer })).toBe(true);
    await (await fetch(`http://localhost/control?probe=${control}`, { cache: "no-store" })).text();
    await geoapifySearch({ query, bias, limit: 1 }, AbortSignal.timeout(2000));
    expect(await geoapifyRoutingAdapter().fetchLegs([{ from: a, to: b }], { venueId: b.id })).toEqual([10]);
    expect(calls.map(c => c.url.pathname)).toEqual(["/control", "/v1/geocode/autocomplete", "/v1/routematrix"]);
    for (const { url } of calls.slice(1)) expect(url.searchParams.get("apiKey")).toBe(key);
    expect(calls[1].url.searchParams.get("text")).toBe(query);
    expect(calls[1].url.searchParams.get("bias")).toBe(`proximity:${bias.lon},${bias.lat}`);
    expect(JSON.parse(calls[2].body)).toMatchObject({ sources: [{ location: [a.lon, a.lat] }], targets: [{ location: [b.lon, b.lat] }] });

    const lines: string[] = [];
    const output = vi.spyOn(process.stdout, "write").mockImplementation(chunk => { lines.push(String(chunk)); return true; });
    try {
      logRequests({ url: "/probe", method: "GET", fetchMetrics: store.fetchMetrics }, { statusCode: 200 },
        { incomingRequests: false, fetches: { fullUrl: true } }, 0n, 1n);
    } finally { output.mockRestore(); }
    expect(spans.some(s => s.name.includes(control) && String(s.attributes["http.url"]).includes(control))).toBe(true);
    expect(lines.join("")).toContain(control);
    const recorded = JSON.stringify([spans, store.fetchMetrics, lines]);
    for (const marker of [key, query, bias.lon, bias.lat, a.lon, a.lat, b.lon, b.lat]) {
      expect(recorded).not.toContain(String(marker));
    }
  } finally {
    redirect.mockRestore();
    otel.trace.disable();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
