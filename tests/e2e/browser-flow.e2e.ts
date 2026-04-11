import { expect, test } from "@playwright/test";
import { createBrowserFixtureApp } from "../helpers/e2e-fixture.js";

test.describe("Capstan browser e2e", () => {
  let fixture: Awaited<ReturnType<typeof createBrowserFixtureApp>>;

  test.beforeAll(async () => {
    fixture = await createBrowserFixtureApp();
  });

  test.afterAll(async () => {
    await fixture.cleanup();
  });

  test("loads SSR pages in the browser, fetches health, and follows page-route navigation", async ({ page }) => {
    await page.goto(`${fixture.baseUrl}/`);

    await expect(page.getByTestId("title")).toHaveText("Capstan Browser E2E");
    await expect(page).toHaveTitle("Capstan Browser E2E");
    await expect(page.getByTestId("counter")).toHaveText("Clicks: 0");

    await page.getByTestId("counter").click();
    await expect(page.getByTestId("counter")).toHaveText("Clicks: 1");

    await page.getByTestId("load-health").click();
    await expect(page.getByTestId("health")).toHaveText("healthy");

    await page.getByTestId("about-link").click();
    await page.waitForURL(/\/about$/);

    await expect(page.getByTestId("about-title")).toHaveText("Client navigation kept the page alive");
    await expect(page).toHaveTitle("Capstan Browser E2E About");

    await page.getByTestId("home-link").click();
    await page.waitForURL(/\/$/);
    await expect(page.getByTestId("title")).toHaveText("Capstan Browser E2E");

    await page.getByTestId("manifest-link").click();
    await page.waitForURL(/\/\.well-known\/capstan\.json$/);
    await expect(page.locator("body")).toContainText("browser-e2e-app");

    await page.goBack();
    await page.waitForURL(/\/$/);

    await page.getByTestId("openapi-link").click();
    await page.waitForURL(/\/openapi\.json$/);
    await expect(page.locator("body")).toContainText("3.1.0");
  });
});
