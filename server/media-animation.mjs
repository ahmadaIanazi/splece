import { spawn } from "node:child_process";
import ffmpeg from "./ffmpeg-path.mjs";
import { renderAsync } from "@resvg/resvg-js";
import {
  mediaFrameSVG,
  validateMediaVisual,
} from "../shared/media-animation.mjs";

// Parse one PNG at a time. Downstream backpressure bounds decoder memory; we never
// collect a clip's frames. Individual PNG chunks are capped before allocating.
async function* pngFrames(stream) {
  let buffer = Buffer.alloc(0),
    parts = [],
    size = 0;
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (!parts.length) {
        if (buffer.length < 8) break;
        if (
          !buffer
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          throw Error("Invalid decoded video frame");
        parts = [buffer.subarray(0, 8)];
        size = 8;
        buffer = buffer.subarray(8);
      }
      if (buffer.length < 8) break;
      const length = buffer.readUInt32BE(0) + 12;
      if (length > 64 * 1024 * 1024 || size + length > 64 * 1024 * 1024)
        throw Error("Decoded frame exceeds memory limit");
      if (buffer.length < length) break;
      const end = buffer.toString("ascii", 4, 8) === "IEND";
      parts.push(buffer.subarray(0, length));
      size += length;
      buffer = buffer.subarray(length);
      if (end) {
        yield Buffer.concat(parts, size);
        parts = [];
        size = 0;
      }
    }
  }
  if (parts.length || buffer.length)
    throw Error("Incomplete decoded video frame");
}
function process(args, stdio) {
  const child = spawn(ffmpeg, ["-y", "-loglevel", "error", ...args], { stdio });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-4000);
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(Error(stderr || "Animated footage export failed")),
    );
  });
  done.catch(() => {});
  return { child, done };
}
export async function renderAnimatedMedia({
  clip,
  media,
  output,
  width,
  height,
  fps,
}) {
  validateMediaVisual(clip.visual);
  const source = media.original || media.path,
    frames = Math.ceil(clip.duration * fps);
  const maxW = Math.max(
    1,
    clip.visual.w || 1,
    ...clip.visual.keyframes.map((k) => k.w || 1),
  );
  const maxH = Math.max(
    1,
    clip.visual.h || 1,
    ...clip.visual.keyframes.map((k) => k.h || 1),
  );
  const image = media.kind === "image" && !!media.original;
  const decoder = process(
    [
      ...(image
        ? ["-loop", "1", "-framerate", String(fps)]
        : ["-ss", String(clip.in || 0)]),
      "-i",
      source,
      "-an",
      "-t",
      String(clip.duration),
      "-vf",
      `fps=${fps},scale=${Math.ceil(width * maxW)}:${Math.ceil(height * maxH)}:force_original_aspect_ratio=decrease,setsar=1`,
      "-frames:v",
      String(frames),
      "-c:v",
      "png",
      "-f",
      "image2pipe",
      "pipe:1",
    ],
    ["ignore", "pipe", "pipe"],
  );
  const volume = clip.mute ? 0 : (clip.volume ?? 1),
    audioFilter = `volume=${volume}${clip.fadeIn ? ",afade=t=in:st=0:d=" + clip.fadeIn : ""}${clip.fadeOut ? ",afade=t=out:st=" + Math.max(0, clip.duration - clip.fadeOut) + ":d=" + clip.fadeOut : ""}`;
  const encoder = process(
    [
      "-f",
      "image2pipe",
      "-framerate",
      String(fps),
      "-i",
      "pipe:0",
      ...(media.audio
        ? ["-ss", String(clip.in || 0), "-i", source]
        : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]),
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-af",
      audioFilter,
      "-t",
      String(clip.duration),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      output,
    ],
    ["pipe", "ignore", "pipe"],
  );
  let pipeError = null;
  encoder.child.stdin.on("error", (e) => {
    pipeError = e;
  });
  let count = 0;
  try {
    for await (const png of pngFrames(decoder.child.stdout)) {
      if (pipeError || encoder.child.exitCode !== null)
        throw pipeError || Error("Footage encoder stopped");
      const svg = mediaFrameSVG(
        clip,
        clip.start + count / fps,
        width,
        height,
        png,
      );
      const frame = (
        await renderAsync(svg, { font: { loadSystemFonts: false } })
      ).asPng();
      await new Promise((resolve, reject) => {
        encoder.child.stdin.write(frame, (error) => error ? reject(error) : resolve());
      });
      count++;
    }
    await decoder.done;
    if (count < frames)
      throw Error("The footage ended before its animated range.");
    encoder.child.stdin.end();
    await encoder.done;
  } catch (error) {
    decoder.child.kill();
    encoder.child.stdin.destroy();
    encoder.child.kill();
    await Promise.allSettled([decoder.done, encoder.done]);
    throw error;
  }
}
