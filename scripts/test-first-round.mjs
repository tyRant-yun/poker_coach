import { spawn } from "node:child_process";
const args =
  process.platform === "win32" &&
  process.versions.node.startsWith("24.") &&
  process.env.RIVERLINE_BROWSER_JIT !== "1"
    ? ["--no-sparkplug", "--no-maglev", "--no-turbofan"]
    : [];
// Local compatibility setting, not a diagnosis of the recorded Windows fast-fail.
const child = spawn(
  process.execPath,
  [
    ...args,
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.first-round.config.ts",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", windowsHide: true },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill());
