// Runs the installed bundle with no developer executables on PATH and disposable data.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const exec = promisify(execFile);
const bundle = path.resolve(process.argv[2]);
const resources = path.join(bundle, "Contents/Resources");
const root = path.join(resources, "studio");
const runtime = path.join(resources, "runtime/node");
const scratch = await fs.mkdtemp(
  path.join(os.tmpdir(), "Splece clean install "),
);
const data = path.join(scratch, "Application Support/Splece");
await fs.mkdir(path.join(scratch, "empty-path"));
const env = {
  HOME: scratch,
  TMPDIR: scratch,
  PATH: path.join(scratch, "empty-path"),
  LANG: "en_US.UTF-8",
};
const moduleURL = pathToFileURL(
  path.join(root, "scripts/release/bundled-launcher.mjs"),
).href;
async function action(name) {
  const code = `import {${name}} from ${JSON.stringify(moduleURL)}; console.log(JSON.stringify(await ${name}(${JSON.stringify({ root, data })})));`;
  const result = await exec(runtime, ["--input-type=module", "-e", code], {
    env,
    cwd: scratch,
    timeout: 60000,
  });
  return JSON.parse(result.stdout);
}
let started, cookie;
async function request(route, body, method) {
  const response = await fetch(new URL(route, started.url), {
    method: method || (body ? "POST" : "GET"),
    headers: { Cookie: cookie || "", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  assert.ok(response.ok, `${route}: ${JSON.stringify(json)}`);
  return json;
}
async function connect() {
  const response = await fetch(new URL("/api/session", started.url));
  cookie = response.headers.get("set-cookie").split(";")[0];
}
const checks = [];
let passed = false;
try {
  started = await action("launchPackaged");
  await connect();
  checks.push(
    "Bundled Node starts the studio with an empty PATH and fresh data",
  );
  assert.equal((await request("/api/studio/mode")).mode, "test");
  assert.equal((await action("launchPackaged")).pid, started.pid);
  checks.push("Reopen reuses the service; default mode is Offline");
  const connections = await request("/api/connections");
  assert.equal(connections.onboarding.completed, false);
  assert.ok(connections.connections.every(c => !c.hasKey));
  await request("/api/onboarding", { skipped: true }, "PUT");
  assert.equal((await request("/api/connections")).onboarding.completed, true);
  assert.equal((await request("/api/studio/mode")).mode, "test");
  checks.push("Fresh onboarding can be skipped without keys or enabling Online generation");
  const page = await fetch(new URL("/", started.url));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root"/);
  for (const file of [
    "/vision/blaze-face.tflite",
    "/vision/face-worker.js",
    "/templates/product-1.mp4",
    "/brand/splece-logo-white.svg",
  ])
    assert.equal((await fetch(new URL(file, started.url))).status, 200, file);
  checks.push("Editor, local vision assets, logo and sample media are bundled");
  let { project, revision } = await request("/api/projects", {
    name: "Installer smoke test",
    templateId: "product",
    includeSample: true,
  });
  assert.ok(project.clips.length > 0);
  assert.ok(!project.folder.startsWith(bundle));
  project.clips = [{ ...project.clips[0], start: 0, in: 0, duration: 2 }];
  project.settings.export = {
    ...project.settings.export,
    resolution: "480p",
    fps: 24,
  };
  ({ revision } = await request(
    `/api/projects/${project.id}`,
    { project, revision },
    "PUT",
  ));
  const job = await request(`/api/projects/${project.id}/export`, { revision });
  let finished;
  for (let i = 0; i < 300; i++) {
    const current = (await request(`/api/projects/${project.id}/jobs`)).find(
      (j) => j.id === job.id,
    );
    if (current?.state === "failed") throw Error(current.error);
    if (current?.state === "ready") {
      finished = current;
      break;
    }
    await delay(200);
  }
  assert.ok(finished, "Export must finish");
  assert.ok((await fs.stat(finished.output)).size > 1000);
  checks.push(
    "Create a sample project, trim/save the timeline, and export MP4 using bundled FFmpeg",
  );
  const stop = await action("stopPackaged");
  assert.equal(stop.stopped, true);
  started = await action("launchPackaged");
  await connect();
  assert.equal((await request("/api/connections")).onboarding.completed, true);
  const restored = await request(`/api/projects/${project.id}`);
  assert.equal(restored.project.clips[0].duration, 2);
  checks.push("Quit and relaunch preserve the saved project and timeline");
  const report = {
    ok: true,
    bundle,
    scratch,
    data,
    url: started.url,
    pid: started.pid,
    checks,
    physicalCleanMacTest: false,
    gatekeeperTest: false,
  };
  await fs.writeFile(
    path.join(scratch, "smoke-result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  passed = true;
} finally {
  if (started && (!passed || !process.argv.includes("--keep-running")))
    await action("stopPackaged");
}
