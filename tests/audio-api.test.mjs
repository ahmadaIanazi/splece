import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { run, probe } from "../server/media.mjs";
import { audioClip } from "../shared/audio-editing.mjs";
test("audio endpoints cache real waveforms, preserve sources and revisions, persist a reusable local mix", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "splece-audio-api-"));
  let child;
  try {
    const source = path.join(root, "test.wav");
    await run(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", source]);
    const original = await fs.readFile(source);
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "14327",
        STUDIO_DATA_DIR: root,
      },
      stdio: "ignore",
    });
    const base = "http://127.0.0.1:14327";
    let cookie;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(base + "/api/session");
        if (r.ok) {
          cookie = r.headers.get("set-cookie").split(";")[0];
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(cookie, "isolated server starts");
    async function api(route, body, method) {
      const r = await fetch(base + "/api" + route, {
        method: method || (body ? "POST" : "GET"),
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await r.json();
      assert.ok(r.ok, JSON.stringify(value));
      return value;
    }
    let { project: p, revision } = await api("/projects", {
      name: "Audio endpoint test",
    });
    const form = new FormData();
    form.set("file", new Blob([original], { type: "audio/wav" }), "test.wav");
    const upload = await fetch(base + "/api/projects/" + p.id + "/import", {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    assert.ok(upload.ok);
    const media = await upload.json();
    const [a, b] = await Promise.all([
      api(`/media/${media.id}/waveform`),
      api(`/media/${media.id}/waveform`),
    ]);
    assert.deepEqual(a, b);
    assert.ok(Math.max(...a.peaks) > 0.08);
    p.audioClips = [
      { ...audioClip(media, "a", 2), duration: 2, fadeIn: 0.2 },
      { ...audioClip(media, "b", 3), duration: 2, volume: 0.3, fadeOut: 0.4 },
    ];
    revision = (await api("/projects/" + p.id, { project: p, revision }, "PUT"))
      .revision;
    const wrong = await fetch(base + "/api/projects/" + p.id + "/audio-mix", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ revision: revision - 1 }),
    });
    assert.equal(wrong.status, 409);
    const mixed = await api("/projects/" + p.id + "/audio-mix", { revision });
    assert.equal(mixed.start, 2);
    assert.ok(mixed.media.audio);
    assert.equal(mixed.media.kind, "audio");
    assert.ok(Math.abs((await probe(mixed.media.path)).duration - 3) < 0.05);
    assert.deepEqual(await fs.readFile(media.original), original);
    assert.deepEqual(
      (await api("/projects/" + p.id)).project.audioClips,
      p.audioClips,
      "mixing never overwrites edits on the server",
    );
    p.audioClips = [audioClip(mixed.media, "mixed", mixed.start)];
    p.assets.push({
      id: "mix-asset",
      name: "Mix",
      kind: "footage",
      media: mixed.media,
    });
    await api("/projects/" + p.id, { project: p, revision }, "PUT");
    assert.deepEqual(
      (await api("/projects/" + p.id)).project.audioClips,
      p.audioClips,
    );
    const download = await fetch(base + mixed.media.url, {
      headers: { Cookie: cookie, Range: "bytes=0-63" },
    });
    assert.equal(download.status, 206);
    assert.ok(
      (await api(`/media/${mixed.media.id}/waveform`)).peaks.some((v) => v > 0),
    );
  } finally {
    if (child && child.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill();
      await done;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
