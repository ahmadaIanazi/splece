import {renderAnimatedMedia} from "./media-animation.mjs";
import {renderElementOverlay,mediaTransformFilter} from "./elements.mjs";
import {validateElements} from "../shared/elements.mjs";
import { audioPath, audioFilter, validateAudio } from "./audio.mjs";
import { exportSize } from "../shared/studio.mjs";
import ffmpeg from "./ffmpeg-path.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
export function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ["-hide_banner", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let log = "";
    p.stderr.on("data", (b) => {
      log = (log + b).slice(-12000);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(log)
        : reject(Object.assign(new Error(log.slice(-1800)), { log })),
    );
  });
}
export async function probe(file) {
  try {
    await run(["-i", file]);
  } catch (e) {
    const log = e.log || e.message;
    const t = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const video =
      log.split("\n").find((line) => /Stream.*Video:/.test(line)) || "";
    const dimensions = video.match(/\b(\d{2,5})x(\d{2,5})\b/);
    const rate = video.match(/([\d.]+) fps/);
    if (t)
      return {
        duration: +t[1] * 3600 + +t[2] * 60 + +t[3],
        audio: log.includes("Audio:"),
        video: log.includes("Video:"),
        ...(dimensions
          ? { width: +dimensions[1], height: +dimensions[2] }
          : {}),
        ...(rate ? { fps: +rate[1] } : {}),
        ...(video ? { codec: video.match(/Video: ([^ ,]+)/)?.[1] } : {}),
      };
  }
  throw new Error("Unsupported or unreadable media");
}
export async function thumbnail(file, out, time = 0) {
  await run([
    "-threads",
    "1",
    "-filter_threads",
    "1",
    "-ss",
    String(Math.max(0, time)),
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    "scale=480:-2",
    "-threads",
    "1",
    out,
  ]);
}

export const PLAYBACK_PROFILE_VERSION = 3;
export function playbackFrameRate(info) {
  const fps = Math.max(1, Math.min(60, info.fps || 30));
  for (const [value, expression] of [
    [24000 / 1001, "24000/1001"],
    [30000 / 1001, "30000/1001"],
    [60000 / 1001, "60000/1001"],
  ]) {
    if (Math.abs(fps - value) < 0.015) return { fps: value, expression };
  }
  return { fps: Math.round(fps), expression: String(Math.round(fps)) };
}

