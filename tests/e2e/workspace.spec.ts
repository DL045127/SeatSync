import { expect, test } from "@playwright/test";
import { fillDeparture } from "./departure.ts";

test("first organizer tabs share a workspace and trip receipt replay keeps its original owner", async ({ context, page, browser }) => {
  const secondTab = await context.newPage();
  const other = await browser.newContext();
  try {
    const bootstraps = [page, secondTab].map(tab => tab.waitForResponse(
      response => response.url().endsWith("/api/workspace") && response.request().method() === "POST",
    ));
    await Promise.all([page.goto("/"), secondTab.goto("/")]);
    const [first, second] = await Promise.all(bootstraps);
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    const workspace = await first.json();
    expect(await second.json()).toEqual(workspace);
    expect((await context.cookies()).find(cookie => cookie.name === "groupride_workspace"))
      .toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });

    const headers = { "idempotency-key": crypto.randomUUID() };
    const data = { name: "Workspace trip", destinationLabel: "Union", departAt: "2027-05-01T12:00Z" };
    const missing = await other.request.post("/api/trips", { headers, data });
    expect(missing.status()).toBe(409);
    expect(await missing.json()).toMatchObject({ error: { code: "WORKSPACE_REQUIRED" } });
    const created = await page.request.post("/api/trips", { headers, data });
    expect(created.status()).toBe(201);
    expect((await (await other.request.post("/api/workspace", { data: { action: "bootstrap" } })).json()).workspaceId)
      .not.toBe(workspace.workspaceId);
    const replay = await other.request.post("/api/trips", { headers, data });
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(await created.json());

    const organizer = page.getByText("Organizer workspace", { exact: true });
    await organizer.click();
    await page.getByRole("button", { name: "Rotate recovery code" }).click();
    const code = await page.getByLabel("New recovery code").inputValue();
    expect(code).toMatch(/^[a-f0-9]{64}$/);
    const recovered = await other.request.post("/api/workspace", { data: { action: "recover", code } });
    expect(await recovered.json()).toEqual(workspace);
    expect((await other.cookies()).find(cookie => cookie.name === "groupride_workspace")?.value)
      .not.toBe((await context.cookies()).find(cookie => cookie.name === "groupride_workspace")?.value);
    const rotated = page.waitForResponse(response => response.url().endsWith("/api/workspace"));
    await page.getByRole("button", { name: "Rotate recovery code" }).click();
    expect((await rotated).ok()).toBe(true);
    expect((await other.request.post("/api/workspace", { data: { action: "recover", code } })).status()).toBe(404);

    await page.getByRole("button", { name: "Sign out other browsers" }).click();
    await expect(page.getByText("Other browsers signed out.")).toBeVisible();
    const revoked = await other.request.post("/api/trips", { headers: { "idempotency-key": crypto.randomUUID() }, data });
    expect(revoked.status()).toBe(409);
    expect((await other.request.post("/api/trips", { headers, data })).status()).toBe(201);
  } finally {
    await other.close();
  }
});

test("without Web Locks two simultaneous first tabs can create separate workspaces", async ({ context, page }) => {
  await context.addInitScript(() => { Object.defineProperty(navigator, "locks", { value: undefined }); });
  const secondTab = await context.newPage();
  let arrivals = 0;
  let release!: () => void;
  const both = new Promise<void>(resolve => { release = resolve; });
  await context.route("**/api/workspace", async route => {
    expect(route.request().headers().cookie).toBeUndefined();
    if (++arrivals === 2) release();
    await both;
    await route.continue();
  });
  const bootstraps = [page, secondTab].map(tab => tab.waitForResponse(response => response.url().endsWith("/api/workspace")));
  await Promise.all([page.goto("/"), secondTab.goto("/")]);
  const [first, second] = await Promise.all(bootstraps);
  expect(first.status()).toBe(200);
  expect(second.status()).toBe(200);
  expect(await first.json()).not.toEqual(await second.json());
});

