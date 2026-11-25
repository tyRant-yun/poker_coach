import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { GameAction, RuleView } from "../../src/modules/play/domain.ts";

export type RuleInput = {
  players: 2 | 6;
  deck: string[];
  actions: GameAction[];
  stacks?: number[];
};
export class Rules {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    number,
    {
      resolve: (v: RuleView) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sequence = 0;
  private start() {
    if (this.child) return this.child;
    const python =
      process.env.RIVERLINE_PYTHON ??
      resolve(
        process.platform === "win32"
          ? ".venv-rules/Scripts/python.exe"
          : ".venv-rules/bin/python",
      );
    if (!existsSync(python))
      throw Error("规则环境未安装，请运行 npm run rules:setup");
    const child = spawn(python, ["-u", "engines/rules/helper.py"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        if (Buffer.byteLength(line) > 131072) throw Error("规则响应超出限制");
        const response = JSON.parse(line),
          p = this.pending.get(response.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(response.id);
        if (response.ok) p.resolve(response.result);
        else p.reject(Error(response.error));
      } catch {
        child.kill();
      }
    });
    child.stderr.on("data", () => {
      /* Keep the wire protocol separate from Python diagnostics. */
    });
    const fail = () => {
      if (this.child !== child) return;
      this.child = undefined;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("规则进程已中断，请重试原行动"));
      }
      this.pending.clear();
    };
    child.on("error", fail);
    child.on("close", fail);
    child.stdin.on("error", fail);
    return child;
  }
  replay(input: RuleInput): Promise<RuleView> {
    if (this.pending.size >= 16)
      return Promise.reject(Error("规则请求繁忙，请稍后重试"));
    const child = this.start(),
      id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("规则计算超时，原行动未提交"));
        child.kill();
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, input }) + "\n");
    });
  }
  close() {
    this.child?.kill();
  }
}
