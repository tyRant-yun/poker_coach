import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Native builds, persisted work and generated HTML are not frontend sources.
  // In particular Playwright reports must not trigger full-page reloads mid-answer.
  server: {
    proxy: { "/api/analysis": "http://127.0.0.1:5174" },
    watch: {
      ignored: [
        "**/.artifacts/**",
        "**/.data/**",
        "**/engines/**",
        "**/playwright-report/**",
        "**/test-results/**",
        "**/coverage/**",
        "**/dist/**",
      ],
    },
  },
  optimizeDeps: { entries: ["index.html"] },
  preview: { proxy: { "/api/analysis": "http://127.0.0.1:5174" } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: "vendor", test: /node_modules/ }] },
      },
    },
  },
  test: {
    include: ["tests/state/**/*.test.ts", "tests/runtime/**/*.test.ts"],
    environment: "node",
  },
});
