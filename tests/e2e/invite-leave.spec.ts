import { expect, test, type Page } from "@playwright/test";

async function join(page: Page, invite: URL, name: string, role: "driver" | "passenger") {
  await page.goto(invite.href);
  await page.getByRole("combobox", { name: "Join as" }).selectOption(role === "driver" ? "drivers" : "requests");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("combobox", { name: "Pickup zone" }).selectOption("north");
  await page.getByRole("button", { name: `Join as ${role}` }).click();
  await expect(page.getByRole("heading", { name: "You’re registered" })).toBeVisible();
  return new URL(await page.getByLabel("Private registration link").inputValue());
}

test("a late registration reply remains recoverable from the shared invite", async ({ page }) => {
  const created = await page.request.post("/api/trips", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name: "Recover a private link", destinationLabel: "Union", departAt: "2027-04-10T09:30Z" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const trip = "/api/trips/" + id;
  await page.goto("/trips/" + id);
  const invite = new URL((await page.getByRole("link", { name: "Open invite" }).getAttribute("href"))!, page.url());
  const driverLink = await join(page, invite, "Dana", "driver");
  await page.goto(invite.href);

  const register = "/api/invites/" + invite.pathname.split("/").pop() + "/requests";
  let reportCommit!: (receipt: { key: string; token: string }) => void;
  const committed = new Promise<{ key: string; token: string }>(resolve => { reportCommit = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**" + register, async route => {
    const response = await route.fetch();
    const body = await response.json();
    reportCommit({ key: route.request().headers()["idempotency-key"], token: body.leaveToken });
    await held;
    await route.fulfill({ response });
  }, { times: 1 });

  await page.getByLabel("Name", { exact: true }).fill("Alex");
  await page.getByRole("combobox", { name: "Pickup zone" }).selectOption("north");
  await page.getByRole("button", { name: "Join as passenger" }).click();
  const { key, token } = await committed;
  try {
    expect(token).toEqual(expect.any(String));
    const roster = await (await page.request.get(trip)).json();
    expect(roster.requests).toMatchObject([{ name: "Alex", active: true }]);

    await page.goto(driverLink.href);
    await expect(page.getByText("Awaiting a saved plan from the organizer.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave trip" })).toBeDisabled();
  } finally {
    release();
  }

  // The enabled action proves the original request has finished on the private page.
  await expect(page.getByRole("button", { name: "Leave trip" })).toBeEnabled();
  await expect(page.getByLabel("Private registration link")).toHaveValue(driverLink.href);
  await expect(page.getByRole("button", { name: "Retry registration" })).toHaveCount(0);

  await page.goto(invite.href);
  await page.reload();
  const retry = page.getByRole("button", { name: "Retry registration" });
  await expect(retry).toBeEnabled();
  const replay = page.waitForResponse(response => response.url().endsWith(register));
  await retry.click();
  const response = await replay;
  expect(response.request().headers()["idempotency-key"]).toBe(key);
  expect(response.status()).toBe(201);
  const passengerLink = new URL(invite);
  passengerLink.hash = "leave=passenger." + token;
  await expect(page.getByLabel("Private registration link")).toHaveValue(passengerLink.href);
  await expect(page.getByText("Awaiting a saved plan from the organizer.")).toBeVisible();
  const roster = await (await page.request.get(trip)).json();
  expect(roster.requests).toMatchObject([{ name: "Alex", active: true }]);
});

