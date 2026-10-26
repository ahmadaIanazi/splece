// Check the Git index, not local ignored project data. Never print file contents.
import { execFileSync } from "node:child_process";
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const prohibited =
  /(^|\/)(node_modules|\.frame)(\/|$)|^(data|dist|release|artifacts|\.studio-launcher|secrets)(\/|$)|^public\/downloads\/|^design\/(logo-explorations|brand)\/|(^|\/)(?:.*-)?credentials\.json$|\.(?:sqlite(?:-.*)?|db(?:-.*)?|pem|key|p12|pfx|mobileprovision|log)$/i;
const failures = paths.filter(
  (p) =>
    prohibited.test(p) ||
    (/(^|\/)\.env(?:\.|$)/.test(p) && !/\.example$/.test(p)),
);
const entries = execFileSync("git", ["ls-files", "--stage", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
for (const entry of entries) {
  const [metadata, file] = entry.split("\t");
  const [mode, hash] = metadata.split(" ");
  if (mode === "120000")
    failures.push(`${file} (symbolic link requires review)`);
  else if (mode === "160000")
    failures.push(`${file} (submodule requires review)`);
  else if (
    Number(
      execFileSync("git", ["cat-file", "-s", hash], { encoding: "utf8" }),
    ) >
    10 * 1024 * 1024
  )
    failures.push(`${file} (larger than 10 MiB)`);
}
if (failures.length) {
  console.error(
    "Repository hygiene check failed:\n" + [...new Set(failures)].join("\n"),
  );
  process.exit(1);
}
console.log(
  `Repository hygiene passed: ${paths.length} tracked files; no prohibited paths or large blobs.`,
);