for (const notify of [true, false]) {
  test(`a workspace switch preserves the draft and asks for confirmation (cross-tab notification: ${notify})`, async ({
    context, page, browser,
  }) => {
    if (!notify) await page.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    });
    const other = await browser.newContext();
    try {
      const target = await (await other.request.post("/api/workspace", { data: { action: "bootstrap" } })).json();
      const recovery = await (await other.request.post("/api/workspace", { data: { action: "rotate", expectedWorkspaceId: target.workspaceId, expectedRecoveryVersion: 0 } })).json();
      await page.goto("/");
      const form = page.locator("form.create-form");
      const create = form.getByRole("button", { name: "Create trip" });
      await expect(create).toBeEnabled();
      await page.getByText("Organizer workspace", { exact: true }).click();
      await page.getByRole("button", { name: "Rotate recovery code" }).click();
      await expect(page.getByLabel("New recovery code")).toBeVisible();
      await form.getByLabel("Trip name").fill("Draft from the first workspace");
      await form.getByLabel("Destination").fill("Union");
      const date = form.locator("input[type=date]");
      await fillDeparture(page, "2027-05-01", "12:00");

      const secondTab = await context.newPage();
      await secondTab.goto("/");
      await secondTab.getByText("Organizer workspace", { exact: true }).click();
      await secondTab.getByLabel("Recovery code", { exact: true }).fill(recovery.recoveryCode);
      const recovered = secondTab.waitForResponse(response => response.url().endsWith("/api/workspace") &&
        response.request().postDataJSON()?.action === "recover");
      await secondTab.getByRole("button", { name: "Recover workspace" }).click();
      expect(await (await recovered).json()).toEqual(target);

      const confirmation = page.getByRole("button", { name: "Use current workspace" });
      if (!notify) {
        const rejected = page.waitForResponse(response => response.url().endsWith("/api/trips"));
        await create.click();
        const response = await rejected;
        expect(response.status()).toBe(409);
        expect(await response.json()).toMatchObject({ error: { code: "WORKSPACE_CHANGED" } });
      }
      await expect(confirmation).toBeVisible();
      await expect(create).toBeDisabled();
      await expect(page.getByLabel("New recovery code")).toHaveCount(0);
      await expect(form.getByLabel("Trip name")).toHaveValue("Draft from the first workspace");
      await expect(date).toHaveValue("2027-05-01");
      await confirmation.click();
      const created = page.waitForResponse(response => response.url().endsWith("/api/trips") && response.status() === 201);
      await (notify ? create : page.getByRole("button", { name: "Retry creation" })).click();
      expect((await created).request().headers()["x-groupride-workspace"]).toBe(target.workspaceId);
      await expect(page.getByRole("heading", { name: "Draft from the first workspace" })).toBeVisible();
    } finally {
      await other.close();
    }
  });
}

for (const action of ["rotate", "revoke"] as const) {
  test(`queued ${action} stays bound to the workspace shown at click time`, async ({ context, page, browser }) => {
    const actionName = action === "rotate" ? "Rotate recovery code" : "Sign out other browsers";
    const other = await browser.newContext();
    try {
      const target = await (await other.request.post("/api/workspace", { data: { action: "bootstrap" } })).json();
      const code = await (await other.request.post("/api/workspace", {
        data: { action: "rotate", expectedWorkspaceId: target.workspaceId, expectedRecoveryVersion: 0 },
      })).json();
      const bootstrapped = page.waitForResponse(response => response.url().endsWith("/api/workspace"));
      await page.goto("/");
      const original = await (await bootstrapped).json();
      expect(original.workspaceId).not.toBe(target.workspaceId);
      await page.getByText("Organizer workspace", { exact: true }).click();

      const secondTab = await context.newPage();
      await secondTab.goto("/");
      await expect(secondTab.getByRole("button", { name: "Create trip" })).toBeEnabled();
      await secondTab.getByText("Organizer workspace", { exact: true }).click();
      await secondTab.getByLabel("Recovery code", { exact: true }).fill(code.recoveryCode);

      let reportQueued!: () => void;
      const recovering = new Promise<void>(resolve => { reportQueued = resolve; });
      let releaseRecovery!: () => void;
      const held = new Promise<void>(resolve => { releaseRecovery = resolve; });
      await secondTab.route("**/api/workspace", async route => {
        reportQueued();
        await held;
        await route.continue();
      }, { times: 1 });
      await secondTab.getByRole("button", { name: "Recover workspace" }).click();
      await recovering;
      let rotatePosts = 0;
      page.on("request", request => {
        if (request.method() === "POST" && request.url().endsWith("/api/workspace") &&
            request.postDataJSON()?.action === "rotate") rotatePosts++;
      });
      const attempted = page.waitForResponse(response => action === "rotate"
        ? response.url().endsWith("/api/workspace?recovery-version")
        : response.url().endsWith("/api/workspace") && response.request().postDataJSON()?.action === action);
      const button = page.getByRole("button", { name: actionName });
      try {
        await button.click();
        await expect(button).toBeDisabled();
      } finally {
        releaseRecovery();
      }
      const rejected = await attempted;
      if (action === "rotate") {
        expect(rejected.status()).toBe(200);
        expect(await rejected.json()).toMatchObject(target);
      } else {
        expect(rejected.request().postDataJSON()).toMatchObject({ action, expectedWorkspaceId: original.workspaceId });
        expect(rejected.status()).toBe(409);
        expect(await rejected.json()).toMatchObject({ error: { code: "WORKSPACE_CHANGED" } });
      }
      await expect(page.getByText("The workspace changed. Review it and choose the action again.")).toBeVisible();
      expect(rotatePosts).toBe(0);
      await expect(page.getByLabel("New recovery code")).toHaveCount(0);

      // Bootstrap proves the original B session was not revoked. Recovery
      // separately proves that the existing code was not rotated.
      const stillActive = await other.request.post("/api/workspace", { data: { action: "bootstrap" } });
      expect(await stillActive.json()).toEqual(target);
      const stillRecoverable = await other.request.post("/api/workspace", {
        data: { action: "recover", code: code.recoveryCode },
      });
      expect(await stillRecoverable.json()).toEqual(target);

      const fresh = page.waitForResponse(response => response.url().endsWith("/api/workspace") &&
        response.request().postDataJSON()?.action === action);
      await button.click();
      const applied = await fresh;
      expect(applied.status()).toBe(200);
      expect(applied.request().postDataJSON()).toMatchObject({ action, expectedWorkspaceId: target.workspaceId });
    } finally {
      await other.close();
    }
  });
}

