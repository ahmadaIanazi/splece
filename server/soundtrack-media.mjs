import {dialogueTiming} from "../shared/dialogue-timing.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { run, probe } from "./media.mjs";
import { downloadVideo, writeVideoResponse } from "./video.mjs";

// Small silent copies only. Originals, including speed/reverse derivatives, are read-only.
export async function soundtrackVisual(unit, part, folder, store) {
  await fs.mkdir(folder, { recursive: true });
  const begin = unit.start + part.start,
    end = begin + part.duration;
  const files = [];
  for (const source of unit.sources) {
    const from = Math.max(source.start, begin),
      to = Math.min(source.start + source.duration, end);
    if (to <= from) continue;
    const media = store.media(source.mediaId);
    if (!media) throw Error("A soundtrack visual source is missing.");
    const file = path.join(folder, `visual-${files.length}.mp4`);
    await run([
      "-threads",
      "1",
      "-filter_threads",
      "1",
      "-ss",
      String(source.in + from - source.start),
      "-i",
      media.path,
      "-t",
      String(to - from),
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-dn",
      "-vf",
      "scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-map_metadata",
      "-1",
      file,
    ]);
    files.push(file);
  }
  if (!files.length) throw Error("No visible footage in this sound section.");
  const output = path.join(folder, "visual.mp4");
  const inputs = files.flatMap((file) => ["-i", file]);
  const concat =
    files.map((_, i) => `[${i}:v]`).join("") +
    `concat=n=${files.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=1[v]`;
  await run([
    "-threads",
    "1",
    ...inputs,
    "-filter_complex_threads",
    "1",
    "-filter_complex",
    concat,
    "-map",
    "[v]",
    "-t",
    String(part.modelDuration),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    output,
  ]);
  for (const file of files) await fs.rm(file, { force: true });
  const info = await probe(output);
  if (
    !info.video ||
    info.audio ||
    info.codec !== "h264" ||
    info.width !== 640 ||
    info.height !== 360 ||
    Math.abs(info.duration - part.modelDuration) > 0.1
  )
    throw Error(
      "The prepared sound video failed its local media check. Nothing was uploaded.",
    );
  const size = (await fs.stat(output)).size;
  if (size > 16 * 1024 * 1024)
    throw Error("Soundtrack preview exceeds 16 MB. Use a shorter selection.");
  return (
    "data:video/mp4;base64," + (await fs.readFile(output)).toString("base64")
  );
}
export async function soundtrackDownload(url, output, duration) {
  const video = output + ".mp4",
    temp = output + ".partial.wav";
  try {
    await writeVideoResponse(await downloadVideo(url, undefined, "fal"), video);
    const info = await probe(video);
    if (!info.audio || info.duration < duration - 0.15)
      throw Error(
        "fal returned missing or truncated audio. Retry retrieval; no new generation will be submitted.",
      );
    await run([
      "-threads",
      "1",
      "-i",
      video,
      "-vn",
      "-map",
      "0:a:0",
      "-af",
      "apad",
      "-t",
      String(duration),
      "-ar",
      "24000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      temp,
    ]);
    await fs.rename(temp, output);
  } finally {
    await fs.rm(video, { force: true });
    await fs.rm(temp, { force: true });
  }
}
export async function joinSoundtrack(parts, files, output, duration, role = "effect") {
  const filters = parts.map((_, i) => `[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);
  let previous = "a0";
  for (let i = 1; i < parts.length; i++) {
    const next = `mix${i}`;
    filters.push(
      `[${previous}][a${i}]${parts[i].overlap ? `acrossfade=d=${parts[i].overlap}:c1=tri:c2=tri` : "concat=n=2:v=0:a=1"}[${next}]`,
    );
    previous = next;
  }
  filters.push(`[${previous}]apad,atrim=duration=${duration},loudnorm=I=${role === "ambience" ? -30 : -23}:TP=-3:LRA=11[leveled]`);
  const temp = output + ".partial.wav";
  try {
    await run([
      "-threads",
      "1",
      ...files.flatMap((file) => ["-i", file]),
      "-filter_complex_threads",
      "1",
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[leveled]",
      "-t",
      String(duration),
      "-c:a",
      "pcm_s16le",
      temp,
    ]);
    const info = await probe(temp);
    if (Math.abs(info.duration - duration) > 0.1)
      throw Error("Soundtrack length did not match the edit.");
    await fs.rename(temp, output);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

// Speech is never cropped or sped up to force a fit. Keep the full performance.
export async function dialogueDownload(url, output) {
  const source = output + ".speech",
    temp = output + ".partial.wav";
  try {
    await writeVideoResponse(
      await downloadVideo(url, undefined, "fal"),
      source,
    );
    const info = await probe(source);
    if (!info.audio || !(info.duration > 0) || info.duration > 600)
      throw Error("Speech response has invalid audio or duration.");
    await run([
      "-threads",
      "1",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-ar",
      "24000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      temp,
    ]);
    await fs.rename(temp, output);
    return info.duration;
  } finally {
    await fs.rm(source, { force: true });
    await fs.rm(temp, { force: true });
  }
}
export async function joinDialogue(parts, files, output, duration, options = {}) {
  const timing = dialogueTiming(parts,duration,options.maxTempo ?? 1);
  let end = 0;
  const filters = parts.map((p, i) => {
    const at = timing[i].start;
    p.actualStart = at;
    p.actualDuration = timing[i].duration;
    p.tempo = timing[i].speed;
    end = at + timing[i].duration + 0.12;
    return `[${i}:a]atempo=${timing[i].speed},asetpts=PTS-STARTPTS,adelay=${Math.round(at * 1000)}:all=1[a${i}]`;
  });
  const length = Math.max(duration, end - 0.12);
  filters.push(
    parts.map((_, i) => `[a${i}]`).join("") +
      `amix=inputs=${parts.length}:normalize=0,apad[out]`,
  );
  const temp = output + ".partial.wav";
  try {
    await run([
      "-threads",
      "1",
      ...files.flatMap((file) => ["-i", file]),
      "-filter_complex_threads",
      "1",
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-t",
      String(length),
      "-c:a",
      "pcm_s16le",
      temp,
    ]);
    await fs.rename(temp, output);
    return length;
  } finally {
    await fs.rm(temp, { force: true });
  }
}
