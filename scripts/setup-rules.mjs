import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const env = { ...process.env, PYTHONUTF8: "1" };
const run = (command, args) => {
  const r = spawnSync(command, args, {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const python =
  process.env.RIVERLINE_PYTHON ??
  (process.platform === "win32"
    ? ".venv-rules/Scripts/python.exe"
    : ".venv-rules/bin/python");
if (!existsSync(python))
  run(process.platform === "win32" ? "py" : "python3", [
    "-m",
    "venv",
    ".venv-rules",
  ]);
run(python, ["-m", "pip", "install", "-r", "engines/rules/requirements.txt"]);
run(python, [
  "-c",
  "from importlib.metadata import version; assert version('pokerkit') == '0.7.8'; print('PokerKit 0.7.8 ready')",
]);
