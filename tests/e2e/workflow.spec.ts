// W3 browser workflow checks via Playwright against a production build on the
// designated TEST database. Covers WF-1, WF-2, WF-3, WF-4, U-02, U-03.
// The global setup resets the test database once; each test creates its own
// trip, so tests do not interfere.

import { expect, test, type Page } from "@playwright/test";
import { fillDeparture } from "./departure.ts";

/** Create a trip from the home page and land on its trip page. */
async function createTrip(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Trip name").fill(name);
  await page.getByLabel("Destination").fill("Student Union");
  await fillDeparture(page, "2026-03-01", "09:30");
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/[0-9a-f-]+$/);
  const url = page.url();
  return url.slice(url.lastIndexOf("/") + 1);
}

test("a newly created trip replaces the loading screen after its initial read", async ({ page }) => {
  let reads = 0;
  await page.route(/\/api\/trips\/[0-9a-f-]+$/, route => {
    if (route.request().method() === "GET") reads += 1;
    return route.continue();
  });
  await createTrip(page, "New dashboard");
  await expect(page.getByRole("heading", { name: "New dashboard" })).toBeVisible();
  await expect(page.getByTestId("trip-status")).toHaveAttribute("data-version", "0");
  await expect(page.getByText("Loading current trip…")).toHaveCount(0);
  expect(reads).toBe(1);
});

test("discard a preview, clear a saved plan, and protect a replacement plan from stale clears", async ({ page }) => {
  const tripId = await createTrip(page, "Clear assignments");
  await addDriver(page, "Dana", "north", 1);
  await addPassenger(page, "Alex", "east");
  const preview = page.getByRole("button", { name: "Preview", exact: true });
  const save = page.getByRole("button", { name: "Save plan" });
  const saved = page.getByTestId("saved-assignments");
  await preview.click();
  await expect(page.getByText("Preview ready to review.")).toBeVisible();
  await page.getByRole("button", { name: "Discard preview" }).click();
  await expect(save).toBeDisabled();
  await expect(page.getByTestId("preview-ready")).toHaveCount(0);

  await preview.click();
  await save.click();
  await expect(saved.getByRole("article", { name: "Dana" })).toContainText("Alex");
  const clear = page.getByRole("button", { name: "Clear plan" });
  page.once("dialog", dialog => void dialog.dismiss());
  await clear.click();
  await expect(saved.getByRole("article", { name: "Dana" })).toContainText("Alex");

  const route = `/api/trips/${tripId}/match/clear`;
  const request = page.waitForRequest(req => req.url().endsWith(route) && req.method() === "POST");
  page.once("dialog", dialog => void dialog.accept());
  await clear.click();
  const original = await request;
  await expect(page.getByTestId("trip-status")).toContainText("Needs a new plan");
  await expect(saved).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("trip-status")).toContainText("Needs a new plan");
  await expect(saved).toHaveCount(0);
  await expect(page.getByText(/Dana \(north\) seats 1/)).toBeVisible();
  await expect(page.getByText(/Alex \(east\)/)).toBeVisible();

  await preview.click();
  await save.click();
  await expect(saved.getByRole("article", { name: "Dana" })).toContainText("Alex");
  const data = original.postDataJSON();
  const key = original.headers()["idempotency-key"];
  const replay = await page.request.post(route, { headers: { "idempotency-key": key }, data });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({ operation: { key, outcome: "applied" } });
  const stale = await page.request.post(route, { headers: { "idempotency-key": crypto.randomUUID() }, data });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "STALE_VERSION" } });
  await page.reload();
  await expect(saved.getByRole("article", { name: "Dana" })).toContainText("Alex");
});

