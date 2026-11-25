import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
const children = [];
let stopping = false;
let restartTimer;
const failures = [];
const stop = () => {
  stopping = true;
  clearTimeout(restartTimer);
  children.forEach((p) => p.kill());
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  let online = false;
  try {
    const health = await fetch("http://127.0.0.1:5174/api/analysis/health", {
      signal: AbortSignal.timeout(1000),
    });
    online = health.ok;
  } catch {}
  if (!online) {
    children.push(
      spawn(process.execPath, ["--import", "tsx", "runtime/server.ts"], {
        stdio: "inherit",
        windowsHide: true,
      }),
    );
    console.info(`[riverline-dev] runtime pid=${children[0].pid}`);
    for (let i = 0; i < 400; i++) {
      await wait(150);
      try {
        if (
          (
            await fetch("http://127.0.0.1:5174/api/analysis/health", {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          online = true;
          break;
        }
      } catch {}
    }
  }
  if (!online) throw Error("本地运行时启动失败");
  const launchFrontend = () => {
    const vite = spawn(
      process.execPath,
      [
        // Windows/Node 24 frontend hosts have failed fast (0xC0000409) here.
        // Disable JS compiler tiers, retaining WebAssembly required by Vite's lexer.
        // RIVERLINE_VITE_JIT=1 restores the defaults for controlled diagnosis.
        ...(process.platform === "win32" &&
        process.versions.node.startsWith("24.") &&
        process.env.RIVERLINE_VITE_JIT !== "1"
          ? ["--no-sparkplug", "--no-maglev", "--no-turbofan"]
          : []),
        "node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        "5173",
        "--strictPort",
      ],
      { stdio: "inherit", windowsHide: true },
    );
    children.push(vite);
    console.info(`[riverline-dev] frontend pid=${vite.pid}`);
    vite.on("error", (error) =>
      console.error(`前端启动失败：${error.message}`),
    );
    vite.on("close", (code, signal) => {
      const index = children.indexOf(vite);
      if (index >= 0) children.splice(index, 1);
      if (stopping) return;
      console.error(
        `前端开发服务退出：code=${code}, signal=${signal ?? "none"}；本地计算服务继续运行。`,
      );
      const now = Date.now();
      while (failures.length && failures[0] < now - 60000) failures.shift();
      if (failures.length >= 2) {
        console.error(
          "前端连续重启失败，已停止自动重启。计算服务保留；请检查日志后重新启动前端。Ctrl+C 可停止本次启动的服务。",
        );
        return;
      }
      failures.push(now);
      restartTimer = setTimeout(launchFrontend, 250);
    });
  };
  launchFrontend();
} catch (error) {
  children.forEach((p) => p.kill());
  console.error(error);
  process.exit(1);
}
