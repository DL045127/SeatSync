import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { chromium, expect, type Browser, type Page } from "@playwright/test";

type Guest =
  | { name: string; location: string; role: "driver"; seats: number; detourMinutes: number }
  | { name: string; location: string; role: "passenger" };

const guests: Guest[] = [
  { name: "Demo Dana", location: "Driver Start Delta", role: "driver", seats: 1, detourMinutes: 2 },
  { name: "Demo Eli", location: "Driver Start Echo", role: "driver", seats: 1, detourMinutes: 1 },
  { name: "Demo Alex", location: "Pickup Alpha", role: "passenger" },
  { name: "Demo Brooke", location: "Pickup Bravo", role: "passenger" },
  { name: "Demo Casey", location: "Pickup Charlie", role: "passenger" },
];

async function openLocalSession(browser: Browser, origin: string) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => {
    return new URL(route.request().url()).origin === origin ? route.continue() : route.abort();
  });
  context.setDefaultTimeout(15_000);
  return context;
}

async function selectFixture(page: Page, field: string, place: string) {
  await page.getByRole("combobox", { name: field, exact: true }).fill(place);
  // The delimiter after the label also distinguishes Pickup Alpha from its annex.
  await page.getByRole("listbox").getByRole("option")
    .filter({ hasText: `GROUPRIDE FIXTURE — ${place} —` }).click();
}

async function joinFromInvite(browser: Browser, invite: URL, guest: Guest) {
  const context = await openLocalSession(browser, invite.origin);
  try {
    const page = await context.newPage();
    await page.goto(invite.href);
    await page.getByRole("combobox", { name: "Join as" })
      .selectOption(guest.role === "driver" ? "drivers" : "requests");
    await page.getByLabel("Name", { exact: true }).fill(guest.name);
    await selectFixture(page, guest.role === "driver" ? "Starting address" : "Pickup address", guest.location);
    if (guest.role === "driver") {
      await page.getByLabel("Seats available").fill(String(guest.seats));
      await page.getByLabel("Detour limit (minutes)").fill(String(guest.detourMinutes));
    }
    await page.getByRole("button", { name: `Join as ${guest.role}` }).click();
    await expect(page.getByRole("heading", { name: "You’re registered" })).toBeVisible({ timeout: 15_000 });
    console.log(`${guest.name} joined as a ${guest.role}.`);
  } finally {
    await context.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: { port: { type: "string", default: "3000" }, headed: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) {
    console.log("Usage: npm run demo:invites -- [--port 3000] [--headed]");
    return;
  }
  const port = Number(values.port);
  if (!/^\d{1,5}$/.test(values.port) || port < 1 || port > 65535) throw new Error("Choose a valid local port.");
  const origin = `http://127.0.0.1:${port}`;
  const ready = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15_000), redirect: "error" })
    .catch(() => null);
  if (!ready?.ok || (await ready.json().catch(() => null))?.status !== "ready") {
    throw new Error(`GroupRide is unavailable at ${origin}. Start the database and app first.`);
  }
  if (ready.headers.get("X-GroupRide-Address-Provider") !== "fixture") {
    throw new Error("The server did not confirm fixture mode. The address demo stopped before searching.");
  }

  const browser = await chromium.launch({ headless: !values.headed, slowMo: values.headed ? 250 : 0 });
  try {
    console.log("Creating the demo trip…");
    const organizer = await openLocalSession(browser, origin);
    const page = await organizer.newPage();
    const landing = await page.goto(origin);
    if (!landing?.ok()) throw new Error(`GroupRide’s home page returned HTTP ${landing?.status() ?? "unknown"}.`);
    await page.getByRole("combobox", { name: "Trip type" }).selectOption("address");
    await page.getByLabel("Trip name").fill("DEMO — Event Hall carpool");
    await selectFixture(page, "Venue", "Event Hall");
    const departure = page.getByRole("group", { name: "Departure" });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await departure.getByLabel("Date", { exact: true }).fill(tomorrow);
    await departure.getByLabel("Time", { exact: true }).fill("09:30");
    await departure.getByRole("combobox", { name: "Time zone" }).selectOption("America/Chicago");
    await page.getByRole("button", { name: "Create trip" }).click();
    await page.waitForURL(/\/trips\/[0-9a-f-]+$/);
    const organizerUrl = page.url();
    console.log(`Organizer dashboard (private): ${organizerUrl}`);

    // The link is the same one the Copy invite link button shares.
    const href = await page.getByRole("link", { name: "Open invite" }).getAttribute("href");
    if (!href || !/^\/join\/[0-9a-f-]{36}$/.test(href)) throw new Error("The trip has no valid invitation.");
    const invite = new URL(href, origin);
    console.log(`Guest invitation (simulated delivery): ${invite.href}`);

    for (const guest of guests) await joinFromInvite(browser, invite, guest);

    console.log("Returning to the organizer to preview and save the plan…");
    if (values.headed) await page.bringToFront();
    await page.reload();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByRole("button", { name: "Save plan", exact: true }).click();
    await expect(page.getByTestId("trip-status")).toContainText("Plan saved");
    await page.reload();
    const plan = page.getByTestId("saved-assignments");
    await expect(plan.getByRole("article", { name: "Demo Dana" }).getByRole("listitem")).toHaveText(/Demo Brooke.*extra 1 min 4 s/);
    await expect(plan.getByRole("article", { name: "Demo Eli" }).getByRole("listitem")).toHaveText(/Demo Alex.*extra 0 min 18 s/);
    await expect(page.getByTestId("saved-unassigned")).toHaveText("Unassigned: Demo Casey");
    await expect(page.getByTestId("trip-status")).toContainText("1 min 22 s (82 s)");
    await expect(page.getByTestId("saved-estimate")).toContainText("Fixture estimate: fictional driving times.");
    console.log("Saved plan verified after reload: 2 matched, 1 unassigned. Total estimated detour: 1 min 22 s.");
    if (values.headed && process.stdin.isTTY) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try {
        await terminal.question("Press Enter to close the demo browser. ");
      } finally {
        terminal.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "The invitation demo failed.");
  console.error("For a stable walkthrough, run npm run build followed by GROUPRIDE_ADDRESS_PROVIDER=fixture npm start.");
  process.exitCode = 1;
});
