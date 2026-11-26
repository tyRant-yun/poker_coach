import { startRuntime } from "../runtime/server.ts";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
mkdirSync(".artifacts/m1", { recursive: true });
const stop = resolve(`.artifacts/m1/stop-${process.pid}`),
  rss = resolve(`.artifacts/m1/rss-${process.pid}.json`);
const observer =
  process.platform === "win32"
    ? spawn(
        "pwsh",
        [
          "-NoProfile",
          "-File",
          "scripts/measure-process-tree.ps1",
          "-RootPid",
          String(process.pid),
          "-Output",
          rss,
          "-StopFile",
          stop,
        ],
        { windowsHide: true, stdio: "ignore" },
      )
    : undefined;
const dirs = [
  mkdtempSync(join(tmpdir(), "m1-load-research-")),
  mkdtempSync(join(tmpdir(), "m1-load-practice-")),
];
const rs = dirs.map((directory) => startRuntime({ port: 0, directory }));
const stats = (a: number[]) => {
  const v = [...a].sort((a, b) => a - b);
  return {
    samples: v.length,
    p50: v[Math.floor(v.length * 0.5)],
    p95: v[Math.floor(v.length * 0.95)],
    max: v.at(-1),
  };
};
try {
  await Promise.all(rs.map((r) => once(r.server, "listening")));
  const calls = await Promise.all(
    rs.map(async (r) => {
      const base = `http://127.0.0.1:${(r.server.address() as { port: number }).port}`;
      return async (tool: string, input: Record<string, unknown> = {}) => {
        const session = await (
          await fetch(base + "/api/analysis/session")
        ).json();
        const response = await (
          await fetch(base + "/api/analysis/call", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Riverline-Session": session.token,
            },
            body: JSON.stringify({
              tool,
              input: {
                workspaceId: "local",
                requestId: crypto.randomUUID(),
                expectedRevision: session.revision,
                ...input,
              },
            }),
          })
        ).json();
        if (!response.ok) throw Error(JSON.stringify(response));
        return response.data;
      };
    }),
  );
  const [research, play] = calls,
    f = JSON.parse(readFileSync("benchmarks/solver/m1-turn-cases.json", "utf8"))
      .cases[0];
  const c = await research("real_case_create", {
    name: "load",
    board: f.board,
    pot: f.pot,
    stack: f.stack,
    betPercent: "50",
    turn: { kind: "hu-turn/4", turnBets: f.turnBets, riverBets: f.riverBets },
    ranges: f.ranges.map((r: Record<string, number>) =>
      Object.fromEntries(Object.entries(r).map(([k, w]) => [k, w * 10000])),
    ),
  });
  const spec = await research("real_spec_create", { caseId: c.ref.id });
  let job = await research("real_analysis_start", { specId: spec.ref.id });
  while (!job.result) {
    await new Promise((r) => setTimeout(r, 20));
    job = await research("real_analysis_get", { jobId: job.ref.id });
    if (job.status === "failed") throw Error(job.error);
  }
  await research("real_turn_solution_query", {
    solutionId: job.result.id,
    limit: 100,
  });
  const busySpec = await research("real_spec_create", {
    caseId: c.ref.id,
    maxIterations: 2000,
    targetNashConvPotFraction: 0.000000001,
  });
  const busy = await research("real_analysis_start", {
    specId: busySpec.ref.id,
  });
  const nodes: number[] = [],
    actions: number[] = [],
    exclusive: number[] = [],
    bots: number[] = [];
  await Promise.all([
    (async () => {
      for (let i = 0; i < 100; i++) {
        const t = performance.now();
        await research("real_turn_solution_query", {
          solutionId: job.result.id,
          limit: 100,
        });
        nodes.push(performance.now() - t);
      }
    })(),
    (async () => {
      let h = await play("game_create", {
        players: 2,
        botId: "hu-v2.2.2-experimental",
      });
      for (let i = 0; i < 100; ) {
        if (h.complete) {
          h = await play("game_next", { handId: h.id });
          continue;
        }
        const before = h.botDecisions.length,
          t = performance.now();
        const a = h.legal.find(
          (a: any) => a.kind === "check" || a.kind === "call",
        );
        h = await play("game_act", {
          handId: h.id,
          handRevision: h.revision,
          kind: a.kind,
        });
        const ms = performance.now() - t,
          wait = h.botDecisions
            .slice(before)
            .reduce((n: number, d: any) => n + d.elapsedMs, 0);
        actions.push(ms);
        bots.push(wait);
        exclusive.push(Math.max(0, ms - wait));
        i++;
      }
    })(),
  ]);
  const cancelStart = performance.now();
  await research("real_analysis_cancel", { jobId: busy.ref.id });
  let end = await research("real_analysis_get", { jobId: busy.ref.id });
  while (end.status === "cancel_requested") {
    await new Promise((r) => setTimeout(r, 10));
    end = await research("real_analysis_get", { jobId: busy.ref.id });
  }
  const report = {
    method:
      "loopback HTTP including session roundtrip and JSON parse; separate isolated practice/research workspaces preserve active-hand information gate; fixed HU candidate; concurrent real solve and cached native root query",
    nodes: stats(nodes),
    actionsEndToEnd: stats(actions),
    actionsExcludingMeasuredBot: stats(exclusive),
    botWaitPerAction: stats(bots),
    cancel: { status: end.status, ms: performance.now() - cancelStart },
    nodeProcessPeakRss: process.resourceUsage().maxRSS * 1024,
    limitations:
      "RSS excludes child process memory; no claim about aggregate RSS or UI render latency",
  };
  mkdirSync(".artifacts/m1", { recursive: true });
  writeFileSync(".artifacts/m1/load.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (observer) {
    writeFileSync(stop, "");
    await once(observer, "exit");
    const memory = JSON.parse(readFileSync(rss, "utf8"));
    const p = ".artifacts/m1/load.json";
    if (readFileSync(p, "utf8")) {
      const r = JSON.parse(readFileSync(p, "utf8"));
      r.aggregateRss = memory;
      r.limitations =
        "HTTP loopback and isolated workspaces; UI render latency excluded; aggregate RSS sampled with CIM overhead";
      writeFileSync(p, JSON.stringify(r, null, 2));
      console.log(JSON.stringify(memory));
    }
    rmSync(stop);
  }
  await Promise.all(rs.map((r) => r.close()));
  for (let i = 0; i < dirs.length; i++)
    rmSync(dirs[i], { recursive: true, force: true });
}
