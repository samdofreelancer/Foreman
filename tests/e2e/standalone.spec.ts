import { expect, test } from "@playwright/test"

test("launches independently and renders the Board without OpenCode", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/board$/)
  await expect(page.getByRole("heading", { name: "Board", exact: true })).toBeVisible()
  await expect(page.getByText("OpenCode disconnected").first()).toBeVisible()
  await expect(page.getByText("Local app running")).toBeVisible()
  const health = await page.request.get("/api/health")
  expect(await health.json()).toMatchObject({ status: "ok", database: { status: "ready", schemaVersion: 2 } })
  await expect(page.getByText("Plan and track work by task, not by chat session.")).toBeVisible()
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

test("manages tasks on the Board and persists changes across reload", async ({ page }) => {
  const taskTitle = `Implement task board ${Date.now()}`
  await page.goto("/board")
  await page.getByRole("button", { name: "New task" }).click()
  await page.getByLabel("Task title").fill(taskTitle)
  await page.getByLabel("Description").fill("Connect Solid UI to SQLite")
  await page.getByLabel("Project folder").fill("C:\\work\\foreman-e2e")
  await page.getByLabel("Project name").fill("Foreman E2E")
  await page.getByRole("button", { name: "Create task" }).click()

  const card = page.getByRole("button", { name: new RegExp(`Foreman E2E ${taskTitle}`) })
  await expect(card).toBeVisible()
  await card.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toContainText("Connect Solid UI to SQLite")
  await expect(page.getByRole("dialog")).toContainText("Not started")
  await page.getByRole("button", { name: "Edit task" }).click()
  await page.getByLabel("Task title").fill(`${taskTitle} revised`)
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByRole("button", { name: new RegExp(`Foreman E2E ${taskTitle} revised`) })).toBeVisible()
  await page.getByRole("button", { name: "Close task details" }).click()

  await page.getByRole("combobox", { name: `Move ${taskTitle} revised` }).selectOption("ready")
  await expect(page.getByRole("region", { name: "Task board" }).getByRole("region", { name: "Ready column" })).toContainText(`${taskTitle} revised`)
  await page.reload()
  await expect(page.getByRole("region", { name: "Ready column" })).toContainText(`${taskTitle} revised`)

  await page.getByLabel("Search tasks").fill("does not exist")
  await expect(page.getByRole("heading", { name: "No matching tasks" })).toBeVisible()
  await page.getByRole("button", { name: "Clear filters" }).click()
  await expect(page.getByRole("region", { name: "Ready column" })).toContainText(`${taskTitle} revised`)
  await page.getByRole("button", { name: new RegExp(`Foreman E2E ${taskTitle} revised`) }).click()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByRole("button", { name: new RegExp(`Foreman E2E ${taskTitle} revised`) })).toHaveCount(0)
})

test("adds projects manually and shows task activity", async ({ page, isMobile }) => {
  const projectName = `Local tools ${Date.now()}`
  await page.goto("/projects")
  await page.getByLabel("Project name").fill(projectName)
  await page.getByLabel("Absolute folder path").fill(`C:\\work\\${projectName.replaceAll(" ", "-")}`)
  await page.getByRole("button", { name: "Add project" }).click()
  await expect(page.getByText(projectName, { exact: true })).toBeVisible()
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click()
  await page.getByRole("link", { name: "Activity" }).click()
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible()
  await expect(page.getByText(`Added project: ${projectName}`)).toBeVisible()
})

test("filters tasks across projects and supports keyboard task opening", async ({ page }) => {
  const suffix = Date.now()
  const firstTitle = `Alpha task ${suffix}`
  const secondTitle = `Beta task ${suffix}`
  await page.goto("/board")
  const createTask = async (title: string, directory: string) => {
    await page.getByRole("button", { name: "New task" }).click()
    await page.getByLabel("Task title").fill(title)
    await page.getByLabel("Project folder").fill(directory)
    await page.getByRole("button", { name: "Create task" }).click()
    await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible()
  }
  const alphaDirectory = `C:\\work\\alpha-${suffix}`
  const betaDirectory = `C:\\work\\beta-${suffix}`
  await createTask(firstTitle, alphaDirectory)
  await createTask(secondTitle, betaDirectory)
  await page.getByLabel("Filter by project").selectOption(alphaDirectory)
  const alphaCard = page.getByRole("button", { name: new RegExp(firstTitle) })
  await expect(alphaCard).toBeVisible()
  await expect(page.getByRole("button", { name: new RegExp(secondTitle) })).toHaveCount(0)
  await alphaCard.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toContainText(firstTitle)
})