test("edit zone participants in place and invalidate the saved plan only when details change", async ({ page }) => {
  const tripId = await createTrip(page, "Edit zone participants");
  await addDriver(page, "Dana", "north", 1);
  await addPassenger(page, "Alex", "east");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Save plan" }).click();
  const saved = page.getByTestId("saved-assignments");
  await expect(saved.getByRole("article", { name: "Dana" })).toContainText("Alex");
  const before = await version(page);
  const driver = page.getByRole("form", { name: "Edit driver details" });
  await page.getByRole("button", { name: "Edit driver Dana" }).click();
  await driver.getByRole("button", { name: "Save changes" }).click();
  await expect(driver).toHaveCount(0);
  await expect(page.getByTestId("trip-status")).toHaveAttribute("data-version", String(before));
  await expect(saved.getByRole("article", { name: "Dana" })).toContainText("Alex");

  await page.getByRole("button", { name: "Edit driver Dana" }).click();
  await driver.getByLabel("Name").fill("Dani");
  await driver.getByRole("combobox", { name: "Pickup zone" }).selectOption("west");
  await driver.getByLabel("Seats available").fill("2");
  await driver.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Dani \(west\) seats 2/)).toBeVisible();
  await expect(saved).toHaveCount(0);

  await page.getByRole("button", { name: "Edit passenger Alex" }).click();
  const passenger = page.getByRole("form", { name: "Edit passenger details" });
  await passenger.getByLabel("Name").fill("Avery");
  await passenger.getByRole("combobox", { name: "Pickup zone" }).selectOption("south");
  await passenger.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Avery \(south\)/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Dani \(west\) seats 2/)).toBeVisible();
  await expect(page.getByText(/Avery \(south\)/)).toBeVisible();
  await expect(page.getByTestId("trip-status")).toHaveAttribute("data-version", String(before + 2));
  const response = await page.request.get(`/api/trips/${tripId}`);
  const roster = await response.json();
  expect(roster.drivers).toHaveLength(1);
  expect(roster.requests).toHaveLength(1);
  expect(roster.assignments).toEqual([]);
});

/** Current trip version parsed from the status line. */
async function version(page: Page): Promise<number> {
  const value = await page.getByTestId("trip-status").getAttribute("data-version");
  return value === null ? -1 : Number(value);
}

async function addDriver(page: Page, name: string, zone: string, seats: number): Promise<void> {
  const before = await version(page);
  await page.getByLabel("driver name").fill(name);
  await page.getByLabel("driver zone").selectOption(zone);
  await page.getByLabel("driver seats").fill(String(seats));
  await page.getByTestId("driver-form").getByRole("button", { name: "Add driver" }).click();
  // Wait until the registration lands (version advances and no pending op).
  await expect(page.getByTestId("trip-status")).toHaveAttribute("data-version", String(before + 1));
  await expect(page.getByText(/Pending operation/)).toHaveCount(0);
}

async function addPassenger(page: Page, name: string, zone: string): Promise<void> {
  const before = await version(page);
  await page.getByLabel("passenger name").fill(name);
  await page.getByLabel("passenger zone").selectOption(zone);
  await page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click();
  await expect(page.getByTestId("trip-status")).toHaveAttribute("data-version", String(before + 1));
  await expect(page.getByText(/Pending operation/)).toHaveCount(0);
}

