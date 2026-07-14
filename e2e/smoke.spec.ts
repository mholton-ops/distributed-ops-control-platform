import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("dashboard shell, theme semantics, and zero-value bars are correct", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Distributed Ops Control" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reconciliation" }),
  ).toBeVisible();

  const themeGroup = page.getByRole("radiogroup", { name: "Theme" });
  await expect(themeGroup).toBeVisible();
  await expect(themeGroup.getByRole("radio")).toHaveCount(3);
  await expect(themeGroup.getByRole("radio", { checked: true })).toHaveCount(1);
  const selectedTheme = themeGroup.getByRole("radio", { checked: true });
  await selectedTheme.focus();
  await selectedTheme.press("ArrowRight");
  await expect(
    themeGroup.getByRole("radio", { name: "Light", checked: true }),
  ).toBeFocused();

  const zeroValueBar = page.getByRole("img", { name: /alerts: 0$/i }).first();
  await expect(zeroValueBar).toHaveCount(1);
  await expect(zeroValueBar).toHaveAttribute("aria-label", /alerts: 0$/i);
  expect(await zeroValueBar.evaluate((element) => element.style.width)).toBe(
    "0%",
  );
});

for (const route of ["/assets", "/reconciliation"]) {
  test(`${route} has no page-level overflow at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);

    await expect(page.locator("main")).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));

    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  });
}

test("parent navigation stays active on asset detail", async ({ page }) => {
  await page.goto("/assets");
  const detailHref = await page
    .getByRole("link", { name: "Open Detail" })
    .first()
    .getAttribute("href");
  expect(detailHref).toMatch(/^\/assets\/[^/?#]+$/);
  await page.goto(detailHref!);

  await expect(page).toHaveURL(/\/assets\/[^/?#]+$/);
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Assets" }),
  ).toHaveAttribute("aria-current", "page");
});

test("case creation and resolution use same-origin authenticated routes", async ({
  page,
}) => {
  const title = `E2E same-origin case ${Date.now()}`;
  await page.goto("/reconciliation");

  await page.getByLabel("Case title").fill(title);
  await page
    .getByLabel("Case description")
    .fill(
      "Browser verification of the authenticated same-origin mutation path.",
    );
  await page.getByLabel("Responsible site").selectOption({ index: 1 });

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/reconciliation-cases",
  );
  await page.getByRole("button", { name: "Create case" }).click();
  const createResponse = await createResponsePromise;
  const createBody = (await createResponse.json()) as {
    data?: { id?: unknown; title?: unknown };
  };

  expect(createResponse.ok(), JSON.stringify(createBody)).toBe(true);
  expect(new URL(createResponse.url()).origin).toBe(new URL(page.url()).origin);
  expect(createBody.data?.title).toBe(title);
  expect(typeof createBody.data?.id).toBe("string");
  await expect(
    page.getByText("Case created. Refreshing the workbench."),
  ).toBeVisible();

  await page.goto(`/reconciliation/${String(createBody.data?.id)}`);
  await expect(
    page.getByText(`Title: ${title}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Reconciliation" }),
  ).toHaveAttribute("aria-current", "page");

  const resolutionSummary =
    "Reviewed the source event chain and verified the accepted state for this E2E case.";
  await page.getByLabel("Resolution summary").fill(resolutionSummary);
  await page
    .getByLabel(/I reviewed the source alert, projection state/i)
    .check();

  const resolveResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/api\/reconciliation-cases\/[^/]+\/resolve$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.getByRole("button", { name: "Resolve case" }).click();
  const resolveResponse = await resolveResponsePromise;
  const resolveBody = (await resolveResponse.json()) as {
    data?: { status?: unknown };
  };

  expect(resolveResponse.ok(), JSON.stringify(resolveBody)).toBe(true);
  expect(new URL(resolveResponse.url()).origin).toBe(
    new URL(page.url()).origin,
  );
  expect(resolveBody.data?.status).toBe("resolved");
  await page.reload();
  await expect(
    page.getByText("Resolved", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(`Resolution: ${resolutionSummary}`, { exact: true }),
  ).toBeVisible();
});

for (const route of ["/", "/assets", "/reconciliation"]) {
  test(`${route} has no automatically detectable WCAG A/AA violations`, async ({
    page,
  }) => {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
