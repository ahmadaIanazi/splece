import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run, renderEpisode, probe } from "../server/media.mjs";
test("A33 independent audio survives a trimmed portrait export with fades and trailing audio", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-audio-"));
  try {
    const video = path.join(root, "video.mp4"),
      audio = path.join(root, "tone.wav"),
      out = path.join(root, "episode.mp4");
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=24",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    await run([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "4",
      audio,
    ]);
    await renderEpisode(
      [{ id: "clip", start: 0, in: 1, duration: 2, volume: 1 }],
      () => ({ path: video, duration: 3, audio: false }),
      path.join(root, "cache"),
      out,
      { aspect: "9:16", resolution: "480p", fps: 24 },
      [
        {
          mediaId: "audio",
          start: 0.5,
          in: 0.5,
          duration: 3,
          volume: 0.5,
          fadeIn: 0.25,
          fadeOut: 0.5,
        },
      ],
      () => ({ path: audio, duration: 4, audio: true }),
    );
    const info = await probe(out);
    assert.ok(info.audio);
    assert.ok(Math.abs(info.duration - 3.5) < 0.15);
    const log = await run([
      "-i",
      out,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]);
    assert.match(log, /480x854/);
    assert.ok(
      Number(log.match(/mean_volume: (-?[\d.]+)/)?.[1]) > -60,
      "mixed audio must be audible",
    );
    assert.equal(
      (await fs.readdir(root)).some((f) => f.includes("partial")),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
