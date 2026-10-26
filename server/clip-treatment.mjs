import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { run, probe, thumbnail } from "./media.mjs";
import {
  treatmentSource,
  treatmentSignature,
} from "../shared/clip-treatment.mjs";
export function installTreatmentRoutes(app, { store, getProject }) {
  app.post("/api/projects/:id/clip-treatment", async (req, res) => {
    const { project, revision } = getProject(req.params.id);
    if (revision !== req.body.revision)
      throw Error("Save your clip edits before processing.");
    const clip = project.clips.find((c) => c.id === req.body.clipId);
    if (!clip) throw Error("Clip not found.");
    const speed = Number(req.body.speed);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4)
      throw Error("Choose a speed from 0.25× to 4×.");
    const source = treatmentSource(clip),
      media = store.media(source.mediaId);
    if (
      !media ||
      source.in < -0.01 ||
      source.in + source.duration > media.duration + 0.1
    )
      throw Error("The source trim is outside the available video.");
    const previous = store
      .jobs(project.id)
      .find(
        (j) =>
          j.kind === "clip-treatment" && j.requestId === req.body.requestId,
      );
    if (previous) return res.json(previous);
    const job = {
      id: randomUUID(),
      projectId: project.id,
      kind: "clip-treatment",
      state: "queued",
      createdAt: Date.now(),
      requestId: req.body.requestId,
      clipId: clip.id,
      sourceSignature: treatmentSignature(clip),
      snapshot: {
        source,
        speed,
        reverse: req.body.reverse === true,
        fps: project.settings.export.fps,
      },
    };
    store.putJob(job);
    res.json(job);
  });
}
export async function renderTreatment(job, store, project) {
  const { source, speed, reverse, fps } = job.snapshot;
  const original = store.media(source.mediaId);
  if (!original) throw Error("Source video missing.");
  const id = randomUUID(),
    folder = path.join(project.folder, "media"),
    scratch = path.join(project.folder, ".cache", "treatment-" + job.id);
  await fs.mkdir(folder, { recursive: true });
  await fs.mkdir(scratch, { recursive: true });
  const out = path.join(folder, id + ".mp4"),
    poster = path.join(folder, id + ".jpg");
  let tempo = speed;
  const filters = [];
  while (tempo > 2) {
    filters.push("atempo=2");
    tempo /= 2;
  }
  while (tempo < 0.5) {
    filters.push("atempo=0.5");
    tempo /= 0.5;
  }
  filters.push("atempo=" + tempo);
  try {
    // Reverse bounded chunks so long footage does not fill memory with decoded frames.
    const chunks = [];
    for (let at = 0; at < source.duration - 1e-6; at += 2)
      chunks.push({ at, duration: Math.min(2, source.duration - at) });
    if (reverse) chunks.reverse();
    const parts = [];
    for (const [i, chunk] of chunks.entries()) {
      const file = path.join(scratch, i + ".mp4");
      parts.push(file);
      await run([
        "-threads",
        "2",
        "-filter_threads",
        "1",
        "-ss",
        String(source.in + chunk.at),
        "-t",
        String(chunk.duration),
        "-i",
        original.path,
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        `${reverse ? "reverse," : ""}setpts=PTS-STARTPTS,fps=${fps || 24},setsar=1`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "2",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        file,
      ]);
    }
    const concat = path.join(scratch, "parts.txt");
    await fs.writeFile(
      concat,
      parts.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n"),
    );
    await run([
      "-threads",
      "2",
      "-filter_threads",
      "1",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concat,
      "-ss",
      String(source.in),
      "-t",
      String(source.duration),
      "-i",
      original.path,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0?",
      "-vf",
      `setpts=(PTS-STARTPTS)/${speed},fps=${fps || 24}`,
      "-af",
      `${reverse ? "areverse," : ""}${filters.join(",")},asetpts=PTS-STARTPTS`,
      "-t",
      String(source.duration / speed),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-threads",
      "2",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      out,
    ]);
    const info = await probe(out);
    await thumbnail(out, poster, 0);
    const media = {
      id,
      projectId: project.id,
      path: out,
      poster,
      kind: "video",
      name: `${original.name} · ${reverse ? "reverse · " : ""}${speed}×`,
      ...info,
      duration: Math.min(info.duration, source.duration / speed),
      audio: info.audio,
      url: "/api/media/" + id,
      thumbnail: "/api/media/" + id + "/thumbnail",
      treatment: { source, speed, reverse },
      sourceMediaId: source.mediaId,
    };
    store.putMedia(media);
    return media;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