let playbackQueue = Promise.resolve();
export function preparePlayback(source, out) {
  // Imports from several tabs must not start a separate all-core encoder each.
  const task = playbackQueue
    .catch(() => {})
    .then(async () => {
      const input = await probe(source);
      if (!input.video) throw Error("Choose a video to optimize for playback.");
      const rate = playbackFrameRate(input);
      const partial = out + ".partial.mp4";
      try {
        await run([
          "-threads",
          "2",
          "-filter_threads",
          "1",
          "-fflags",
          "+genpts",
          "-i",
          source,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-sn",
          "-dn",
          "-vf",
          // Respect display aspect (including anamorphic pixels) and autorotation.
          // Cap either orientation at 1280, without padding, cropping or upscaling.
          "scale=w='max(2,trunc(iw*sar*min(1,min(1280/(iw*sar),1280/ih))/2)*2)':h='max(2,trunc(ih*min(1,min(1280/(iw*sar),1280/ih))/2)*2)',setsar=1,fps=fps=" +
            rate.expression +
            ":start_time=0",
          "-fps_mode",
          "cfr",
          "-pix_fmt",
          "yuv420p",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "21",
          "-threads",
          "2",
          "-g",
          String(Math.ceil(rate.fps)),
          "-bf",
          "0",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-af",
          "aresample=async=1:first_pts=0,apad",
          "-shortest",
          // Bound padded audio to the source duration across FFmpeg platform builds.
          "-t",
          String(input.duration),
          "-map_metadata",
          "-1",
          "-movflags",
          "+faststart",
          partial,
        ]);
        const info = await probe(partial);
        if (!info.video || !(info.duration > 0))
          throw Error("The playback copy could not be verified.");
        await fs.rename(partial, out);
        return {
          ...info,
          playback: {
            version: PLAYBACK_PROFILE_VERSION,
            fps: rate.fps,
            width: info.width,
            height: info.height,
          },
        };
      } finally {
        await fs.rm(partial, { force: true });
      }
    });
  playbackQueue = task;
  return task;
}
export async function renderDemo(source, out, settings, offset = 0) {
  const short = Number.parseInt(settings.resolution || "480"),
    long = Math.round((short * 16) / 9 / 2) * 2;
  const [w, h] =
    settings.aspect === "9:16"
      ? [short, long]
      : settings.aspect === "1:1"
        ? [short, short]
        : [long, short];
  await run([
    "-ss",
    String(offset),
    "-stream_loop",
    "-1",
    "-i",
    source,
    "-t",
    String(settings.duration),
    "-vf",
    `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ]);
}
export async function renderEpisode(
  clips,
  mediaFor,
  folder,
  out,
  settings = { aspect: "16:9", resolution: "720p", fps: 24 },
  audioClips = [],
  audioFor = () => null,
  elements = [],
) {
  validateElements(elements);
  validateAudio(audioClips, audioFor);
  const [width, height] = exportSize(settings);
  const fps = Number(settings.fps) || 24;
  if (
    ![24, 25, 30, 60].includes(fps) ||
    !["480p", "720p", "1080p"].includes(settings.resolution || "720p")
  )
    throw new Error("Unsupported export profile");
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  if (!ordered.length && !elements.length) throw new Error("Add a clip or element before exporting.");
  const segments = [];
  let cursor = 0;
  await fs.mkdir(folder, { recursive: true });
  async function segment(c, index, gap) {
    const file = path.join(folder, `${index}.mp4`);
    const duration = gap || c.duration;
    if(!gap && c.visual?.keyframes?.length){
      await renderAnimatedMedia({clip:c,media:mediaFor(c),output:file,width,height,fps});
      segments.push(file);return;
    }
    const args = gap
      ? [
          "-f",
          "lavfi",
          "-i",
          `color=c=black:s=${width}x${height}:r=${fps}`,
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=48000:cl=stereo",
        ]
      : [
          ...(mediaFor(c).kind === "image" && mediaFor(c).original
            ? ["-loop", "1", "-framerate", String(fps)]
            : ["-ss", String(c.in)]),
          "-i",
          mediaFor(c).original || mediaFor(c).path,
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=48000:cl=stereo",
        ];
    const m = gap ? null : mediaFor(c);
    const volume = c?.mute ? 0 : (c?.volume ?? 1);
    args.push(
      "-t",
      String(duration),
      "-map",
      c?.visual ? "[visual]" : "0:v:0",
      "-map",
      m?.audio ? "0:a:0" : "1:a:0",
      c?.visual ? "-filter_complex" : "-vf",
      c?.visual ? mediaTransformFilter(c.visual,width,height,fps) : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`,
      "-af",
      `volume=${volume}${c?.fadeIn ? ",afade=t=in:st=0:d=" + c.fadeIn : ""}${c?.fadeOut ? ",afade=t=out:st=" + Math.max(0, duration - c.fadeOut) + ":d=" + c.fadeOut : ""}`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-pix_fmt",
      "yuv420p",
      file,
    );
    await run(args);
    segments.push(file);
  }
  for (const c of ordered) {
    if (c.start < cursor - 0.02)
      throw new Error("Clips overlap. Move them apart before exporting.");
    if (c.start > cursor + 0.02)
      await segment(null, segments.length, c.start - cursor);
    const m = mediaFor(c);
    if (!m || (m.kind !== "image" && m.duration < c.in + c.duration - 0.1))
      throw new Error("A selected take is shorter than its timeline range.");
    await segment(c, segments.length);
    cursor = c.start + c.duration;
  }
  const episodeDuration = Math.max(
    cursor,
    ...audioClips.map((c) => c.start + c.duration),
    ...elements.map(e=>e.start+e.duration),
  );
  if (episodeDuration > cursor + 0.02)
    await segment(null, segments.length, episodeDuration - cursor);
  const list = path.join(folder, "concat.txt");
  await fs.writeFile(
    list,
    segments.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n"),
  );
  await run([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    path.join(folder, "base.mp4"),
  ]);
  const base = path.join(folder, "base.mp4"),
    partial = out + ".partial.mp4";
  if (audioClips.length) {
    const args = ["-i", base],
      filters = ["[0:a]anull[base]"],
      labels = ["[base]"];
    audioClips.forEach((c, index) => {
      const m = audioFor(c);
      if (!m?.audio) throw new Error("Audio source missing");
      if (c.in + c.duration > m.duration + 0.05)
        throw new Error("Audio trim exceeds source duration");
      args.push("-i", audioPath(m));
      const label = "mix" + index;
      filters.push(`[${index + 1}:a]${audioFilter(c)}[${label}]`);
      labels.push(`[${label}]`);
    });
    filters.push(
      labels.join("") +
        `amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.98:level=false:latency=true[mixed]`,
    );
    await run([
      ...args,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v:0",
      "-map",
      "[mixed]",
      "-t",
      String(episodeDuration),
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      partial,
    ]);
  } else await fs.copyFile(base, partial);
  if(elements.length){
    const composited=path.join(folder,"elements.mp4");
    await renderElementOverlay(partial,composited,elements,width,height,fps,episodeDuration);
    await fs.rename(composited,partial);
  }
  await probe(partial);
  await fs.rename(partial, out);
  return episodeDuration;
}

export async function providerFrame(file, out, time = 0) {
  if (/\.(png|jpe?g|webp)$/i.test(file)) time = 0;
  await run([
    "-ss",
    String(Math.max(0, time)),
    "-i",
    file,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    out,
  ]);
}
export async function imageDimensions(file) {
  try {
    await run(["-i", file]);
  } catch (e) {
    const match = (e.log || "").match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
    if (match) return { width: +match[1], height: +match[2] };
  }
  throw new Error("Reference image cannot be decoded");
}
