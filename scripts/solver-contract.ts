import { writeFileSync } from "node:fs";
import { z } from "zod";
import {
  realContract,
  realSchemas,
} from "../src/modules/analysis/real-domain.ts";
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
writeFileSync(
  new URL("../contracts/solver/business.schema.json", import.meta.url),
  `${JSON.stringify({ contractVersion: realContract, tools: Object.fromEntries(Object.entries(realSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)])) }, null, 2)}\n`,
);
