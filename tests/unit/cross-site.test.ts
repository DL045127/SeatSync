// The cross-site write check (docs/ARCHITECTURE-v2.md section 7, ISSUE-054): 403
// with no receipt unless the request is provably same-origin. The trusted origin
// is a FULL origin (scheme, host and port), never just a host copied from the
// request's own Host header, which a DNS-rebinding page controls. Requests that
// carry neither header (the evaluation scripts and integration suites use Node
// fetch) are allowed.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rejectCrossSite, rejectUntrustedHost } from "../../src/app/api/http.ts";

const request = (headers: Record<string, string>) =>
  new Request("http://127.0.0.1:3100/api/trips", { method: "POST", headers });
const ok = (headers: Record<string, string>, env: Record<string, string | undefined> = {}) =>
  expect(rejectCrossSite(request(headers), env)).toBeUndefined();
const refused = async (headers: Record<string, string>, env: Record<string, string | undefined> = {}) => {
  const response = rejectCrossSite(request(headers), env);
  expect(response?.status).toBe(403);
  const body = (await response!.json()) as { error: { code: string }; operation?: unknown };
  expect(body.error.code).toBe("CROSS_SITE_REQUEST");
  expect(body.operation).toBeUndefined(); // never a receipt
};

describe("requests with neither header", () => {
  test("are allowed, whatever the Host", () => {
    ok({ host: "127.0.0.1:3100" });
    ok({ host: "app.example:8080" });
    ok({});
  });
});

