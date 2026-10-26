import {bundleFFmpeg} from './bundle-ffmpeg.mjs';
// Run on each target OS/architecture with an official, supported Node runtime.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import {sparkleSDK, updateConfig} from './sparkle.mjs';
const exec = promisify(execFile);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json")));
const mac = process.platform === "darwin";
if (mac && !process.release.lts)
  throw Error(
    "Package with an official LTS Node runtime, not a development/current runtime.",
  );
if (process.platform === "linux") { await import("./package-linux.mjs"); process.exit(0); }
if (!mac && process.platform !== "win32")
  throw Error("Build on macOS or Windows.");
if (!mac && process.arch !== "x64")
  throw Error("The current Windows installer targets x64.");
const platform = `${mac ? "macos" : "windows"}-${process.arch}`;
const stage = path.join(root, "release", platform);
await fs.rm(stage, { recursive: true, force: true });
const bundle = path.join(stage, "Splece.app");
const base = mac ? path.join(bundle, "Contents", "Resources") : stage;
const studio = path.join(base, "studio");
await fs.mkdir(studio, { recursive: true });
for (const name of [
  "dist",
  "server",
  "shared",
  "package.json",
  "package-lock.json",
])
  await fs.cp(path.join(root, name), path.join(studio, name), {
    recursive: true,
  });
// Website download archives do not belong inside the desktop application.
await fs.rm(path.join(studio, "dist", "downloads"), {
  recursive: true,
  force: true,
});
await fs.mkdir(path.join(studio, "scripts", "release"), { recursive: true });
for (const name of [
  "scripts/studio-launcher.mjs",
  "scripts/release/bundled-launcher.mjs",
  "scripts/release/windows-updater.mjs",
])
  await fs.copyFile(path.join(root, name), path.join(studio, name));
