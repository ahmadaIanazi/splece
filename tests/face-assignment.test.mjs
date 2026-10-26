import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { dialogueSignature } from "../shared/soundtrack-dialogue.mjs";
import {
  assignFace,
  faceChoice,
  targetedSegments,
  speakerOptions,
  TARGETED_LIP_MODEL,
} from "../shared/face-assignment.mjs";
import {
  lipSyncInput,
  lipSyncSignature,
  applyLipSync,
  lipSyncCosts,
} from "../shared/lip-sync.mjs";
import { createLipSyncService, prepareLipSync } from "../server/lip-sync.mjs";
import { prepareSpeaker } from "../server/speaker-sync.mjs";
import { openStore } from "../server/store.mjs";
import { saveStudioMode } from "../server/mode.mjs";
import { run, probe } from "../server/media.mjs";

function fixture() {
  const p = upgradeProject(newProject("Speaker test"));
  p.assets = [
    { id: "a", name: "Alex", kind: "character" },
    { id: "b", name: "Sam", kind: "character" },
  ];
  p.clips = [
    {
      id: "c",
      draftId: "d",
      start: 0,
      in: 0,
      duration: 2,
      activeTake: "v",
      takes: [{ id: "v" }],
    },
  ];
  p.drafts = [
    {
      id: "d",
      referenceIds: ["a", "b"],
      scenes: [
        {
          dialogue: [
            { speaker: "a", text: "Hello." },
            { speaker: "b", text: "Welcome." },
          ],
        },
      ],
    },
  ];
  p.audioClips = [
    {
      id: "voice",
      mediaId: "audio",
      start: 0,
      in: 0,
      duration: 2,
      soundtrack: {
        role: "dialogue",
        scriptSignature: dialogueSignature(p, p.clips[0]),
        lineTimings: [
          { start: 0, duration: 0.8 },
          { start: 1, duration: 0.8 },
        ],
        sources: [{ clipId: "c", mediaId: "v", in: 0, start: 0, duration: 2 }],
      },
    },
  ];
  assignFace(p, p.clips[0], 0, { point: [0.25, 0.4], time: 0.2 });
  assignFace(p, p.clips[0], 1, { point: [0.75, 0.4], time: 1.2 });
  return p;
}
test("each written line has an explicit face, recorded audio range, and Sync 3 payload", () => {
  const p = fixture(),
    input = lipSyncInput(p, "c", "voice");
  assert.equal(input.model, TARGETED_LIP_MODEL);
  assert.deepEqual(
    input.segments.map((s) => [s.speaker, s.start, s.duration]),
    [
      ["a", 0, 0.8],
      ["b", 1, 0.8],
    ],
  );
  assert.deepEqual(speakerOptions(input.segments[1], 1280, 720), {
    active_speaker_detection: {
      auto_detect: false,
      frame_number: 5,
      coordinates: [960, 288],
    },
  });
  delete p.production.faceAssignments.c.lines[1];
  assert.throws(() => lipSyncInput(p, "c", "voice"), /line 2/);
});
test("face assignments survive timeline moves but not changed picture, trims or speaker/script", () => {
  const p = fixture(),
    c = p.clips[0];
  c.start = 20;
  assert.ok(faceChoice(p, c, 0));
  c.in = 0.1;
  assert.equal(faceChoice(p, c, 0), null);
  c.in = 0;
  c.activeTake = "new";
  c.takes.push({ id: "new" });
  assert.equal(faceChoice(p, c, 0), null);
  c.activeTake = "v";
  p.drafts[0].scenes[0].dialogue[0].speaker = "b";
  assert.equal(faceChoice(p, c, 0), null);
});
test("invalid face coordinates, out-of-line frames, stale timing and overlapping speech are blocked", () => {
  const p = fixture(),
    c = p.clips[0],
    a = p.audioClips[0];
  assert.throws(
    () => assignFace(p, c, 0, { point: [NaN, 0.4], time: 0.2 }),
    /visible face/,
  );
  assignFace(p, c, 0, { point: [0.4, 0.4], time: 1.9 });
  assert.throws(() => targetedSegments(p, c, a), /recorded time/);
  assignFace(p, c, 0, { point: [0.4, 0.4], time: 0.2 });
  a.soundtrack.lineTimings[1].start = 0.5;
  assert.throws(() => targetedSegments(p, c, a), /timing/);
  delete a.soundtrack.lineTimings;
  assert.throws(() => targetedSegments(p, c, a), /precise line timings/);
});
test("changing a face after quoting invalidates the old result; applying preserves originals and assignments", () => {
  const p = fixture(),
    input = lipSyncInput(p, "c", "voice");
  const job = {
    projectId: p.id,
    episodeId: p.episodeId,
    input,
    signature: lipSyncSignature(input),
    media: { id: "new" },
  };
  assignFace(p, p.clips[0], 1, { point: [0.6, 0.4], time: 1.2 });
  assert.throws(() => applyLipSync(p, job), /changed/);
  assignFace(p, p.clips[0], 1, { point: [0.75, 0.4], time: 1.2 });
  applyLipSync(p, job);
  assert.equal(p.clips[0].takes.length, 2);
  assert.ok(faceChoice(p, p.clips[0], 1));
});
async function sandbox(fn) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "splece-speakers-")),
    store = openStore(path.join(folder, "db.sqlite")),
    services = [];
  try {
    const p = fixture();
    p.folder = folder;
    const revision = store.save(p, 0);
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=25:d=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path.join(folder, "v.mp4"),
    ]);
    await run([
      "-f",
      "lavfi",
      "-i",
      "sine=duration=2",
      path.join(folder, "voice.wav"),
    ]);
    store.putMedia({
      id: "v",
      projectId: p.id,
      path: path.join(folder, "v.mp4"),
      duration: 2,
    });
    store.putMedia({
      id: "audio",
      projectId: p.id,
      path: path.join(folder, "voice.wav"),
      duration: 2,
    });
    await saveStudioMode(folder, "test");
    await fn({
      folder,
      store,
      p,
      revision,
      service: (opts = {}) => {
        const s = createLipSyncService({ data: folder, store, ...opts });
        services.push(s);
        return s;
      },
    });
  } finally {
    services.forEach((s) => s.close());
    store.db.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
}
test("Test multi-speaker pass survives restart, stitches a silent new take and never calls a provider", () =>
  sandbox(async ({ folder, store, p, revision, service }) => {
    const forbidden = () => {
      throw Error("No provider calls in Test");
    };
    let s = service({
      adapterFactory: forbidden,
      upload: forbidden,
      download: forbidden,
    });
    const q = await s.estimate(p.id, { clipId: "c", audioId: "voice" });
    await s.submit(p.id, {
      clipId: "c",
      audioId: "voice",
      quoteId: q.id,
      revision,
      requestId: "test-speakers",
    });
    await s.tick();
    assert.equal(s.list(p.id)[0].parts[0].state, "ready");
    s.close();
    s = service({
      adapterFactory: forbidden,
      upload: forbidden,
      download: forbidden,
    });
    await s.tick();
    await s.tick();
    const done = s.list(p.id)[0];
    assert.equal(done.state, "ready", done.error);
    assert.equal(done.parts.length, 2);
    const info = await probe(done.media.path);
    assert.equal(info.duration, 2);
    assert.equal(info.audio, false);
    assert.equal(lipSyncCosts(done).amount, 0);
    assert.equal((await probe(path.join(folder, "v.mp4"))).duration, 2);
    const prepared = await prepareSpeaker(
      done.input,
      done.input.segments[1],
      path.join(folder, "prepare"),
      store,
      prepareLipSync,
    );
    assert.deepEqual(
      prepared.input.options.active_speaker_detection.coordinates,
      [120, 36],
    );
    assert.equal(
      prepared.input.options.active_speaker_detection.frame_number,
      5,
    );
  }));
