import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run, probe } from "../server/media.mjs";
import {
  waveform,
  mixArguments,
  validateAudio,
  audioPlayback,
} from "../server/audio.mjs";
import { audioClip, splitAudio } from "../shared/audio-editing.mjs";
test("real waveforms preserve silence/stereo, share analysis, and mixes preserve trimmed fades", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "splece-audio-"));
  try {
    const source = path.join(root, "test.wav");
    // Opposite polarity channels must not cancel the waveform or level measurement.
    await run([
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(lt(t\\,1)\\,0\\,0.2*sin(2*PI*440*t))|if(lt(t\\,1)\\,0\\,-0.2*sin(2*PI*440*t)):s=48000:d=4",
      source,
    ]);
    const media = {
      id: "tone",
      path: source,
      original: source,
      audio: true,
      duration: 4,
    };
    const [wave, concurrent] = await Promise.all([
      waveform(media, path.join(root, "cache")),
      waveform(media, path.join(root, "cache")),
    ]);
    assert.deepEqual(wave, concurrent);
    assert.ok(wave.peaks.slice(0, 80).every((v) => v === 0));
    assert.ok(Math.max(...wave.peaks) > 0.19);
    assert.ok(wave.rms[200] > 0.13);
    assert.equal((await fs.readdir(path.join(root, "cache"))).length, 1);
    const clip = audioClip(media, "clip");
    clip.in = 1;
    clip.duration = 3;
    clip.fadeIn = 1;
    clip.fadeOut = 1;
    const whole = path.join(root, "whole.wav"),
      split = path.join(root, "split.wav");
    await run([
      ...mixArguments([clip], () => media),
      "-c:a",
      "pcm_s24le",
      whole,
    ]);
    const p = { audioClips: [structuredClone(clip)] };
    splitAudio(p, "clip", 0.4, "right");
    await run([
      ...mixArguments(p.audioClips, () => media),
      "-c:a",
      "pcm_s24le",
      split,
    ]);
    const wholeWave = await waveform(
      { ...media, path: whole, original: whole, duration: 3 },
      path.join(root, "cache"),
    );
    const splitWave = await waveform(
      { ...media, path: split, original: split, duration: 3 },
      path.join(root, "cache"),
    );
    for (let i = 0; i < wholeWave.rms.length; i++)
      assert.ok(
        Math.abs(wholeWave.rms[i] - splitWave.rms[i]) < 0.003,
        `split envelope differs at ${i}`,
      );
    assert.ok(wholeWave.rms[10] < wholeWave.rms[140] / 3);
    assert.ok(wholeWave.rms[290] < wholeWave.rms[140] / 3);
    assert.ok(Math.abs((await probe(split)).duration - 3) < 0.05);
    const video = path.join(root, "with-picture.mp4");
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=12:d=4",
      "-i",
      source,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      video,
    ]);
    const videoMedia = {
      ...media,
      path: video,
      original: video,
      kind: "video",
    };
    const [audioOne, audioTwo] = await Promise.all([
      audioPlayback(videoMedia, path.join(root, "cache")),
      audioPlayback(videoMedia, path.join(root, "cache")),
    ]);
    assert.equal(audioOne, audioTwo);
    assert.equal(
      await audioPlayback(
        { ...videoMedia, kind: "audio" },
        path.join(root, "cache"),
      ),
      audioOne,
      "legacy blank-video audio imports get the same lightweight stream",
    );
    const playbackInfo = await probe(audioOne);
    assert.ok(playbackInfo.audio);
    assert.equal(playbackInfo.video, false);
    assert.ok(Math.abs(playbackInfo.duration - 4) < 0.05);
    assert.throws(
      () => validateAudio([{ ...clip, in: 3, duration: 3 }], () => media),
      /exceeds/,
    );
    assert.throws(
      () => validateAudio([{ ...clip, volume: "1;evil" }]),
      /Invalid/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
