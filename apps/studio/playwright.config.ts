import { defineConfig, devices } from "@playwright/test";

/**
 * Studio E2E: drives the real vite dev server on a dedicated port so it
 * never collides with a developer's :5173 session. Packages are consumed
 * from their built dist/ output — run `npm run build` at the repo root first.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
