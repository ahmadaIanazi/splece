import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { withLauncherLock } from "../studio-launcher.mjs";
import { sourceVersion } from "../../shared/source-version.mjs";

export function packagedDataDir(
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
) {
  if (platform === "linux") return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "Splece");
  return platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Splece")
    : path.join(
        env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
        "Splece",
      );
}
async function inspect(port) {
  const url = `http://127.0.0.1:${port}`;
  let response;
  try {
    response = await fetch(url + "/api/session", {
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    return null;
  }
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (
    !response.ok ||
    !(await response.json().catch(() => null))?.local ||
    !cookie
  )
    throw Error(
      "Another application is using Splece’s local address. Close it and try again.",
    );
  const status = await fetch(url + "/api/launcher/status", {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(2000),
  });
  const body = await status.json().catch(() => null);
  if (!status.ok || body?.service !== "frame-studio")
    throw Error("Another application is using Splece’s local address.");
  return { ...body, url, cookie };
}
async function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) =>
      error.code === "EADDRINUSE" ? resolve(false) : reject(error),
    );
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
async function readState(data) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(data, "launcher", "packaged.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}
async function remember(data, running) {
  const file = path.join(data, "launcher", "packaged.json");
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(
    temporary,
    JSON.stringify({
      port: Number(new URL(running.url).port),
      pid: running.pid,
    }),
    { mode: 0o600 },
  );
  await fs.rename(temporary, file);
}
async function stopRunning(running) {
  const response = await fetch(running.url + "/api/launcher/stop", {
    method: "POST",
    headers: { Cookie: running.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedPid: running.pid }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (!response.ok)
    throw Error(
      body.error ||
        "Splece is still working. Please try again when it finishes.",
    );
  for (let i = 0; i < 100; i++) {
    if (await portAvailable(Number(new URL(running.url).port))) return;
    await delay(100);
  }
  throw Error("Splece is still closing. Please try again shortly.");
}
export async function stopPackaged({ root, data = packagedDataDir() } = {}) {
  root = await fs.realpath(root);
  await fs.mkdir(data, { recursive: true });
  data = await fs.realpath(data);
  return withLauncherLock(path.join(data, "launcher"), async () => {
    const state = await readState(data);
    if (!Number.isInteger(state.port)) return { ok: true, stopped: false };
    const running = await inspect(state.port).catch(() => null);
    if (
      !running ||
      running.pid !== state.pid ||
      running.data !== data ||
      running.root !== root
    )
      return { ok: true, stopped: false };
    await stopRunning(running);
    await fs.rm(path.join(data, "launcher", "packaged.json"), { force: true });
    return { ok: true, stopped: true };
  });
}
export async function launchPackaged({
  root,
  data = packagedDataDir(),
  port,
  executable = process.execPath,
} = {}) {
  root = await fs.realpath(root);
  const automatic = port === undefined;
  port = automatic ? 4310 : Number(port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid studio port.");
  await fs.access(path.join(root, "dist/index.html"));
  await fs.mkdir(data, { recursive: true });
  data = await fs.realpath(data);
  return withLauncherLock(path.join(data, "launcher"), async () => {
    if (automatic) {
      const saved = await readState(data);
      const candidates = [
        ...new Set([
          saved.port,
          ...Array.from({ length: 40 }, (_, i) => 4310 + i),
        ]),
      ].filter((p) => Number.isInteger(p) && p >= 1024 && p <= 65535);
      let available;
      let existing;
      for (const candidate of candidates) {
        if (await portAvailable(candidate)) {
          available ??= candidate;
          continue;
        }
        const service = await inspect(candidate).catch(() => null);
        if (service?.data === data) {
          existing = candidate;
          break;
        }
      }
      port = existing ?? available;
      if (!port)
        throw Error(
          "Splece could not find an available local address. Close another app and try again.",
        );
    }
    let running = await inspect(port);
    if (running) {
      if (running.data !== data)
        throw Error(
          "A different Splece workspace is already running. Finish its jobs and close its service before opening this installation.",
        );
      if (running.root !== root)
        throw Error(
          "Another Splece installation is using your projects. Quit that installation before opening this one.",
        );
      if (running.version !== (await sourceVersion(root, "server"))) {
        await stopRunning(running);
        running = null;
      } else {
        await remember(data, running);
        return {
          ok: true,
          url: running.url + "/#home",
          pid: running.pid,
          reused: true,
        };
      }
    }
    if (!(await portAvailable(port)))
      throw Error(
        "Splece’s local address is busy. Please try opening Splece again.",
      );
    const log = openSync(path.join(data, "launcher", "server.log"), "a", 0o600);
    let child;
    try {
      child = spawn(executable, [path.join(root, "server/index.mjs")], {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          NODE_ENV: "production",
          PORT: String(port),
          STUDIO_DATA_DIR: data,
        },
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } finally {
      closeSync(log);
    }
    child.unref();
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null)
        throw Error(
          "Splece could not start. See server.log in your Splece data folder.",
        );
      const ready = await inspect(port).catch(() => null);
      if (ready?.pid === child.pid && ready.data === data) {
        await remember(data, ready);
        return {
          ok: true,
          url: ready.url + "/#home",
          pid: ready.pid,
          reused: false,
        };
      }
      await delay(200);
    }
    throw Error(
      "Splece is taking longer than expected to start. Try opening it again; your projects are safe.",
    );
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const action = process.argv[2] === "stop" ? stopPackaged : launchPackaged;
    const result = await action({
      root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    });
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