test("rotation clears another tab’s superseded code and leaves the current code visible", async ({ context, page, browser }) => {
  const secondTab = await context.newPage();
  const other = await browser.newContext();
  try {
    await Promise.all([page.goto("/"), secondTab.goto("/")]);
    for (const tab of [page, secondTab]) await tab.getByText("Organizer workspace", { exact: true }).click();
    await page.getByRole("button", { name: "Rotate recovery code" }).click();
    const oldCode = await page.getByLabel("New recovery code").inputValue();
    await secondTab.getByRole("button", { name: "Rotate recovery code" }).click();
    const newCode = await secondTab.getByLabel("New recovery code").inputValue();
    expect(newCode).not.toBe(oldCode);
    await expect(page.getByLabel("New recovery code")).toHaveCount(0);
    await expect(secondTab.getByLabel("New recovery code")).toHaveValue(newCode);

    const recover = (code: string) => other.request.post("/api/workspace", { data: { action: "recover", code } });
    expect((await recover(oldCode)).status()).toBe(404);
    expect((await recover(newCode)).status()).toBe(200);
  } finally {
    await other.close();
  }
});

test("a lost rotation reply clears codes from both tabs", async ({ context, page, browser }) => {
  const rotatingTab = await context.newPage();
  // Exercise the BroadcastChannel sender fallback as well as the lost reply.
  await rotatingTab.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get: () => { throw new Error("Storage blocked"); } });
  });
  const verifier = await browser.newContext();
  try {
    await Promise.all([page.goto("/"), rotatingTab.goto("/")]);
    for (const tab of [page, rotatingTab]) await tab.getByText("Organizer workspace", { exact: true }).click();
    await page.getByRole("button", { name: "Rotate recovery code" }).click();
    const oldCode = await page.getByLabel("New recovery code").inputValue();

    let committedCode = "";
    let committedVersion = 0;
    await rotatingTab.route("**/api/workspace", async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const committed = await response.json();
      committedCode = committed.recoveryCode;
      committedVersion = committed.recoveryVersion;
      await route.abort();
    }, { times: 1 });
    await rotatingTab.getByRole("button", { name: "Rotate recovery code" }).click();
    await expect(rotatingTab.getByText("Failed to fetch")).toBeVisible();
    await page.bringToFront();
    await expect(page.getByLabel("New recovery code")).toHaveCount(0);
    await expect(rotatingTab.getByLabel("New recovery code")).toHaveCount(0);

    const recover = (code: string) => verifier.request.post("/api/workspace", { data: { action: "recover", code } });
    expect(committedCode).toMatch(/^[a-f0-9]{64}$/);
    expect((await recover(oldCode)).status()).toBe(404);
    expect((await recover(committedCode)).status()).toBe(200);

    const retried = rotatingTab.waitForResponse(response => response.url().endsWith("/api/workspace"));
    await rotatingTab.getByRole("button", { name: "Rotate recovery code" }).click();
    const retryResponse = await retried;
    expect(retryResponse.status()).toBe(200);
    expect(retryResponse.request().postDataJSON().expectedRecoveryVersion).toBe(committedVersion);
    const retryCode = await rotatingTab.getByLabel("New recovery code").inputValue();
    expect((await recover(committedCode)).status()).toBe(404);
    expect((await recover(retryCode)).status()).toBe(200);
  } finally {
    await verifier.close();
  }
});

