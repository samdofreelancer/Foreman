import { defineConfig, devices } from "@playwright/test"
import { tmpdir } from "node:os"
import { join } from "node:path"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4318",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4318/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { FOREMAN_PORT: "4318", FOREMAN_NO_OPEN: "1", FOREMAN_DATA_DIR: join(tmpdir(), "foreman-playwright-data") },
  },
})