test("explicitly starts a Ready task and sends follow-up to its linked session", async ({ page }) => {
  let startedTaskId = ""
  let followUpPayload: { text?: string } | undefined
  await page.route("**/api/runtime", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ runtime: { status: "connected", mode: "managed", version: "2.4.2", sessionBaseUrl: "http://127.0.0.1:4096/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session" } }),
  }))
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    const payload = await response.json() as { tasks: Array<Record<string, unknown>> }
    payload.tasks = payload.tasks.map((task) => task.id === startedTaskId
      ? { ...task, column: "doing", sessionID: "ses-e2e", initialPromptState: "sent", startedAt: Date.now() }
      : task)
    await route.fulfill({ response, json: payload })
  })
  await page.route("**/api/tasks/*/start", async (route) => {
    startedTaskId = route.request().url().split("/").at(-2) ?? ""
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { kind: "started", sessionId: "ses-e2e" } }) })
  })
  await page.route("**/api/tasks/*/follow-up", async (route) => {
    followUpPayload = route.request().postDataJSON() as { text?: string }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { kind: "followed-up", sessionId: "ses-e2e" } }) })
  })

  const title = `Run task ${Date.now()}`
  await page.goto("/board")
  await page.getByRole("button", { name: "New task" }).click()
  await page.getByLabel("Task title").fill(title)
  await page.getByLabel("Project folder").fill("C:\\work\\execution-e2e")
  await page.getByRole("button", { name: "Create task" }).click()
  await page.getByRole("combobox", { name: `Move ${title}` }).selectOption("ready")
  await page.getByRole("button", { name: new RegExp(title) }).click()
  await expect(page.getByRole("button", { name: "Start task" })).toBeEnabled()
  await page.getByRole("button", { name: "Start task" }).click()
  await expect(page.getByRole("dialog")).toContainText("ses-e2e")
  await page.getByRole("button", { name: "Close task details" }).click()
  await page.reload()
  await page.getByRole("button", { name: new RegExp(title) }).click()
  await expect(page.getByRole("dialog")).toContainText("ses-e2e")
  await expect(page.getByRole("link", { name: "Open in OpenCode" })).toHaveAttribute("href", "http://127.0.0.1:4096/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session/ses-e2e")
  await page.getByLabel("Follow up in this session").fill("Add regression tests")
  await page.getByRole("button", { name: "Send follow-up" }).click()
  expect(followUpPayload).toEqual({ text: "Add regression tests" })
})

test("resends a failed initial prompt in the existing session without starting another", async ({ page }) => {
  let taskId = ""
  let promptState: "failed" | "sent" = "failed"
  let resendCalls = 0
  let startCalls = 0
  await page.route("**/api/runtime", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ runtime: { status: "connected", mode: "external", version: "2.4.2" } }),
  }))
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() === "POST") {
      const response = await route.fetch()
      const payload = await response.json() as { task: { id: string } }
      taskId = payload.task.id
      return route.fulfill({ response, json: payload })
    }
    const response = await route.fetch()
    const payload = await response.json() as { tasks: Array<Record<string, unknown>> }
    payload.tasks = payload.tasks.map((task) => task.id === taskId
      ? { ...task, column: "doing", sessionID: "ses-existing", initialPromptState: promptState, lastError: promptState === "failed" ? "Initial prompt rejected" : undefined }
      : task)
    await route.fulfill({ response, json: payload })
  })
  await page.route("**/api/tasks/*/start", async (route) => {
    startCalls++
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { kind: "started", sessionId: "ses-should-not-exist" } }) })
  })
  await page.route("**/api/tasks/*/resend", async (route) => {
    resendCalls++
    promptState = "sent"
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { kind: "resent", sessionId: "ses-existing" } }) })
  })

  const title = `Resend prompt ${Date.now()}`
  await page.goto("/board")
  await page.getByRole("button", { name: "New task" }).click()
  await page.getByLabel("Task title").fill(title)
  await page.getByLabel("Project folder").fill("C:\\work\\resend-e2e")
  await page.getByRole("button", { name: "Create task" }).click()
  await page.getByRole("button", { name: new RegExp(title) }).click()
  await expect(page.getByRole("dialog")).toContainText("ses-existing")
  await expect(page.getByRole("button", { name: "Resend initial prompt" })).toBeVisible()
  await page.getByRole("button", { name: "Resend initial prompt" }).click()
  await expect(page.getByRole("dialog")).toContainText("ses-existing")
  expect(resendCalls).toBe(1)
  expect(startCalls).toBe(0)
})

test("shows Inbox permissions and questions and sends only explicit human responses", async ({ page }) => {
  let permissionResolved = false
  let questionAnswered = false
  await page.route("**/api/runtime", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ runtime: { status: "connected", mode: "external", version: "2.4.2" } }),
  }))
  await page.route("**/api/inbox", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ items: [
      ...(!permissionResolved ? [{ id: "permission:perm-e2e", kind: "permission", task: { id: "task-e2e", title: "Write configuration", projectDirectory: "C:\\work\\demo" }, sessionId: "ses-e2e", title: "write file", permission: { id: "perm-e2e", sessionId: "ses-e2e", title: "write file", metadata: { message: "Allow OpenCode to write config.json?", resources: ["config.json"] } } }] : []),
      ...(!questionAnswered ? [{ id: "question:form-e2e", kind: "question", task: { id: "task-e2e", title: "Choose deployment target", projectDirectory: "C:\\work\\demo" }, sessionId: "ses-e2e", title: "OpenCode needs your input", question: { id: "form-e2e", sessionId: "ses-e2e", questions: [{ key: "target", question: "Select target", options: ["Staging", "Production"] }] } }] : []),
    ] }),
  }))
  await page.route("**/api/inbox/permissions/perm-e2e/reply", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ response: "once" })
    permissionResolved = true
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ resolved: true }) })
  })
  await page.route("**/api/inbox/questions/form-e2e/reply", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ answers: [["Staging"]] })
    questionAnswered = true
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ resolved: true }) })
  })

  await page.goto("/inbox")
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible()
  await expect(page.getByText("Allow OpenCode to write config.json?")).toBeVisible()
  await expect(page.getByText("Select target")).toBeVisible()
  await page.getByRole("button", { name: "Allow once" }).click()
  await expect(page.getByText("Allow OpenCode to write config.json?")).toHaveCount(0)
  await page.getByLabel("Select target").selectOption("Staging")
  await page.getByRole("button", { name: "Send answers to OpenCode" }).click()
  await expect(page.getByRole("heading", { name: "Nothing needs your attention" })).toBeVisible()
  expect(permissionResolved).toBe(true)
  expect(questionAnswered).toBe(true)
})