test("a late older rotation reply cannot replace or hide the current code", async ({ context, page, browser }) => {
  // Establish the shared workspace first so the only race is between rotations.
  const bootstrap = await context.request.post("/api/workspace", { data: { action: "bootstrap" } });
  expect(bootstrap.status()).toBe(200);
  await context.addInitScript(() => { Object.defineProperty(navigator, "locks", { value: undefined }); });
  const secondTab = await context.newPage();
  const verifier = await browser.newContext();
  try {
    await Promise.all([page.goto("/"), secondTab.goto("/")]);
    for (const tab of [page, secondTab]) await tab.getByText("Organizer workspace", { exact: true }).click();
    type Rotation = { recoveryCode: string; recoveryVersion: number };
    let reportOld!: (rotation: Rotation) => void;
    const oldCommitted = new Promise<Rotation>(resolve => { reportOld = resolve; });
    let releaseOld!: () => void;
    const held = new Promise<void>(resolve => { releaseOld = resolve; });
    await page.route("**/api/workspace", async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      reportOld(await response.json());
      await held;
      await route.fulfill({ response });
    }, { times: 1 });
    const rotate = (tab: typeof page) => tab.getByRole("button", { name: "Rotate recovery code" });
    await rotate(page).click();
    const oldest = await oldCommitted;
    let newest: Rotation;
    try {
      const newer = secondTab.waitForResponse(response => response.url().endsWith("/api/workspace"));
      await rotate(secondTab).click();
      newest = await (await newer).json();
      expect(newest.recoveryVersion).toBeGreaterThan(oldest.recoveryVersion);
      // Even a known candidate is hidden until concurrent rotations settle.
      await expect(rotate(secondTab)).toBeEnabled();
      await expect(secondTab.getByLabel("New recovery code")).toHaveCount(0);
    } finally {
      releaseOld();
    }
    await expect(rotate(page)).toBeEnabled();
    await expect(page.getByLabel("New recovery code")).toHaveCount(0);
    await expect(secondTab.getByLabel("New recovery code")).toHaveValue(newest.recoveryCode);

    const recover = (code: string) => verifier.request.post("/api/workspace", { data: { action: "recover", code } });
    expect((await recover(oldest.recoveryCode)).status()).toBe(404);
    expect((await recover(newest.recoveryCode)).status()).toBe(200);
  } finally {
    await verifier.close();
  }
});

test("an interrupted rotation cannot overwrite a successful retry when its write runs late", async ({ context, page, browser }) => {
  const verifier = await browser.newContext();
  try {
    await page.goto("/");
    await page.getByText("Organizer workspace", { exact: true }).click();
    const rotate = page.getByRole("button", { name: "Rotate recovery code" });
    let delayed: { expectedWorkspaceId: string; expectedRecoveryVersion: number } | undefined;
    await page.route("**/api/workspace", async route => {
      delayed = route.request().postDataJSON();
      // Hold this exact write before dispatch while the organizer sees a lost reply.
      await route.abort();
    }, { times: 1 });
    await rotate.click();
    await expect(page.getByText("Failed to fetch")).toBeVisible();
    expect(delayed).toMatchObject({ action: "rotate", expectedRecoveryVersion: 0 });

    const retried = page.waitForResponse(response => response.url().endsWith("/api/workspace"));
    await rotate.click();
    const success = await retried;
    expect(success.status()).toBe(200);
    expect(success.request().postDataJSON()).toEqual(delayed);
    const code = await page.getByLabel("New recovery code").inputValue();
    const recover = () => verifier.request.post("/api/workspace", { data: { action: "recover", code } });
    expect((await recover()).status()).toBe(200);

    // Deliver the first request unchanged to the real PostgreSQL-backed route.
    const original = await context.request.post("/api/workspace", { data: delayed });
    expect(original.status()).toBe(409);
    expect(await original.json()).toMatchObject({ error: { code: "RECOVERY_VERSION_CHANGED", currentVersion: 1 } });
    expect((await recover()).status()).toBe(200);
    await expect(page.getByLabel("New recovery code")).toHaveValue(code);
  } finally {
    await verifier.close();
  }
});

