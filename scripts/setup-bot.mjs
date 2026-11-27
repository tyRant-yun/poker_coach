import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const python =
  process.platform === "win32"
    ? ".venv-bot/Scripts/python.exe"
    : ".venv-bot/bin/python";
const env = { ...process.env, PYTHONUTF8: "1" };
if (env.RIVERLINE_BOT_DIRECT_NETWORK === "1")
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ])
    delete env[key];
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", windowsHide: true, env });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!existsSync(python))
  run(process.platform === "win32" ? "py" : "python3", [
    "-m",
    "venv",
    ".venv-bot",
  ]);
run(python, ["-m", "pip", "install", "-r", "engines/bot/requirements.txt"]);
run(python, [
  "scripts/install-bot.py",
  process.argv[2] ??
    process.env.RIVERLINE_HU_SOURCE ??
    (existsSync("../riverline-bot/submission/hu_bot")
      ? "../riverline-bot"
      : "E:/hu bot"),
]);