test("preview and saved plans group passenger rows by driver", async ({ page }) => {
  await createTrip(page, "Driver cards");
  await addDriver(page, "Dana", "north", 2);
  await addDriver(page, "Eli", "north", 1);
  await addDriver(page, "Sam", "north", 0);
  const passengerNames = ["Alex", "Brooke", "Casey", "Jo" + "n".repeat(65)];
  for (const name of passengerNames) await addPassenger(page, name, "north");
  const drivers = page.getByRole("region", { name: "Drivers", exact: true });
  const passengers = page.getByRole("region", { name: "Passengers", exact: true });
  const driverStyles = await drivers.locator(".roster-row").first().evaluate(row => ({
    height: row.getBoundingClientRect().height,
    color: getComputedStyle(row).backgroundColor,
  }));
  const passengerStyles = await passengers.locator(".roster-row").first().evaluate(row => ({
    height: row.getBoundingClientRect().height,
    color: getComputedStyle(row).backgroundColor,
  }));
  expect(driverStyles.height).toBeLessThan(54);
  expect(passengerStyles.height).toBeLessThan(54);
  expect(driverStyles.color).not.toBe(passengerStyles.color);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByTestId("preview-assignments");
  const saved = page.getByTestId("saved-assignments");
  for (const plan of [preview, saved]) {
    if (plan === saved) await page.getByRole("button", { name: "Save plan" }).click();
    await expect(plan.getByRole("article")).toHaveCount(3);
    await expect(plan.getByRole("article", { name: "Dana" }).getByRole("listitem")).toHaveCount(2);
    await expect(plan.getByRole("article", { name: "Eli" }).getByRole("listitem")).toHaveCount(1);
    await expect(plan.getByRole("article", { name: "Sam" })).toContainText("No passengers assigned.");
  }
  const rows = await saved.getByRole("listitem").allTextContents();
  const names = rows.map(row => row.split("cost")[0].trim());
  expect(new Set(names).size).toBe(3);
  const unassigned = passengerNames.find(name => !names.includes(name));
  expect(unassigned).toBeDefined();
  await expect(page.getByTestId("saved-unassigned")).toHaveText(`Unassigned: ${unassigned}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(saved.getByRole("listitem")).toHaveText(rows);
  const boxes = await saved.getByRole("article").evaluateAll(cards => cards.map(card => {
    const { left, top, right } = card.getBoundingClientRect();
    return { left, top, right };
  }));
  expect(boxes[0].left).toBe(boxes[1].left);
  expect(boxes[0].top).toBeLessThan(boxes[1].top);
  expect(boxes.every(box => box.right <= 390)).toBe(true);
  await expect(passengers.getByRole("button", { name: `Edit passenger ${passengerNames[3]}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("WF-1 / WF-4: create → register → preview → save → reload shows 1 match at cost 7", async ({ page }) => {
  await createTrip(page, "WF Browser Trip");
  // WF-4 directional fixture: North driver, East passenger -> cost 7.
  await addDriver(page, "Dana", "north", 1);
  await expect(page.getByText(/Dana \(north\) seats 1/)).toBeVisible();
  await addPassenger(page, "Pat", "east");
  await expect(page.getByText(/Pat \(east\)/)).toBeVisible();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("preview-ready")).toBeVisible();
  // ISSUE-024: the visible preview shows the named pairing and cost BEFORE save.
  await expect(page.getByTestId("preview-assignments").getByRole("article", { name: "Dana" }).getByRole("listitem"))
    .toHaveText(/Pat.*cost 7/);
  await expect(page.getByTestId("preview-unassigned")).toContainText("none");

  await page.getByRole("button", { name: "Save plan" }).click();
  // After commit + refresh, the trip is assigned with 1 match at total cost 7.
  await expect(page.getByTestId("trip-status")).toContainText("Plan saved");
  await expect(page.getByTestId("trip-status")).toContainText("Matched: 1");
  await expect(page.getByTestId("trip-status")).toContainText("Total cost: 7");

  // Reload: the saved plan persists, with the named pairing visible (ISSUE-024).
  await page.reload();
  await expect(page.getByTestId("trip-status")).toContainText("Plan saved");
  await expect(page.getByTestId("trip-status")).toContainText("Total cost: 7");
  await expect(page.getByTestId("saved-assignments").getByRole("article", { name: "Dana" }).getByRole("listitem"))
    .toHaveText(/Pat.*cost 7/);
});

test("ISSUE-021: blocked storage sends zero creation requests; a lost creation retries to one trip", async ({ browser }) => {
  // Part 1: with storage writes blocked, the create form must not transmit.
  const blockedContext = await browser.newContext();
  await blockedContext.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("blocked", "QuotaExceededError");
    };
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        return { getItem: () => null, setItem: blocked, removeItem: blocked } as unknown as Storage;
      },
    });
  });
  const blockedPage = await blockedContext.newPage();
  try {
    let creationRequests = 0;
    await blockedPage.route("**/api/trips", (route) => {
      creationRequests += 1;
      return route.continue();
    });
    await blockedPage.goto("/");
    await blockedPage.getByLabel("Trip name").fill("Blocked Trip");
    await blockedPage.getByLabel("Destination").fill("Union");
    await fillDeparture(blockedPage, "2026-03-01", "09:30");
    // The submit button is disabled under blocked storage; force the handler
    // and confirm no request was transmitted.
    await expect(blockedPage.getByRole("button", { name: /Create trip/ })).toBeDisabled();
    expect(creationRequests).toBe(0);
  } finally {
    await blockedContext.close();
  }

  // Part 2: let the first POST COMMIT on the server, suppress its reply, then
  // retry the ORIGINAL key and verify the receipt replays to exactly one trip
  // (one durable effect). This exercises a true lost-acknowledgement, not an
  // aborted-before-server request.
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    let firstKey: string | undefined;
    let committedId: string | undefined;
    const seenKeys = new Set<string>();
    await page.route("**/api/trips", async (route) => {
      const key = route.request().headers()["idempotency-key"];
      seenKeys.add(key);
      if (firstKey === undefined) {
        firstKey = key;
        // Forward to the server so the trip really commits and capture its id,
        // then hide that success from the browser behind a retainable 503 (an
        // unfinalized outcome). The server committed; the client keeps the op.
        const response = await route.fetch();
        committedId = ((await response.json()) as { id: string }).id;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "DATABASE_UNAVAILABLE", message: "unavailable", requestId: "r" } }),
        });
      } else {
        await route.continue();
      }
    });
    await page.goto("/");
    await page.getByLabel("Trip name").fill("Lost Create");
    await page.getByLabel("Destination").fill("Union");
    await fillDeparture(page, "2026-03-01", "09:30");
    await page.getByRole("button", { name: "Create trip" }).click();
    // The pending banner also appears before the POST completes. Wait for the
    // simulated 503 to reach the browser before inspecting the committed id.
    await expect(page.getByText("Outcome unknown. Retry the same creation.", { exact: true })).toBeVisible();
    await expect(page.getByText(/unresolved creation/i)).toBeVisible();
    expect(committedId).toBeDefined();

    // Retry the original key: the idempotent receipt replays to the SAME trip.
    await page.getByRole("button", { name: "Retry creation" }).click();
    await page.waitForURL(/\/trips\/[0-9a-f-]+$/);
    const url = page.url();
    expect(url.slice(url.lastIndexOf("/") + 1)).toBe(committedId);
    // Exactly one durable effect: only the original key was ever transmitted
    // (both the first POST and the retry), and the retry resolved to the SAME
    // trip id. One key + idempotent receipt replay = one created trip.
    expect(seenKeys.size).toBe(1);
    expect([...seenKeys][0]).toBe(firstKey);
    expect(url.slice(url.lastIndexOf("/") + 1)).toBe(committedId);
    // The committed trip is readable and at version 0 (a fresh, single create).
    const snapshot = await page.request.get(`/api/trips/${committedId}`).then((r) => r.json());
    expect((snapshot as { version: number }).version).toBe(0);
  } finally {
    await context.close();
  }
});

