import { expect, test } from "@playwright/test";
import { fillDeparture } from "./departure.ts";

test("an invite lets guests join both roles and recovers a lost registration reply", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByLabel("Trip name").fill("Volunteer day");
  await page.getByLabel("Destination").fill("Riverside Park");
  await fillDeparture(page, "2027-04-10", "09:30", "America/Chicago");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page.getByRole("heading", { name: "Volunteer day" })).toBeVisible();
  const organizer = new URL(page.url());
  const invite = new URL((await page.getByRole("link", { name: "Open invite" }).getAttribute("href"))!, organizer);
  expect(invite.pathname.split("/").pop()).not.toBe(organizer.pathname.split("/").pop());

  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(invite.href);
    await expect(guest.getByRole("heading", { name: "Volunteer day" })).toBeVisible();
    await expect(guest.getByText(/Riverside Park/)).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Register participants" })).toHaveCount(0);
    expect(await guest.locator("body").innerHTML()).not.toContain(organizer.pathname.split("/").pop());
    const inviteId = invite.pathname.split("/").pop();
    expect((await guest.request.get(new URL("/api/trips/" + inviteId, invite).href)).status()).toBe(404);
    await guest.getByLabel("Name", { exact: true }).fill("Lee");
    await guest.getByRole("combobox", { name: "Pickup zone" }).selectOption("east");

    const registration = "/api/invites/" + inviteId + "/requests";
    let originalKey = "";
    await guest.route("**" + registration, async route => {
      originalKey = route.request().headers()["idempotency-key"];
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.fulfill({ status: 503, json: { error: { code: "DATABASE_UNAVAILABLE" } } });
    }, { times: 1 });
    await guest.getByRole("button", { name: "Join as passenger" }).click();
    await expect(guest.getByText(/couldn’t confirm your registration/)).toBeVisible();
    await guest.reload();
    const replay = guest.waitForResponse(r => r.url().endsWith(registration));
    await guest.getByRole("button", { name: "Retry registration" }).click();
    expect((await replay).request().headers()["idempotency-key"]).toBe(originalKey);
    await expect(guest.getByText(/You joined as a passenger/)).toBeVisible();

    const otherGuest = await context.newPage();
    await otherGuest.goto(invite.href);
    await expect(otherGuest.getByText("Lee", { exact: true })).toHaveCount(0);
    await otherGuest.getByRole("combobox", { name: "Join as" }).selectOption("drivers");
    await otherGuest.getByLabel("Name", { exact: true }).fill("Dana");
    await otherGuest.getByRole("combobox", { name: "Pickup zone" }).selectOption("north");
    await otherGuest.getByLabel("Seats available").fill("2");
    await otherGuest.getByRole("button", { name: "Join as driver" }).click();
    await expect(otherGuest.getByText(/You joined as a driver/)).toBeVisible();

    await page.reload();
    await expect(page.getByText(/Dana \(north\) seats 2/)).toBeVisible();
    await expect(page.getByText(/Lee \(east\)/)).toHaveCount(1);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByTestId("preview-assignments").getByRole("article", { name: "Dana" })).toContainText("Lee");
  } finally {
    await context.close();
  }
});

test("address invite selections are scoped to the invite and register in the organizer roster", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Trip name").fill("Address invitation");
  await page.getByRole("combobox", { name: "Trip type" }).selectOption("address");
  await fillDeparture(page, "2027-04-10", "09:30", "America/Chicago");
  const venue = page.getByRole("combobox", { name: "Venue" });
  await venue.fill("event hall");
  await page.getByRole("listbox").getByRole("option").first().click();
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page.getByRole("heading", { name: "Address invitation" })).toBeVisible();
  const organizerUrl = page.url();
  const id = new URL(organizerUrl).pathname.split("/").pop()!;
  await page.getByRole("link", { name: "Open invite" }).click();
  const invite = new URL(page.url()).pathname.split("/").pop()!;
  await page.getByRole("combobox", { name: "Join as" }).selectOption("drivers");
  await page.getByLabel("Name", { exact: true }).fill("Dana");
  const hit = page.waitForResponse(r => r.url().endsWith("/api/invites/" + invite + "/search"));
  await page.getByRole("combobox", { name: "Starting address" }).fill("delta");
  const reply = await (await hit).json();
  const token = reply.suggestions[0].token;
  expect(Buffer.from(token.split(".")[1], "base64url").toString()).not.toContain(id);
  const organizerAttachment = await page.request.post("/api/trips/" + id + "/drivers", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name: "Dana", seatCapacity: 1, maxDetourMinutes: 15, startSelectionToken: token },
  });
  expect(organizerAttachment.status()).toBe(422);
  expect(await organizerAttachment.json()).toMatchObject({ error: { code: "LOCATION_SELECTION_INVALID" } });
  await page.getByRole("listbox").getByRole("option").first().click();
  await page.getByRole("button", { name: "Join as driver" }).click();
  await expect(page.getByText(/You joined as a driver/)).toBeVisible();

  await page.goto("/join/" + invite);
  await page.getByLabel("Name", { exact: true }).fill("Pat");
  await page.getByRole("combobox", { name: "Pickup address" }).fill("pickup alpha");
  await page.getByRole("listbox").getByRole("option", { name: /Pickup Alpha —/ }).click();
  await page.getByRole("button", { name: "Join as passenger" }).click();
  await expect(page.getByText(/You joined as a passenger/)).toBeVisible();
  await page.goto(organizerUrl);
  await expect(page.getByText(/Dana \(GROUPRIDE FIXTURE — Driver Start Delta\)/)).toHaveCount(1);
  await expect(page.getByText(/Pat \(GROUPRIDE FIXTURE — Pickup Alpha\)/)).toHaveCount(1);
  const invalid = await page.goto("/join/" + crypto.randomUUID());
  expect(invalid?.status()).toBe(404);
});
