import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { hash } from "../store.ts";
import {
  validateStrategyPack,
  evaluatePreflop,
  canonicalCombo,
  pathKey,
} from "../../src/modules/play/strategy.ts";
import type {
  StrategyPack,
  StrategySummary,
} from "../../src/modules/play/strategy.ts";
import type { ReviewInput } from "../../src/modules/play/review.ts";

export class StrategyService {
  private db: DatabaseSync;
  constructor(directory: string) {
    this.db = new DatabaseSync(join(directory, "strategies.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS packs(hash TEXT PRIMARY KEY, summary TEXT NOT NULL, document TEXT NOT NULL)",
    );
  }
  list(): StrategySummary[] {
    return (
      this.db
        .prepare("SELECT summary FROM packs ORDER BY rowid DESC LIMIT 100")
        .all() as { summary: string }[]
    ).map((r) => JSON.parse(r.summary));
  }
  private get(key: string) {
    const row = this.db
      .prepare("SELECT summary,document FROM packs WHERE hash=?")
      .get(key) as { summary: string; document: string } | undefined;
    if (!row) throw Error("策略包固定哈希不存在");
    const pack = JSON.parse(row.document) as StrategyPack;
    if (hash(pack) !== key) throw Error("策略包内容校验失败");
    return { pack, summary: JSON.parse(row.summary) as StrategySummary };
  }
  import(raw: unknown) {
    const pack = validateStrategyPack(raw),
      key = hash(pack);
    const existing = this.db
      .prepare("SELECT summary FROM packs WHERE hash=?")
      .get(key) as { summary: string } | undefined;
    if (existing) return JSON.parse(existing.summary) as StrategySummary;
    const summary: StrategySummary = {
      hash: key,
      id: pack.id,
      version: pack.version,
      name: pack.name,
      nodes: pack.nodes.length,
      status: "candidate",
      source: pack.source,
    };
    this.db
      .prepare("INSERT INTO packs VALUES(?,?,?)")
      .run(key, JSON.stringify(summary), JSON.stringify(pack));
    return summary;
  }
  accept(key: string, evidence: string) {
    const { pack, summary } = this.get(key);
    if (summary.status === "accepted") {
      if (summary.acceptance !== evidence)
        throw Error("固定版本的核验记录不可覆盖，请导入新版本");
      return summary;
    }
    if (pack.source.kind === "synthetic-test")
      throw Error("合成测试包不得接纳为产品评价来源");
    if (evidence.trim().length < 20)
      throw Error("需要填写实际核验依据、范围及限制（至少20字符）");
    summary.status = "accepted";
    summary.acceptance = evidence;
    this.db
      .prepare("UPDATE packs SET summary=? WHERE hash=?")
      .run(JSON.stringify(summary), key);
    return summary;
  }
  query(
    key: string,
    path: StrategyPack["nodes"][number]["path"],
    combo: string,
  ) {
    const { pack, summary } = this.get(key);
    const node = pack.nodes.find((n) => pathKey(n.path) === pathKey(path));
    if (!node) return { summary, availability: "off-tree" };
    const row = node.rows[canonicalCombo(combo)];
    return {
      summary,
      availability: row ? "available" : "unavailable",
      actions: node.actions,
      row,
      continuation: node.continuation,
    };
  }
  evaluate(input: ReviewInput) {
    for (const summary of this.list().filter((s) => s.status === "accepted")) {
      const result = evaluatePreflop(
        this.get(summary.hash).pack,
        summary.hash,
        input,
      );
      if (result) return result;
    }
  }
  close() {
    this.db.close();
  }
}