test("recovering one failed line polls its saved request and never regenerates a completed line", () =>
  sandbox(async ({ folder, p, revision, service }) => {
    await saveStudioMode(folder, "live");
    let submissions = 0,
      failed = false;
    const polls = [];
    const adapter = {
      pricing: async (model) => {
        assert.equal(model, TARGETED_LIP_MODEL);
        return { rate: 0.1 };
      },
      submitSound: async (input, model) => {
        assert.equal(model, TARGETED_LIP_MODEL);
        assert.equal(input.options.active_speaker_detection.auto_detect, false);
        return { providerJobId: `request-${++submissions}` };
      },
      pollSound: async (part) => {
        polls.push(part.providerJobId);
        if (part.index === 1 && !failed) {
          failed = true;
          throw Error("Temporary status failure");
        }
        return { state: "ready", downloadUrl: "mock" };
      },
    };
    const s = service({
      adapterFactory: async () => adapter,
      upload: async () => "https://v3.fal.media/test",
      download: async (url, out, duration) =>
        run([
          "-f",
          "lavfi",
          "-i",
          `color=c=red:s=160x90:r=25:d=${duration}`,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          out,
        ]),
    });
    const q = await s.estimate(p.id, { clipId: "c", audioId: "voice" });
    assert.ok(Math.abs(q.amount - 0.16) < 1e-9);
    await s.submit(p.id, {
      clipId: "c",
      audioId: "voice",
      quoteId: q.id,
      revision,
      requestId: "recover-speakers",
    });
    await s.tick();
    await s.tick();
    const failedJob = s.list(p.id)[0];
    assert.equal(failedJob.state, "failed");
    assert.equal(failedJob.parts[0].state, "ready");
    s.recover(p.id, failedJob.id, {});
    await s.tick();
    await s.tick();
    const done = s.list(p.id)[0];
    assert.equal(done.state, "ready", done.error);
    // Original blue picture is retained in the silence between red speaking results.
    for (const [time, dominant] of [
      [0.4, 0],
      [0.9, 2],
      [1.4, 0],
      [1.9, 2],
    ]) {
      const pixel = path.join(folder, `pixel-${time}.rgb`);
      await run([
        "-ss",
        String(time),
        "-i",
        done.media.path,
        "-frames:v",
        "1",
        "-vf",
        "scale=1:1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        pixel,
      ]);
      const rgb = await fs.readFile(pixel);
      assert.ok(
        rgb[dominant] > 200,
        `Original/speaking boundary at ${time}s: ${rgb}`,
      );
    }
    assert.equal(submissions, 2);
    assert.deepEqual(polls, ["request-1", "request-2", "request-2"]);
    assert.equal(lipSyncCosts(done).status, "estimated");
  }));

