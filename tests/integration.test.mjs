import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { probe, run } from "../server/media.mjs";
const base = "http://127.0.0.1:14319";
let cookie = "";
async function request(route, body, method) {
  const r = await fetch(base + "/api" + route, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  assert.ok(r.ok, JSON.stringify(json));
  return json;
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(base + "/api/session");
      if (response.ok) {
        cookie = response.headers.get("set-cookie").split(";")[0];
        return;
      }
    } catch {}
    await delay(100);
  }
  throw new Error("Server did not start");
}
async function finished(projectId, jobId) {
  for (let i = 0; i < 150; i++) {
    const j = (await request("/projects/" + projectId + "/jobs")).find(
      (j) => j.id === jobId,
    );
    if (j?.state === "failed") throw new Error(j.error);
    if (j?.state === "ready") return j;
    await delay(200);
  }
  throw new Error("Job did not finish");
}
test("worker restart, immutable inputs, local media, failure retry and MP4 export", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-integration-"));
  try {
    await fs.copyFile("data/sample.mp4", path.join(tmp, "sample.mp4"));
  } catch {
    await run([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=12",
      "-t",
      "60",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      path.join(tmp, "sample.mp4"),
    ]);
  }
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "14319",
        STUDIO_DATA_DIR: tmp,
      },
      stdio: "ignore",
    });
    await ready();
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await done;
    }
  };
  try {
    await start();
    const preferred = {
      model: "demo-cinema",
      duration: 10,
      resolution: "480p",
      aspect: "16:9",
      audio: false,
    };
    assert.deepEqual(
      (await request("/video-defaults", preferred, "PUT")).demo,
      preferred,
    );
    const forbidden = await fetch(base + "/api/projects", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(forbidden.status, 403);
    let { project: p, revision } = await request("/projects", {
      name: "Integration test",
    });
    const d = p.drafts[0];
    d.scenes[0].text = "Original exact prompt";
    d.targetId = "slot";
    p.clips = [
      {
        id: "slot",
        start: 0,
        in: 0,
        duration: 5,
        takes: [],
        activeTake: null,
        volume: 1,
        mute: false,
      },
    ];
    revision = (
      await request("/projects/" + p.id, { project: p, revision }, "PUT")
    ).revision;
    await request("/venice/key", { key: "test-only-not-a-real-key" });
    const smart = await request("/projects/" + p.id + "/smart-jobs", {
      draftId: d.id,
      revision,
      requestId: "smart-one",
    });
    const smartDuplicate = await request("/projects/" + p.id + "/smart-jobs", {
      draftId: d.id,
      revision,
      requestId: "smart-one",
    });
    assert.equal(smartDuplicate.id, smart.id);
    let smartReady;
    for (let i = 0; i < 30; i++) {
      smartReady = (await request("/projects/" + p.id + "/smart-jobs")).find(
        (j) => j.id === smart.id,
      );
      if (smartReady.state === "ready") break;
      await delay(50);
    }
    assert.equal(smartReady.state, "ready");
    assert.equal(smartReady.result.model, "local-smart-fixture");
    assert.equal(smartReady.result.usage, null);
    const writing = await request("/projects/" + p.id + "/smart-jobs", {
      draftId: d.id,
      revision,
      requestId: "writing-variation",
      operation: "canvas-writing",
    });
    let writingReady;
    for (let i = 0; i < 30; i++) {
      writingReady = (await request("/projects/" + p.id + "/smart-jobs")).find(
        (j) => j.id === writing.id,
      );
      if (writingReady.state === "ready") break;
      await delay(50);
    }
    assert.equal(writingReady.state, "ready");
    assert.equal(writingReady.input.draft.id, d.id);
    assert.equal(writingReady.input.operation, "canvas-writing");
    assert.equal(writingReady.result.kind, "writing-variation");
    assert.equal(writingReady.config, undefined);
    assert.equal(writingReady.input.library, undefined);
    const envelope = await request(
      "/projects/" + p.id + "/prompt-json/" + d.id,
    );
    assert.equal(envelope.kind, "frame.prompt");
    const validation = await request(
      "/projects/" + p.id + "/prompt-json/validate",
      envelope,
    );
    assert.equal(validation.draft.scenes[0].text, d.scenes[0].text);
    assert.ok(envelope.injections.frames);
    await request("/deepseek/settings", { mode: "deepseek" }, "PUT");
    const storyPlansBeforeGeneration = (await request("/projects/" + p.id))
      .project.storyPlans;
    const story = await request("/projects/" + p.id + "/story-jobs", {
      revision,
      requestId: "story-one",
      demo: true,
    });
    assert.equal(
      (
        await request("/projects/" + p.id + "/story-jobs", {
          revision,
          requestId: "story-one",
          demo: true,
        })
      ).id,
      story.id,
    );
    let storyReady;
    for (let i = 0; i < 30; i++) {
      storyReady = (await request("/projects/" + p.id + "/story-jobs")).find(
        (j) => j.id === story.id,
      );
      if (storyReady.state === "ready") break;
      await delay(50);
    }
    assert.equal(storyReady.result.model, "local-story-fixture");
    assert.equal(storyReady.result.usage, null);
    assert.equal((await request("/deepseek/settings")).mode, "demo");
    assert.equal((await request("/studio/mode")).mode, "test");
    await request("/deepseek/settings", { mode: "demo" }, "PUT");
    assert.deepEqual(
      (await request("/projects/" + p.id)).project.storyPlans,
      storyPlansBeforeGeneration,
      "Generating a proposal must not modify the saved story plan",
    );
    const job = await request("/projects/" + p.id + "/jobs", {
      draftId: d.id,
      requestId: "same-intent",
      revision,
    });
    const duplicate = await request("/projects/" + p.id + "/jobs", {
      draftId: d.id,
      requestId: "same-intent",
      revision,
    });
    assert.equal(duplicate.id, job.id);
    assert.equal((await request("/projects/" + p.id + "/jobs")).length, 1);
    for (let i = 0; i < 30; i++) {
      const queued = (await request("/projects/" + p.id + "/jobs")).find(
        (j) => j.id === job.id,
      );
      if (queued.providerJobId) {
        assert.ok(queued.providerJobId);
        break;
      }
      await delay(100);
    }
    d.scenes[0].text = "Later draft edit";
    revision = (
      await request("/projects/" + p.id, { project: p, revision }, "PUT")
    ).revision;
    await stop();
    await start();
    assert.deepEqual((await request("/video-defaults")).demo, preferred);
    const veniceStatus = await request("/venice/settings");
    assert.equal(veniceStatus.hasKey, true);
    assert.equal(veniceStatus.mode, "demo");
    assert.ok(
      !JSON.stringify(veniceStatus).includes("test-only-not-a-real-key"),
    );
    assert.equal(
      (await request("/projects/" + p.id + "/smart-jobs")).find(
        (j) => j.id === smart.id,
      ).id,
      smart.id,
    );
    assert.equal(
      (await request("/projects/" + p.id + "/story-jobs"))[0].id,
      story.id,
    );
    const done = await finished(p.id, job.id);
    assert.equal(done.snapshot.draft.scenes[0].text, "Original exact prompt");
    assert.equal(
      (await request("/projects/" + p.id)).project.drafts[0].scenes[0].text,
      "Later draft edit",
    );
    assert.equal(done.media.duration, 5);
    const bytes = await fetch(base + done.media.url, {
      headers: { Range: "bytes=0-99", Cookie: cookie },
    });
    assert.equal(bytes.status, 206);
    assert.equal((await bytes.arrayBuffer()).byteLength, 100);
    const originalGeneration = await fs.readFile(done.media.path);
    const beforeOptimization = await request("/projects/" + p.id);
    const repaired = await Promise.all([
      request("/media/" + done.media.id + "/optimize-preview", {}),
      request("/media/" + done.media.id + "/optimize-preview", {}),
    ]);
    assert.equal(repaired[0].playback.version, 3);
    assert.deepEqual(repaired[0], repaired[1]);
    assert.deepEqual(await fs.readFile(done.media.path), originalGeneration);
    assert.deepEqual(await request("/projects/" + p.id), beforeOptimization);
    const checkpoint = JSON.parse(
      await fs.readFile(
        path.join(p.folder, ".frame/project.bundle.json"),
        "utf8",
      ),
    );
    const repairedMedia = checkpoint.media.find((m) => m.id === done.media.id);
    assert.equal(
      path.resolve(p.folder, repairedMedia.original),
      done.media.path,
    );
    assert.equal(repairedMedia.path, repairedMedia.original);
    const proxyStatus = await request(
      "/media/" + done.media.id + "/preview-status",
    );
    assert.equal(proxyStatus.state, "ready");
    assert.ok(proxyStatus.url.includes("/preview?key="));
    assert.ok(!JSON.stringify(checkpoint).includes("preview-cache"));
    const repairedRange = await fetch(base + done.media.url + "?preview=2", {
      headers: { Range: "bytes=0-99", Cookie: cookie },
    });
    assert.equal(repairedRange.status, 206);
    assert.equal((await repairedRange.arrayBuffer()).byteLength, 100);
    p.clips[0].takes = [done.media];
    p.clips[0].activeTake = done.media.id;
    p.clips[0].in = 1;
    p.clips[0].duration = 2;
    p.clips.push({
      ...structuredClone(p.clips[0]),
      id: "second",
      start: 3,
      in: 2,
      duration: 2,
    });
    p.remarks = [{ id: "remark", start: 1, end: 4, text: "Hook", lane: 0 }];
    revision = (
      await request("/projects/" + p.id, { project: p, revision }, "PUT")
    ).revision;
    const exp = await request("/projects/" + p.id + "/export", { revision });
    const rendered = await finished(p.id, exp.id);
    const info = await probe(rendered.output);
    assert.ok(
      Math.abs(info.duration - 5) < 0.15,
      `Expected 5s with gap, got ${info.duration}`,
    );
    assert.ok((await fs.stat(rendered.output)).size > 1000);
    const still = path.join(tmp, "reference.png");
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90",
      "-frames:v",
      "1",
      still,
    ]);
    const form = new FormData();
    form.append(
      "file",
      new Blob([await fs.readFile(still)], { type: "image/png" }),
      "reference.png",
    );
    const importedResponse = await fetch(
      base + "/api/projects/" + p.id + "/import",
      { method: "POST", body: form, headers: { Cookie: cookie } },
    );
    assert.ok(importedResponse.ok);
    const imported = await importedResponse.json();
    assert.equal(imported.kind, "image");
    assert.equal(imported.duration, 5);
    assert.ok((await fs.stat(imported.original)).size > 0);
    // Uploads own their bytes; deleting the user's source cannot break references.
    assert.equal(path.dirname(imported.original), path.join(p.folder, "media"));
    const originalBytes = await fs.readFile(still);
    await fs.unlink(still);
    assert.deepEqual(await fs.readFile(imported.original), originalBytes);
    const retainedImage = await fetch(
      base + "/api/media/" + imported.id + "/original",
      {
        headers: { Cookie: cookie },
      },
    );
    assert.ok(retainedImage.ok);
    assert.deepEqual(
      Buffer.from(await retainedImage.arrayBuffer()),
      originalBytes,
    );

    const failure = await request("/projects/" + p.id + "/jobs", {
      draftId: d.id,
      revision,
      simulation: "failure",
    });
    for (let i = 0; i < 60; i++) {
      const j = (await request("/projects/" + p.id + "/jobs")).find(
        (j) => j.id === failure.id,
      );
      if (j.state === "failed") break;
      await delay(200);
    }
    const fail = (await request("/projects/" + p.id + "/jobs")).find(
      (j) => j.id === failure.id,
    );
    assert.equal(fail.state, "failed");
    assert.equal(fail.snapshot.draft.scenes[0].text, "Later draft edit");
    await request("/jobs/" + failure.id + "/retry", {});
    assert.equal((await finished(p.id, failure.id)).state, "ready");
    const waitState = async (jobId, state) => {
      for (let i = 0; i < 100; i++) {
        const j = (await request("/projects/" + p.id + "/jobs")).find(
          (j) => j.id === jobId,
        );
        if (j.state === state) return j;
        await delay(100);
      }
      throw new Error("Missing state " + state);
    };
    const uncertain = await request("/projects/" + p.id + "/jobs", {
      draftId: d.id,
      revision,
      simulation: "uncertain",
    });
    const held = await waitState(uncertain.id, "submission_uncertain");
    const denied = await fetch(base + "/api/jobs/" + held.id + "/retry", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(denied.ok, false);
    await request("/jobs/" + held.id + "/recover", {
      providerJobId: held.recoveryId,
    });
    const recovered = await finished(p.id, held.id);
    assert.equal(recovered.providerJobId, held.recoveryId);
    const transfer = await request("/projects/" + p.id + "/jobs", {
      draftId: d.id,
      revision,
      simulation: "download-failure",
    });
    const downloadFailed = await waitState(transfer.id, "download_failed");
    await request("/jobs/" + transfer.id + "/retry", {});
    const downloaded = await finished(p.id, transfer.id);
    assert.equal(downloaded.providerJobId, downloadFailed.providerJobId);
    assert.equal(downloaded.submitCount, 1);
    const transients = await Promise.all(
      ["rate-limit", "offline"].map((simulation) =>
        request("/projects/" + p.id + "/jobs", {
          draftId: d.id,
          revision,
          simulation,
        }),
      ),
    );
    const resumed = await Promise.all(
      transients.map((j) => finished(p.id, j.id)),
    );
    assert.ok(resumed.every((j) => j.submitCount === 1));
    assert.ok(resumed[0].statusHistory.some((s) => s.state === "rate_limited"));
    assert.ok(resumed[1].statusHistory.some((s) => s.state === "unreachable"));
    const current = await request("/projects/" + p.id);
    const importedPrompt = await request(
      "/projects/" + p.id + "/prompt-json/import",
      { revision: current.revision, document: envelope },
    );
    assert.notEqual(importedPrompt.draft.id, d.id);
    assert.equal(importedPrompt.revision, current.revision + 1);
    assert.equal(
      (await request("/projects/" + p.id)).project.drafts.length,
      current.project.drafts.length + 1,
    );
    const bundle = JSON.parse(
      await fs.readFile(
        path.join(current.project.folder, ".frame", "project.bundle.json"),
        "utf8",
      ),
    );
    assert.equal(bundle.storyJobs[0].id, story.id);
    const unauthenticated = await fetch(base + "/api/projects");
    assert.equal(unauthenticated.status, 401);
  } finally {
    await stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
