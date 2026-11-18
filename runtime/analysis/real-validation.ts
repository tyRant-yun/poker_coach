import { z } from "zod";
import { hash } from "../store.ts";
import { realStateSchema } from "../../src/modules/analysis/real-domain.ts";
import type { RuntimeState, Ref } from "../../src/modules/analysis/domain.ts";

export function validateRealState(s: RuntimeState) {
  if (!s.real) return;
  realStateSchema.parse(s.real);
  const fixed = <T extends { ref: Ref }>(
    record: Record<string, T>,
    reference: Ref,
  ) => {
    const value =
      record[`${reference.id}@${reference.version}`] ?? record[reference.id];
    if (!value || value.ref.contentHash !== reference.contentHash)
      throw Error("真实备份固定引用缺失");
    return value;
  };
  for (const group of [s.real.cases, s.real.specs, s.real.solutions])
    for (const [key, value] of Object.entries(group)) {
      const { ref: reference, ...payload } = value;
      if (
        (key !== reference.id &&
          key !== `${reference.id}@${reference.version}`) ||
        hash(payload) !== reference.contentHash
      )
        throw Error("真实备份身份或内容哈希错误");
    }
  for (const c of Object.values(s.real.cases)) {
    z.object({
      name: z.string(),
      board: z.array(z.string()).length(5),
      pot: z.number().int().positive(),
      stack: z.number().int().positive(),
      betPercent: z.string(),
      ranges: z.array(z.unknown()).length(2),
    }).parse(c);
    c.ranges.forEach((r) => fixed(s.ranges, r));
  }
  for (const spec of Object.values(s.real.specs)) {
    fixed(s.real.cases, spec.situation);
    spec.ranges.forEach((r) => fixed(s.ranges, r));
    const a = fixed(s.artifacts, spec.input);
    if (a.hash !== spec.inputHash) throw Error("真实规格输入摘要错误");
  }
  for (const j of Object.values(s.real.jobs)) {
    z.enum([
      "queued",
      "running",
      "postprocessing",
      "cancel_requested",
      "cancelled",
      "completed",
      "failed",
      "interrupted",
    ]).parse(j.status);
    fixed(s.real.specs, j.spec);
    if (j.result) fixed(s.real.solutions, j.result);
    if (j.status === "completed" && !j.result)
      throw Error("完成作业缺少真实解");
  }
  for (const solution of Object.values(s.real.solutions)) {
    fixed(s.real.specs, solution.spec);
    if (
      solution.dataKind !== "engine-computed" ||
      solution.nodes.length !== 6 ||
      solution.engineCommit !== "9d1509fe5077d019825f833eed04b16d342dfda1"
    )
      throw Error("真实解能力或版本不匹配");
    for (const r of [
      solution.native,
      solution.summary,
      ...solution.nodes.map((n) => n.artifact),
    ])
      fixed(s.artifacts, r);
  }
}
