import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { sourceVersion } from "../shared/source-version.mjs";
import {
  buildInterface,
  withLauncherLock,
  launchStudio,
  inspectStudio,
} from "../scripts/studio-launcher.mjs";
import { installLauncherControl } from "../server/launcher.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "studio-launcher-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const folder of ["src", "server", "shared", "data", "dist"])
    await fs.mkdir(path.join(root, folder));
  await fs.writeFile(path.join(root, "src/app.jsx"), "interface-v1");
  return root;
}

test("launcher fingerprints editable code separately from projects and builds", async (t) => {
  const root = await fixture(t);
  const ui = await sourceVersion(root),
    server = await sourceVersion(root, "server");
  await fs.writeFile(path.join(root, "data/project.json"), "saved project");
  await fs.writeFile(path.join(root, "dist/index.html"), "built interface");
  assert.equal(await sourceVersion(root), ui);
  await fs.writeFile(path.join(root, "src/app.jsx"), "interface-v2");
  assert.notEqual(await sourceVersion(root), ui);
  assert.equal(await sourceVersion(root, "server"), server);
  await fs.writeFile(path.join(root, "shared/domain.mjs"), "new schema");
  assert.notEqual(await sourceVersion(root, "server"), server);
});

test(
  "Mac launcher starts, reuses and updates a detached server while preserving custom data and active jobs",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "splece-detached-test-")),
    );
    for (const folder of ["src", "server", "shared", "dist"])
      await fs.mkdir(path.join(root, folder));
    await fs.writeFile(path.join(root, "src/app.jsx"), "test interface");
    const data = await fs.mkdtemp(
      path.join(os.tmpdir(), "splece-custom-data-"),
    );
    const reservation = net.createServer().listen(0, "127.0.0.1");
    await new Promise((resolve) => reservation.once("listening", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const repo = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "local-video-studio", type: "module" }),
    );
    await fs.writeFile(
      path.join(root, "server/index.mjs"),
      `
    import express from ${JSON.stringify(pathToFileURL(path.join(repo, "node_modules/express/index.js")).href)};
    import { DatabaseSync } from 'node:sqlite';
    import { installLauncherControl } from ${JSON.stringify(pathToFileURL(path.join(repo, "server/launcher.mjs")).href)};
    const root = process.cwd(), data = process.env.STUDIO_DATA_DIR;
    const db = new DatabaseSync(data + '/test.sqlite');
    db.exec('CREATE TABLE IF NOT EXISTS jobs(body TEXT)');
    const app = express(); app.use(express.json());
    app.get('/api/session', (_req,res)=>res.setHeader('Set-Cookie','test_session=local').json({local:true}));
    let server;
    await installLauncherControl(app,{store:{db},root,data,stop:()=>server.close(()=>setTimeout(()=>process.exit(0),250))});
    app.post('/api/fixture-job',(req,res)=>{db.exec('DELETE FROM jobs'); if(req.body.active)db.prepare('INSERT INTO jobs VALUES (?)').run(JSON.stringify({state:'running'}));res.json({ok:true});});
    server = app.listen(Number(process.env.PORT),'127.0.0.1');
  `,
    );
    let latest;
    t.after(async () => {
      const running = await inspectStudio(root, port).catch(() => null);
      if (running) {
        await fetch(running.url + "/api/fixture-job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"active":false}',
        });
        await fetch(running.url + "/api/launcher/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedPid: running.pid }),
        });
      }
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(data, { recursive: true, force: true });
    });
    let builds = 0;
    const build = async (out) => {
      builds++;
      await fs.writeFile(path.join(out, "index.html"), "test interface");
    };
    latest = await launchStudio({ root, port, dataDir: data, build });
    const firstPid = latest.pid;
    assert.equal(latest.reused, false);
    const repeated = await Promise.all([
      launchStudio({ root, port, build }),
      launchStudio({ root, port, build }),
    ]);
    assert.ok(repeated.every((r) => r.reused && r.pid === firstPid));
    assert.equal(builds, 1);
    await fs.writeFile(path.join(data, "project-marker.txt"), "preserved");
    await fs.appendFile(
      path.join(root, "server/index.mjs"),
      "\n// updated server\n",
    );
    latest = await launchStudio({ root, port, build });
    assert.notEqual(latest.pid, firstPid);
    assert.equal((await inspectStudio(root, port)).data, data);
    assert.equal(
      await fs.readFile(path.join(data, "project-marker.txt"), "utf8"),
      "preserved",
    );
    await fetch(latest.url + "/api/fixture-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"active":true}',
    });
    await fs.appendFile(
      path.join(root, "server/index.mjs"),
      "\n// another update\n",
    );
    const pending = await launchStudio({ root, port, build });
    assert.equal(pending.pid, latest.pid);
    assert.equal(pending.updatePending, true);
    await assert.rejects(
      launchStudio({ root, port, build, command: "restart" }),
      /still active/,
    );
    await fetch(latest.url + "/api/fixture-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"active":false}',
    });
    latest = await launchStudio({ root, port, build });
    assert.notEqual(latest.pid, pending.pid);
    assert.equal(latest.updatePending, false);
  },
);

