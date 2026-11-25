// ISSUE-054, end to end. The old guard compared the Origin's host with the request's OWN
// Host header. A page served under a hostname the attacker controls, which resolves to the
// loopback server (DNS rebinding), makes both equal, so its same-origin POST was accepted.
// Chromium is started with a resolver rule that maps evil.example to 127.0.0.1: the app's
// pages answer for any Host, so this is the real attack, not a simulation of header values.
// (launchOptions can only be set at the top level of a spec file, hence a file of its own.)

import { expect, test, type Page } from "@playwright/test";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP evil.example 127.0.0.1"] } });

const postTrip = (page: Page) =>
  page.evaluate(async () => {
    // crypto.randomUUID needs a secure context, which a rebound http origin is not.
    const uuid = "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": uuid },
      body: JSON.stringify({ name: "Rebound", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+00:00" }),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as { error?: { code?: string } } | null };
  });

test("ISSUE-054: a write from a page served under a rebound hostname is refused; the real origin still works", async ({ page }) => {
  await page.goto("http://evil.example:3100/");
  expect(new URL(page.url()).hostname).toBe("evil.example"); // the rebinding really happened
  const rebound = await postTrip(page);
  expect(rebound.status).toBe(403);
  expect(rebound.body?.error?.code).toBe("CROSS_SITE_REQUEST");

  // The legitimate loopback origins are unaffected (controls, so a blanket refusal cannot pass).
  await page.goto("http://127.0.0.1:3100/");
  expect((await postTrip(page)).status).toBe(201);
  await page.goto("http://localhost:3100/");
  expect((await postTrip(page)).status).toBe(201);
});

// ISSUE-060. A same-origin GET carries no `Origin` header, so a check that consults the trusted
// origins only when Origin is present lets a rebound page drive a state-changing GET. The
// telemetry endpoint (enabled for the designated test database) enables, resets and drains
// collection on GET, and its response is readable by the rebound page.
const getTelemetry = (page: Page, query: string) =>
  page.evaluate(async (q) => {
    const res = await fetch(`/api/eval/telemetry${q}`);
    return { status: res.status, text: await res.text() };
  }, query);

test("ISSUE-060: a rebound page cannot enable, reset or drain telemetry; the real origin and plain scripts can", async ({ page, request }) => {
  await page.goto("http://evil.example:3100/");
  for (const query of ["?enable=1", "?reset=1", ""]) {
    const rebound = await getTelemetry(page, query);
    expect(rebound.status, `rebound GET ${query || "(drain)"}`).toBe(403);
    expect(rebound.text).toContain("CROSS_SITE_REQUEST");
  }

  // Controls: the legitimate origin, and a header-less script (the evaluation harness), still work.
  await page.goto("http://127.0.0.1:3100/");
  expect((await getTelemetry(page, "?enable=1")).status).toBe(200);
  expect((await getTelemetry(page, "")).status).toBe(200);
  expect((await request.get("http://127.0.0.1:3100/api/eval/telemetry")).status()).toBe(200);
});
