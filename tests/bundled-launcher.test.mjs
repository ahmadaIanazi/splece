import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  launchPackaged,
  packagedDataDir,
  stopPackaged,
} from "../scripts/release/bundled-launcher.mjs";

const root = path.resolve(import.meta.dirname, "..");
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
test("packaged projects are outside the app installation", () => {
  assert.equal(packagedDataDir("linux", "/home/test", {}), "/home/test/.local/share/Splece");
  assert.equal(packagedDataDir("linux", "/home/test", {XDG_DATA_HOME:"/data"}), "/data/Splece");
  assert.equal(
    packagedDataDir("darwin", "/Users/test", {}),
    path.join("/Users/test", "Library", "Application Support", "Splece"),
  );
  assert.equal(
    packagedDataDir("win32", "/home", { LOCALAPPDATA: "/user/local" }),
    path.join("/user/local", "Splece"),
  );
});
test(
  "bundled launcher starts and reuses a prebuilt studio without rebuilding or changing the source installation",
  { timeout: 45000 },
  async (t) => {
    const data = await fs.mkdtemp(
      path.join(os.tmpdir(), "splece-package-test-"),
    );
    const port = await freePort();
    let pid;
    t.after(async () => {
      if (pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
        for (let i = 0; i < 50; i++) {
          try {
            process.kill(pid, 0);
            await delay(100);
          } catch {
            break;
          }
        }
      }
      await fs.rm(data, { recursive: true, force: true });
    });
    const first = await launchPackaged({ root, data, port });
    pid = first.pid;
    assert.equal(first.reused, false);
    assert.match(first.url, /\/#home$/);
    const second = await launchPackaged({ root, data, port });
    assert.equal(second.reused, true);
    assert.equal(second.pid, first.pid);
    assert.ok((await fs.stat(path.join(data, "studio.sqlite"))).isFile());
    assert.ok(
      (await fs.stat(path.join(data, "launcher", "server.log"))).isFile(),
    );
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "splece-foreign-"));
    t.after(() => fs.rm(other, { recursive: true, force: true }));
    await assert.rejects(
      launchPackaged({ root, data: other, port }),
      /different Splece workspace/,
    );
  },
);
test(
  "automatic launch avoids occupied ports, concurrent opens reuse one service, quit preserves projects",
  { timeout: 45000 },
  async (t) => {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-auto-test-"));
    const blocker = net.createServer((socket) => socket.destroy());
    const occupied = await new Promise((resolve) => {
      blocker.once("error", (error) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else throw error;
      });
      blocker.listen(4310, "127.0.0.1", () => resolve(true));
    });
    let pid;
    t.after(async () => {
      if (pid)
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      if (occupied) await new Promise((resolve) => blocker.close(resolve));
      await fs.rm(data, { recursive: true, force: true });
    });
    const results = await Promise.all([
      launchPackaged({ root, data }),
      launchPackaged({ root, data }),
    ]);
    pid = results[0].pid;
    assert.equal(results[0].pid, results[1].pid);
    assert.notEqual(new URL(results[0].url).port, "4310");
    const marker = path.join(data, "my-project-marker.txt");
    await fs.writeFile(marker, "keep my work");
    assert.equal((await stopPackaged({ root, data })).stopped, true);
    pid = null;
    assert.equal(await fs.readFile(marker, "utf8"), "keep my work");
    const reopened = await launchPackaged({ root, data });
    pid = reopened.pid;
    assert.equal(reopened.reused, false);
    assert.equal(await fs.readFile(marker, "utf8"), "keep my work");
    assert.equal((await stopPackaged({ root, data })).stopped, true);
    pid = null;
  },
);
