import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  engineCommandSchema,
  engineEventSchema,
  riverInputSchema,
} from "../../contracts/solver/engine.ts";

test("versioned JSON schemas match TS and the golden Rust command", () => {
  for (const [name, schema] of Object.entries({
    command: engineCommandSchema,
    event: engineEventSchema,
    river: riverInputSchema,
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
