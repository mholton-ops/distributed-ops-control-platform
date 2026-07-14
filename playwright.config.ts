import { defineConfig, devices } from "@playwright/test";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for database-backed end-to-end tests.`,
    );
  }
  return value;
}

const databaseUrl = requiredEnvironment("DATABASE_URL");
const authToken = requiredEnvironment("OPS_TEST_AUTH_TOKEN");
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run start --workspace @ops/api",
      url: "http://127.0.0.1:4000/ready",
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "production",
        PORT: "4000",
        LOG_LEVEL: "warn",
        DATABASE_URL: databaseUrl,
        OPS_TEST_AUTH_TOKEN: authToken,
        OPS_TEST_ACTOR: process.env.OPS_TEST_ACTOR ?? "playwright-operator",
      },
    },
    {
      command: "node scripts/start-web-standalone.mjs",
      url: `${baseURL}/api/health`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "3000",
        API_BASE_URL: "http://127.0.0.1:4000/api/v1",
        OPS_TEST_AUTH_TOKEN: authToken,
        OPS_TEST_WEB_ORIGIN: baseURL,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
