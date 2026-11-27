import { expect, test } from "@playwright/test"

test("launches independently and renders the Board without OpenCode", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/board$/)
  await expect(page.getByRole("heading", { name: "Board", exact: true })).toBeVisible()
  await expect(page.getByText("OpenCode disconnected").first()).toBeVisible()
  await expect(page.getByText("Local app running")).toBeVisible()
  const health = await page.request.get("/api/health")
  expect(await health.json()).toMatchObject({ status: "ok", server: { status: "ready" }, database: { status: "ready", schemaVersion: 3 }, runtime: { status: "disconnected" } })
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
  let releaseFollowUp!: () => void
  let failFollowUp = false
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
  await page.route("**/api/tasks/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    const payload = await response.json() as { task: Record<string, unknown>; activity: unknown[]; messages?: unknown[] }
    if (payload.task.id === startedTaskId) {
      payload.task = { ...payload.task, column: "doing", sessionID: "ses-e2e", initialPromptState: "sent", startedAt: Date.now() }
      payload.messages = [
        { id: "msg-user-e2e", role: "user", text: "Run the task", createdAt: Date.now() - 1000 },
        { id: "msg-assistant-e2e", role: "assistant", model: { providerID: "anthropic", id: "claude-sonnet-4-5" }, text: "## Migration verification\n\n**All 22 tests pass.** Rollback behavior is covered.\n\n### Remaining gaps\n\n- Corrupt database startup\n- Restore rollback after activation failure\n\n```bash\nnpm test\n```", createdAt: Date.now() },
        ...(followUpPayload?.text ? [{ id: "msg-follow-up-e2e", role: "user", text: followUpPayload.text, createdAt: Date.now() }] : []),
      ]
    }
    await route.fulfill({ response, json: payload })
  })
  await page.route("**/api/tasks/*/events", (route) => route.fulfill({ status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" }, body: ["event: ready", "data: {\"taskId\":\"e2e\"}", "", "event: progress", "data: {\"type\":\"session.execution.started\",\"properties\":{\"sessionID\":\"ses-e2e\"}}", "", "event: progress", "data: {\"type\":\"session.text.delta\",\"properties\":{\"sessionID\":\"ses-e2e\",\"assistantMessageID\":\"msg-live-e2e\",\"delta\":\"Streaming output from OpenCode\"}}", "", ""].join("\n") }));
  await page.route("**/api/tasks/*/start", async (route) => {
    startedTaskId = route.request().url().split("/").at(-2) ?? ""
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { kind: "started", sessionId: "ses-e2e" } }) })
  })
  await page.route("**/api/tasks/*/follow-up", async (route) => {
    followUpPayload = route.request().postDataJSON() as { text?: string }
    await new Promise<void>((resolve) => { releaseFollowUp = resolve })
    await route.fulfill(failFollowUp
      ? { status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "OpenCode runtime unavailable" } }) }
      : { status: 200, contentType: "application/json", body: JSON.stringify({ result: { kind: "followed-up", sessionId: "ses-e2e" } }) })
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
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).overflow)).toBe("hidden")
  const detailPanel = page.locator(".task-detail")
  await expect.poll(() => detailPanel.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect.poll(() => detailPanel.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true)
  await detailPanel.evaluate((element) => { element.scrollTop = 260 })
  await expect.poll(() => detailPanel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await detailPanel.evaluate((element) => { element.scrollTop = 0 })
  await expect.poll(() => detailPanel.evaluate((element) => element.scrollTop)).toBe(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await detailPanel.evaluate((element) => { element.scrollTop = 0 })
  await page.locator(".jump-latest-button").click()
  await expect.poll(() => detailPanel.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true)
  await expect(page.getByRole("region", { name: "OpenCode conversation" })).toContainText("All 22 tests pass.")
  await expect(page.getByRole("region", { name: "OpenCode conversation" })).toContainText("Streaming output from OpenCode")
  await expect(page.getByRole("heading", { name: "Migration verification" })).toBeVisible()
  await expect(page.locator('.conversation-message:not(.conversation-live) .conversation-model')).toContainText('anthropic / claude-sonnet-4-5')
  await expect(page.getByRole("region", { name: "OpenCode conversation" })).toContainText("OpenCode 2.4.2")
  await expect(page.getByRole("heading", { name: "Remaining gaps" })).toBeVisible()
  await expect(page.getByRole("list")).toContainText("Corrupt database startup")
  await expect(page.locator(".message-code")).toContainText("npm test")
  await expect(page.getByRole("link", { name: "Open in OpenCode" })).toHaveAttribute("href", "http://127.0.0.1:4096/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session/ses-e2e")
  await page.getByLabel("Follow up in this session").fill("Add regression tests")
  await page.getByRole("button", { name: "Send follow-up" }).click()
  expect(followUpPayload).toEqual({ text: "Add regression tests" })
  await expect(page.locator(".follow-up-working")).toContainText("Đang gửi yêu cầu tới OpenCode…")
  await expect(page.getByRole("button", { name: "Đang gửi tới OpenCode…" })).toBeDisabled()
  await expect(page.locator(".follow-up-submit .button-spinner")).toBeVisible()
  releaseFollowUp()
  await expect(page.locator(".follow-up-working")).toContainText("đang chờ OpenCode bắt đầu xử lý")
  await expect(page.locator(".follow-up-working")).toBeVisible()
  await expect(page.getByRole("region", { name: "OpenCode conversation" })).toContainText("Add regression tests")
  failFollowUp = true
  await page.getByLabel("Follow up in this session").fill("This request should fail")
  await page.getByRole("button", { name: "Send follow-up" }).click()
  await expect(page.locator(".follow-up-working")).toContainText("Đang gửi yêu cầu tới OpenCode…")
  releaseFollowUp()
  await expect(page.getByRole("region", { name: "OpenCode conversation" }).getByRole("status")).toContainText("Không thể gửi yêu cầu: OpenCode runtime unavailable")
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeEnabled()
  await page.getByRole("button", { name: "Close task details" }).click()
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).overflow)).toBe("visible")
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
  await page.route("**/api/tasks/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    const payload = await response.json() as { task: Record<string, unknown>; activity: unknown[]; messages?: unknown[] }
    if (payload.task.id === taskId) {
      payload.task = { ...payload.task, column: "doing", sessionID: "ses-existing", initialPromptState: promptState, lastError: promptState === "failed" ? "Initial prompt rejected" : undefined }
    }
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

test("shows independent Foreman, SQLite and OpenCode health on Settings", async ({ page }) => {
  await page.route("**/api/runtime", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    runtime: { status: "stale", mode: "external", version: "2.4.2", reason: "connection reset" },
    settings: { mode: "external", endpoint: "https://opencode.example.test", username: "dev", credentialRequired: true, autoConnect: false, updatedAt: 1 },
  }) }))
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    status: "ok", server: { status: "ready", uptimeSeconds: 120, nodeVersion: "v22.23.5" },
    database: { status: "ready", schemaVersion: 3 }, runtime: { status: "stale", mode: "external", version: "2.4.2" },
  }) }))
  await page.goto("/settings")
  await expect(page.getByRole("heading", { name: "Application health" })).toBeVisible()
  await expect(page.getByText("Foreman server")).toBeVisible()
  await expect(page.getByText("SQLite database")).toBeVisible()
  await expect(page.getByText("OpenCode runtime", { exact: true })).toBeVisible()
  await expect(page.getByText("Connection stale")).toBeVisible()
  await expect(page.getByText(/Password is not persisted/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Reconnect saved runtime" })).toBeDisabled()
})