test("restart during speaker submission blocks duplicate spending until the request ID is recovered", () =>
  sandbox(async ({ folder, store, p, revision, service }) => {
    let s = service();
    const q = await s.estimate(p.id, { clipId: "c", audioId: "voice" });
    const job = await s.submit(p.id, {
      clipId: "c",
      audioId: "voice",
      quoteId: q.id,
      revision,
      requestId: "uncertain-line",
    });
    s.close();
    job.executionMode = "live";
    job.state = "processing";
    job.parts = job.input.segments.map((part, i) => ({
      ...part,
      model: TARGETED_LIP_MODEL,
      state: i === 0 ? "submitting" : "queued",
    }));
    store.db
      .prepare("UPDATE lip_sync_jobs SET state=?,body=? WHERE id=?")
      .run(job.state, JSON.stringify(job), job.id);
    await saveStudioMode(folder, "live");
    let calls = 0;
    s = service({
      adapterFactory: async () => {
        calls++;
        throw Error("Must not contact provider");
      },
    });
    await s.tick();
    assert.equal(s.list(p.id)[0].state, "submission_uncertain");
    assert.equal(lipSyncCosts(s.list(p.id)[0]).amount, null);
    assert.throws(() => s.recover(p.id, job.id, {}), /request ID/);
    await s.tick();
    assert.equal(calls, 0);
    const recovered = s.recover(p.id, job.id, {
      providerJobId: "saved-request-123",
    });
    assert.equal(recovered.parts[0].providerJobId, "saved-request-123");
    assert.equal(recovered.parts[1].state, "queued");
  }));


test("reused character face sends a cropped base64 image from outside the current spoken line", () =>
  sandbox(async ({ folder, store, p }) => {
    const input = lipSyncInput(p, "c", "voice");
    const segment = { ...input.segments[1], face: {
      point: [.25, .4], time: .2, reusable: true,
      box: {x: .1, y: .1, w: .3, h: .6},
    }};
    const result = await prepareSpeaker(input, segment, path.join(folder, "reused"), store, prepareLipSync);
    const options = result.input.options.active_speaker_detection;
    assert.equal(options.auto_detect, false);
    assert.equal(options.coordinates, undefined);
    assert.equal(options.frame_number, undefined);
    const bytes = Buffer.from(options.face_image, "base64");
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    const raw = path.join(folder, "face.rgb");
    await run(["-i", path.join(folder, "reused", "speaker.jpg"), "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", raw]);
    assert.equal((await fs.stat(raw)).size, 256 * 288 * 3);
    assert.ok(Math.abs((await probe(result.picture)).duration - segment.duration) < .05);
  }));
