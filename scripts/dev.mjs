import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
const children = [];
try {
  let online = false;
  try {
    const health = await fetch("http://127.0.0.1:5174/api/analysis/health");
    online = health.ok;
  } catch {}
  if (!online) {
    children.push(
      spawn(process.execPath, ["--import", "tsx", "runtime/server.ts"], {
        stdio: "inherit",
        windowsHide: true,
      }),
    );
    for (let i = 0; i < 60; i++) {
      await wait(150);
      try {
        if ((await fetch("http://127.0.0.1:5174/api/analysis/health")).ok) {
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
  const stop = () => {
    children.forEach((p) => p.kill());
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  vite.on("exit", (code) => {
    stop();
    process.exit(code ?? 0);
  });
} catch (error) {
  children.forEach((p) => p.kill());
  console.error(error);
  process.exit(1);
}