test("ISSUE-021: creation is blocked when another operation already owns the tab slot", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Seed the shared slot with a TRIP operation (as if a trip mutation is
    // pending), then visit Home and attempt to create.
    await page.goto("/");
    await page.evaluate(() => {
      sessionStorage.setItem(
        "groupride.pending.v1",
        JSON.stringify({
          key: "11111111-1111-4111-8111-111111111111",
          method: "PATCH",
          canonicalRoute: "/api/trips/abc/drivers/def",
          normalizedBody: { baseVersion: 0, active: false },
          tripId: "abc",
        }),
      );
    });
    const before = await page.evaluate(() => sessionStorage.getItem("groupride.pending.v1"));

    let creationRequests = 0;
    await page.route("**/api/trips", (route) => {
      creationRequests += 1;
      return route.continue();
    });
    await page.reload();
    await page.getByLabel("Trip name").fill("Should Not Create");
    await page.getByLabel("Destination").fill("Union");
    await fillDeparture(page, "2026-03-01", "09:30");
    // The create button is disabled while the slot is owned by another op.
    await expect(page.getByRole("button", { name: /Create trip/ })).toBeDisabled();
    await expect(page.getByText(/Another operation is unresolved/i)).toBeVisible();

    // No creation POST was sent and the stored recovery record is unchanged.
    expect(creationRequests).toBe(0);
    const after = await page.evaluate(() => sessionStorage.getItem("groupride.pending.v1"));
    expect(after).toBe(before);
  } finally {
    await context.close();
  }
});

