// Scan exactly the staged snapshot before committing; never scan local user data.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const version = spawnSync("gitleaks", ["version"], { stdio: "ignore" });
if (version.error || version.status !== 0) {
  console.error(
    "Install Gitleaks before committing (macOS: brew install gitleaks). See docs/repository-workflow.md.",
  );
  process.exit(1);
}
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-staged-"));
let status = 1;
try {
  execFileSync(
    "git",
    ["checkout-index", "--all", `--prefix=${dir}${path.sep}`],
    { stdio: "inherit" },
  );
  const scan = spawnSync(
    "gitleaks",
    ["dir", dir, "--redact=100", "--no-banner", "--max-archive-depth=2"],
    { stdio: "inherit" },
  );
  status = scan.status ?? 1;
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
process.exitCode = status;
