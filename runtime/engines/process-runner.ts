import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  engineCommandSchema,
  engineCommit,
  engineEventSchema,
  engineIdentitySchema,
  engineProtocol,
  riverInputSchema,
} from "../../contracts/solver/engine.ts";
import type {
  EngineEvent,
  EngineIdentity,
  RiverInput,
} from "../../contracts/solver/engine.ts";

const binary = fileURLToPath(
  new URL(
    `../../engines/postflop/target/release/riverline-solver${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export type EngineRunResult = {
  identity: EngineIdentity;
  status: "completed" | "cancelled" | "failed" | "interrupted";
  binaryHash: string;
  error?: string;
  native?: { path: string; hash: string; bytes: number };
  summary?: { path: string; hash: string; bytes: number };
  nodes?: { path: string; hash: string; bytes: number; history: number[] }[];
  cancelLatencyMs?: number;
};

/** No workspace state here: caller owns job transitions and atomic artifact publication. */
export function startEngine(
  input: RiverInput,
  options: {
    directory: string;
    jobId?: string;
    attempt?: number;
    onEvent?: (event: EngineEvent) => void;
  },
): {
  result: Promise<EngineRunResult>;
  cancel: () => void;
  interrupt: () => void;
} {
  const parsed = riverInputSchema.parse(input);
  const directory = resolve(options.directory);
  // Exclusive fresh directory prevents retry artifacts and symlink substitutions being reused.
  mkdirSync(directory, { recursive: false });
  const inputBytes = Buffer.from(JSON.stringify(parsed));
  if (inputBytes.length > 1_048_576) throw Error("input exceeds 1MiB");
  const identity = {
    requestId: randomUUID(),
    jobId: options.jobId ?? randomUUID(),
    attempt: options.attempt ?? 1,
    specHash: digest(inputBytes),
  };
  engineCommandSchema.parse({
    protocolVersion: engineProtocol,
    operation: "solve",
    identity,
  });
  const binaryHash = digest(readFileSync(binary));
  writeFileSync(join(directory, "input.json"), inputBytes, { flag: "wx" });
  const child = spawn(binary, ["worker", directory], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let pending = Buffer.alloc(0),
    stderr = "",
    seq = -1,
    hello = false;
  let started = false,
    terminal: EngineEvent | undefined,
    failure: string | undefined;
  let cancelRequestedAt: number | undefined,
    cancelledEarly = false,
    forced = false;
  let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
  const send = (operation: "solve" | "cancel") => {
    if (!child.stdin.destroyed)
      child.stdin.write(
        `${JSON.stringify({ protocolVersion: engineProtocol, operation, identity })}\n`,
      );
  };
  const cancel = () => {
    if (terminal || forced || cancelRequestedAt) return;
    cancelRequestedAt = performance.now();
    if (hello) send("cancel");
    else cancelledEarly = true;
    cancellationTimer = setTimeout(() => {
      forced = true;
      child.kill();
    }, 2000);
  };
  const interrupt = () => {
    forced = true;
    child.kill();
  };
  const fail = (message: string) => {
    failure ??= message;
    child.kill();
  };
  const timeout = setTimeout(
    () => fail("worker wall-time budget exceeded"),
    (parsed.limits.maxSeconds + 15) * 1000,
  );
  const result = new Promise<EngineRunResult>((resolveResult) => {
    child.on("error", (error) => {
      failure = error.message;
    });
    child.stdin.on("error", (error) => {
      if (!terminal) failure ??= `worker input: ${error.message}`;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-65536);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      try {
        let newline: number;
        while ((newline = pending.indexOf(10)) >= 0) {
          if (newline > 262143) throw Error("overlong engine frame");
          const event = engineEventSchema.parse(
            JSON.parse(pending.subarray(0, newline).toString("utf8")),
          );
          pending = pending.subarray(newline + 1);
          if (terminal || event.seq <= seq)
            throw Error("out-of-order or post-terminal engine event");
          seq = event.seq;
          if (event.kind === "hello") {
            if (
              hello ||
              seq !== 0 ||
              event.identity !== null ||
              event.payload.engineCommit !== engineCommit ||
              event.payload.algorithmId !== "upstream-dcfr-gamma3-v1" ||
              JSON.stringify(event.payload.features) !==
                JSON.stringify(["bincode"]) ||
              event.payload.resume !== false
            )
              throw Error("engine handshake mismatch");
            hello = true;
            send("solve");
            if (cancelledEarly) send("cancel");
          } else {
            if (
              !hello ||
              JSON.stringify(event.identity) !== JSON.stringify(identity)
            )
              throw Error("engine identity mismatch");
            if (event.kind === "started") {
              if (started) throw Error("duplicate start");
              started = true;
            } else if (!started) throw Error("engine result before start");
            if (["completed", "cancelled", "failed"].includes(event.kind))
              terminal = event;
          }
          options.onEvent?.(event);
        }
        if (pending.length >= 262144) throw Error("unterminated engine frame");
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(cancellationTimer);
      const base = {
        identity,
        binaryHash,
        cancelLatencyMs: cancelRequestedAt
          ? performance.now() - cancelRequestedAt
          : undefined,
      };
      if (
        failure ||
        code !== 0 ||
        signal ||
        forced ||
        pending.length ||
        !terminal
      ) {
        resolveResult({
          ...base,
          status: forced ? "interrupted" : "failed",
          error: failure ?? `worker exited ${code}/${signal}: ${stderr}`,
        });
        return;
      }
      if (terminal.kind !== "completed") {
        resolveResult({
          ...base,
          status: terminal.kind === "cancelled" ? "cancelled" : "failed",
          error: String(
            terminal.payload.message ?? terminal.payload.code ?? "",
          ),
        });
        return;
      }
      try {
        if (
          terminal.payload.nativeFile !== "solution.bin" ||
          terminal.payload.summaryFile !== "summary.json"
        )
          throw Error("unexpected artifact name");
        const inspect = (name: string) => {
          const path = join(directory, name),
            stat = lstatSync(path);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size > 67_108_864 ||
            stat.size === 0
          )
            throw Error("invalid artifact size/type");
          const bytes = readFileSync(path);
          return { path, hash: digest(bytes), bytes: bytes.length };
        };
        const native = inspect("solution.bin"),
          summary = inspect("summary.json");
        const report = JSON.parse(readFileSync(summary.path, "utf8")) as {
          engineCommit?: string;
          identity?: unknown;
          nodes?: {
            path: number[];
            file: string;
            hash: string;
            bytes: number;
          }[];
        };
        if (
          report.engineCommit !== engineCommit ||
          JSON.stringify(engineIdentitySchema.parse(report.identity)) !==
            JSON.stringify(identity)
        )
          throw Error("artifact identity mismatch");
        const paths = [[], [0], [0, 0], [1], [1, 0], [1, 1]];
        if (!Array.isArray(report.nodes) || report.nodes.length !== 6)
          throw Error("node index incomplete");
        const nodes = report.nodes.map((node, index) => {
          if (
            node.file !== `node-${index}.json` ||
            JSON.stringify(node.path) !== JSON.stringify(paths[index])
          )
            throw Error("node index mismatch");
          const page = inspect(node.file);
          if (page.hash !== node.hash || page.bytes !== node.bytes)
            throw Error("node hash mismatch");
          return { ...page, history: node.path };
        });
        resolveResult({ ...base, status: "completed", native, summary, nodes });
      } catch (error) {
        resolveResult({ ...base, status: "failed", error: String(error) });
      }
    });
  });
  return { result, cancel, interrupt };
}
