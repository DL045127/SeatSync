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

test("ISSUE-084: the picker asks which building, clears the old choice and accepts a clarified street", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  await page.getByLabel("Trip name").fill("Clarify the venue");
  await page.getByLabel(/Departure/).fill("2027-03-05T17:30:00-06:00");
  await chooseByKeyboard(page, "Venue", "event hall", VENUE);
  const box = page.getByRole("combobox", { name: "Venue" });
  const create = page.getByRole("button", { name: "Create trip" });
  const clarification = page.getByTestId("picker-venue").getByRole("alert");
  for (const [ambiguous, corrected] of [
    ["100 Fixture Plaza, 11 Alpha Court", "100 Fixture Plaza"],
    ["100 Fixture Plaza - 11 Alpha Court", '"Event Hall"'],
    ["100 Fixture Plaza, Austin, TX - 11 Alpha Court, Dallas, TX", '"Event Hall", Fixtureville, TX'],
    ["100 Fixture Plaza, Austin, TX, or 11 Alpha Court, Dallas, TX", "100 Fixture Plaza"],
  ]) {
    await expect(create).toBeEnabled();
    await box.fill(ambiguous);
    await expect(clarification).toContainText("Enter one building number and street name.");
    await expect(suggestions(page)).toHaveCount(0);
    await box.press("Enter");
    await expect(create).toBeDisabled();
    await box.fill("");
    await chooseByKeyboard(page, "Venue", corrected, VENUE);
    await expect(clarification).toHaveCount(0);
    await expect(create).toBeEnabled();
  }
  await box.fill('"Event Hall", Austin, TX, USA');
  await expect(page.getByText("No matching address.")).toBeVisible();
  await expect(suggestions(page)).toHaveCount(0);
  await expect(create).toBeDisabled();
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

test("L-17: delayed, failed and superseded estimates leave Save with the current generation", async ({ page }) => {
  await createAddressTrip(page, "Waiting organizer");
  const preview = page.getByRole("button", { name: "Preview", exact: true });
  const save = page.getByRole("button", { name: "Save plan (commit)" });
  await preview.click();
  await expect(save).toBeEnabled();

  // Control the browser's delivery of an already-completed server reply, even
  // after an abort. Real routes and the saved server preview still supply the data.
  await page.evaluate(() => {
    const send = window.fetch.bind(window);
    const pending: Array<(failure: boolean) => void> = [];
    Object.assign(window, { deliverPreview: (failure: boolean) => pending.shift()!(failure) });
    window.fetch = async (url, init) => {
      if (!String(url).endsWith("/match/preview")) return send(url, init);
      const response = await send(url, { ...init, signal: undefined });
      return new Promise<Response>((resolve) => {
        pending.push((fail) => resolve(fail ? Response.json({ error: {} }, { status: 503 }) : response));
        document.documentElement.dataset.waiting = String(pending.length);
      });
    };
  });
  const deliver = async (failure: boolean, left: number) => {
    await page.evaluate(([fail, n]) => {
      (window as unknown as { deliverPreview: (x: boolean) => void }).deliverPreview(fail);
      document.documentElement.dataset.waiting = String(n);
    }, [failure, left] as const);
  };
  await preview.click();
  await expect(page.getByText("Estimating pickup times…")).toBeVisible();
  await expect(preview).toBeDisabled();
  await expect(save).toBeDisabled();
  await expect(page.locator("html")).toHaveAttribute("data-waiting", "1");
  await deliver(true, 0);
  const retry = page.getByRole("button", { name: "Retry preview" });
  await expect(retry).toBeEnabled();
  await expect(save).toBeDisabled();

  for (const failure of [false, true]) {
    await page.getByRole("button", { name: /^(Retry preview|Preview)$/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-waiting", "1");
    const before = await version(page);
    await page.getByLabel("passenger name").fill(failure ? "Pat" : "Lee");
    await chooseByKeyboard(page, "Passenger pickup address", "pickup alpha", "GROUPRIDE FIXTURE — Pickup Alpha");
    await page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click();
    await expect(page.getByTestId("trip-status")).toContainText(`Version: ${before + 1}`);
    await preview.click();
    await expect(page.locator("html")).toHaveAttribute("data-waiting", "2");
    await deliver(failure, 1);
    await expect(page.getByText("Estimating pickup times…")).toBeVisible();
    await expect(preview).toBeDisabled();
    await expect(save).toBeDisabled();
    await deliver(false, 0);
    await expect(save).toBeEnabled();
    await expect(page.getByTestId("preview-ready")).toContainText(`Preview for version ${before + 1}`);
  }
});

test("L-17: browser deadline aborts a stalled response and Retry recovers the saved winner", async ({ page }) => {
  await createAddressTrip(page, "Deadline recovery");
  let first = true;
  let winner = "";
  await page.route("**/match/preview", async (route) => {
    if (!first) { await route.continue(); return; }
    first = false;
    const response = await route.fetch();
    winner = (await response.json()).previewId;
    // The server published, but delivery to the browser is deliberately stalled.
  });
  const save = page.getByRole("button", { name: "Save plan (commit)" });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Estimating pickup times…")).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry preview" });
  await expect(retry).toBeEnabled({ timeout: 15_000 });
  await expect(save).toBeDisabled();
  expect(winner).not.toBe("");
  const retryResponse = page.waitForResponse((r) => r.url().endsWith("/match/preview"));
  await retry.click();
  expect(await (await retryResponse).json()).toMatchObject({ previewId: winner });
  await expect(save).toBeEnabled();
});

test("L-18: live-format fixture credits remain visible on suggestions, previews and saved estimates", async ({ page }) => {
  const external = watchExternalRequests(page);
  const source = "Fictional municipal address dataset";
  // Preserve fixture tokens and database writes. Only the provider metadata
  // presented to the browser is substituted in these recorded response shapes.
  await page.route("**/api/locations/search", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), provider: "geoapify", attribution: source } });
  });
  await page.route(/\/api\/trips\/[\da-f-]+$/, async route => {
    const response = await route.fetch();
    const trip = await response.json();
    trip.venue = { ...trip.venue, provider: "geoapify", attribution: source };
    if (trip.estimate) trip.estimate.provider = "geoapify";
    await route.fulfill({ response, json: trip });
  });
  await page.route("**/match/preview", async route => {
    const response = await route.fetch();
    const preview = await response.json();
    preview.estimate.provider = "geoapify";
    await route.fulfill({ response, json: preview });
  });
  const credits = async (id: string) => {
    const section = page.getByTestId(id);
    for (const [name, href] of [
      ["Geoapify", "https://www.geoapify.com/"],
      ["© OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
    ]) {
      const link = section.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", href);
    }
    await expect(section).toContainText(source);
  };
  await page.goto("/");
  await page.getByLabel("Trip type").selectOption("address");
  const notice = page.getByText(/Geoapify receives your search text/);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Geoapify receives the selected driver start, passenger pickup, and venue coordinates");
  await page.getByLabel("Trip name").fill("Credit display");
  await page.getByLabel(/Departure/).fill("2027-03-05T17:30:00-06:00");
  await page.getByRole("combobox", { name: "Venue" }).fill("event hall");
  await credits("provider-attribution");
  await suggestions(page).first().click();
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await credits("preview-estimate");
  await page.getByRole("button", { name: "Save plan (commit)" }).click();
  await credits("saved-estimate");
  await page.reload();
  await credits("saved-estimate");
  expect(external).toEqual([]);
});
