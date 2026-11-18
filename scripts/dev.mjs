import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
const children = [];
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
  let stopping = false;
  const stop = () => {
    stopping = true;
    children.forEach((p) => p.kill());
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  vite.on("exit", (code, signal) => {
    if (!stopping && code !== 0 && code !== null)
      console.error(
        `前端开发服务异常退出：code=${code}, signal=${signal ?? "none"}`,
      );
    stop();
    process.exit(code ?? 0);
  });
} catch (error) {
  children.forEach((p) => p.kill());
  console.error(error);
  process.exit(1);
}
