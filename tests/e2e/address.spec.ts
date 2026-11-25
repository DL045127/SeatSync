// L-03 browser workflow for address trips against a production build, the test
// database and the OFFLINE fixture provider: keyboard-only search and selection,
// ambiguous/empty results, editing clears a selection, superseded replies, and
// create -> register -> preview -> save -> reload. Expected numbers are derived
// by hand from data/fixture-places.json (see tests/concurrency/address-workflow).
//   Delta->Alpha 403 s + Alpha->Hall 346 s - Delta->Hall 519 s = 230 s = 3 min 50 s

import { expect, test, type Page } from "@playwright/test";

const VENUE = "GROUPRIDE FIXTURE — Event Hall";

/** The suggestion options only: a <select>'s own <option> elements also have role "option". */
const suggestions = (page: Page) => page.getByRole("listbox").getByRole("option");

/** Collect any request that leaves loopback: the offline workflow must make none. */
function watchExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol.startsWith("http")) external.push(request.url());
  });
  return external;
}

async function version(page: Page): Promise<number> {
  const text = (await page.getByTestId("trip-status").textContent()) ?? "";
  const m = /Version:\s*(\d+)/.exec(text);
  return m ? Number(m[1]) : -1;
}

/** Type into a combobox and choose the first selectable suggestion with the keyboard only. */
async function chooseByKeyboard(page: Page, name: string, text: string, expectedLabel: string): Promise<void> {
  const box = page.getByRole("combobox", { name });
  await box.click();
  await box.pressSequentially(text);
  await expect(suggestions(page).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText(`Selected: ${expectedLabel}`)).toBeVisible();
}

async function createAddressTrip(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  await page.getByLabel("Trip name").fill(name);
  await page.getByLabel(/Departure/).fill("2027-03-05T17:30:00-06:00");
  // Submission is blocked until an address is actually selected.
  await expect(page.getByRole("button", { name: "Create trip" })).toBeDisabled();
  await chooseByKeyboard(page, "Venue", "event hall", VENUE);
  await expect(page.getByRole("button", { name: "Create trip" })).toBeEnabled();
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/[0-9a-f-]+$/);
  return page.url().slice(page.url().lastIndexOf("/") + 1);
}

test("L-03: keyboard search, confirm, register, preview, save and reload, with fixture labelling and zero outbound requests", async ({ page }) => {
  const external = watchExternalRequests(page);
  await createAddressTrip(page, "Austin evening event");
  await expect(page.getByTestId("trip-venue")).toContainText("GROUPRIDE FIXTURE — Event Hall");
  await expect(page.getByTestId("trip-venue")).toContainText("Fixture data: fictional places and driving times.");

  let before = await version(page);
  await page.getByLabel("driver name").fill("Dana");
  await chooseByKeyboard(page, "Driver start address", "delta", "GROUPRIDE FIXTURE — Driver Start Delta");
  await page.getByLabel("driver seats").fill("1");
  await expect(page.getByLabel("driver detour limit (minutes)")).toHaveValue("15"); // the proposed default
  await page.getByTestId("driver-form").getByRole("button", { name: "Add driver" }).click();
  await expect(page.getByTestId("trip-status")).toContainText(`Version: ${before + 1}`);
  await expect(page.getByText(/Dana \(GROUPRIDE FIXTURE — Driver Start Delta\) seats 1 · limit 15 min/)).toBeVisible();

  before = await version(page);
  await page.getByLabel("passenger name").fill("Pat");
  await chooseByKeyboard(page, "Passenger pickup address", "pickup alpha", "GROUPRIDE FIXTURE — Pickup Alpha");
  await page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click();
  await expect(page.getByTestId("trip-status")).toContainText(`Version: ${before + 1}`);
  await expect(page.getByText(/Pending operation/)).toHaveCount(0);

  // Preview shows the named pairing, its unit and the fixture provenance BEFORE saving.
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("preview-ready")).toBeVisible();
  await expect(page.getByTestId("preview-assignments")).toContainText("Pat → Dana (extra 3 min 50 s)");
  await expect(page.getByTestId("preview-ready")).toContainText("sum of estimated individual pickup detours 3 min 50 s");
  await expect(page.getByTestId("preview-estimate")).toContainText("Fixture estimate: fictional driving times.");

  await page.getByRole("button", { name: "Save plan (commit)" }).click();
  await expect(page.getByTestId("trip-status")).toContainText("Status: assigned");
  await expect(page.getByTestId("trip-status")).toContainText("Matched: 1");
  await expect(page.getByTestId("trip-status")).toContainText("Sum of estimated individual pickup detours: 3 min 50 s (230 s)");
  await expect(page.getByTestId("saved-assignments")).toContainText("Pat → Dana (extra 3 min 50 s)");

  // Reload reproduces the reviewed assignment and its estimate.
  await page.reload();
  await expect(page.getByTestId("trip-status")).toContainText("Status: assigned");
  await expect(page.getByTestId("saved-assignments")).toContainText("Pat → Dana (extra 3 min 50 s)");
  await expect(page.getByTestId("trip-venue")).toContainText("Fixture data");
  expect(external).toEqual([]); // the whole workflow stayed on loopback
});