test("private registration status and leave recovery stay scoped while the organizer updates", async ({ page, browser }) => {
  const created = await page.request.post("/api/trips", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name: "Guest leave", destinationLabel: "Union", departAt: "2027-04-10T09:30Z" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto("/trips/" + id);
  const invite = new URL((await page.getByRole("link", { name: "Open invite" }).getAttribute("href"))!, page.url());
  const leave = "/api/invites/" + invite.pathname.split("/").pop() + "/leave";
  const guest = await browser.newPage();
  const returning = await browser.newPage();
  try {
    const driverLink = await join(guest, invite, "Dana", "driver");
    const riderLink = await join(guest, invite, "Alex", "passenger");
    expect(driverLink.hash).toMatch(/^#leave=driver\./);
    expect(riderLink.hash).toMatch(/^#leave=passenger\./);

    await returning.goto(invite.href);
    await expect(returning.getByRole("heading", { name: "Join this trip" })).toBeVisible();
    await expect(returning.getByRole("button", { name: "Leave trip" })).toHaveCount(0);
    const [role, token] = riderLink.hash.slice("#leave=".length).split(".");
    const send = (data: unknown) => returning.request.post(new URL(leave, invite).href, {
      headers: { "idempotency-key": crypto.randomUUID() }, data,
    });
    expect((await send({ role })).status()).toBe(400);
    expect((await send({ role: "driver", token })).status()).toBe(404);

    await returning.goto(driverLink.href);
    await expect(returning.getByText("Awaiting a saved plan from the organizer.")).toBeVisible();
    await returning.goto(riderLink.href);
    await expect(returning.getByText("Awaiting a saved plan from the organizer.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByTestId("trip-status")).toContainText("Plan saved");
    const organizerLoad = await page.evaluate(() => performance.timeOrigin);

    await returning.goto(driverLink.href);
    await expect(returning.getByText("The saved plan assigns you 1 passenger.")).toBeVisible();
    await returning.goto(riderLink.href);
    await expect(returning.getByText("You have a saved ride assignment.")).toBeVisible();
    const statusUrl = new URL(leave.replace(/\/leave$/, "/status"), invite).href;
    const scopedStatus = await returning.request.post(statusUrl, { data: { role, token } });
    expect(await scopedStatus.json()).toEqual({ state: "saved_plan", assignedCount: 1 });
    expect((await returning.request.post(statusUrl, { data: { role: "driver", token } })).status()).toBe(404);

    let firstKey: string | undefined;
    await returning.route("**" + leave, async route => {
      firstKey = route.request().headers()["idempotency-key"];
      await route.fulfill({ status: 503, json: { error: { code: "DATABASE_UNAVAILABLE" } } });
    }, { times: 1 });
    returning.once("dialog", dialog => void dialog.accept());
    await returning.getByRole("button", { name: "Leave trip" }).click();
    await expect(returning.getByText(/couldn’t confirm that you left/)).toBeVisible();

    await returning.goto(driverLink.href);
    await returning.reload();
    await expect(returning.getByText("The saved plan assigns you 1 passenger.")).toBeVisible();
    await expect(returning.getByRole("button", { name: "Retry leaving" })).toHaveCount(0);
    await expect(returning.getByRole("heading", { name: "You left the trip" })).toHaveCount(0);
    await expect(page.getByText(/Alex \(north\)/)).toBeVisible();

    await returning.goto(riderLink.href);
    await page.bringToFront();
    await returning.route("**" + leave, async route => {
      expect(route.request().headers()["idempotency-key"]).toBe(firstKey);
      expect((await route.fetch()).status()).toBe(200);
      await route.fulfill({ status: 503, json: { error: { code: "DATABASE_UNAVAILABLE" } } });
    }, { times: 1 });
    await returning.getByRole("button", { name: "Retry leaving" }).click();
    await expect(returning.getByText(/couldn’t confirm that you left/)).toBeVisible();
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    await expect(page.getByText("No active passengers.")).toBeVisible();
    await expect(page.getByTestId("trip-status")).toContainText("Needs a new plan");
    await expect(page.getByTestId("saved-assignments")).toHaveCount(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(organizerLoad);

    await returning.reload();
    await expect(returning.getByText("This registration is already inactive.")).toBeVisible();
    const replay = returning.waitForResponse(response => response.url().endsWith(leave));
    await returning.getByRole("button", { name: "Retry leaving" }).click();
    expect((await replay).request().headers()["idempotency-key"]).toBe(firstKey);
    await expect(returning.getByRole("heading", { name: "You left the trip" })).toBeVisible();
    await returning.reload();
    await expect(returning.getByRole("heading", { name: "You left the trip" })).toBeVisible();
    await expect(returning.getByRole("button", { name: "Leave trip" })).toHaveCount(0);

    await expect(page.getByText(/Dana \(north\)/)).toBeVisible();
    await expect(page.getByTestId("trip-status")).toContainText("Needs a new plan");
    const version = await page.getByTestId("trip-status").getAttribute("data-version");
    expect((await send({ role, token })).status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId("trip-status")).toHaveAttribute("data-version", version!);

    await returning.goto(driverLink.href);
    await expect(returning.getByText("Awaiting a saved plan from the organizer.")).toBeVisible();
    returning.once("dialog", dialog => void dialog.accept());
    await returning.getByRole("button", { name: "Leave trip" }).click();
    await expect(returning.getByRole("heading", { name: "You left the trip" })).toBeVisible();
    await page.bringToFront();
    await expect(page.getByText("No active drivers.")).toBeVisible();
  } finally {
    await Promise.all([guest.close(), returning.close()]);
  }
});

test("the organizer keeps an edit draft through guest departure and a stale save", async ({ page, browser }) => {
  const created = await page.request.post("/api/trips", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name: "Edit while guests leave", destinationLabel: "Union", departAt: "2027-04-10T09:30Z" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const trip = "/api/trips/" + id;
  await page.goto("/trips/" + id);
  const invite = new URL((await page.getByRole("link", { name: "Open invite" }).getAttribute("href"))!, page.url());

  const guest = await browser.newPage();
  try {
    await join(guest, invite, "Dana", "driver");
    await join(guest, invite, "Alex", "passenger");
    await guest.getByText("Awaiting a saved plan from the organizer.").waitFor();
    await page.bringToFront();
    await expect(page.getByText(/Alex \(north\)/)).toBeVisible();
    await page.getByRole("button", { name: "Edit driver Dana" }).click();
    const editor = page.getByRole("form", { name: "Edit driver details" });
    const name = editor.getByLabel("Name");
    const seats = editor.getByLabel("Seats available");
    const save = editor.getByRole("button", { name: "Save changes" });
    const conflict = editor.getByText(/The trip changed while you were editing/);
    await name.fill("Dani");
    await seats.fill("4");

    guest.once("dialog", dialog => void dialog.accept());
    await guest.getByRole("button", { name: "Leave trip" }).click();
    await expect(guest.getByRole("heading", { name: "You left the trip" })).toBeVisible();
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    await expect(page.getByText("No active passengers.")).toBeVisible();
    await expect(conflict).toBeVisible();
    await expect(name).toHaveValue("Dani");
    await expect(seats).toHaveValue("4");
    await expect(save).toBeDisabled();

    const current = await (await page.request.get(trip)).json();
    const driverRoute = trip + "/drivers/" + current.drivers[0].id;
    await page.route("**" + driverRoute, async route => {
      expect(route.request().postDataJSON().baseVersion).toBe(current.version);
      const other = await page.request.patch(driverRoute, {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: { baseVersion: current.version, details: { name: "Dana Lee", zoneId: "north", seatCapacity: 2 } },
      });
      expect(other.status()).toBe(200);
      await route.continue();
    }, { times: 1 });
    await editor.getByRole("button", { name: "Keep draft" }).click();
    const stale = page.waitForResponse(response =>
      response.request().method() === "PATCH" && response.url().endsWith(driverRoute));
    await save.click();
    expect((await stale).status()).toBe(409);
    await expect(editor.getByText(/Current registration for Dana Lee at north · 2 seats/)).toBeVisible();
    await expect(conflict).toBeVisible();
    await expect(name).toHaveValue("Dani");
    await expect(seats).toHaveValue("4");
    await expect(save).toBeDisabled();

    await editor.getByRole("button", { name: "Keep draft" }).click();
    await save.click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText(/Dani \(north\) seats 4/)).toBeVisible();
    const saved = await (await page.request.get(trip)).json();
    expect(saved.drivers).toMatchObject([{ name: "Dani", seatCapacity: 4 }]);
  } finally {
    await guest.close();
  }
});

test("an older successful registration replay shows completion without a private link", async ({ page }) => {
  const created = await page.request.post("/api/trips", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name: "Older guest receipt", destinationLabel: "Union", departAt: "2027-04-10T09:30Z" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto("/trips/" + id);
  const invite = new URL((await page.getByRole("link", { name: "Open invite" }).getAttribute("href"))!, page.url());
  const register = "/api/invites/" + invite.pathname.split("/").pop() + "/requests";

  let key: string | undefined;
  await page.route("**" + register, async route => {
    key = route.request().headers()["idempotency-key"];
    expect((await route.fetch()).status()).toBe(201);
    await route.fulfill({ status: 503, json: { error: { code: "DATABASE_UNAVAILABLE" } } });
  }, { times: 1 });
  await page.goto(invite.href);
  await page.getByLabel("Name", { exact: true }).fill("Alex");
  await page.getByRole("combobox", { name: "Pickup zone" }).selectOption("north");
  await page.getByRole("button", { name: "Join as passenger" }).click();
  await expect(page.getByText(/couldn’t confirm your registration/)).toBeVisible();

  await page.reload();
  await page.route("**" + register, async route => {
    expect(route.request().headers()["idempotency-key"]).toBe(key);
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.operation).toMatchObject({ key, outcome: "applied" });
    expect(body.leaveToken).toEqual(expect.any(String));
    delete body.leaveToken;
    await route.fulfill({ status: 201, json: body });
  }, { times: 1 });
  await page.getByRole("button", { name: "Retry registration" }).click();
  await expect(page.getByRole("heading", { name: "You’re registered" })).toBeVisible();
  await expect(page.getByText(/Ask the organizer if you need to leave the trip/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Join as passenger" })).toHaveCount(0);
  await expect(page.getByLabel("Private registration link")).toHaveCount(0);
  const roster = await (await page.request.get("/api/trips/" + id)).json();
  expect(roster.requests).toMatchObject([{ name: "Alex", active: true }]);
});
