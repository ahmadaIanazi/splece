import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderComparison } from "../server/comparison.mjs";
import { run, probe } from "../server/media.mjs";
import { comparisonChoices } from "../shared/take-comparison.mjs";
test("paired comparison uses one video clock and preserves independently selectable stereo audio", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "splece-compare-"));
  try {
    const sides = [];
    for (const [i, color, freq] of [
      [0, "red", 440],
      [1, "blue", 880],
    ]) {
      const file = path.join(folder, i + ".mp4");
      await run([
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=160x90:r=${i ? 24 : 30}:d=1.5`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${freq}:duration=1.5`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        file,
      ]);
      sides.push({ path: file, in: 0, duration: i ? 1 : 1.5 });
    }
    const output = path.join(folder, "paired.mp4");
    assert.equal((await renderComparison(sides, output)).duration, 1);
    const info = await probe(output);
    assert.equal(info.width, 1280);
    assert.equal(info.duration, 1);
    assert.equal(info.audio, true);
    for (const [channel, expected] of [
      [0, 440],
      [1, 440],
      [2, 880],
      [3, 880],
    ]) {
      const file = path.join(folder, channel + ".f32");
      await run([
        "-i",
        output,
        "-map",
        "0:a",
        "-af",
        `pan=mono|c0=c${channel}`,
        "-ar",
        "48000",
        "-f",
        "f32le",
        file,
      ]);
      const data = await fs.readFile(file);
      let crosses = 0;
      for (let i = 4; i < data.length; i += 4)
        if (data.readFloatLE(i - 4) < 0 && data.readFloatLE(i) >= 0) crosses++;
      const freq = crosses / (data.length / 4 / 48000);
      assert.ok(Math.abs(freq - expected) < 30, `channel ${channel}: ${freq}`);
    }
    assert.equal((await probe(sides[0].path)).duration, 1.5);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
test("comparison choices retain each take trim and associated dialogue voice", () => {
  const p = {
    drafts: [{ targetId: "c", name: "Hello" }],
    audioClips: [{ id: "voice", mediaId: "speech", in: 1 }],
    clips: [
      {
        id: "c",
        activeTake: "b",
        in: 2,
        duration: 3,
        takes: [
          { id: "a", url: "/a", duration: 8 },
          { id: "b", url: "/b", lipSync: { audioId: "voice" } },
        ],
        takeEdits: { a: { in: 1, duration: 5 } },
      },
    ],
  };
  const [a, b] = comparisonChoices(p);
  assert.equal(a.in, 1);
  assert.equal(a.duration, 5);
  assert.equal(b.in, 2);
  assert.equal(b.voice.in, 3);
});
