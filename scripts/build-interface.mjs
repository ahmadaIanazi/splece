import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { buildInterface, withLauncherLock } from "./studio-launcher.mjs";

// Use the launcher's staged publication for command-line builds too. Vite's
// default clean of dist removes lazy chunks still referenced by open tabs.
export function buildStudioInterface(
  root,
  build = (outDir) => viteBuild({ root, build: { outDir, emptyOutDir: true } }),
) {
  return withLauncherLock(path.join(root, ".studio-launcher"), () =>
    buildInterface(root, { build }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildStudioInterface(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
}
