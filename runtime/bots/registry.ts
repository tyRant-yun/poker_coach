import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { botRequestSchema, botReplySchema } from "../../contracts/bot.ts";
import type { BotRequest, BotReply } from "../../contracts/bot.ts";
import { baselineAction } from "./baseline.ts";
import { hash } from "../store.ts";
const packageDir = resolve(".data/bots/hu-v2.2.2-m1");
const source = JSON.parse(
  readFileSync(resolve("engines/bot/source.json"), "utf8"),
) as {
  sourceArchiveSha256: string;
  files: Record<string, string>;
};
const python = () =>
  process.env.RIVERLINE_BOT_PYTHON ??
  resolve(
    process.platform === "win32"
      ? ".venv-bot/Scripts/python.exe"
      : ".venv-bot/bin/python",
  );
export function botCatalog() {
  let available = false;
  try {
    const m = JSON.parse(
      readFileSync(join(packageDir, "manifest.json"), "utf8"),
    );
    available =
      existsSync(python()) &&
      m.sourceArchiveSha256 === source.sourceArchiveSha256 &&
      hash(m.files) === hash(source.files) &&
      Object.entries(source.files).every(
        ([p, h]) =>
          /^hu_bot\/[a-z0-9_]+\.py$/.test(p) &&
          hash(readFileSync(join(packageDir, p))) === h,
      );
  } catch {}
  return [
    {
      id: "baseline-heuristic/1",
      name: "基础对手",
      version: "1",
      tableSizes: [2, 6],
      available: true,
      status: "heuristic",
      description: "轻量启发式；没有GTO或强度证明",
    },
    {
      id: "hu-v2.2.2-experimental",
      name: "HU Bot 2.2.2",
      version: "2.2.2-final-r9",
      tableSizes: [2],
      available,
      status: "experimental",
      description: available
        ? "固定本地候选；局部行为有验证，整体强度未证明"
        : "运行 npm run bot:setup 安装固定本地候选",
    },
  ];
}
export class HuWorker {
  constructor(private command?: { binary: string; args: string[] }) {}
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private pending?: {
    id: string;
    resolve: (r: BotReply) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  async start() {
    if (this.ready) return this.ready;
    if (!botCatalog()[1].available) throw Error("HU Bot发行包未安装或校验失败");
    const child = spawn(
      this.command?.binary ?? python(),
      this.command?.args ?? ["-u", "engines/bot/worker.py", packageDir],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1" },
      },
    );
    this.child = child;
    this.ready = new Promise((yes, no) => {
      const timer = setTimeout(() => {
        no(Error("Bot预热超时"));
        this.close();
      }, 5000);
      let frameBytes = 0;
      child.stdout.on("data", (bytes: Buffer) => {
        for (const byte of bytes) {
          frameBytes = byte === 10 ? 0 : frameBytes + 1;
          if (frameBytes > 16384) {
            no(Error("Bot响应流超限"));
            this.close();
            break;
          }
        }
      });
      createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          if (Buffer.byteLength(line) > 16384) throw Error("Bot响应超限");
          const r = JSON.parse(line);
          if (r.ready === true) {
            if (
              r.contract !== "riverline-bot/1" ||
              r.source !== "hu-v2.2.2-experimental"
            )
              throw Error("Bot预热合同或来源不符");
            clearTimeout(timer);
            yes();
            return;
          }
          const p = this.pending;
          if (!p) return;
          if (!r.ok) {
            if (r.requestId !== p.id) throw Error("Bot错误身份不匹配");
            clearTimeout(p.timer);
            this.pending = undefined;
            p.reject(Error(r.error));
            return;
          }
          const result = botReplySchema.parse(r.reply);
          if (result.requestId !== p.id) throw Error("Bot响应身份不匹配");
          clearTimeout(p.timer);
          this.pending = undefined;
          p.resolve(result);
        } catch (e) {
          no(e);
          this.close();
        }
      });
      const fail = () => {
        clearTimeout(timer);
        no(Error("Bot进程中断"));
        if (this.child === child) {
          this.pending?.reject(Error("Bot进程中断"));
          if (this.pending) clearTimeout(this.pending.timer);
          this.pending = undefined;
          this.child = undefined;
          this.ready = undefined;
        }
      };
      child.on("error", fail);
      child.on("close", fail);
      child.stdin.on("error", fail);
      child.stderr.on("data", () => {});
    });
    return this.ready;
  }
  async decide(request: BotRequest) {
    await this.start();
    if (this.pending) throw Error("Bot决策槽繁忙");
    return new Promise<BotReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(Error("Bot本地截止超时"));
        this.close();
      }, request.budgetMs + 100);
      this.pending = { id: request.requestId, resolve, reject, timer };
      this.child!.stdin.write(JSON.stringify(request) + "\n");
    });
  }
  close() {
    this.pending?.reject(Error("Bot进程关闭"));
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
    this.child?.kill();
    this.child = undefined;
    this.ready = undefined;
  }
}
export class BotRegistry {
  constructor(
    private hu: Pick<HuWorker, "start" | "decide" | "close"> = new HuWorker(),
  ) {}
  async warm(id: string) {
    if (id === "hu-v2.2.2-experimental") await this.hu.start();
  }
  async decide(id: string, raw: BotRequest) {
    const input = botRequestSchema.parse(raw),
      start = performance.now();
    if (id === "baseline-heuristic/1")
      return {
        action: baselineAction(input),
        executed: id,
        elapsedMs: performance.now() - start,
      };
    try {
      if (id !== "hu-v2.2.2-experimental" || input.originPlayers !== 2)
        throw Error("不支持的Bot桌型");
      const result = await this.hu.decide(input);
      if (
        result.handId !== input.handId ||
        result.revision !== input.revision ||
        result.sequence !== input.sequence
      )
        throw Error("Bot结果已过期");
      const legal = input.legal.find((a) => a.kind === result.action.kind);
      if (
        !legal ||
        (result.action.kind === "raise" &&
          (result.action.amount === undefined ||
            result.action.amount < legal.min! ||
            result.action.amount > legal.max!))
      )
        throw Error("Bot输出非法动作");
      return {
        action: result.action,
        executed: result.source,
        elapsedMs: performance.now() - start,
        ...(result.fallback ? { fallback: result.fallback } : {}),
      };
    } catch (e) {
      const safe =
        input.legal.find((a) => a.kind === "check") ??
        input.legal.find((a) => a.kind === "fold") ??
        input.legal.find((a) => a.kind === "call") ??
        input.legal[0];
      return {
        action: {
          kind: safe.kind,
          ...(safe.kind === "raise" ? { amount: safe.min } : {}),
        },
        executed: "legal-safe/1",
        elapsedMs: performance.now() - start,
        fallback: (e instanceof Error ? e.message : String(e)).slice(0, 120),
      };
    }
  }
  close() {
    this.hu.close();
  }
}