// Fresh platform dependencies; never copy a developer's node_modules or data.
const npmCLI = process.env.npm_execpath;
if (!npmCLI) throw Error("Run this build with npm run release:package.");
await exec(
  process.execPath,
  [npmCLI, "ci", "--prefer-offline", "--omit=dev", "--no-audit", "--no-fund"],
  { cwd: studio, timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
);
await bundleFFmpeg(root,studio);
await fs.cp(path.join(root,"packaging/licenses"),path.join(studio,"third-party-platform"),{recursive:true});
for(const name of ['LICENSE','NOTICE','TRADEMARKS.md','ATTRIBUTION.md','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(root,name),path.join(studio,name));
await exec(process.execPath,[path.join(root,'scripts/release/license-inventory.mjs'),path.join(studio,'third-party')],{cwd:root,timeout:30000,maxBuffer:2e6});
// Frontend tooling is unnecessary in a prebuilt app and includes extra binaries.
for (const name of [
  "vite",
  "esbuild",
  "@esbuild",
  "rollup",
  "@rollup",
  "react",
  "react-dom",
  "lucide-react",
  ".bin",
])
  await fs.rm(path.join(studio, "node_modules", name), {
    recursive: true,
    force: true,
  });
const runtime = path.join(base, "runtime");
await fs.mkdir(runtime, { recursive: true });
await fs.copyFile(
  process.execPath,
  path.join(runtime, mac ? "node" : "node.exe"),
);
const nodeLicense = path.resolve(
  path.dirname(process.execPath),
  mac ? "../LICENSE" : "LICENSE",
);
await fs.copyFile(nodeLicense, path.join(runtime, "LICENSE"));
if (mac) {
  const contents = path.join(bundle, "Contents");
  const sdk = await sparkleSDK();
  await fs.copyFile(path.join(sdk,'LICENSE'),path.join(base,'Sparkle-LICENSE.txt'));
  const frameworks = path.join(contents, 'Frameworks');
  await fs.mkdir(frameworks, {recursive:true});
  await exec('ditto', [path.join(sdk, 'Sparkle.framework'), path.join(frameworks, 'Sparkle.framework')]);
  await fs.writeFile(path.join(studio,'desktop-update.json'), JSON.stringify({engine:'sparkle',channel:'beta'}));
  await fs.mkdir(path.join(contents, "MacOS"), { recursive: true });
  await exec(
    "swiftc",
    [
      "-O",
      "-target",
      `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx13.0`,
      "-framework",
      "AppKit",
      "-F", frameworks, "-framework", "Sparkle",
      "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
      path.join(root, "packaging/SpleceRelease.swift"),
      "-o",
      path.join(contents, "MacOS/Splece"),
    ],
    { timeout: 120000 },
  );
  const iconset = path.join(stage, "Splece.iconset");
  await exec("swift", [path.join(root, "macos/RenderIcon.swift"), iconset], {
    timeout: 120000,
  });
  await exec("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    path.join(base, "Splece.icns"),
  ]);
  await fs.rm(iconset, { recursive: true });
  await fs.writeFile(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Splece</string><key>CFBundleIdentifier</key><string>app.splece.studio</string><key>CFBundleExecutable</key><string>Splece</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${pkg.version}</string><key>CFBundleVersion</key><string>${pkg.version}</string><key>CFBundleIconFile</key><string>Splece</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>Splece</string><key>CFBundleURLSchemes</key><array><string>splece</string></array></dict></array></dict></plist>`,
  );
  const identity = process.env.APPLE_SIGNING_IDENTITY || "-";
  const plist = path.join(contents,'Info.plist');
  let plistText = await fs.readFile(plist,'utf8');
  const updatePlist = `<key>SUFeedURL</key><string>${updateConfig.feedURL}</string><key>SUPublicEDKey</key><string>${updateConfig.publicKey}</string><key>SUEnableAutomaticChecks</key><false/><key>SUAllowsAutomaticUpdates</key><false/><key>SUAutomaticallyUpdate</key><false/><key>SUEnableSystemProfiling</key><false/><key>SUVerifyUpdateBeforeExtraction</key><true/><key>SURequireSignedFeed</key><true/><key>SUSignedFeedFailureExpirationInterval</key><integer>0</integer>`;
  await fs.writeFile(plist,plistText.replace('</dict></plist>',updatePlist+'</dict></plist>'));
  const options =
    identity === "-" ? [] : ["--timestamp", "--options", "runtime"];
  await exec("codesign", [
    "--force",
    "--sign",
    identity,
    ...options,
    "--entitlements",
    path.join(root, "packaging/node-entitlements.plist"),
    path.join(runtime, "node"),
  ]);
  // Sign every nested Mach-O, including native addons introduced by app features.
  // Signing just Node and FFmpeg leaves native dependencies unnotarizable.
  async function signNative(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await signNative(file);
      else if (entry.isFile()) {
        const handle = await fs.open(file, "r");
        const magic = Buffer.alloc(4);
        try {
          await handle.read(magic, 0, 4, 0);
        } finally {
          await handle.close();
        }
        if (
          [
            "cffaedfe",
            "cefaedfe",
            "feedfacf",
            "feedface",
            "cafebabe",
            "bebafeca",
            "cafebabf",
          ].includes(magic.toString("hex"))
        ) {
          const libraries = (await exec("otool", ["-L", file])).stdout
            .split("\n")
            .slice(1);
          const ownIds = (await exec("otool", ["-D", file])).stdout
            .split("\n")
            .slice(1)
            .map((line) => line.trim());
          if (
            libraries.some(
              (line) =>
                !ownIds.includes(line.trim().split(" (compatibility")[0]) &&
                /^\s*\/(?!usr\/lib\/|System\/Library\/)/.test(line),
            )
          )
            throw Error(`Non-system dynamic library dependency in ${file}`);
          await exec("codesign", [
            "--force",
            "--sign",
            identity,
            ...options,
            file,
          ]);
        }
      }
    }
  }
  await signNative(path.join(studio, "node_modules"));
  await signNative(path.join(studio, "vendor"));
  // Sign nested Sparkle helpers inside-out; never use --deep for signing.
  const sparkle = path.join(frameworks,'Sparkle.framework/Versions/B');
  for (const relative of ['XPCServices/Downloader.xpc','XPCServices/Installer.xpc','Autoupdate','Updater.app','']) {
    await exec('codesign',['--force','--sign',identity,...options,path.join(sparkle,relative)]);
  }
  await exec("codesign", ["--force", "--sign", identity, ...options, bundle]);
  await exec("codesign", ["--verify", "--deep", "--strict", bundle]);
  await fs.symlink("/Applications", path.join(stage, "Applications"));
  const dmg = path.join(
    root,
    "release",
    `Splece-${pkg.version}-${platform}.dmg`,
  );
  await fs.rm(dmg, { force: true });
  const dmgTool=process.env.DMGBUILD_PATH || path.join(os.homedir(),'Library/Caches/SpleceRelease/dmgbuild-venv/bin/dmgbuild');
  await fs.access(dmgTool).catch(()=>{throw Error('Install the pinned dmgbuild tooling described in docs/mac-release-workflow.md, or set DMGBUILD_PATH.');});
  const background=path.join(stage,'installer-background.png');
  await exec(process.execPath,[path.join(root,'scripts/release/dmg-art.mjs'),background]);
  await exec(dmgTool,['-s',path.join(root,'packaging/dmg-settings.py'),'-D',`app=${bundle}`,'-D',`background=${background}`,'Splece',dmg],{timeout:180000,maxBuffer:2*1024*1024});
  if (identity !== "-")
    await exec("codesign", ["--force", "--sign", identity, "--timestamp", dmg]);
  console.log(
    `Built ${dmg}\n${identity === "-" ? "Development build only: sign and notarize before public distribution." : "Signed: notarize and staple before public distribution."}`,
  );
 } else {
  // SpleceDesktop is separate from %LOCALAPPDATA%/Splece (user data).
  await fs.writeFile(path.join(studio,'desktop-update.json'),JSON.stringify({engine:'velopack',channel:'beta',publicKey:updateConfig.publicKey}));
  await exec('dotnet',['publish',path.join(root,'packaging/windows/Splece.csproj'),'-c','Release','-r','win-x64','--self-contained','true','-o',stage,`-p:Version=${pkg.version}`],{timeout:300000,maxBuffer:4*1024*1024});
  await exec(process.env.VPK_PATH || 'vpk',['pack','--packId','SpleceDesktop','--packTitle','Splece','--packVersion',pkg.version,'--packDir',stage,'--mainExe','Splece.exe','--channel','win','--icon',path.join(root,'public/brand/Splece.ico'),'--outputDir',path.join(root,'release/windows-beta')],{timeout:300000,maxBuffer:4*1024*1024});
  console.log('Windows beta prepared in release/windows-beta. Unsigned: test before distribution.');
}
