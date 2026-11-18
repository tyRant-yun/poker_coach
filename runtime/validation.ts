import { z } from "zod";
import { contractVersion, refSchema } from "../src/modules/analysis/domain.ts";
import type { RuntimeState } from "../src/modules/analysis/domain.ts";
import { realStateSchema } from "../src/modules/analysis/real-domain.ts";
import { validateRealState } from "./analysis/real-validation.ts";
const record = z.record(z.string(), z.unknown()),
  weights = z.record(z.string(), z.number().min(0).max(10000));
const stateShape = z
  .object({
    schemaVersion: z.literal(1),
    contractVersion: z.literal(contractVersion),
    workspaceId: z.string(),
    revision: z.number().int().nonnegative(),
    situations: record,
    ranges: record,
    policies: record,
    specs: record,
    jobs: record,
    solutions: record,
    experiments: record,
    attempts: record,
    artifacts: record,
    objects: record,
    real: realStateSchema.optional(),
    legacy: z.unknown().optional(),
    exposures: z.array(z.string()),
    imports: record,
    receipts: record,
    changes: z.array(
      z.object({
        sequence: z.number().int(),
        tool: z.string(),
        refs: z.array(refSchema),
      }),
    ),
    independent: z
      .object({ question: z.string(), keys: z.array(z.string()) })
      .optional(),
  })
  .strict();
const refRecord = z.object({ ref: refSchema }).passthrough();
export function validateBackupState(value: unknown): RuntimeState {
  const parsed = stateShape.parse(value),
    state = value as RuntimeState;
  for (const group of [
    "situations",
    "ranges",
    "policies",
    "specs",
    "jobs",
    "solutions",
    "experiments",
    "attempts",
    "artifacts",
  ] as const)
    for (const [key, item] of Object.entries(parsed[group])) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw Error("导入对象标识不允许");
      const data = refRecord.parse(item);
      if (key !== data.ref.id && key !== `${data.ref.id}@${data.ref.version}`)
        throw Error("导入对象身份不匹配");
    }
  for (const r of Object.values(state.ranges)) {
    weights.parse(r.weights);
    z.array(weights).parse(r.history);
    z.array(weights).parse(r.future);
    z.array(z.string()).parse(r.protected);
  }
  for (const s of Object.values(state.situations)) {
    z.object({
      stack: z.number().int().positive(),
      rake: z.number().min(0).max(1).nullable(),
      format: z.enum(["HU", "6-max", "unknown"]),
      board: z.array(z.string()),
      ranges: z.record(z.string(), refSchema),
      players: z.array(
        z.object({
          id: z.string(),
          initial: z.number().nonnegative(),
          remaining: z.number().nonnegative(),
          contribution: z.number().nonnegative(),
          status: z.enum(["active", "folded"]),
        }),
      ),
    }).parse(s);
    for (const r of Object.values(s.ranges))
      if (!state.ranges[r.id] && !state.ranges[`${r.id}@${r.version}`])
        throw Error("导入缺少范围版本");
  }
  for (const p of Object.values(state.policies)) {
    z.record(z.string(), weights).parse(p.allocations);
    if (!state.situations[p.situation.id] || !state.ranges[p.range.id])
      throw Error("导入策略依赖缺失");
  }
  for (const s of Object.values(state.specs)) {
    z.object({
      fingerprint: z.string(),
      engineVersion: z.string(),
      algorithmVersion: z.string(),
      operation: z.enum([
        "load-reference",
        "solve-equilibrium",
        "evaluate-policy",
        "resolve-with-lock",
      ]),
      analysisScope: z.enum(["subgame", "local-node"]),
      valueModel: z.literal("synthetic"),
      ranges: z.record(z.string(), z.object({ ref: refSchema, weights })),
      situation: z.object({
        ref: refSchema,
        preset: z.string(),
        players: z.array(z.unknown()),
      }),
    }).parse(s);
    if (!state.situations[s.situation.ref.id]) throw Error("导入规格局面缺失");
  }
  for (const j of Object.values(state.jobs)) {
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
    if (!state.specs[j.spec.id] || (j.result && !state.solutions[j.result.id]))
      throw Error("导入作业依赖缺失");
  }
  for (const m of Object.values(state.solutions)) {
    z.object({
      dataKind: z.literal("synthetic"),
      nodes: z.array(
        z.object({
          id: z.string(),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          bytes: z.number().int().positive(),
        }),
      ),
      availability: z.enum(["available", "uncovered", "unsupported"]),
      quality: z.enum(["demo-target-met", "demo-incomplete", "not-evaluated"]),
      metricDefinition: z.object({
        unit: z.string(),
        origin: z.string(),
        invested: z.string(),
        rake: z.string(),
        model: z.string(),
      }),
    }).parse(m);
    if (!state.specs[m.spec.id]) throw Error("导入解的规格缺失");
  }
  for (const e of Object.values(state.experiments))
    if (
      !state.solutions[e.baseline.id] ||
      (e.variant && !state.solutions[e.variant.id]) ||
      (e.comparison && !state.objects[e.comparison.id]) ||
      (e.conclusion && !state.objects[e.conclusion.id])
    )
      throw Error("导入实验依赖缺失");
  for (const a of Object.values(state.artifacts))
    z.object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().nonnegative(),
      mediaType: z.string(),
    }).parse(a);
  validateRealState(state);
  return state;
}