test("ISSUE-021: a trip mutation is blocked and does not overwrite a pending creation", async ({ page }) => {
  // Create a trip normally, then seed the slot with a pending CREATION (as if
  // Home has an unresolved create), and attempt a registration on the trip page.
  const tripId = await createTrip(page, "Occupied Slot Trip");
  await page.evaluate(() => {
    sessionStorage.setItem(
      "groupride.pending.v1",
      JSON.stringify({
        key: "22222222-2222-4222-8222-222222222222",
        method: "POST",
        canonicalRoute: "/api/trips",
        normalizedBody: { name: "Pending", destinationLabel: "D", departAt: "2026-03-01T09:30:00+00:00" },
        tripId: null,
      }),
    );
  });
  const before = await page.evaluate(() => sessionStorage.getItem("groupride.pending.v1"));

  let driverPosts = 0;
  await page.route("**/api/trips/*/drivers", (route) => {
    driverPosts += 1;
    return route.continue();
  });
  await page.getByLabel("driver name").fill("Blocked");
  await page.getByLabel("driver zone").selectOption("north");
  await page.getByTestId("driver-form").getByRole("button", { name: "Add driver" }).click();

  // The registration is refused: no POST, the creation slot is intact.
  await expect(page.getByText(/unresolved trip creation/i)).toBeVisible();
  expect(driverPosts).toBe(0);
  const after = await page.evaluate(() => sessionStorage.getItem("groupride.pending.v1"));
  expect(after).toBe(before);
  void tripId;
});

test("ISSUE-022: a blank registration name is rejected locally with zero POSTs; a corrected submit succeeds", async ({ page }) => {
  await createTrip(page, "Validation Trip");
  let passengerPosts = 0;
  await page.route("**/api/trips/*/requests", (route) => {
    passengerPosts += 1;
    return route.continue();
  });

  // A whitespace-only name is rejected in the form before any request.
  await page.getByLabel("passenger name").fill("   ");
  await page.getByLabel("passenger zone").selectOption("north");
  await page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click();
  await expect(page.getByTestId("passenger-form").getByRole("alert")).toContainText(/1.80 characters/i);
  expect(passengerPosts).toBe(0);
  // No pending operation was created, so the tab is not stranded.
  await expect(page.getByText(/Pending operation/)).toHaveCount(0);

  // A corrected submission succeeds.
  await page.getByLabel("passenger name").fill("Valid Rider");
  await page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click();
  await expect(page.getByText(/Valid Rider \(north\)/)).toBeVisible();
  expect(passengerPosts).toBe(1);
});

test("ISSUE-022: an over-length passenger name is rejected locally with zero POSTs; a corrected submit succeeds", async ({ page }) => {
  await createTrip(page, "Long Name Trip");
  let posts = 0;
  await page.route("**/api/trips/*/requests", (route) => {
    posts += 1;
    return route.continue();
  });
  // 81 characters exceeds the 80 code-point participant-name limit.
  await page.getByLabel("passenger name").fill("a".repeat(81));
  await page.getByLabel("passenger zone").selectOption("north");
  await page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click();
  await expect(page.getByTestId("passenger-form").getByRole("alert")).toContainText(/1.80 characters/i);
  expect(posts).toBe(0);
  await expect(page.getByText(/Pending operation/)).toHaveCount(0);

  await page.getByLabel("passenger name").fill("Short Name");
  await page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click();
  await expect(page.getByText(/Short Name \(north\)/)).toBeVisible();
  expect(posts).toBe(1);
});

