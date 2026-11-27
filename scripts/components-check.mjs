import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const lock = JSON.parse(
  readFileSync(new URL("../components.lock.json", import.meta.url), "utf8"),
);
const fingerprint = (bytes) => createHash("sha256").update(bytes).digest("hex");
let checked = 0;
for (const [name, component] of Object.entries(lock.components)) {
  const sourceArgument = process.argv.find((a) => a.startsWith(`--${name}=`));
  const sourceRoot = sourceArgument
    ? resolve(sourceArgument.slice(name.length + 3))
    : undefined;
  if (sourceRoot) {
    const actual = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceRoot,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    if (actual !== component.commit)
      throw Error(`${name}: checkout differs from fixed component commit`);
  }
  for (const entry of component.files) {
    const destination = resolve(root, entry.productPath);
    const delta = relative(root, destination);
    if (isAbsolute(delta) || delta.startsWith(".."))
      throw Error("Component path escapes product");
    if (fingerprint(readFileSync(destination)) !== entry.sha256)
      throw Error(`${name}: product snapshot drift: ${entry.productPath}`);
    if (sourceRoot) {
      const source = resolve(sourceRoot, entry.sourcePath),
        sourceDelta = relative(sourceRoot, source);
      if (isAbsolute(sourceDelta) || sourceDelta.startsWith(".."))
        throw Error("Component path escapes source");
      if (fingerprint(readFileSync(source)) !== entry.sha256)
        throw Error(`${name}: fixed source differs: ${entry.sourcePath}`);
    }
    ++checked;
  }
}
console.log(
  `Verified ${checked} pinned component files${process.argv.length > 2 ? " against fixed local source repositories" : " in product snapshots"}`,
);
