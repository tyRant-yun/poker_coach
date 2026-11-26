import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  turnInputSchema,
  turnNodeSchema,
  turnPathSchema,
} from "../../contracts/solver/turn.ts";
import {
  explicitRiverSchema,
  nativeQuerySchema,
  nativePageSchema,
} from "../../contracts/solver/river-tree.ts";
import {
  realContract,
  realSchemas,
} from "../../src/modules/analysis/real-domain.ts";
import {
  engineCommandSchema,
  engineEventSchema,
  riverInputSchema,
} from "../../contracts/solver/engine.ts";

test("versioned JSON schemas match TS and the golden Rust command", () => {
  assert.deepEqual(
    {
      contractVersion: realContract,
      tools: Object.fromEntries(
        Object.entries(realSchemas).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema),
        ]),
      ),
    },
    JSON.parse(readFileSync("contracts/solver/business.schema.json", "utf8")),
  );
  for (const [name, schema] of Object.entries({
    command: engineCommandSchema,
    event: engineEventSchema,
    river: riverInputSchema,
    "river-tree": explicitRiverSchema,
    "native-query": nativeQuerySchema,
    "native-page": nativePageSchema,
    turn: turnInputSchema,
    "turn-node": turnNodeSchema,
    "turn-path": turnPathSchema,
  })) {
    assert.deepEqual(
      z.toJSONSchema(schema),
      JSON.parse(readFileSync(`contracts/solver/${name}.schema.json`, "utf8")),
    );
  }
  const golden: unknown = JSON.parse(
    readFileSync("contracts/solver/examples/solve.json", "utf8"),
  );
  assert.ok(engineCommandSchema.safeParse(golden).success);
  assert.equal(
    engineCommandSchema.safeParse({ ...(golden as object), extra: true })
      .success,
    false,
  );
});
