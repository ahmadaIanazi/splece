import { existsSync } from "node:fs";
import { renderAsync } from "@resvg/resvg-js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import ffmpeg from "./ffmpeg-path.mjs";
import {
  elementFonts,
  elementsSVG,
  validateElements,
  normalizeMediaTransform,
} from "../shared/elements.mjs";
const fontFiles = elementFonts.map((f) =>
  fileURLToPath(
    new URL(
      (existsSync(
        fileURLToPath(new URL("../public/fonts/" + f.file, import.meta.url)),
      )
        ? "../public/fonts/"
        : "../dist/fonts/") + f.file,
      import.meta.url,
    ),
  ),
);
// A bounded, sequential stream: only the current SVG/PNG is retained. Rasterization
// runs off the HTTP event loop so editing and saves remain responsive during export.
export async function renderElementOverlay(
  input,
  output,
  elements,
  width,
  height,
  fps,
  duration,
) {
  validateElements(elements);
  const child = spawn(
    ffmpeg,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      input,
      "-f",
      "image2pipe",
      "-framerate",
      String(fps),
      "-i",
      "pipe:0",
      "-filter_complex",
      "[0:v][1:v]overlay=0:0:shortest=1:format=auto,format=yuv420p[v]",
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "copy",
      "-t",
      String(duration),
      "-movflags",
      "+faststart",
      output,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "",
    pipeError = null;
  child.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-4000);
  });
  child.stdin.on("error", (err) => {
    pipeError = err;
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(Error(stderr || "Element export failed")),
    );
  });
  // Attach immediately: an encoder failure must never become an unhandled rejection.
  done.catch(() => {});
  let previous = "",
    png;
  try {
    for (let frame = 0; frame < Math.ceil(duration * fps); frame++) {
      if (pipeError || child.exitCode !== null)
        throw pipeError || Error(stderr || "Element encoder stopped");
      const svg = elementsSVG(elements, frame / fps, width, height);
      if (svg !== previous) {
        png = (
          await renderAsync(svg, {
            font: {
              fontFiles,
              loadSystemFonts: false,
              defaultFontFamily: "Noto Sans",
            },
          })
        ).asPng();
        previous = svg;
      }
      if (!child.stdin.write(png))
        await Promise.race([
          once(child.stdin, "drain"),
          done.then(() => {
            throw Error("Element encoder closed early");
          }),
        ]);
    }
    child.stdin.end();
    await done;
  } catch (error) {
    child.stdin.destroy();
    child.kill();
    await done.catch(() => {});
    throw error;
  }
}
export function mediaTransformFilter(visual, width, height, fps) {
  const p = normalizeMediaTransform(visual),
    w = Math.max(2, Math.round((p.w * width) / 2) * 2),
    h = Math.max(2, Math.round((p.h * height) / 2) * 2),
    angle = (p.rotation * Math.PI) / 180;
  const fit =
    p.fit === "cover"
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
  return `[0:v]format=rgba,${fit},setsar=1,colorchannelmixer=aa=${p.opacity},rotate=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=none[fg];color=c=black:s=${width}x${height}:r=${fps}[bg];[bg][fg]overlay=x=${p.x * width}-overlay_w/2:y=${p.y * height}-overlay_h/2:shortest=1,fps=${fps},format=yuv420p[visual]`;
}
