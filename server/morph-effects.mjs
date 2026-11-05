import fs from "node:fs/promises";
import path from "node:path";
import { run, probe, thumbnail } from "./media.mjs";
import { morphDimensions, morphPresets } from "../shared/morph-effects.mjs";

const stamp = (s) => [s.size, s.mtimeMs];
export async function prepareMorphFrames(job, stage) {
  stage.framePaths = [];
  stage.frameSnapshots = [];
  const { width, height } = morphDimensions(job.input.settings);
  for (let i = 0; i < 2; i++) {
    const source = job.frameSources[i],
      frame = job.input.references[i];
    if (
      JSON.stringify(stamp(await fs.stat(source.path))) !==
      JSON.stringify(source.stamp)
    )
      throw Error("A frame source changed. Prepare a fresh transition.");
    const snapshot = path.join(
      job.folder,
      `frame-source-${i}${path.extname(source.path)}`,
    );
    await fs.copyFile(source.path, snapshot);
    if (
      JSON.stringify(stamp(await fs.stat(source.path))) !==
      JSON.stringify(source.stamp)
    )
      throw Error("A frame source changed during snapshot. Prepare again.");
    const output = path.join(job.folder, `frame-${i}.png`);
    await run([
      ...(frame.source.kind === "video" ? ["-ss", String(frame.time)] : []),
      "-i",
      snapshot,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      output,
    ]);
    if ((await fs.stat(output)).size > 20 * 1024 ** 2)
      throw Error("A prepared frame exceeds 20 MB.");
    stage.framePaths.push(output);
    stage.frameSnapshots.push(snapshot);
  }
  // The source used for replacing audio/comparison is independently frozen too.
  if (
    JSON.stringify(stamp(await fs.stat(job.sourcePath))) !==
    JSON.stringify(job.sourceStamp[0])
  )
    throw Error("Replacement source changed. Prepare again.");
  stage.snapshot = path.join(
    job.folder,
    "snapshot" + path.extname(job.sourcePath),
  );
  await fs.copyFile(job.sourcePath, stage.snapshot);
  if (
    JSON.stringify(stamp(await fs.stat(job.sourcePath))) !==
    JSON.stringify(job.sourceStamp[0])
  )
    throw Error("Replacement source changed during snapshot.");
  stage.artifact = path.join(job.folder, "frame-preview.mp4");
  await renderMorphPreview(
    stage.framePaths,
    stage.artifact,
    job.input.settings.duration,
  );
  stage.state = "ready";
}
// A local dissolve motion guide, never represented as an AI-generated morph.
export async function renderMorphPreview(frames, output, duration) {
  await run([
    "-filter_complex_threads", "1",
    "-loop",
    "1",
    "-framerate",
    "24",
    "-t",
    String(duration * .7),
    "-i",
    frames[0],
    "-loop",
    "1",
    "-framerate",
    "24",
    "-t",
    String(duration * .7),
    "-i",
    frames[1],
    "-filter_complex",
    `[0:v]setsar=1,format=yuv420p[a];[1:v]setsar=1,format=yuv420p[b];[a][b]xfade=transition=fade:duration=${duration*.4}:offset=${duration*.3},format=yuv420p[v]`,
    "-map",
    "[v]",
    "-an",
    "-t",
    String(duration),
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
}
export function morphPayload(job, urls) {
  const s = job.input.settings;
  return {
    prompt: job.input.prompt,
    start_image_url: urls[0],
    end_image_url: urls[1],
    duration: s.duration,
    resolution: s.resolution,
    aspect_ratio: s.aspect,
    audio: false,
    enable_prompt_expansion: false,
    enable_safety_checker: true,
  };
}
export async function saveMorphMedia(job, store) {
  const transformed = job.stages[1].artifact,
    info = await probe(transformed),
    settings = job.input.settings;
  const { width, height } = morphDimensions(settings);
  // Provider resolutions can be rounded to codec block sizes.
  if (
    !info.video ||
    Math.abs(info.duration - settings.duration) > 0.2 ||
    Math.abs(info.width - width) > 32 ||
    Math.abs(info.height - height) > 32
  )
    throw Error(
      "Transition duration or framing does not match the request. Original preserved.",
    );
  const replace = job.input.placement === "replace",
    duration = replace ? job.input.source.duration : settings.duration;
  const output = path.join(job.folder, "result.mp4"),
    poster = path.join(job.folder, "poster.jpg");
  const inputs = ["-i", transformed];
  if (replace && job.input.source.kind === "video")
    inputs.push(
      "-ss",
      String(job.input.source.in),
      "-i",
      job.stages[0].snapshot,
    );
  if (replace && job.input.range) {
    const { from, to } = job.input.range,
      offset = from - job.input.source.start,
      length = to - from;
    const w = Math.ceil(job.sourceInfo.width / 2) * 2,
      h = Math.ceil(job.sourceInfo.height / 2) * 2;
    if (job.input.source.kind === "image")
      inputs.push(
        "-loop",
        "1",
        "-t",
        String(duration),
        "-i",
        job.stages[0].snapshot,
      );
    const fit = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p`;
    const filters = [],
      parts = [];
    if (offset > 1e-5) {
      filters.push(
        `[1:v]trim=start=0:end=${offset},setpts=PTS-STARTPTS,${fit}[pre]`,
      );
      parts.push("[pre]");
    }
    filters.push(
      `[0:v]setpts=(PTS-STARTPTS)*${length / info.duration},${fit},tpad=stop_mode=clone:stop_duration=0.1,trim=duration=${length}[mid]`,
    );
    parts.push("[mid]");
    if (offset + length < duration - 1e-5) {
      filters.push(
        `[1:v]trim=start=${offset + length}:end=${duration},setpts=PTS-STARTPTS,${fit}[post]`,
      );
      parts.push("[post]");
    }
    filters.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0[v]`);
    await run([
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[v]",
      ...(job.input.source.kind === "video" ? ["-map", "1:a:0?"] : ["-an"]),
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      output,
    ]);
  } else {
    await run([
      ...inputs,
      "-map",
      "0:v:0",
      ...(replace && job.input.source.kind === "video"
        ? ["-map", "1:a:0?"]
        : ["-an"]),
      "-vf",
      `setpts=(PTS-STARTPTS)*${duration / info.duration},fps=24,tpad=stop_mode=clone:stop_duration=0.1`,
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      output,
    ]);
  }
  const saved = await probe(output);
  await thumbnail(output, poster);
  const name = morphPresets.find((p) => p.id === settings.preset).name;
  const media = {
    ...saved,
    id: job.id,
    projectId: job.projectId,
    kind: "video",
    path: output,
    original: output,
    poster,
    url: "/api/media/" + job.id,
    thumbnail: "/api/media/" + job.id + "/thumbnail",
    duration,
    generated: job.executionMode !== "test",
    name:
      job.executionMode === "test"
        ? `Offline frame preview · ${name}`
        : `${name} · transition`,
    provenance: {
      effectId: job.input.effectId,
      version: job.input.version,
      jobId: job.id,
      source: job.input.source,
      references: job.input.references,
      range: job.input.range,
      settings,
      prompt: job.input.prompt,
      model: job.model,
      executionMode: job.executionMode,
      estimate: job.estimate,
    },
  };
  store.putMedia(media);
  return media;
}
