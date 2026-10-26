import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  lipSyncInput,
  lipSyncSignature,
  LIP_SYNC_MODEL,
} from "../shared/lip-sync.mjs";
import { FalSoundtrackAdapter } from "./adapters/fal-soundtrack.mjs";
import { credentials } from "./connections.mjs";
import { studioMode } from "./mode.mjs";
import { run, probe, thumbnail } from "./media.mjs";
import { downloadVideo, writeVideoResponse } from "./video.mjs";
import { stepSpeakers } from "./speaker-sync.mjs";
import { SPEAKER_FPS } from "../shared/face-assignment.mjs";
import { uploadFalMedia } from "./adapters/fal-storage.mjs";

export async function prepareLipSync(input, folder, store) {
  const video = store.media(input.source.mediaId),
    audio = store.media(input.audioMediaId);
  await fs.mkdir(folder, { recursive: true });
  const picture = path.join(folder, "picture.mp4"),
    voice = path.join(folder, "voice.wav");
  await run([
    "-threads",
    "1",
    "-filter_threads",
    "1",
    "-ss",
    String(input.source.in),
    "-i",
    video.path,
    "-t",
    String(input.duration),
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    `scale=w='min(1280,iw)':h=-2,setsar=1,fps=${SPEAKER_FPS}`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    picture,
  ]);
  await run([
    "-threads",
    "1",
    "-ss",
    String(input.audioIn),
    "-i",
    audio.path,
    "-t",
    String(input.duration),
    "-map",
    "0:a:0",
    "-af",
    "apad",
    "-ar",
    "24000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    voice,
  ]);
  if ((await fs.stat(picture)).size > 24 * 1024 * 1024)
    throw Error(
      "This shot is too large for lip-sync. Use a shorter selection.",
    );
  return {
    picture,
    voice,
    input: {
      model: "lipsync-2",
      sync_mode: "silence",
      enable_safety_checker: true,
    },
  };
}
export async function saveLipSync(url, output, duration) {
  const received = output + ".received.mp4";
  try {
    await writeVideoResponse(
      await downloadVideo(url, undefined, "fal"),
      received,
    );
    const info = await probe(received);
    if (!info.video || Math.abs(info.duration - duration) > 0.2)
      throw Error(
        "Lip-sync returned an incompatible duration. Original picture was kept.",
      );
    await run([
      "-i",
      received,
      "-map",
      "0:v:0",
      "-an",
      "-t",
      String(duration),
      "-c:v",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ]);
  } finally {
    await fs.rm(received, { force: true });
  }
}
export function createLipSyncService({
  store,
  data,
  adapterFactory = async () =>
    new FalSoundtrackAdapter({
      key: await credentials(data, "fal").key(),
      allowSubmit: async () => (await studioMode(data)) === "live",
    }),
  prepare = prepareLipSync,
  upload = uploadFalMedia,
  download = saveLipSync,
}) {
  const db = store.db,
    quotes = new Map();
  let busy = false,
    closed = false;
  db.exec(
    "CREATE TABLE IF NOT EXISTS lip_sync_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL)",
  );
  const save = (j) =>
    db
      .prepare("INSERT OR REPLACE INTO lip_sync_jobs VALUES(?,?,?,?)")
      .run(j.id, j.projectId, j.state, JSON.stringify(j));
  const list = (id) =>
    db
      .prepare(
        "SELECT body FROM lip_sync_jobs WHERE projectId=? ORDER BY rowid DESC",
      )
      .all(id)
      .map((r) => JSON.parse(r.body));
  function context(id, body) {
    const record = store.get(id);
    if (!record) throw Error("Project not found.");
    const input = lipSyncInput(record.project, body.clipId, body.audioId);
    for (const [id, offset] of [
      [input.source.mediaId, input.source.in],
      [input.audioMediaId, input.audioIn],
    ]) {
      const media = store.media(id);
      if (
        !media ||
        media.projectId !== record.project.id ||
        offset < 0 ||
        offset + input.duration > media.duration + 0.1
      )
        throw Error(
          "Source footage or voice-over is unavailable for this range.",
        );
    }
    return { record, input, signature: lipSyncSignature(input) };
  }
  async function estimate(id, body) {
    const ctx = context(id, body),
      mode = (await studioMode(data)) === "live" ? "live" : "test";
    const rate =
      mode === "live"
        ? await (
            await adapterFactory()
          ).pricing(ctx.input.model || LIP_SYNC_MODEL)
        : null;
    const q = {
      id: randomUUID(),
      projectId: id,
      signature: ctx.signature,
      mode,
      amount: rate
        ? rate.rate *
          (ctx.input.segments?.reduce((n, s) => n + s.duration, 0) ??
            ctx.input.duration)
        : 0,
      expires: Date.now() + 600000,
    };
    for (const [id, v] of quotes) if (v.expires < Date.now()) quotes.delete(id);
    if (quotes.size > 100) quotes.delete(quotes.keys().next().value);
    quotes.set(q.id, q);
    return q;
  }
  async function submit(id, body) {
    const mode = (await studioMode(data)) === "live" ? "live" : "test";
    const existing = list(id).find(
      (j) => body.requestId && j.requestId === body.requestId,
    );
    if (existing) return existing;
    const ctx = context(id, body),
      q = quotes.get(body.quoteId);
    if (
      !q ||
      q.projectId !== id ||
      q.signature !== ctx.signature ||
      q.mode !== mode ||
      q.expires < Date.now() ||
      q.used
    )
      throw Error("Review a fresh lip-sync estimate.");
    if (body.revision !== ctx.record.revision)
      throw Error("Save your edit before lip-sync.");
    if (
      list(id).some((j) =>
        ["queued", "processing", "submitting", "downloading"].includes(j.state) && j.input.clipId === ctx.input.clipId,
      )
    )
      throw Error("This clip already has a lip-sync pass running.");
    const job = {
      id: randomUUID(),
      projectId: id,
      episodeId: ctx.input.episodeId,
      input: ctx.input,
      signature: ctx.signature,
      executionMode: mode,
      amount: q.amount,
      requestId: body.requestId,
      model: ctx.input.model || LIP_SYNC_MODEL,
      state: "queued",
      createdAt: Date.now(),
    };
    save(job);
    q.used = true;
    return job;
  }
  async function tick() {
    if (busy || closed) return;
    const row = db
      .prepare(
        "SELECT body FROM lip_sync_jobs WHERE state IN ('queued','processing','submitting','downloading') ORDER BY rowid LIMIT 1",
      )
      .get();
    if (!row) return;
    const job = JSON.parse(row.body);
    busy = true;
    try {
      const record = store.get(job.projectId);
      if (!record || store.removing.has(job.projectId)) {
        job.state = "cancelled";
        save(job);
        return;
      }
      if (job.executionMode === "live" && (await studioMode(data)) !== "live")
        return;
      if (
        !job.input.segments &&
        job.state === "submitting" &&
        !job.providerJobId
      ) {
        job.state = "submission_uncertain";
        job.error =
          "Provider acceptance is unknown. No automatic resubmission; recover the request ID from fal.";
        save(job);
        return;
      }
      const folder = path.join(record.project.folder, "media", "lip-sync"),
        work = path.join(folder, ".work-" + job.id),
        output = path.join(folder, job.id + ".mp4");
      await fs.mkdir(folder, { recursive: true });
      if (job.input.segments) {
        const done = await stepSpeakers({
          job,
          folder,
          output,
          store,
          save,
          adapterFactory,
          prepare,
          upload,
          download,
          liveAllowed: async () =>
            !closed && (await studioMode(data)) === "live",
        });
        if (!done) return;
      } else if (job.executionMode === "test") {
        const media = store.media(job.input.source.mediaId);
        await run([
          "-ss",
          String(job.input.source.in),
          "-i",
          media.path,
          "-t",
          String(job.input.duration),
          "-map",
          "0:v:0",
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          output,
        ]);
      } else {
        const adapter = await adapterFactory();
        if (!job.providerJobId) {
          job.stage = "Preparing picture and voice";
          save(job);
          const prepared = await prepare(job.input, work, store);
          // Recheck mode after media preparation, before any paid call.
          if ((await studioMode(data)) !== "live") return;
          if (prepared.picture && prepared.voice) {
            job.stage = "Uploading picture and voice";
            save(job);
            prepared.input.video_url = await upload(
              adapter,
              prepared.picture,
              "video/mp4",
            );
            prepared.input.audio_url = await upload(
              adapter,
              prepared.voice,
              "audio/wav",
            );
          }
          if ((await studioMode(data)) !== "live") return;
          job.state = "submitting";
          save(job);
          try {
            Object.assign(
              job,
              await adapter.submitSound(prepared.input, LIP_SYNC_MODEL),
            );
          } catch (e) {
            job.state = e.uncertain ? "submission_uncertain" : "failed";
            throw e;
          }
          job.state = "processing";
          job.stage = "Matching lip movement";
          save(job);
          await fs.rm(work, { recursive: true, force: true });
        }
        const result = await adapter.pollSound(job);
        if (result.state !== "ready") {
          job.stage =
            result.state === "queued"
              ? "Queued at fal"
              : "Matching lip movement";
          save(job);
          return;
        }
        job.state = "downloading";
        job.stage = "Saving new take";
        save(job);
        await download(result.downloadUrl, output, job.input.duration);
      }
      const info = await probe(output),
        poster = path.join(folder, job.id + ".jpg");
      await thumbnail(output, poster);
      job.media = {
        ...info,
        id: job.id,
        projectId: job.projectId,
        path: output,
        original: output,
        url: "/api/media/" + job.id,
        thumbnail: "/api/media/" + job.id + "/thumbnail",
        poster,
        name:
          job.executionMode === "test"
            ? "Offline lip-sync preview (unchanged mouths)"
            : "Lip-sync take",
        kind: "video",
        audio: false,
        generated: true,
        duration: job.input.duration,
      };
      store.putMedia(job.media);
      job.state = "ready";
      job.stage = "Review new take";
      job.error = null;
      save(job);
    } catch (e) {
      job.state = job.state === "submission_uncertain" ? job.state : "failed";
      job.error = String(e.message).slice(0, 500);
      job.terminal = !!e.terminal;
      job.stage = job.terminal ? "Input rejected" : "Needs attention";
      save(job);
    } finally {
      busy = false;
    }
  }
  function recover(id, jobId, body) {
    const job = list(id).find((j) => j.id === jobId);
    if (!job) throw Error("Lip-sync job missing.");
    if (!["failed", "submission_uncertain"].includes(job.state))
      throw Error("This job is not waiting for recovery.");
    const part = job.parts?.find((p) => p.state !== "ready");
    if (part) {
      if (part.terminal)
        throw Error(
          "This line was rejected. Correct the input and create a new pass. Completed results remain saved.",
        );
      if (body.providerJobId && !part.providerJobId) {
        if (!/^[\w-]{8,200}$/.test(body.providerJobId))
          throw Error("Invalid request ID.");
        part.providerJobId = body.providerJobId;
      }
      if (job.executionMode === "live" && !part.providerJobId)
        throw Error("Recover the request ID for this line before continuing.");
      part.state = part.providerJobId ? "processing" : "queued";
      delete part.error;
      job.state = "processing";
      job.error = null;
      save(job);
      return job;
    }
    if (
      job.terminal ||
      /fal.ai \((400|401|402|403|404|422)\)/.test(job.error || "")
    )
      throw Error(
        "This request was rejected. Correct the input and review a new estimate.",
      );
    if (body.providerJobId && !job.providerJobId) {
      if (!/^[\w-]{8,200}$/.test(body.providerJobId))
        throw Error("Invalid request ID.");
      job.providerJobId = body.providerJobId;
    }
    if (!job.providerJobId)
      throw Error(
        "No accepted request is known. Review a new estimate instead.",
      );
    job.state = "processing";
    job.error = null;
    save(job);
    return job;
  }
  const timer = setInterval(() => tick().catch(() => {}), 3000);
  timer.unref();
  return {
    list,
    estimate,
    submit,
    tick,
    recover,
    ack(id, jobId) {
      const job = list(id).find((j) => j.id === jobId);
      if (job?.state === "ready") {
        job.delivered = true;
        save(job);
      }
      return { ok: true };
    },
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
export function installLipSyncRoutes(app, service) {
  app.post("/api/projects/:id/lip-sync/:job/ack", (req, res) =>
    res.json(service.ack(req.params.id, req.params.job)),
  );
  app.get("/api/projects/:id/lip-sync", (req, res) =>
    res.json(service.list(req.params.id)),
  );
  app.post("/api/projects/:id/lip-sync/estimate", async (req, res) =>
    res.json(await service.estimate(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/lip-sync", async (req, res) =>
    res.json(await service.submit(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/lip-sync/:job/recover", (req, res) =>
    res.json(service.recover(req.params.id, req.params.job, req.body)),
  );
}