test("L-03: ambiguous results are shown but cannot be chosen, and empty results say so", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  const box = page.getByRole("combobox", { name: "Venue" });
  await box.click();
  await box.pressSequentially("alpha");
  const options = suggestions(page);
  await expect(options).toHaveCount(3);
  const street = options.filter({ hasText: "street only" });
  await expect(street).toHaveAttribute("aria-disabled", "true");
  await expect(street).toContainText("be more specific");
  // Clicking an unusable result selects nothing.
  await street.click({ force: true }); // Playwright refuses to click aria-disabled elements unless forced
  await expect(page.getByText(/Selected:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create trip" })).toBeDisabled();
  // Arrow keys skip unusable options: the first Enter chooses the first USABLE one.
  await page.keyboard.press("Enter");
  await expect(page.getByText("Selected: GROUPRIDE FIXTURE — Pickup Alpha")).toBeVisible();

  await box.fill("zzzz nothing here");
  await expect(page.getByText("No matching address.")).toBeVisible();
  await expect(page.getByText(/Selected:/)).toHaveCount(0);
});

test("L-03: editing the text clears the selection, so the form cannot submit a stale address", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  await page.getByLabel("Trip name").fill("Edit Clears");
  await page.getByLabel(/Departure/).fill("2027-03-05T17:30:00-06:00");
  await chooseByKeyboard(page, "Venue", "event hall", VENUE);
  await expect(page.getByRole("button", { name: "Create trip" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Venue" }).pressSequentially("x");
  await expect(page.getByText(/Selected:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create trip" })).toBeDisabled();
});

test("L-03: a superseded search reply can neither replace newer results nor override a choice", async ({ page }) => {
  // The FIRST query ("pickup") is answered slowly; later queries are answered at once.
  await page.route("**/api/locations/search", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { query?: string };
    if (body.query === "pickup") await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  const box = page.getByRole("combobox", { name: "Venue" });
  await box.click();
  await box.fill("pickup"); // slow: five results, once it arrives
  await page.waitForTimeout(450); // past the debounce, so the slow request is in flight
  await box.fill("event hall"); // fast: one result
  await expect(suggestions(page)).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByText(`Selected: ${VENUE}`)).toBeVisible();
  // Now let the superseded slow reply arrive.
  await page.waitForTimeout(1800);
  await expect(page.getByText(`Selected: ${VENUE}`)).toBeVisible();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(suggestions(page)).toHaveCount(0);
});

test("ISSUE-055: editing the query invalidates the visible options at once, so Enter cannot choose a stale one", async ({ page }) => {
  // The reply for "bravo" is held back so the pending window is long and observable.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/locations/search", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { query?: string };
    if (body.query === "bravo") await held;
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  const box = page.getByRole("combobox", { name: "Venue" });
  await box.click();
  await box.fill("event hall");
  await expect(suggestions(page)).toHaveCount(1); // Event Hall is on screen
  await box.fill("bravo"); // edit the query: the old option must vanish immediately
  await expect(suggestions(page)).toHaveCount(0);
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter"); // while the new search is pending
  await page.waitForTimeout(400);
  await expect(page.getByText(/Selected:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create trip" })).toBeDisabled();
  // Once the reply arrives, Enter chooses the NEW query's result, never the old one.
  release();
  await expect(suggestions(page)).toHaveCount(1);
  await expect(suggestions(page).first()).toContainText("Pickup Bravo");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Selected: GROUPRIDE FIXTURE — Pickup Bravo")).toBeVisible();
});

test("ISSUE-055: a pointer cannot choose an option from a superseded query either", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/locations/search", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { query?: string };
    if (body.query === "bravo") await held;
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  const box = page.getByRole("combobox", { name: "Venue" });
  await box.click();
  await box.fill("event hall");
  const stale = suggestions(page).first();
  await expect(stale).toContainText("Event Hall");
  const staleBox = await stale.boundingBox();
  await box.fill("bravo");
  await expect(suggestions(page)).toHaveCount(0);
  // Click where the old option used to be.
  if (staleBox) await page.mouse.click(staleBox.x + 5, staleBox.y + 5);
  await expect(page.getByText(/Selected:/)).toHaveCount(0);
  release();
});

test("ISSUE-056: switching Addresses -> Zones -> Addresses leaves no hidden venue to submit", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/trips") posts.push(request.url());
  });
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  await page.getByLabel("Trip name").fill("Hidden Venue");
  await page.getByLabel(/Departure/).fill("2027-03-05T17:30:00-06:00");
  await chooseByKeyboard(page, "Venue", "event hall", VENUE);
  await expect(page.getByRole("button", { name: "Create trip" })).toBeEnabled();

  await page.getByLabel("Trip type").selectOption("zone");
  await expect(page.getByLabel("Destination")).toBeVisible();
  await page.getByLabel("Trip type").selectOption("address");

  // The field is blank AND nothing is secretly selected.
  await expect(page.getByRole("combobox", { name: "Venue" })).toHaveValue("");
  await expect(page.getByText(/Selected:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create trip" })).toBeDisabled();
  // Implicit submission (Enter in another field) must not send a venue either.
  await page.getByLabel("Trip name").press("Enter");
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
  expect(new URL(page.url()).pathname).toBe("/");

  // Choosing a venue again works normally and creates the trip.
  await chooseByKeyboard(page, "Venue", "event hall", VENUE);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/[0-9a-f-]+$/);
  await expect(page.getByTestId("trip-venue")).toContainText("GROUPRIDE FIXTURE — Event Hall");
  expect(posts).toHaveLength(1);
});

test("ISSUE-056: a zone trip is still created normally after visiting address mode", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  await chooseByKeyboard(page, "Venue", "event hall", VENUE);
  await page.getByLabel("Trip type").selectOption("zone");
  await page.getByLabel("Trip name").fill("Zone After Address");
  await page.getByLabel("Destination").fill("Student Union");
  await page.getByLabel(/Departure/).fill("2026-03-01T09:30:00+00:00");
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/[0-9a-f-]+$/);
  await expect(page.getByTestId("trip-venue")).toHaveCount(0); // a zone trip: no venue
});
