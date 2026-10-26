import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import ffmpeg from "./ffmpeg-path.mjs";
import { audioEnvelope } from "../shared/audio-editing.mjs";

export const audioPath = (media) => media.original || media.path;
// Keep analysis bounded in memory and serialize CPU work, including duplicate requests.
const pending = new Map();
let queue = Promise.resolve();
export async function audioPlayback(media, cache) {
  if (!media.audio) throw new Error("This file has no audio.");
  if (media.kind === "audio" && !/\.mp4$/i.test(media.path)) return media.path;
  const source = media.path,
    stat = await fs.stat(source);
  const key = createHash("sha256")
    .update([source, stat.size, stat.mtimeMs, "audio-v1"].join("|"))
    .digest("hex");
  const output = path.join(cache, key + ".m4a");
  try {
    await fs.access(output);
    return output;
  } catch {}
  if (!pending.has(key)) {
    const task = queue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(cache, { recursive: true });
        try {
          await new Promise((resolve, reject) => {
            const child = spawn(
              ffmpeg,
              [
                "-v",
                "error",
                "-y",
                "-threads",
                "1",
                "-i",
                source,
                "-map",
                "0:a:0",
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-movflags",
                "+faststart",
                output + ".partial.m4a",
              ],
              { stdio: ["ignore", "ignore", "pipe"] },
            );
            let error = "";
            const timer = setTimeout(() => {
              error = "Preparing audio took too long. Try a shorter file.";
              child.kill();
            }, 600000);
            child.stderr.on("data", (b) => {
              error = (error + b).slice(-2000);
            });
            child.on("error", (e) => {
              clearTimeout(timer);
              reject(e);
            });
            child.on("close", (code) => {
              clearTimeout(timer);
              code === 0
                ? resolve()
                : reject(new Error(error || "Could not prepare audio."));
            });
          });
          await fs.rename(output + ".partial.m4a", output);
          return output;
        } finally {
          await fs.rm(output + ".partial.m4a", { force: true });
        }
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    queue = task;
  }
  return pending.get(key);
}
export async function waveform(media, cache, remember = async () => {}) {
  if (!media.audio) throw new Error("This file has no audio.");
  const source = audioPath(media),
    stat = await fs.stat(source);
  const key = createHash("sha256")
    .update([source, stat.size, stat.mtimeMs, "wave-v1"].join("|"))
    .digest("hex");
  const file = path.join(cache, key + ".json");
  try {
    const result = JSON.parse(await fs.readFile(file, "utf8"));
    await remember(file);
    return result;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!pending.has(key)) {
    const task = queue
      .catch(() => {})
      .then(async () => {
        const result = await decodeWaveform(source, media.duration);
        await fs.mkdir(cache, { recursive: true });
        await fs.writeFile(file + ".tmp", JSON.stringify(result));
        await fs.rename(file + ".tmp", file);
        return result;
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    queue = task;
  }
  const result = await pending.get(key);
  await remember(file);
  return result;
}
function decodeWaveform(source, duration) {
  return new Promise((resolve, reject) => {
    const count = Math.min(24000, Math.max(256, Math.ceil(duration * 100)));
    const step = duration / count;
    const peaks = new Float32Array(count),
      squares = new Float64Array(count),
      samples = new Uint32Array(count);
    const child = spawn(
      ffmpeg,
      [
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        source,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "2",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let carry = Buffer.alloc(0),
      frame = 0,
      error = "";
    const timer = setTimeout(() => {
      error = "Audio analysis timed out. Try a shorter file.";
      child.kill();
    }, 600000);
    child.stderr.on("data", (b) => {
      error = (error + b).slice(-2000);
    });
    child.stdout.on("data", (data) => {
      const bytes = Buffer.concat([carry, data]),
        end = bytes.length - (bytes.length % 8);
      for (let i = 0; i < end; i += 8, frame++) {
        const index = Math.min(count - 1, Math.floor(frame / 8000 / step));
        const left = bytes.readFloatLE(i),
          right = bytes.readFloatLE(i + 4);
        peaks[index] = Math.max(peaks[index], Math.abs(left), Math.abs(right));
        squares[index] += (left * left + right * right) / 2;
        samples[index]++;
      }
      carry = Buffer.from(bytes.subarray(end));
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error(error || "Could not read audio."));
      resolve({
        duration,
        step,
        peaks: Array.from(peaks, (v) => +v.toFixed(5)),
        rms: Array.from(
          squares,
          (v, i) => +Math.sqrt(v / Math.max(1, samples[i])).toFixed(6),
        ),
      });
    });
  });
}
export function validateAudio(clips, mediaFor) {
  if (!Array.isArray(clips) || clips.length > 256)
    throw new Error("Use up to 256 audio clips per episode.");
  for (const c of clips) {
    if (
      c.soundtrack &&
      (!["effect", "ambience", "dialogue"].includes(c.soundtrack.role) ||
        !Array.isArray(c.soundtrack.sources) ||
        !c.soundtrack.sources.length ||
        c.soundtrack.sources.length > 120 ||
        c.soundtrack.sources.some(
          (s) =>
            !s ||
            typeof s.clipId !== "string" ||
            typeof s.mediaId !== "string" ||
            !["start", "in", "duration"].every(
              (k) => Number.isFinite(s[k]) && s[k] >= 0,
            ),
        ))
    )
      throw new Error("Invalid soundtrack source attachment");
    for (const key of [
      "start",
      "in",
      "duration",
      "volume",
      "fadeIn",
      "fadeOut",
      "lane",
    ]) {
      const value = c[key] ?? (key === "volume" ? 1 : 0);
      if (!Number.isFinite(value) || value < 0)
        throw new Error("Invalid audio " + key);
    }
    if (
      c.duration <= 0 ||
      (c.volume ?? 1) > 1 ||
      !Number.isInteger(c.lane || 0) ||
      (c.lane || 0) > 255
    )
      throw new Error("Invalid audio settings");
    if (
      c.envelope &&
      ["in", "duration", "fadeIn", "fadeOut"].some(
        (key) => !Number.isFinite(c.envelope[key]) || c.envelope[key] < 0,
      )
    )
      throw new Error("Invalid audio fade envelope");
    if (mediaFor) {
      const media = mediaFor(c);
      if (!media?.audio) throw new Error("Audio source missing");
      if (c.in + c.duration > media.duration + 0.05)
        throw new Error("Audio trim exceeds source duration");
    }
  }
}
export function audioFilter(c, offset = 0) {
  const env = audioEnvelope(c);
  return (
    `asetpts=PTS-STARTPTS,volume=${c.mute ? 0 : (c.volume ?? 1)}` +
    (env.fadeIn ? `,afade=t=in:st=${env.in}:d=${env.fadeIn}` : "") +
    (env.fadeOut
      ? `,afade=t=out:st=${Math.max(0, env.in + env.duration - env.fadeOut)}:d=${env.fadeOut}`
      : "") +
    `,atrim=start=${c.in}:duration=${c.duration},asetpts=PTS-STARTPTS,adelay=${Math.round(Math.max(0, c.start - offset) * 1000)}:all=1`
  );
}
export function mixArguments(clips, mediaFor, offset = 0) {
  validateAudio(clips, mediaFor);
  const args = [],
    filters = [],
    labels = [];
  clips.forEach((c, i) => {
    args.push("-threads", "1", "-i", audioPath(mediaFor(c)));
    filters.push(`[${i}:a]${audioFilter(c, offset)}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  filters.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.98:level=false:latency=true[mixed]`,
  );
  return [
    ...args,
    "-filter_complex_threads",
    "1",
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[mixed]",
    "-t",
    String(Math.max(...clips.map((c) => c.start + c.duration)) - offset),
    "-ar",
    "48000",
    "-ac",
    "2",
  ];
}
