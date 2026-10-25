import { defineConfig, devices } from "@playwright/test"

// PLAN §10.7: flows, axe
const baseURL = process.env.E2E_BASE_URL ?? "http://itb.localhost"
// Production hosts carry no port
const server = process.env.E2E_SERVER ?? "127.0.0.1:5198"
// HTTP only, no browser
const API = /api\.e2e\.ts$/

export default defineConfig({
  testDir: ".",
  // bun test skips *.e2e.ts
  testMatch: /.*\.e2e\.ts$/,
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    launchOptions: {
      args: [`--host-resolver-rules=MAP *.localhost:80 ${server}`],
      // Local runs: optional Chrome
      executablePath: process.env.CHROME_PATH,
    },
    trace: "retain-on-failure",
    // Mid-reveal opacity fools contrast
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "phone", testIgnore: API, use: { ...devices["Pixel 7"] } },
    { name: "desktop", testIgnore: API, use: { ...devices["Desktop Chrome"] } },
    {
      name: "api",
      testMatch: API,
      // One fixture run per file
      fullyParallel: false,
      // Host header picks the campus
      use: { baseURL: `http://${server}` },
    },
  ],
})