test("departure handles daylight-saving gaps and sends the selected UTC instant", async ({ page }) => {
  const departures: string[] = [];
  await page.route("**/api/trips", (route) => {
    departures.push(route.request().postDataJSON().departAt);
    return route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Trip name").fill("Clock change trip");
  await page.getByLabel("Destination").fill("Union");

  await fillDeparture(page, "2026-03-08", "02:30", "America/Chicago");
  await expect(page.getByRole("group", { name: "Departure" }).getByRole("alert")).toContainText("unavailable in the selected time zone");
  await page.getByRole("button", { name: "Create trip" }).click();
  expect(departures).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem("groupride.pending.v1"))).toBeNull();

  await fillDeparture(page, "2026-11-01", "01:30", "America/Chicago");
  const occurrence = page.getByRole("combobox", { name: /This time occurs twice/ });
  await expect(occurrence.getByRole("option")).toHaveCount(3);
  await page.getByRole("button", { name: "Create trip" }).click();
  expect(departures).toEqual([]);
  await occurrence.selectOption("2026-11-01T07:30:00.000Z");
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/[0-9a-f-]+$/);
  expect(departures).toEqual(["2026-11-01T07:30:00.000Z"]);
  await expect(page.locator("time")).toHaveAttribute("datetime", "2026-11-01T07:30:00.000Z");
});

test("WF-2: editing available seats clears the plan and rematch saves a valid replacement", async ({ page }) => {
  await createTrip(page, "Rematch Trip");
  await addDriver(page, "Drew", "north", 2);
  await addPassenger(page, "Ira", "north");
  await addPassenger(page, "Jo", "north");

  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByTestId("trip-status")).toContainText("Plan saved");
  await expect(page.getByTestId("trip-status")).toContainText("Matched: 2");

  await page.getByRole("button", { name: "Edit driver Drew" }).click();
  const edit = page.getByRole("form", { name: "Edit driver details" });
  await edit.getByLabel("Seats available").fill("1");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("trip-status")).toContainText("Needs a new plan");
  await expect(page.getByTestId("trip-status")).toContainText("Matched: 0");

  // Manual rematch respects the reduced capacity (one seat -> one match).
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByTestId("trip-status")).toContainText("Plan saved");
  await expect(page.getByTestId("trip-status")).toContainText("Matched: 1");

  // ISSUE-024 evidence: assert the ACTUAL unmatched rider by name. Exactly one
  // of Ira/Jo is assigned and the other is unassigned; derive from the view.
  const assignedText = (await page.getByTestId("saved-assignments").textContent()) ?? "";
  const unassignedText = (await page.getByTestId("saved-unassigned").textContent()) ?? "";
  const riders = ["Ira", "Jo"];
  const assignedRider = riders.find((r) => assignedText.includes(r));
  const unassignedRider = riders.find((r) => r !== assignedRider);
  expect(assignedRider).toBeDefined();
  expect(unassignedRider).toBeDefined();
  expect(unassignedText).toContain(unassignedRider as string);
  expect(unassignedText).not.toContain(assignedRider as string);
});