test("launcher preserves the working interface when a new build fails and skips unchanged builds", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "dist/index.html"), "old interface");
  await fs.mkdir(path.join(root, "dist/assets"));
  await fs.writeFile(
    path.join(root, "dist/assets/old.js"),
    "used by an open tab",
  );
  await assert.rejects(
    buildInterface(root, {
      build: async () => {
        throw Error("broken source");
      },
    }),
  );
  assert.equal(
    await fs.readFile(path.join(root, "dist/index.html"), "utf8"),
    "old interface",
  );
  let builds = 0;
  const build = async (out) => {
    builds++;
    await fs.writeFile(path.join(out, "index.html"), "new interface");
  };
  assert.equal(await buildInterface(root, { build }), true);
  assert.equal(await buildInterface(root, { build }), false);
  assert.equal(builds, 1);
  assert.equal(
    await fs.readFile(path.join(root, "dist/assets/old.js"), "utf8"),
    "used by an open tab",
  );
});

test("simultaneous Dock launches cannot start duplicate servers", async (t) => {
  const root = await fixture(t);
  let active = 0,
    peak = 0;
  const launch = () =>
    withLauncherLock(root, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active--;
    });
  await Promise.all([launch(), launch(), launch()]);
  assert.equal(peak, 1);
  await assert.rejects(fs.access(path.join(root, "launch.lock")));
});

test("restart refuses active jobs and writes, then drains safely without accepting another submission", async (t) => {
  const root = await fixture(t),
    db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(
    "CREATE TABLE jobs(body TEXT); CREATE TABLE smart_jobs(body TEXT); CREATE TABLE story_jobs(body TEXT)",
  );
  db.prepare("INSERT INTO jobs VALUES (?)").run(
    JSON.stringify({ state: "running" }),
  );
  const app = express();
  app.use(express.json());
  let stopped = false,
    finishWrite,
    writeStarted;
  const started = new Promise((resolve) => {
    writeStarted = resolve;
  });
  await installLauncherControl(app, {
    store: { db },
    root,
    data: path.join(root, "data"),
    stop: () => {
      stopped = true;
    },
  });
  app.post("/api/save", async (_req, res) => {
    writeStarted();
    await new Promise((resolve) => {
      finishWrite = resolve;
    });
    res.json({ saved: true });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const stop = () =>
    fetch(url + "/api/launcher/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPid: process.pid }),
    });
  assert.equal((await stop()).status, 409);
  db.exec("DELETE FROM jobs");
  db.prepare("INSERT INTO story_jobs VALUES (?)").run(
    JSON.stringify({ state: "queued" }),
  );
  assert.equal((await stop()).status, 409);
  db.exec("DELETE FROM story_jobs");
  const saving = fetch(url + "/api/save", { method: "POST" });
  await started;
  assert.equal((await stop()).status, 409);
  assert.equal(stopped, false);
  finishWrite();
  await saving;
  assert.equal((await stop()).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, true);
  assert.equal(
    (await fetch(url + "/api/save", { method: "POST" })).status,
    503,
  );
});
