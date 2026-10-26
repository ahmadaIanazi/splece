import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin")
  throw Error("The Dock launcher requires macOS.");
const applications = path.join(os.homedir(), "Applications");
await fs.mkdir(applications, { recursive: true });
const staging = await fs.mkdtemp(path.join(applications, ".splece-install-"));
const bundle = path.join(staging, "Splece.app");
const contents = path.join(bundle, "Contents");
const resources = path.join(contents, "Resources");
const target = path.join(applications, "Splece.app");
const backup = path.join(staging, "previous.app");
try {
  await fs.mkdir(path.join(contents, "MacOS"), { recursive: true });
  await fs.mkdir(resources, { recursive: true });
  const icons = path.join(staging, "Splece.iconset");
  console.log("Building the Splece icon and local Mac launcher…");
  await exec(
    "/usr/bin/swift",
    [path.join(root, "macos/RenderIcon.swift"), icons],
    { timeout: 120000 },
  );
  await exec("/usr/bin/iconutil", [
    "-c",
    "icns",
    icons,
    "-o",
    path.join(resources, "Splece.icns"),
  ]);
  await exec(
    "/usr/bin/swiftc",
    [
      "-swift-version",
      "5",
      "-O",
      "-framework",
      "AppKit",
      path.join(root, "macos/Splece.swift"),
      "-o",
      path.join(contents, "MacOS/Splece"),
    ],
    { timeout: 120000 },
  );
  await fs.writeFile(
    path.join(resources, "Configuration.json"),
    JSON.stringify(
      { codeRoot: root, node: process.execPath, port: 4310 },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Splece</string>
<key>CFBundleDisplayName</key><string>Splece</string>
<key>CFBundleIdentifier</key><string>local.splece.studio</string>
<key>CFBundleExecutable</key><string>Splece</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>Splece</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>`,
  );
  await exec("/usr/bin/plutil", ["-lint", path.join(contents, "Info.plist")]);
  await exec("/usr/bin/codesign", ["--force", "--sign", "-", bundle]);
  await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await fs.copyFile(
    path.join(icons, "icon_512x512@2x.png"),
    path.join(root, "artifacts/splece-icon.png"),
  );
  let previous = false;
  try {
    await fs.rename(target, backup);
    previous = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    await fs.rename(bundle, target);
  } catch (e) {
    if (previous) await fs.rename(backup, target);
    throw e;
  }
  console.log(
    `Installed: ${target}\nSource folder: ${root}\nOpen Splece from Finder, then keep it in your Dock. Code changes remain editable.`,
  );
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