test("rotation invalidation reaches a tab with no BroadcastChannel", async ({ context, page, browser }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "BroadcastChannel", { value: undefined }); });
  const rotatingTab = await context.newPage();
  const verifier = await browser.newContext();
  try {
    const started = page.waitForResponse(response => response.url().endsWith("/api/workspace"));
    await page.goto("/");
    expect((await started).status()).toBe(200);
    await rotatingTab.goto("/");
    for (const tab of [page, rotatingTab]) await tab.getByText("Organizer workspace", { exact: true }).click();
    await page.getByRole("button", { name: "Rotate recovery code" }).click();
    const oldCode = await page.getByLabel("New recovery code").inputValue();
    await rotatingTab.getByRole("button", { name: "Rotate recovery code" }).click();
    const current = await rotatingTab.getByLabel("New recovery code").inputValue();
    await page.bringToFront();
    await expect(page.getByLabel("New recovery code")).toHaveCount(0);
    await expect(rotatingTab.getByLabel("New recovery code")).toHaveValue(current);

    const recover = (code: string) => verifier.request.post("/api/workspace", { data: { action: "recover", code } });
    expect((await recover(oldCode)).status()).toBe(404);
    expect((await recover(current)).status()).toBe(200);
  } finally {
    await verifier.close();
  }
});

test("a held version reply for another workspace cannot authorize the original rotation", async ({ context, page, browser }) => {
  await context.addInitScript(() => { Object.defineProperty(navigator, "locks", { value: undefined }); });
  const other = await browser.newContext();
  try {
    const ready = page.waitForResponse(response => response.url().endsWith("/api/workspace"));
    await page.goto("/");
    const a = await (await ready).json();
    const b = await (await other.request.post("/api/workspace", { data: { action: "bootstrap" } })).json();
    const rotate = (request: typeof context.request, workspaceId: string, expectedRecoveryVersion: number) =>
      request.post("/api/workspace", { data: { action: "rotate", expectedWorkspaceId: workspaceId, expectedRecoveryVersion } });
    const recover = (request: typeof context.request, code: string) =>
      request.post("/api/workspace", { data: { action: "recover", code } });

    const aFirstResponse = await rotate(context.request, a.workspaceId, 0);
    expect(aFirstResponse.status()).toBe(200);
    const aFirst = await aFirstResponse.json();
    expect((await rotate(other.request, b.workspaceId, 0)).status()).toBe(200);
    const bSecondResponse = await rotate(other.request, b.workspaceId, 1);
    expect(bSecondResponse.status()).toBe(200);
    const bSecond = await bSecondResponse.json();

    await page.getByText("Organizer workspace", { exact: true }).click();
    // Change the shared cookie without delivering a workspace notice to the old tab.
    expect((await recover(context.request, bSecond.recoveryCode)).status()).toBe(200);
    let reportRead!: (data: unknown) => void;
    const snapshot = new Promise<unknown>(resolve => { reportRead = resolve; });
    let releaseRead!: () => void;
    const held = new Promise<void>(resolve => { releaseRead = resolve; });
    await page.route("**/api/workspace?recovery-version", async route => {
      const response = await route.fetch();
      reportRead(await response.json());
      await held;
      await route.fulfill({ response });
    }, { times: 1 });
    let posts = 0;
    page.on("request", request => {
      if (request.method() === "POST" && request.url().endsWith("/api/workspace") &&
          request.postDataJSON()?.action === "rotate") posts++;
    });
    const button = page.getByRole("button", { name: "Rotate recovery code" });
    await button.click();

    let aCurrentCode: string;
    try {
      expect(await snapshot).toEqual({ workspaceId: b.workspaceId, recoveryVersion: 2 });
      expect((await recover(context.request, aFirst.recoveryCode)).status()).toBe(200);
      const aSecond = await rotate(context.request, a.workspaceId, 1);
      expect(aSecond.status()).toBe(200);
      const body = await aSecond.json();
      expect(body.recoveryVersion).toBe(2);
      aCurrentCode = body.recoveryCode;
      expect((await recover(other.request, aCurrentCode)).status()).toBe(200);
    } finally {
      releaseRead();
    }

    await expect(page.getByText("The workspace changed. Review it and choose the action again.")).toBeVisible();
    expect(posts).toBe(0);
    expect((await recover(other.request, aCurrentCode)).status()).toBe(200);
    await expect(page.getByLabel("New recovery code")).toHaveCount(0);

    await button.click();
    await expect(page.getByLabel("New recovery code")).toBeVisible();
    expect(posts).toBe(1);
  } finally {
    await other.close();
  }
});