test("downloads a backup and requires a verified preview plus confirmation before restore", async ({ page }) => {
  let confirmedToken = ""
  await page.route("**/api/backup", (route) => route.fulfill({ status: 200, contentType: "application/vnd.foreman.backup", body: Buffer.from("FOREMAN-BACKUP-TEST") }))
  await page.route("**/api/backup/preview", async (route) => {
    expect(route.request().headers()["content-type"]).toContain("application/vnd.foreman.backup")
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preview: {
      token: "restore-preview-token", manifest: { createdAt: "2026-11-28T00:00:00.000Z", schemaVersion: 3, databaseBytes: 4096 },
      counts: { tasks: 12, projects: 3, activities: 48 }, expiresInSeconds: 600,
    } }) })
  })
  await page.route("**/api/backup/restore", async (route) => {
    confirmedToken = (route.request().postDataJSON() as { token: string }).token
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { restored: true, rollbackAvailable: true } }) })
  })
  await page.goto("/settings")
  await expect(page.getByRole("heading", { name: "Backup & restore" })).toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download backup" }).click()
  expect((await download).suggestedFilename()).toMatch(/foreman-backup-.*\.fbackup/)

  await page.getByLabel("Restore from backup").setInputFiles({ name: "safe-copy.fbackup", mimeType: "application/vnd.foreman.backup", buffer: Buffer.from("test archive") })
  await expect(page.getByText("Backup verified")).toBeVisible()
  await expect(page.getByText("12 tasks")).toBeVisible()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Confirm restore" }).click()
  await expect(page.getByText("Restore completed. Your previous database was retained as a rollback copy.")).toBeVisible()
  expect(confirmedToken).toBe("restore-preview-token")
})

test("discovers connected OpenCode projects and imports them without removing manual project entry", async ({ page }) => {
  let imported = false
  await page.route("**/api/runtime", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runtime: { status: "connected", mode: "external", version: "2.4.2" } }) }))
  await page.route("**/api/projects", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: imported ? [{ id: "project-alpha", name: "Alpha", directory: "C:\\work\\alpha", createdAt: 1, updatedAt: 1 }] : [] }) }))
  await page.route("**/api/projects/discover", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [{ directory: "C:\\work\\alpha", name: "Alpha" }] }) }))
  await page.route("**/api/projects/import", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ directory: "C:\\work\\alpha" })
    imported = true
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ imported: true, project: { id: "project-alpha", name: "Alpha", directory: "C:\\work\\alpha", createdAt: 1, updatedAt: 1 } }) })
  })
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Discover from OpenCode" })).toBeVisible()
  await expect(page.getByText("C:\\work\\alpha")).toBeVisible()
  await page.getByRole("button", { name: "Add to Foreman" }).click()
  await expect(page.getByRole("button", { name: "Added" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Add a local project" })).toBeVisible()
})