describe("Origin must equal the trusted local origin (scheme, host AND port)", () => {
  test.each([
    ["127.0.0.1:3100", "http://127.0.0.1:3100"],
    ["localhost:3000", "http://localhost:3000"],
    ["[::1]:3100", "http://[::1]:3100"],
  ])("Host %s with Origin %s is the same origin", (host, origin) => {
    ok({ host, origin });
    ok({ host, origin, "sec-fetch-site": "same-origin" });
  });

  test.each([
    ["another scheme", { host: "127.0.0.1:3100", origin: "https://127.0.0.1:3100" }],
    ["another port on the same host", { host: "127.0.0.1:3100", origin: "http://127.0.0.1:9999" }],
    ["another host", { host: "127.0.0.1:3100", origin: "http://localhost:3100" }],
    ["a foreign origin", { host: "127.0.0.1:3100", origin: "https://evil.example" }],
    ["an opaque null origin", { host: "127.0.0.1:3100", origin: "null" }],
    ["a malformed origin", { host: "127.0.0.1:3100", origin: "not a url" }],
    ["an origin with a path", { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100/x" }],
  ])("refuses %s", async (_name, headers) => {
    await refused(headers);
  });

  test("DNS rebinding: a page on evil.example whose name resolves to 127.0.0.1 controls BOTH Host and Origin", async () => {
    // The old check compared the Origin's host with the request's own Host header,
    // which this attacker makes equal. A non-loopback Host is never trusted.
    await refused({ host: "evil.example:3100", origin: "http://evil.example:3100" });
    await refused({ host: "evil.example:3100", origin: "http://evil.example:3100", "sec-fetch-site": "same-origin" });
    await refused({ host: "127.0.0.1.evil.example:3100", origin: "http://127.0.0.1.evil.example:3100" });
  });

  test("a Host that is not a bare authority is never trusted", async () => {
    await refused({ host: "127.0.0.1:3100@evil.example", origin: "http://127.0.0.1:3100" });
    await refused({ host: "127.0.0.1:3100/evil", origin: "http://127.0.0.1:3100" });
  });
});

describe("Sec-Fetch-Site is an independent check", () => {
  test.each(["same-origin", "none"])("%s is allowed", (value) => {
    ok({ host: "127.0.0.1:3100", "sec-fetch-site": value });
  });

  test.each(["cross-site", "same-site", "bogus"])("%s is refused", async (value) => {
    await refused({ host: "127.0.0.1:3100", "sec-fetch-site": value });
  });

  test("a same-origin claim cannot excuse a mismatching Origin, nor a good Origin a cross-site claim", async () => {
    await refused({ host: "127.0.0.1:3100", "sec-fetch-site": "same-origin", origin: "https://evil.example" });
    await refused({ host: "127.0.0.1:3100", "sec-fetch-site": "cross-site", origin: "http://127.0.0.1:3100" });
  });
});

describe("the listening port, when known, is the configured origin", () => {
  const env = { PORT: "3100" };

  test("loopback names on that port are trusted whatever the Host header says", () => {
    ok({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }, env);
    ok({ host: "localhost:3100", origin: "http://localhost:3100" }, env);
    ok({ host: "[::1]:3100", origin: "http://[::1]:3100" }, env);
    // A request that reached the listening port but carried an odd Host is judged by its Origin.
    ok({ host: "anything", origin: "http://127.0.0.1:3100" }, env);
  });

  test.each([
    ["another port on loopback", { host: "127.0.0.1:3100", origin: "http://127.0.0.1:9999" }],
    ["another scheme", { host: "127.0.0.1:3100", origin: "https://127.0.0.1:3100" }],
    ["a rebound hostname even on the listening port", { host: "evil.example:3100", origin: "http://evil.example:3100" }],
    ["a rebound hostname claiming a loopback Host", { host: "127.0.0.1:3100", origin: "http://evil.example:3100" }],
  ])("refuses %s", async (_name, headers) => {
    await refused(headers, env);
  });

  test.each(["", "0", "70000", "abc", "3100.5", "-1"])("an unusable PORT (%j) falls back to the loopback-Host rule", async (port) => {
    ok({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }, { PORT: port });
    await refused({ host: "evil.example:3100", origin: "http://evil.example:3100" }, { PORT: port });
  });

  test("an explicit trusted-origin list overrides the listening port", async () => {
    await refused({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }, { PORT: "3100", GROUPRIDE_TRUSTED_ORIGINS: "http://app.example:8080" });
  });
});

describe("GROUPRIDE_TRUSTED_ORIGINS", () => {
  const env = { GROUPRIDE_TRUSTED_ORIGINS: "http://app.example:8080, https://other.example/ignored/path, nonsense" };

  test("when set, ONLY the listed full origins are trusted", async () => {
    ok({ host: "app.example:8080", origin: "http://app.example:8080" }, env);
    ok({ host: "other.example", origin: "https://other.example" }, env);
    await refused({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }, env); // loopback is no longer implied
    await refused({ host: "app.example:8080", origin: "https://app.example:8080" }, env); // scheme
    await refused({ host: "app.example:9090", origin: "http://app.example:9090" }, env); // port
    await refused({ host: "evil.example", origin: "http://evil.example" }, env);
  });

  test("a configuration with no valid entry trusts nothing (fail closed)", async () => {
    await refused({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }, { GROUPRIDE_TRUSTED_ORIGINS: "nonsense, ,,,", });
  });
});

describe("rejectUntrustedHost validates the destination (ISSUE-060)", () => {
  const hostOnly = (host: string | null) => new Request("http://127.0.0.1:3100/api/eval/telemetry", host === null ? {} : { headers: { host } });
  const allowed = (host: string | null, env: Record<string, string | undefined> = {}) =>
    expect(rejectUntrustedHost(hostOnly(host), env)).toBeUndefined();
  const refusedHost = (host: string | null, env: Record<string, string | undefined> = {}) =>
    expect(rejectUntrustedHost(hostOnly(host), env)?.status).toBe(403);

  test("with no known port, only a bare loopback Host is trusted", () => {
    allowed("127.0.0.1:3100");
    allowed("localhost:3000");
    allowed("[::1]:3100");
    refusedHost("evil.example:3100");
    refusedHost("127.0.0.1.evil.example:3100");
    refusedHost("127.0.0.1:3100@evil.example");
    refusedHost("127.0.0.1:3100/x");
    refusedHost(null); // a real HTTP/1.1 request always has a Host
    refusedHost("");
  });

  test("with a known listening port, only loopback names on THAT port are trusted", () => {
    const env = { PORT: "3100" };
    allowed("127.0.0.1:3100", env);
    allowed("localhost:3100", env);
    refusedHost("127.0.0.1:9999", env);
    refusedHost("evil.example:3100", env);
  });

  test("with an explicit list, the Host must match a listed authority under its configured scheme", () => {
    const env = { GROUPRIDE_TRUSTED_ORIGINS: "https://app.example, http://other.example:8080" };
    allowed("app.example", env);
    allowed("app.example:443", env);
    refusedHost("app.example:80", env);
    refusedHost("app.example:443/", env);
    refusedHost("app.example:443@other.example", env);
    allowed("other.example:8080", env);
    refusedHost("app.example:8443", env);
    refusedHost("127.0.0.1:3100", env);
  });
});

describe("the telemetry endpoint applies the same guard before any side effect", () => {
  const saved = process.env.GROUPRIDE_USE_TEST_DATABASE;
  beforeEach(() => {
    process.env.GROUPRIDE_USE_TEST_DATABASE = "1";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GROUPRIDE_USE_TEST_DATABASE;
    else process.env.GROUPRIDE_USE_TEST_DATABASE = saved;
  });

  const get = (query: string, headers: Record<string, string> = {}) =>
    new Request(`http://127.0.0.1:3100/api/eval/telemetry${query}`, { headers: { host: "127.0.0.1:3100", ...headers } });

  test("cross-site enable, reset and drain are 403 and change nothing; a plain request still works", async () => {
    const route = await import("../../src/app/api/eval/telemetry/route.ts");
    const telemetry = await import("../../src/trips/preview-telemetry.ts");
    telemetry.resetPreviewTelemetry();
    const cross: Array<Record<string, string>> = [
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
      { host: "evil.example:3100", origin: "http://evil.example:3100" },
    ];

    expect(telemetry.isPreviewTelemetryEnabled()).toBe(false);
    for (const headers of cross) expect((await route.GET(get("?enable=1", headers))).status).toBe(403);
    expect(telemetry.isPreviewTelemetryEnabled()).toBe(false); // not enabled by a foreign page

    expect((await route.GET(get("?enable=1"))).status).toBe(200); // a plain script may enable it
    expect(telemetry.isPreviewTelemetryEnabled()).toBe(true);
    telemetry.recordPreview({ cacheHit: false, matcherMs: 1.5 });
    for (const headers of cross) {
      expect((await route.GET(get("?reset=1", headers))).status).toBe(403);
      expect((await route.GET(get("", headers))).status).toBe(403);
    }
    // Neither the foreign reset nor the foreign drain consumed the record.
    const drained = (await (await route.GET(get(""))).json()) as { records?: unknown[] };
    expect(JSON.stringify(drained)).toContain("1.5");
    const again = (await (await route.GET(get(""))).json()) as Record<string, unknown>;
    expect(JSON.stringify(again)).not.toContain("1.5"); // a legitimate drain empties it
  });

  test("a REBOUND same-origin GET (no Origin, Sec-Fetch-Site same-origin, attacker Host) is refused and changes nothing", async () => {
    const route = await import("../../src/app/api/eval/telemetry/route.ts");
    const telemetry = await import("../../src/trips/preview-telemetry.ts");
    telemetry.resetPreviewTelemetry();
    await route.GET(get("?enable=1")); // a trusted script enables collection
    telemetry.recordPreview({ cacheHit: false, matcherMs: 7.25 });
    // Exactly what Chromium sends for fetch("/api/eval/telemetry...") from a page on evil.example.
    const rebound = { host: "evil.example:3100", "sec-fetch-site": "same-origin" };
    for (const query of ["?enable=1", "?reset=1", ""]) {
      const response = await route.GET(get(query, rebound));
      expect(response.status, query || "drain").toBe(403);
    }
    // A header-less request WITHOUT any Host is refused too; one with the trusted Host is the harness.
    expect((await route.GET(new Request("http://127.0.0.1:3100/api/eval/telemetry"))).status).toBe(403);
    const drained = JSON.stringify(await (await route.GET(get(""))).json()); // the legitimate harness
    expect(drained).toContain("7.25"); // the record survived every refused request
  });

  test("configured HTTPS telemetry accepts both default-port spellings", async () => {
    vi.stubEnv("GROUPRIDE_TRUSTED_ORIGINS", "https://app.example");
    try {
      const route = await import("../../src/app/api/eval/telemetry/route.ts");
      expect((await route.GET(get("", { host: "app.example" }))).status).toBe(200);
      expect((await route.GET(get("", { host: "app.example:443" }))).status).toBe(200);
      expect((await route.GET(get("", { host: "app.example:80" }))).status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("outside the test database the endpoint stays inert (404) for everyone", async () => {
    delete process.env.GROUPRIDE_USE_TEST_DATABASE;
    const route = await import("../../src/app/api/eval/telemetry/route.ts");
    expect((await route.GET(get("?enable=1"))).status).toBe(404);
    expect((await route.GET(get("", { origin: "https://evil.example" }))).status).toBe(404);
  });
});
