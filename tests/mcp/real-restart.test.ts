import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Reply } from "../../src/modules/analysis/domain.ts";
import type {
  RealCase,
  RealSpec,
  RealJob,
  RealSolution,
} from "../../src/modules/analysis/real-domain.ts";
import { allCombos, legalCombo } from "../../src/modules/analysis/content.ts";

test(
  "R2 recovery: kill actual business server during native work, reopen journal, retry the fixed spec",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "riverline-real-restart-"));
    let child: ChildProcess | undefined;
    async function launch() {
      child = fork(resolve("runtime/server.ts"), [], {
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          RIVERLINE_PORT: "0",
          RIVERLINE_DATA: directory,
          RIVERLINE_WORKSPACE: "real-restart",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      });
      const ready = await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw Error("runtime exited before ready");
        }),
      ]);
      const message = ready[0] as { port: number };
      return `http://127.0.0.1:${message.port}`;
    }
    async function call<T>(
      address: string,
      tool: string,
      input: Record<string, unknown> = {},
    ): Promise<T> {
      const session = (await (
        await fetch(`${address}/api/analysis/session`)
      ).json()) as { token: string; revision: number };
      const result = (await (
        await fetch(`${address}/api/analysis/call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Riverline-Session": session.token,
          },
          body: JSON.stringify({
            tool,
            input: {
              workspaceId: "real-restart",
              requestId: crypto.randomUUID(),
              expectedRevision: session.revision,
              ...input,
            },
          }),
        })
      ).json()) as Reply;
      assert.equal(result.ok, true, JSON.stringify(result));
      return (result as Extract<Reply, { ok: true }>).data as T;
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      const closed = once(child, "exit");
      child.kill();
      await closed;
    }
    try {
      let address = await launch();
      const board = ["2c", "3d", "7h", "9s", "Jc"],
        weights = Object.fromEntries(
          allCombos
            .filter((c) => legalCombo(c, board))
            .slice(0, 200)
            .map((c) => [c, 10000]),
        );
      const c = await call<RealCase>(address, "real_case_create", {
          name: "进程终止恢复",
          board,
          pot: 1000,
          stack: 1000,
          betPercent: "100",
          ranges: [weights, weights],
        }),
        spec = await call<RealSpec>(address, "real_spec_create", {
          caseId: c.ref.id,
          targetNashConvPotFraction: 1e-12,
        });
      const job = await call<RealJob>(address, "real_analysis_start", {
        specId: spec.ref.id,
      });
      await stop();
      address = await launch();
      const recovered = await call<RealJob>(address, "real_analysis_get", {
        jobId: job.ref.id,
      });
      assert.equal(recovered.status, "interrupted");
      assert.equal(recovered.result, undefined);
      const retry = await call<RealJob>(address, "real_analysis_retry", {
        jobId: job.ref.id,
      });
      assert.equal(retry.spec.contentHash, spec.ref.contentHash);
      assert.equal(retry.attempt, 2);
      let result = retry;
      for (
        let n = 0;
        n < 1000 && !["completed", "failed"].includes(result.status);
        n++
      ) {
        await new Promise((r) => setTimeout(r, 10));
        result = await call<RealJob>(address, "real_analysis_get", {
          jobId: retry.ref.id,
        });
      }
      assert.equal(result.status, "completed", result.error);
      const solution = await call<RealSolution>(address, "real_solution_load", {
        solutionId: result.result!.id,
      });
      assert.equal(solution.engineCommit, spec.engineCommit);
      mkdirSync(".artifacts/solver/r2", { recursive: true });
      writeFileSync(
        ".artifacts/solver/r2/restart-evidence.json",
        JSON.stringify(
          {
            kind: "actual-server-process-termination",
            spec: spec.ref,
            inputHash: spec.inputHash,
            originalJob: job.ref,
            recoveredStatus: recovered.status,
            retry: retry.ref,
            attempt: retry.attempt,
            result: solution.ref,
            engineCommit: solution.engineCommit,
            iterations: solution.iterations,
            quality: solution.quality,
          },
          null,
          2,
        ),
      );
    } finally {
      await stop();
      await new Promise((r) => setTimeout(r, 100));
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
