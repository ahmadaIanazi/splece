import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { sourceVersion } from "../shared/source-version.mjs";
const exec = promisify(execFile);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

async function json(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" || e instanceof SyntaxError) return fallback;
    throw e;
  }
}
async function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
export async function withLauncherLock(folder, fn) {
  await fs.mkdir(folder, { recursive: true });
  const lock = path.join(folder, "launch.lock");
  let acquired = false;
  for (let i = 0; i < 600; i++) {
    try {
      const handle = await fs.open(lock, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      acquired = true;
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const owner = await json(lock);
      const age = await fs
        .stat(lock)
        .then((s) => Date.now() - s.mtimeMs)
        .catch(() => 0);
      if ((owner.pid && !alive(owner.pid)) || (!owner.pid && age > 5000))
        await fs.unlink(lock).catch(() => {});
      await delay(200);
    }
  }
  if (!acquired)
    throw Error(
      "Another studio launch is still working. Please try again shortly.",
    );
  try {
    return await fn();
  } finally {
    await fs.unlink(lock).catch(() => {});
  }
}

export async function buildInterface(root, { build } = {}) {
  const folder = path.join(root, ".studio-launcher"),
    file = path.join(folder, "build.json");
  await fs.mkdir(folder, { recursive: true });
  const version = await sourceVersion(root);
  const stamp = await json(file);
  if (
    stamp.version === version &&
    (await fs.access(path.join(root, "dist/index.html")).then(
      () => true,
      () => false,
    ))
  )
    return false;
  const staging = await fs.mkdtemp(path.join(folder, "build-"));
  try {
    if (build) await build(staging);
    else {
      await exec(process.execPath, [path.join(root,"scripts/prepare-vision.mjs")], {cwd:root});
      const vite = path.join(root, "node_modules/vite/bin/vite.js");
      if (
        !(await fs.access(vite).then(
          () => true,
          () => false,
        ))
      )
        throw Error(
          "This code folder needs its dependencies installed. Run npm install in the project folder, then open the app again.",
        );
      try {
        const result = await exec(
          process.execPath,
          [vite, "build", "--outDir", staging, "--emptyOutDir"],
          { cwd: root, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
        );
        await fs.writeFile(
          path.join(folder, "build.log"),
          result.stdout + result.stderr,
        );
      } catch (e) {
        await fs.writeFile(
          path.join(folder, "build.log"),
          (e.stdout || "") + (e.stderr || e.message),
        );
        throw Error(
          "The latest interface could not be built. Your existing build and projects are safe. Check build.log in the launcher logs folder.",
        );
      }
    }
    const html = await fs.readFile(path.join(staging, "index.html"));
    const dist = path.join(root, "dist");
    await fs.mkdir(dist, { recursive: true });
    // Publish the index last, and retain previous hashed assets for open browser tabs.
    for (const item of await fs.readdir(staging))
      if (item !== "index.html")
        await fs.cp(path.join(staging, item), path.join(dist, item), {
          recursive: true,
        });
    const temporary = path.join(dist, `index.${process.pid}.tmp`);
    await fs.writeFile(temporary, html);
    await fs.rename(temporary, path.join(dist, "index.html"));
    await writeJson(file, { version, builtAt: Date.now() });
    return true;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function listener(port) {
  try {
    const { stdout } = await exec("/usr/sbin/lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    return [...new Set(stdout.trim().split(/\s+/).map(Number).filter(Boolean))];
  } catch (e) {
    if (e.code === 1) return [];
    throw e;
  }
}
export async function inspectStudio(root, port) {
  const url = `http://127.0.0.1:${port}`;
  const pids = await listener(port);
  if (!pids.length) return null;
  if (pids.length !== 1)
    throw Error(
      `Port ${port} is occupied by another service. No process was stopped.`,
    );
  const pid = pids[0];
  const [{ stdout: cwd }, { stdout: name }] = await Promise.all([
    exec("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
    exec("/bin/ps", ["-p", String(pid), "-o", "comm="]),
  ]);
  const processFolder = cwd
    .split("\n")
    .find((l) => l.startsWith("n"))
    ?.slice(1);
  if (processFolder !== root || path.basename(name.trim()) !== "node")
    throw Error(
      `Port ${port} belongs to another application or code folder. It was left untouched.`,
    );
  const response = await fetch(url + "/api/session", {
    signal: AbortSignal.timeout(3000),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!response.ok || !(await response.json()).local || !cookie)
    throw Error("The process on the studio port is not a ready Splece server.");
  const statusResponse = await fetch(url + "/api/launcher/status", {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(3000),
  });
  const status = await statusResponse.json().catch(() => null);
  if (!status || status.service !== "frame-studio")
    return { pid, legacy: true, cookie, url };
  if (status.root !== root || status.pid !== pid)
    throw Error(
      "The running server does not match this code folder. It was left untouched.",
    );
  return { ...status, cookie, url };
}
async function stopStudio(status) {
  if (status.legacy)
    throw Error(
      "This older server was started outside the launcher. Let its jobs finish, then stop it from its original terminal once. Future launches and updates are handled by this app.",
    );
  const response = await fetch(status.url + "/api/launcher/stop", {
    method: "POST",
    headers: { Cookie: status.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedPid: status.pid }),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || "The server could not restart safely.");
  for (let i = 0; i < 100; i++) {
    // Releasing the HTTP port can precede process exit. The worker's database
    // lock still belongs to that PID until it exits, so wait for both.
    if (
      !(await listener(new URL(status.url).port)).length &&
      !alive(status.pid)
    )
      return;
    await delay(100);
  }
  throw Error(
    "The server is still closing. Open the studio again in a moment.",
  );
}
export async function launchStudio({
  root,
  port = 4310,
  command = "open",
  dataDir,
  build,
} = {}) {
  root = await fs.realpath(root);
  port = Number(port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid local studio port.");
  if (!["open", "restart", "status"].includes(command))
    throw Error("Unknown launcher action.");
  const pkg = await json(path.join(root, "package.json"));
  if (pkg.name !== "local-video-studio")
    throw Error(
      "Choose the Splece code folder containing package.json and server/index.mjs.",
    );
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13))
    throw Error("Splece needs Node 22.13 or newer.");
  const folder = path.join(root, ".studio-launcher", String(port));
  return withLauncherLock(folder, async () => {
    let running = await inspectStudio(root, port);
    const serverDataDir = dataDir || running?.data || path.join(root, "data");
    if (command === "status")
      return {
        ok: true,
        running: !!running,
        pid: running?.pid,
        activeJobs: running?.activeJobs,
        legacy: running?.legacy,
      };
    const built = await buildInterface(root, { build });
    const version = await sourceVersion(root, "server");
    let updatePending =
      !!running && (running.legacy || running.version !== version);
    if (
      running &&
      (command === "restart" ||
        (updatePending &&
          !running.legacy &&
          !running.activeJobs &&
          !running.activeWrites))
    ) {
      try {
        await stopStudio(running);
        running = null;
      } catch (e) {
        if (command === "restart") throw e;
        updatePending = true;
      }
    }
    if (running)
      return {
        ok: true,
        url: running.url,
        reused: true,
        built,
        pid: running.pid,
        updatePending,
        legacy: !!running.legacy,
      };
    const logPath = path.join(folder, "server.log");
    const log = openSync(logPath, "a", 0o600);
    const child = spawn(
      process.execPath,
      [path.join(root, "server/index.mjs")],
      {
        cwd: root,
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          NODE_ENV: "production",
          PORT: String(port),
          STUDIO_DATA_DIR: serverDataDir,
          PATH: `${path.dirname(process.execPath)}:${process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin"}`,
        },
      },
    );
    closeSync(log);
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    await writeJson(path.join(folder, "server.json"), {
      pid: child.pid,
      version,
      node: process.execPath,
      startedAt: Date.now(),
      logPath,
    });
    for (let i = 0; i < 200; i++) {
      if (!alive(child.pid))
        throw Error(
          `The server could not start. Open server.log in the launcher logs folder.`,
        );
      try {
        const ready = await inspectStudio(root, port);
        if (ready && ready.pid === child.pid && !ready.legacy)
          return {
            ok: true,
            url: ready.url,
            reused: false,
            built,
            pid: child.pid,
            updatePending: false,
          };
      } catch {
        /* The listener can appear before its routes are ready. */
      }
      await delay(150);
    }
    throw Error(
      "The studio is taking longer than expected to start. Check the launcher logs, then try opening it again.",
    );
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await launchStudio({
      root:
        process.argv[3] ||
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      command: process.argv[2] || "open",
      port: process.env.PORT || 4310,
      dataDir: process.env.STUDIO_DATA_DIR,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: e.message }) + "\n",
    );
    process.exitCode = 1;
  }
}