test("WF-3: two sessions, stale commit gives a review/refresh flow without silent overwrite", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    const tripId = await createTrip(pageA, "Two Session Trip");
    await addDriver(pageA, "Alex", "north", 1);
    await addPassenger(pageA, "Bo", "east");

    // Both sessions open the same trip and preview the same version.
    await pageB.goto(`/trips/${tripId}`);
    await expect(pageB.getByTestId("trip-status")).toHaveAttribute("data-version", "2");
    await pageA.getByRole("button", { name: "Preview" }).click();
    await expect(pageA.getByTestId("preview-ready")).toBeVisible();
    await pageB.getByRole("button", { name: "Preview" }).click();
    await expect(pageB.getByTestId("preview-ready")).toBeVisible();

    // Session A commits successfully.
    await pageA.getByRole("button", { name: "Save plan" }).click();
    await expect(pageA.getByTestId("trip-status")).toContainText("Plan saved");

    // Session B's commit is now stale: it must be rejected with a review prompt,
    // not silently overwrite A's plan.
    await pageB.getByRole("button", { name: "Save plan" }).click();
    await expect(pageB.getByText("The trip changed. Review the refreshed state and resubmit.")).toBeVisible();
    // B's preview was cleared and Commit is disabled until it reviews anew.
    await expect(pageB.getByRole("button", { name: "Save plan" })).toBeDisabled();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("inactive drivers and passengers disappear from the dashboard and stay hidden after reload", async ({ page }) => {
  const tripId = await createTrip(page, "Active roster");
  await addDriver(page, "Dana", "north", 1);
  await addPassenger(page, "Alex", "east");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("No active drivers.")).toBeVisible();
  await expect(page.getByText(/Dana \(north\)/)).toHaveCount(0);
  await expect(page.getByText(/Alex \(east\)/)).toBeVisible();
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("No active passengers.")).toBeVisible();
  await expect(page.getByText(/Alex \(east\)/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("No active drivers.")).toBeVisible();
  await expect(page.getByText("No active passengers.")).toBeVisible();
  const response = await page.request.get(`/api/trips/${tripId}`);
  expect(await response.json()).toMatchObject({
    drivers: [{ name: "Dana", active: false }],
    requests: [{ name: "Alex", active: false }],
  });
});

test("U-02: reload replays the exact registration receipt after a withdrawal", async ({ page }) => {
  const tripId = await createTrip(page, "Pending Reload Trip");
  const trip = `/api/trips/${tripId}`;
  const route = `${trip}/requests`;
  const passenger = { name: "Lee", zoneId: "north" };
  const pendingSlot = () => page.evaluate(() => sessionStorage.getItem("groupride.pending.v1"));
  let originalReceipt!: { id: string; mutationVersion: number; operation: { key: string; outcome: string } };

  // Commit the first POST and replace its reply before the page sees it.
  await page.route(route, async (intercept) => {
    const committed = await intercept.fetch();
    expect(committed.status()).toBe(201);
    expect(committed.headers()["idempotency-replayed"]).toBeUndefined();
    originalReceipt = await committed.json();
    await intercept.fulfill({ status: 503, json: { error: { code: "DATABASE_UNAVAILABLE" } } });
  }, { times: 1 });
  await page.getByLabel("passenger name").fill(passenger.name);
  await page.getByLabel("passenger zone").selectOption(passenger.zoneId);
  const [first] = await Promise.all([
    page.waitForRequest(route),
    page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click(),
  ]);
  await expect(page.getByText("Outcome unknown. Retry the same operation.", { exact: true })).toBeVisible();
  const key = first.headers()["idempotency-key"];
  expect(first.method()).toBe("POST");
  expect(first.postDataJSON()).toEqual(passenger);
  expect(originalReceipt).toMatchObject({ id: expect.any(String), mutationVersion: 1, operation: { key, outcome: "applied" } });
  const stored = await pendingSlot();
  expect(JSON.parse(stored!)).toEqual({ key, tripId, method: "POST", canonicalRoute: route, normalizedBody: passenger });

  // A separate client withdraws the committed passenger while the tab is uncertain.
  const withdrawal = await page.request.patch(`${route}/${originalReceipt.id}`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { baseVersion: originalReceipt.mutationVersion, active: false },
  });
  expect(withdrawal.status()).toBe(200);
  const withdrawn = await (await page.request.get(trip)).json();
  expect(withdrawn).toMatchObject({ version: 2, requests: [{ ...passenger, id: originalReceipt.id, active: false }] });

  await page.reload();
  await expect(page.getByText(/Pending operation/)).toBeVisible();
  expect(await pendingSlot()).toBe(stored);
  const [replay] = await Promise.all([
    page.waitForResponse(route, { timeout: 5000 }),
    page.getByRole("button", { name: "Retry" }).click(),
  ]);
  expect(replay.request().method()).toBe("POST");
  expect(replay.request().headers()["idempotency-key"]).toBe(key);
  expect(replay.request().postData()).toBe(first.postData());
  expect(replay.status()).toBe(201);
  expect(replay.headers()["idempotency-replayed"]).toBe("true");
  expect(await replay.json()).toEqual(originalReceipt);
  await expect(page.getByText(/Pending operation/)).toHaveCount(0);
  expect(await pendingSlot()).toBeNull();
  await expect(page.getByText("No active passengers.")).toBeVisible();
  await expect(page.getByText(/Lee \(north\)/)).toHaveCount(0);
  expect(await (await page.request.get(trip)).json()).toEqual(withdrawn);
});

