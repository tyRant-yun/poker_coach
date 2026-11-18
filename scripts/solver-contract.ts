import { writeFileSync } from "node:fs";
import { z } from "zod";
import {
  engineCommandSchema,
  engineEventSchema,
  riverInputSchema,
} from "../contracts/solver/engine.ts";

for (const [name, schema] of Object.entries({
  command: engineCommandSchema,
  event: engineEventSchema,
  river: riverInputSchema,
})) {
  writeFileSync(
    new URL(`../contracts/solver/${name}.schema.json`, import.meta.url),
    `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`,
  );
}
