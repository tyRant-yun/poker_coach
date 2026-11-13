import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  readFileSync,
  existsSync,
  unlinkSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import type {
  Artifact,
  Ref,
  RuntimeState,
} from "../src/modules/analysis/domain.ts";
import { contractVersion } from "../src/modules/analysis/domain.ts";

export function canonical(value: unknown): string {
  return JSON.stringify(normalize(value));
}
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}
export const hash = (v: unknown) =>
  createHash("sha256")
    .update(typeof v === "string" || Buffer.isBuffer(v) ? v : canonical(v))
    .digest("hex");
export const ref = (
  kind: string,
  value: unknown,
  id = `${kind}-${randomUUID()}`,
  version = 1,
): Ref => ({ id, version, kind, contentHash: hash(value) });
export function emptyState(workspaceId: string): RuntimeState {
  return {
    schemaVersion: 1,
    contractVersion,
    workspaceId,
    revision: 0,
    situations: {},
    ranges: {},
    policies: {},
    specs: {},
    jobs: {},
    solutions: {},
    experiments: {},
    attempts: {},
    artifacts: {},
    objects: {},
    exposures: [],
    imports: {},
    receipts: {},
    changes: [],
  };
}
export class DiskStore {
  directory: string;
  state: RuntimeState;
  private lock: string;
  private descriptor: number;
  private closed = false;
  constructor(directory: string, workspaceId = "local") {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true });
    mkdirSync(join(this.directory, "blobs"), { recursive: true });
    this.lock = join(this.directory, "writer.lock");
    if (existsSync(this.lock)) {
      const pid = Number(readFileSync(this.lock, "utf8"));
      let live = false;
      try {
        process.kill(pid, 0);
        live = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") live = true;
      }
      if (live) throw Error("此工作区已有运行中的写进程");
      unlinkSync(this.lock);
    }
    this.descriptor = openSync(this.lock, "wx");
    writeSync(this.descriptor, String(process.pid));
    fsyncSync(this.descriptor);
    try {
      this.state = emptyState(workspaceId);
      const journal = join(this.directory, "journal.jsonl");
      if (existsSync(journal)) {
        const raw = readFileSync(journal, "utf8"),
          lines = raw.split("\n");
        let valid = "";
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          try {
            const record = JSON.parse(line) as {
              checksum: string;
              state: RuntimeState;
            };
            if (
              record.checksum !== hash(record.state) ||
              record.state.workspaceId !== workspaceId ||
              record.state.contractVersion !== contractVersion
            )
              throw Error("journal validation");
            if (record.state.revision !== this.state.revision + 1)
              throw Error("journal sequence");
            this.state = record.state;
            valid += line + "\n";
          } catch {
            writeFileSync(
              join(this.directory, `damaged-${Date.now()}.jsonl`),
              raw,
            );
            if (i !== lines.length - 1)
              throw Error("已提交日志损坏，原件已封存；请恢复备份");
            writeFileSync(journal, valid);
          }
        }
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }
  commit(next: RuntimeState) {
    if (this.closed) throw Error("存储已关闭");
    next.revision = this.state.revision + 1;
    const line = JSON.stringify({ checksum: hash(next), state: next }) + "\n";
    const journal = join(this.directory, "journal.jsonl");
    appendFileSync(journal, line);
    const fd = openSync(journal, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.state = next;
  }
  putBytes(bytes: Buffer): { hash: string; bytes: number } {
    const digest = hash(bytes),
      target = join(this.directory, "blobs", digest);
    if (!existsSync(target)) {
      const fd = openSync(target, "wx");
      try {
        writeSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    return { hash: digest, bytes: bytes.length };
  }
  getBytes(digest: string): Buffer {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw Error("ARTIFACT_INCOMPLETE");
    try {
      const bytes = readFileSync(join(this.directory, "blobs", digest));
      if (hash(bytes) !== digest) throw Error("hash");
      return bytes;
    } catch {
      throw Error("ARTIFACT_INCOMPLETE");
    }
  }
  put(value: unknown) {
    return this.putBytes(Buffer.from(JSON.stringify(value)));
  }
  get<T>(digest: string): T {
    return JSON.parse(this.getBytes(digest).toString("utf8")) as T;
  }
  artifact(bytes: Buffer, mediaType = "application/json"): Artifact {
    const data = this.putBytes(bytes);
    const blocks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 65536)
      blocks.push(this.putBytes(bytes.subarray(offset, offset + 65536)).hash);
    const index = this.put({ blocks, bytes: bytes.length });
    return {
      ref: ref("artifact", { ...data, indexHash: index.hash }),
      ...data,
      mediaType,
      indexHash: index.hash,
    };
  }
  artifactPage(artifact: Artifact, page: number) {
    if (artifact.indexHash) {
      const index = this.get<{ blocks: string[]; bytes: number }>(
        artifact.indexHash,
      );
      if (index.bytes !== artifact.bytes || !index.blocks[page])
        throw Error("ARTIFACT_INCOMPLETE");
      return this.getBytes(index.blocks[page]);
    }
    return this.getBytes(artifact.hash).subarray(
      page * 65536,
      (page + 1) * 65536,
    );
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      closeSync(this.descriptor);
      unlinkSync(this.lock);
    }
  }
}
