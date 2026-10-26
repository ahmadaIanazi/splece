import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createSoundtrackPlan,
  applySoundtrackResults,
  soundUnitState,
  soundtrackDirtyClips,
  followSoundtrackEdits,
} from "../shared/soundtrack.mjs";
import {
  createSoundtrackService,
  renderTestSound,
} from "../server/soundtrack.mjs";
import { openStore } from "../server/store.mjs";
import { saveStudioMode } from "../server/mode.mjs";
import { probe, renderEpisode, run as ffmpeg } from "../server/media.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { activeStudioJobs } from "../server/launcher.mjs";
let serial = 0;
const id = () => `sound-${++serial}`;
function fixture() {
  const p = upgradeProject(newProject("Sound test"));
  p.clips = [0, 1, 2].map((i) => ({
    id: `c${i}`,
    start: i * 2,
    in: 0,
    duration: 2,
    activeTake: `m${i}`,
    takes: [{ id: `m${i}`, duration: 4 }],
    volume: 0.7,
    mute: false,
  }));
  return p;
}
function ready(p, options = {}) {
  const r = createSoundtrackPlan(p, options, id);
  r.units.forEach((u) => {
    u.state = "ready";
    u.media = {
      id: u.id,
      duration: u.duration,
      kind: "audio",
      audio: true,
      name: u.role,
    };
  });
  return r;
}
test("soundtrack plans continuous beds across cuts, respects gaps and selection, and refuses unfinished footage", () => {
  const p = fixture();
  const r = createSoundtrackPlan(p, {}, id);
  assert.equal(r.units.filter((u) => u.role === "effect").length, 1);
  assert.equal(r.units.filter((u) => u.role === "ambience").length, 1);
  assert.equal(r.units.at(-1).duration, 6);
  assert.equal(
    createSoundtrackPlan(p, { clipIds: ["c0", "c2"] }, id).units.filter(
      (u) => u.role === "ambience",
    ).length,
    2,
  );
  p.clips[1].activeTake = null;
  assert.throws(() => createSoundtrackPlan(p, {}, id), /completed footage/);
  assert.throws(
    () => createSoundtrackPlan(fixture(), { roles: [] }, id),
    /Choose effects/,
  );
});
test("results are idempotent, retain originals, preserve independent audio, and archive stale outputs", () => {
  const p = fixture();
  p.audioClips = [
    { id: "music", start: 0, in: 0, duration: 6, mediaId: "music" },
  ];
  const original = structuredClone(p.clips),
    r = ready(p);
  assert.equal(applySoundtrackResults(p, r), 2);
  assert.equal(applySoundtrackResults(p, r), 0);
  assert.deepEqual(p.clips, original);
  assert.ok(p.audioClips.some((a) => a.id === "music"));
  assert.equal(p.assets.length, 2);
  assert.ok(p.assets.every((a) => a.scope === "project"));
  const next = ready(p);
  p.clips[1].activeTake = "other";
  p.clips[1].takes.push({ id: "other", duration: 4 });
  applySoundtrackResults(p, next);
  assert.ok(!p.audioClips.some((a) => a.id === next.units[1].id));
  assert.ok(p.assets.some((a) => a.id === next.units[1].id));
  assert.equal(p.production.audioPlans.at(-1).cues[1].status, "needs-review");
});
test("picture moves follow sound, while trims/take changes flag only affected sources and joins", () => {
  const p = fixture(),
    r = ready(p);
  applySoundtrackResults(p, r);
  const next = structuredClone(p);
  next.clips.forEach((c) => (c.start += 3));
  followSoundtrackEdits(p, next);
  assert.equal(next.audioClips[0].start, 3);
  assert.equal(soundtrackDirtyClips(next).size, 0);
  const trimmed = structuredClone(next);
  trimmed.clips[1].in = 0.5;
  trimmed.clips[1].duration = 1.5;
  assert.deepEqual([...soundtrackDirtyClips(trimmed)], ["c1"]);
  const moved = structuredClone(next);
  moved.clips[0].start = 8;
  assert.equal(
    soundtrackDirtyClips(moved).size,
    2,
    "continuous bed needs new joins after reorder",
  );
  const update = ready(trimmed, { changedOnly: true });
  assert.equal(update.units.filter((u) => u.role === "effect").length, 1);
});
test("partial soundtrack regeneration keeps outside bed tails without double-playing the selected region", () => {
  const p = fixture();
  applySoundtrackResults(p, ready(p));
  applySoundtrackResults(p, ready(p, { clipIds: ["c1"] }));
  const beds = p.audioClips
    .filter((a) => a.soundtrack?.role === "ambience")
    .sort((a, b) => a.start - b.start);
  assert.deepEqual(
    beds.map((a) => [a.start, a.duration]),
    [
      [0, 2],
      [2, 2],
      [4, 2],
    ],
  );
  assert.equal(beds[2].in, 4);
  assert.equal(
    p.audioClips.filter((a) => a.soundtrack?.role === "effect").length,
    3,
  );
});
test("source changes during generation never silently attach obsolete results; removed clips remain flagged", () => {
  const p = fixture(),
    r = ready(p);
  applySoundtrackResults(p, r);
  p.clips.splice(1, 1);
  assert.ok(soundtrackDirtyClips(p).has("c1"));
  assert.ok(soundUnitState(p, r.units.at(-1)).stale);
  const other = fixture();
  assert.equal(applySoundtrackResults(other, r), 0);
});
test("local soundtrack renderer is bounded, continuous through internal cuts, and exports playable audio", async () => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-sound-render-"),
  );
  try {
    const p = fixture(),
      r = ready(p),
      bed = r.units.at(-1),
      out = path.join(folder, "bed.wav");
    const progress = [];
    await renderTestSound(bed, out, (v) => progress.push(v));
    assert.equal((await probe(out)).duration, 6);
    assert.equal(progress.at(-1), 1);
    const pcm = await fs.readFile(out);
    const rms = (at) => {
      let sum = 0;
      for (let i = at; i < at + 240; i++)
        sum += (pcm.readInt16LE(44 + i * 2) / 32768) ** 2;
      return Math.sqrt(sum / 240);
    };
    assert.ok(
      rms(2 * 24000) > 0.0001,
      "ambience does not reset to silence at the cut",
    );
    const video = path.join(folder, "picture.mp4");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=24",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    const output = path.join(folder, "export.mp4");
    await renderEpisode(
      [{ id: "v", start: 0, in: 0, duration: 2 }],
      () => ({ path: video, duration: 2, audio: false }),
      path.join(folder, "cache"),
      output,
      { aspect: "16:9", resolution: "480p", fps: 24 },
      [
        {
          mediaId: "bed",
          start: 0,
          in: 0,
          duration: 2,
          volume: 0.5,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
      () => ({ path: out, duration: 6, audio: true }),
    );
    const info = await probe(output);
    assert.ok(info.audio && info.video);
    assert.ok(Math.abs(info.duration - 2) < 0.1);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
test("persistent worker requires a Live estimate, resumes processing, deduplicates requests, preserves delivery and retries only failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "splece-sound-worker-"));
  const store = openStore(path.join(root, "db.sqlite"));
  let service;
  try {
    const p = fixture();
    p.folder = root;
    const revision = store.save(p, 0);
    p.clips.forEach((c) =>
      store.putMedia({
        id: c.activeTake,
        projectId: p.id,
        path: path.join(root, c.activeTake),
        duration: 4,
      }),
    );
    let calls = 0,
      fail = true;
    service = createSoundtrackService({
      store,
      data: root,
      render: async (u, o, progress) => {
        calls++;
        if (fail && u.role === "ambience")
          throw Error("Simulated local failure");
        return renderTestSound(u, o, progress);
      },
    });
    await saveStudioMode(root, "live");
    await assert.rejects(
      () => service.submit(p.id, { revision }),
      /fresh Online soundtrack estimate/,
    );
    await saveStudioMode(root, "test");
    const request = { revision, requestId: "one" };
    const queued = await service.submit(p.id, request);
    assert.equal((await service.submit(p.id, request)).id, queued.id);
    assert.equal(activeStudioJobs(store.db), 1);
    await assert.rejects(
      () => service.submit(p.id, { revision, requestId: "two" }),
      /already running/,
    );
    await service.tick();
    assert.equal(service.get(queued.id).state, "failed");
    assert.equal(calls, 2);
    const partial = service.get(queued.id);
    applySoundtrackResults(p, partial);
    store.save(p, revision);
    service.ack(p.id, queued.id);
    fail = false;
    await service.retry(p.id, queued.id);
    await service.tick();
    const finished = service.get(queued.id);
    assert.equal(finished.state, "ready");
    assert.equal(calls, 3);
    assert.ok(finished.units.slice(0, 1).every((u) => u.delivered));
    assert.equal(activeStudioJobs(store.db), 0);
    service.close();
    // Simulate a saved in-flight unit at restart. Only the unfinished unit reruns.
    finished.state = "processing";
    finished.units.at(-1).state = "processing";
    // Simulate an unfinished renderer, not a ready part whose work was cleaned up.
    finished.units.at(-1).parts.forEach((part) => (part.state = "queued"));
    delete finished.units.at(-1).media;
    store.db
      .prepare("UPDATE soundtrack_runs SET state=?,body=? WHERE id=?")
      .run("processing", JSON.stringify(finished), finished.id);
    service = createSoundtrackService({
      store,
      data: root,
      render: async (u, o, progress) => {
        calls++;
        return renderTestSound(u, o, progress);
      },
    });
    await service.tick();
    assert.equal(service.get(queued.id).state, "ready");
    assert.equal(calls, 4);
  } finally {
    service?.close();
    store.db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("soundtrack files, receipts and run history travel with the project folder", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-sound-portable-"),
  );
  const { createPortableStore } = await import("../server/portable.mjs");
  const store = openStore(path.join(root, "original.sqlite"));
  let service, imported, second;
  try {
    const p = fixture();
    p.folder = path.join(root, "project");
    await fs.mkdir(p.folder);
    for (const c of p.clips) {
      const file = path.join(p.folder, c.activeTake + ".wav");
      await renderTestSound({ role: "ambience", duration: 4 }, file);
      store.putMedia({
        id: c.activeTake,
        projectId: p.id,
        path: file,
        original: file,
        duration: 4,
        audio: true,
        kind: "audio",
      });
    }
    const revision = store.save(p, 0);
    await saveStudioMode(root, "test");
    service = createSoundtrackService({ store, data: root });
    const job = await service.submit(p.id, { revision });
    await service.tick();
    const result = service.get(job.id);
    assert.equal(result.state, "ready");
    applySoundtrackResults(p, result);
    store.save(p, revision);
    service.ack(p.id, job.id);
    await createPortableStore(store).checkpoint(p.id);
    service.close();
    const target = path.join(root, "copy");
    await fs.cp(p.folder, target, { recursive: true });
    imported = openStore(path.join(root, "imported.sqlite"));
    second = createSoundtrackService({ store: imported, data: root });
    const reopened = await createPortableStore(imported).open(target);
    assert.equal(reopened.project.audioClips.length, 2);
    const restored = second.get(job.id);
    assert.equal(restored.state, "ready");
    assert.ok(restored.units.every((u) => u.delivered));
    assert.ok(
      imported
        .media(restored.units[0].media.id)
        .path.startsWith(await fs.realpath(target)),
    );
    assert.ok(
      (await fs.stat(imported.media(restored.units[0].media.id).path)).size >
        44,
    );
  } finally {
    service?.close();
    second?.close();
    store.db.close();
    imported?.db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("updating a shortened edit removes obsolete sound tails and clears dirty sections", () => {
  const p = fixture();
  applySoundtrackResults(p, ready(p));
  const shorter = structuredClone(p);
  shorter.clips[1].duration = 1;
  shorter.clips[2].start = 3;
  followSoundtrackEdits(p, shorter);
  assert.ok(soundtrackDirtyClips(shorter).size);
  const update = ready(shorter, { changedOnly: true });
  applySoundtrackResults(shorter, update);
  assert.equal(soundtrackDirtyClips(shorter).size, 0);
  assert.equal(
    Math.max(...shorter.audioClips.map((a) => a.start + a.duration)),
    5,
  );
  assert.equal(
    shorter.audioClips.filter((a) => a.soundtrack.role === "ambience").length,
    1,
  );
});

test("highlighted sound ranges keep full edit dependencies and replace only the highlighted audio", () => {
  const p = fixture();
  applySoundtrackResults(p, ready(p));
  const r = ready(p, { roles: ["effect"], range: { from: 1, to: 5 } });
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0].start, 1);
  assert.equal(r.units[0].duration, 4);
  assert.deepEqual(
    r.units[0].sources.map((s) => [s.start, s.duration]),
    [
      [0, 2],
      [2, 2],
      [4, 2],
    ],
  );
  assert.equal(soundUnitState(p, r.units[0]).stale, false);
  applySoundtrackResults(p, r);
  const effects = p.audioClips
    .filter((a) => a.soundtrack.role === "effect")
    .sort((a, b) => a.start - b.start);
  assert.deepEqual(
    effects.map((a) => [a.start, a.duration, a.in]),
    [
      [0, 1, 0],
      [1, 4, 0],
      [5, 1, 5],
    ],
  );
  assert.equal(
    p.audioClips.filter((a) => a.soundtrack.role === "ambience").length,
    1,
  );
  assert.throws(
    () => ready(p, { range: { from: 2, to: 1 } }),
    /valid time range/,
  );
  p.clips[1].in = 0.25;
  assert.ok(soundUnitState(p, r.units[0]).stale);
});

test("resuming one failed section leaves other failures and completed layers untouched", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-sound-retry-section-"),
  );
  const store = openStore(path.join(root, "db.sqlite"));
  let service;
  try {
    const p = fixture();
    p.folder = root;
    const revision = store.save(p, 0);
    p.clips.forEach((c) =>
      store.putMedia({
        id: c.activeTake,
        projectId: p.id,
        path: path.join(root, c.activeTake),
        duration: 4,
      }),
    );
    await saveStudioMode(root, "test");
    let failing = true;
    const calls = [];
    service = createSoundtrackService({
      store,
      data: root,
      render: async (u, out) => {
        calls.push(u.id);
        if (failing) throw Error("Local test failure");
        await renderTestSound(u, out);
      },
    });
    const run = await service.submit(p.id, { revision });
    await service.tick();
    assert.equal(
      service.get(run.id).units.filter((u) => u.state === "failed").length,
      2,
    );
    failing = false;
    await service.retry(p.id, run.id, { unitId: run.units[0].id });
    await service.tick();
    const result = service.get(run.id);
    assert.deepEqual(
      result.units.map((u) => u.state),
      ["ready", "failed"],
    );
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1), run.units[0].id);
  } finally {
    service?.close();
    store.db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
