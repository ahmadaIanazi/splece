// Uses an existing Keychain profile. Never accepts passwords on the command line.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const dmg = path.resolve(process.argv[2] || "");
const profile = process.env.APPLE_NOTARY_PROFILE;
if (process.platform !== "darwin" || !dmg.endsWith(".dmg") || !profile)
  throw Error(
    "Provide a Mac DMG and set APPLE_NOTARY_PROFILE to an existing notarytool Keychain profile.",
  );
const signature = await exec("codesign", ["--display", "--verbose=4", dmg]);
if (!signature.stderr.includes("Authority=Developer ID Application:"))
  throw Error(
    "The DMG must be signed with Developer ID Application before notarization.",
  );
await exec("codesign", ["--verify", "--strict", dmg]);
const receipt = dmg + ".notarization.json";
let submission;
try { submission = JSON.parse(await fs.readFile(receipt, "utf8")); }
catch (e) { if (e.code !== "ENOENT") throw e; }
const uploadSha256 = createHash("sha256").update(await fs.readFile(dmg)).digest("hex");
if (submission && submission.status !== "Accepted" && submission.uploadSha256 !== uploadSha256)
  throw Error("The installer changed since submission. Build a fresh release instead of reusing its receipt.");
if (!submission) {
  console.log("Submitting the signed beta to Apple for notarization…");
  const result = await exec("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", profile, "--output-format", "json"], {timeout: 1800000});
  submission = {...JSON.parse(result.stdout), uploadSha256};
  await fs.writeFile(receipt, JSON.stringify(submission, null, 2));
}
if (submission.status !== "Accepted") {
  console.log(`Waiting for Apple submission ${submission.id}. Rerunning this command resumes the same submission.`);
  const result = await exec("xcrun", ["notarytool", "wait", submission.id, "--keychain-profile", profile, "--timeout", "30m", "--output-format", "json"], {timeout: 1810000});
  submission = {...submission, ...JSON.parse(result.stdout)};
  await fs.writeFile(receipt, JSON.stringify(submission, null, 2));
}
if (submission.status !== "Accepted")
  throw Error(
    `Apple did not accept the beta: ${submission.status}. See the saved submission ID.`,
  );
await exec("xcrun", ["stapler", "staple", dmg]);
await exec("xcrun", ["stapler", "validate", dmg]);
await exec("spctl", [
  "--assess",
  "--type",
  "open",
  "--context",
  "context:primary-signature",
  "--verbose=2",
  dmg,
]);
await fs.writeFile(
  dmg + ".sha256",
  createHash("sha256")
    .update(await fs.readFile(dmg))
    .digest("hex") +
    "  " +
    path.basename(dmg) +
    "\n",
);
console.log(
  "Apple accepted the DMG; ticket stapled and verified. Test the downloaded installer on a clean Mac before enabling downloads.",
);