test("ISSUE-022: only a receipt-backed matching-key terminal response resolves a pending op", async ({ page }) => {
  const tripId = await createTrip(page, "Receipt Rules Trip");
  await addDriver(page, "Mel", "north", 2);

  // Case 1: a mismatched-key 200 must NOT clear the pending op.
  await page.route("**/api/trips/*/requests", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "x", mutationVersion: 99, operation: { key: "00000000-0000-4000-8000-0000000000ff", outcome: "applied" } }),
    });
  });
  await page.getByLabel("passenger name").fill("Nia");
  await page.getByLabel("passenger zone").selectOption("north");
  await page.getByTestId("passenger-form").getByRole("button", { name: "Add passenger" }).click();
  // The reply names a different key, so the operation is retained (unknown).
  await expect(page.getByText(/Pending operation/)).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem("groupride.pending.v1"));
  expect(stored).not.toBeNull();
  await page.unroute("**/api/trips/*/requests");

  // Case 2: a receipt-backed matching-key 200 resolves it. Retry replays the
  // real request; the pending banner clears and Nia is added once.
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(/Nia \(north\)/)).toBeVisible();
  await expect(page.getByText(/Pending operation/)).toHaveCount(0);
  const clearedSlot = await page.evaluate(() => sessionStorage.getItem("groupride.pending.v1"));
  expect(clearedSlot).toBeNull();
  void tripId;
});

test("U-03: unavailable session storage blocks mutations before sending; reads/preview still work", async ({ browser }) => {
  const context = await browser.newContext();
  // Make sessionStorage writes throw in every document of this context.
  await context.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("blocked", "QuotaExceededError");
    };
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        return { getItem: () => null, setItem: blocked, removeItem: blocked } as unknown as Storage;
      },
    });
  });
  const page = await context.newPage();
  try {
    // Create the trip via the API directly (creation also needs storage-free
    // flow); then open its page in the storage-blocked context.
    const created = await page.request.post("/api/trips", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { name: "No Storage Trip", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+00:00" },
    });
    const { id } = (await created.json()) as { id: string };
    await page.request.post(`/api/trips/${id}/drivers`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { name: "Sky", zoneId: "north", seatCapacity: 1 },
    });
    await page.request.post(`/api/trips/${id}/requests`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { name: "Robin", zoneId: "east" },
    });

    await page.goto(`/trips/${id}`);
    // The storage-blocked banner is shown (scope to the text to avoid matching
    // Next's route-announcer, which also has role=alert).
    await expect(page.getByText(/Session storage unavailable/i)).toBeVisible();

    // Reads work: the roster is visible.
    await expect(page.getByText(/Sky \(north\)/)).toBeVisible();
    // Preview (a read, non-keyed) still works.
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByTestId("preview-ready")).toBeVisible();

    // A keyed mutation is blocked before sending: the cancel button triggers a
    // blocked message and no driver is canceled.
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await expect(
      page.getByText("Session storage is unavailable; mutations are blocked. Reads and previews still work."),
    ).toBeVisible();
    await expect(page.getByText(/Sky \(north\)/)).toBeVisible(); // still active
  } finally {
    await context.close();
  }
});
