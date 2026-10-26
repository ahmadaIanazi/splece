// Signs an isolated, previously tested app without rebuilding its source.
// Never use this against an installed app or the original unsigned candidate.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const bundle = path.resolve(process.argv[2] || "");
const output = path.resolve(process.argv[3] || "");
const identity = process.env.APPLE_SIGNING_IDENTITY;
if (process.platform !== "darwin" || !bundle.endsWith(".app") ||
    !output.endsWith(".dmg") || !identity || identity === "-")
  throw Error("Provide an isolated .app, a new .dmg output, and APPLE_SIGNING_IDENTITY.");
if (bundle.startsWith("/Applications/") || bundle.startsWith(path.join(process.env.HOME, "Applications/")))
  throw Error("Refusing to sign an installed app.");
try { await fs.access(output); throw Error("Output already exists; choose a new output path."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const identities = (await exec("security", ["find-identity", "-v", "-p", "codesigning"])).stdout;
if (!identities.split("\n").some(line => line.includes(identity) && line.includes("Developer ID Application:")))
  throw Error("A valid Developer ID Application identity is required.");
const files = [];
async function walk(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) files.push(file);
  }
}
await walk(bundle);
const hashes = new Map();
const native = [];
for (const file of files) {
  const bytes = await fs.readFile(file);
  hashes.set(file, createHash("sha256").update(bytes).digest("hex"));
  if (["cffaedfe", "cefaedfe", "feedfacf", "feedface", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(bytes.subarray(0,4).toString("hex")))
    native.push(file);
}
const node = path.join(bundle, "Contents/Resources/runtime/node");
if (!native.includes(node)) throw Error("Bundled Node runtime is missing.");
const entitlements = path.resolve("packaging/node-entitlements.plist");
for (const file of native.sort((a,b) => b.length - a.length)) {
  await exec("codesign", ["--force", "--sign", identity, "--timestamp", "--options", "runtime",
    ...(file === node ? ["--entitlements", entitlements] : []), file], { timeout: 120000 });
  console.log("Signed", path.relative(bundle, file));
}
await exec("codesign", ["--force", "--sign", identity, "--timestamp", "--options", "runtime", bundle], { timeout: 120000 });
await exec("codesign", ["--verify", "--deep", "--strict", bundle]);
for (const [file, hash] of hashes) {
  if (native.includes(file) || file.includes("/_CodeSignature/")) continue;
  if (createHash("sha256").update(await fs.readFile(file)).digest("hex") !== hash)
    throw Error(`Non-signature content changed: ${file}`);
}
await exec(node, ["--input-type=module", "-e", "console.log('Signed Node runtime OK', process.version)"], { timeout: 30000 });
const stage = await fs.mkdtemp(path.join(path.dirname(bundle), "dmg-stage-"));
try {
  await exec("ditto", [bundle, path.join(stage, "Splece.app")]);
  await fs.symlink("/Applications", path.join(stage, "Applications"));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await exec("hdiutil", ["create", "-volname", "Splece", "-srcfolder", stage, "-format", "UDZO", output], { timeout: 180000 });
  await exec("codesign", ["--force", "--sign", identity, "--timestamp", output], { timeout: 120000 });
  await exec("codesign", ["--verify", "--strict", output]);
} finally { await fs.rm(stage, { recursive: true, force: true }); }
console.log(`Signed ${output}. Notarization and installed-bundle testing are still required. Nothing published.`);
