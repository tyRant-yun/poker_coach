import { defineConfig, devices } from "@playwright/test";
process.env.RIVERLINE_RUNTIME = "http://127.0.0.1:5217";
export default defineConfig({
  testDir: "./tests/journeys",
  testMatch:
    process.env.RIVERLINE_ALL_JOURNEYS === "1"
      ? ["**/*.spec.ts"]
      : [
          "real-solver.spec.ts",
          "round2.spec.ts",
          "whole-hand.spec.ts",
          "m1.spec.ts",
        ],
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  projects:
    process.env.RIVERLINE_ALL_JOURNEYS === "1"
      ? [
          {
            name: "legacy",
            testIgnore: [
              /solver\.spec\.ts$/,
              /whole-hand\.spec\.ts$/,
              /round2\.spec\.ts$/,
              /m1\.spec\.ts$/,
            ],
          },
          {
            name: "analysis",
            testMatch: /solver\.spec\.ts$/,
            dependencies: ["legacy"],
          },
          {
            name: "whole-hand",
            testMatch: /(?:whole-hand|round2|m1)\.spec\.ts$/,
            dependencies: ["analysis"],
          },
        ]
      : undefined,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5217",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command: "node --import tsx runtime/server.ts --serve",
    url: "http://127.0.0.1:5217/api/analysis/health",
    reuseExistingServer: process.env.RIVERLINE_REUSE_TEST_SERVER === "1",
    env: {
      RIVERLINE_PORT: "5217",
      RIVERLINE_DATA:
        process.env.RIVERLINE_E2E_DATA ??
        `.artifacts/first-round/browser-${Date.now()}`,
      RIVERLINE_WORKSPACE: "local",
    },
    timeout: 30000,
  },
});
