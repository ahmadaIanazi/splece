// Developer build command. End users only receive the self-contained DMG.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {updateConfig} from "./sparkle.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
if (process.platform !== "darwin" || !process.release.lts)
  throw Error("Build on a Mac using an official Node LTS installation.");
const npm = path.resolve(
  path.dirname(process.execPath),
  "../lib/node_modules/npm/bin/npm-cli.js",
);
await fs.access(npm);
const label = new Date().toISOString().replace(/[:.]/g, "-");
const work = path.join(root, "release", `beta-${label}-${process.arch}`);
const snapshot = path.join(work, "source");
await fs.mkdir(snapshot, { recursive: true });
const inputs = [
  "LICENSE", "NOTICE", "TRADEMARKS.md", "ATTRIBUTION.md", "THIRD_PARTY_NOTICES.md",
  "src",
  "server",
  "shared",
  "scripts",
  "packaging",
  "macos",
  "tests",
  "index.html",
  "package.json",
  "package-lock.json",
  "docs/models/source-recipes",
];
for (const name of ["vite.config.js", "vite.config.mjs"])
  if (await fs.stat(path.join(root, name)).catch(() => null)) inputs.push(name);
const publicInputs = [
  "brand",
  "marketing",
  "templates",
  "vision",
  "fonts",
  "splece.svg",
  "audio.svg",
];
for (const name of publicInputs)
  if (await fs.stat(path.join(root, "public", name)).catch(() => null))
    inputs.push("public/" + name);
async function fingerprint(base) {
  const hash = createHash("sha256");
  async function walk(relative) {
    const absolute = path.join(base, relative),
      stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink())
      throw Error(`Unexpected symlink in release inputs: ${relative}`);
    if (stat.isDirectory())
      for (const name of (await fs.readdir(absolute)).sort())
        await walk(path.join(relative, name));
    else hash.update(relative).update(await fs.readFile(absolute));
  }
  for (const name of inputs) await walk(name);
  return hash.digest("hex");
}
const before = await fingerprint(root);
for (const name of inputs)
  await fs.cp(path.join(root, name), path.join(snapshot, name), {
    recursive: true,
  });
if (
  before !== (await fingerprint(root)) ||
  before !== (await fingerprint(snapshot))
)
  throw Error(
    "Source changed during the snapshot. Retry when the current edit finishes.",
  );
await fs.writeFile(
  path.join(snapshot, "public/downloads.json"),
  JSON.stringify({ version: "0.1.0", mac: null, windows: null, source: null }),
);
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: snapshot,
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: path.dirname(process.execPath) + ":/usr/bin:/bin:/usr/sbin:/sbin",
      },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`Build step failed (${code}): ${args.join(" ")}`)),
    );
  });
}
console.log(`Building isolated beta snapshot: ${work}`);
await run([npm, "ci", "--prefer-offline", "--no-audit", "--no-fund"]);
await run([npm, "run", "build"]);
await run([npm, "test"]);
await run([npm, "run", "release:package"]);
const pkg = JSON.parse(await fs.readFile(path.join(snapshot, "package.json")));
const filename = `Splece-${pkg.version}-macos-${process.arch}.dmg`;
const architecture = process.arch === "arm64" ? "Apple-Silicon" : "Intel";
const signed = Boolean(process.env.APPLE_SIGNING_IDENTITY && process.env.APPLE_SIGNING_IDENTITY !== "-");
const candidateName = `Splece-${pkg.version}-beta-${signed ? "signed" : "unsigned"}-${architecture}.dmg`;
const result = path.join(work, candidateName);
await fs.copyFile(path.join(snapshot, "release", filename), result);
await fs.writeFile(
  path.join(work, "build.json"),
  JSON.stringify(
    {
      version: pkg.version,
      channel: "beta",
      updater: {engine:"sparkle",publicKey:updateConfig.publicKey,feedURL:updateConfig.feedURL},
      arch: process.arch,
      node: process.version,
      builtAt: new Date().toISOString(),
      sourceSha256: before,
    dmg: candidateName,
      sha256: createHash("sha256")
        .update(await fs.readFile(result))
        .digest("hex"),
      signed: Boolean(
        process.env.APPLE_SIGNING_IDENTITY &&
        process.env.APPLE_SIGNING_IDENTITY !== "-",
      ),
      notarized: false,
      publishable: false,
    },
    null,
    2,
  ),
);
console.log(
  `Beta candidate: ${result}\nNot published. Package smoke tests, Developer ID signing, notarization and Gatekeeper checks are required before sharing.`,
);

if (process.env.SPLECE_BETA_RESULT_FILE) await fs.writeFile(process.env.SPLECE_BETA_RESULT_FILE, JSON.stringify({work, snapshot, dmg: result}));
