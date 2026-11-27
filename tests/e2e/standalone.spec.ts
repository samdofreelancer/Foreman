import { expect, test } from "@playwright/test"

test("launches independently and renders the Board without OpenCode", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/board$/)
  await expect(page.getByRole("heading", { name: "Board", exact: true })).toBeVisible()
  await expect(page.getByText("OpenCode disconnected").first()).toBeVisible()
  await expect(page.getByText("Local app running")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible()
  const health = await page.request.get("/api/health")
  expect(await health.json()).toMatchObject({ status: "ok", database: { status: "ready", schemaVersion: 1 } })
  await expect(page.getByText("Make progress visible.")).toBeVisible()
})

test("announces a safe database recovery state when local storage is unavailable", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "degraded", database: { status: "degraded", schemaVersion: 0, message: "Foreman could not safely open its local database. The original data has not been deleted." } }),
  }))
  await page.goto("/board")
  await expect(page.getByRole("alert")).toContainText("original data has not been deleted")
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
})

test("supports direct route navigation and refresh", async ({ page, isMobile }) => {
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click()
  await page.getByRole("link", { name: "Board" }).click()
  await expect(page).toHaveURL(/\/board$/)
})

test("opens and closes the narrow viewport navigation drawer", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Narrow viewport interaction is covered by the mobile project")
  await page.goto("/board")
  await page.getByRole("button", { name: "Open navigation" }).click()
  const navigation = page.getByRole("navigation", { name: "Main navigation" })
  await expect(navigation).toBeVisible()
  await navigation.getByRole("link", { name: "Activity" }).click()
  await expect(page).toHaveURL(/\/activity$/)
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible()
})

test("creates a fresh local browser session after a browser context restart", async ({ browser }) => {
  const firstContext = await browser.newContext()
  const firstPage = await firstContext.newPage()
  await firstPage.goto("/board")
  await expect(firstPage.getByRole("heading", { name: "Board", exact: true })).toBeVisible()
  await firstContext.close()

  const restartedContext = await browser.newContext()
  const restartedPage = await restartedContext.newPage()
  await restartedPage.goto("/board")
  await expect(restartedPage.getByRole("heading", { name: "Board", exact: true })).toBeVisible()
  await expect(restartedPage.getByText("Local app running")).toBeVisible()
  await restartedContext.close()
})

test("keeps the application within the viewport without horizontal page overflow", async ({ page }) => {
  await page.goto("/board")
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
})
