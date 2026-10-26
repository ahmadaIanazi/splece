import fs from "node:fs/promises";
import path from "node:path";
import { run, probe } from "./media.mjs";
import {
  speakerOptions,
  SPEAKER_FPS,
  TARGETED_LIP_MODEL,
} from "../shared/face-assignment.mjs";

export async function prepareSpeaker(input, segment, folder, store, prepare) {
  const partInput = {
    ...input,
    source: { ...input.source, in: input.source.in + segment.start },
    audioIn: input.audioIn + segment.start,
    duration: segment.duration,
  };
  const result = await prepare(partInput, folder, store);
  const info = await probe(result.picture);
  let options = speakerOptions(segment, info.width, info.height);
  if (segment.face.reusable) {
    // A saved face image follows the character, not a stale position in a later frame.
    const original = store.media(input.source.mediaId);
    const box = segment.face.box;
    const x = Math.max(0, box.x),
      y = Math.max(0, box.y);
    const w = Math.min(1 - x, box.x + box.w - x),
      h = Math.min(1 - y, box.y + box.h - y);
    const faceFile = path.join(folder, "speaker.jpg");
    await run([
      "-ss",
      String(input.source.in + segment.face.time),
      "-i",
      original.path,
      "-frames:v",
      "1",
      "-vf",
      `crop=iw*${w}:ih*${h}:iw*${x}:ih*${y},scale=256:-1`,
      faceFile,
    ]);
    options = {
      active_speaker_detection: {
        auto_detect: false,
        face_image: (await fs.readFile(faceFile)).toString("base64"),
      },
    };
  }
  result.input = {
    sync_mode: "silence",
    enable_safety_checker: true,
    options,
  };
  return result;
}

// Use the original for all unspoken intervals; each result affects its assigned time range only.
export async function assembleSpeakers(input, parts, output, store) {
  const original = store.media(input.source.mediaId);
  const args = [
    "-threads",
    "1",
    "-filter_complex_threads",
    "1",
    "-ss",
    String(input.source.in),
    "-i",
    original.path,
    ...parts.flatMap((p) => ["-i", p.file]),
  ];
  const dimensions = await probe(parts[0].file);
  const filters = [
    `[0:v]scale=${dimensions.width}:${dimensions.height},setsar=1,fps=${SPEAKER_FPS},setpts=PTS-STARTPTS[base]`,
  ];
  parts.forEach((part, i) => {
    filters.push(
      `[${i + 1}:v]scale=${dimensions.width}:${dimensions.height},setsar=1,fps=${SPEAKER_FPS},setpts=PTS-STARTPTS+${part.start}/TB[p${i}]`,
    );
    filters.push(
      `[${i === 0 ? "base" : `v${i - 1}`}][p${i}]overlay=eof_action=pass:enable='gte(t,${part.start})*lt(t,${part.start + part.duration})'[v${i}]`,
    );
  });
  const temporary = output + ".partial.mp4";
  try {
    await run([
      ...args,
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[v${parts.length - 1}]`,
      "-an",
      "-t",
      String(input.duration),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      temporary,
    ]);
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function stepSpeakers({
  job,
  folder,
  output,
  store,
  save,
  adapterFactory,
  prepare,
  upload,
  download,
  liveAllowed,
}) {
  job.parts ??= job.input.segments.map((s) => ({
    ...s,
    model: TARGETED_LIP_MODEL,
    amount:
      (job.amount / job.input.segments.reduce((n, s) => n + s.duration, 0)) *
      s.duration,
    state: "queued",
  }));
  const work = path.join(folder, ".speakers-" + job.id);
  await fs.mkdir(work, { recursive: true });
  const part = job.parts.find((p) => p.state !== "ready");
  if (part) {
    const partFolder = path.join(work, String(part.index));
    part.file = path.join(work, `${part.index}.mp4`);
    job.stage = `Line ${part.index + 1}/${job.parts.length} · ${part.name}`;
    job.progress =
      job.parts.filter((p) => p.state === "ready").length / job.parts.length;
    if (part.state === "submitting" && !part.providerJobId) {
      part.state = "submission_uncertain";
      job.state = "submission_uncertain";
      save(job);
      throw Error(
        "Acceptance of this line is unknown. Recover its request ID; completed lines are kept.",
      );
    }
    try {
      if (job.executionMode === "test") {
        const result = await prepareSpeaker(
          job.input,
          part,
          partFolder,
          store,
          prepare,
        );
        await fs.copyFile(result.picture, part.file);
      } else {
        const adapter = await adapterFactory();
        if (!part.providerJobId) {
          const result = await prepareSpeaker(
            job.input,
            part,
            partFolder,
            store,
            prepare,
          );
          if (!(await liveAllowed())) return false;
          result.input.video_url = await upload(
            adapter,
            result.picture,
            "video/mp4",
          );
          result.input.audio_url = await upload(
            adapter,
            result.voice,
            "audio/wav",
          );
          if (!(await liveAllowed())) return false;
          part.state = "submitting";
          job.state = "processing";
          save(job);
          try {
            Object.assign(
              part,
              await adapter.submitSound(result.input, TARGETED_LIP_MODEL),
            );
          } catch (e) {
            part.state = e.uncertain ? "submission_uncertain" : "failed";
            if (e.uncertain) job.state = "submission_uncertain";
            throw e;
          }
          part.state = "processing";
          save(job);
        }
        if (!(await liveAllowed())) return false;
        const result = await adapter.pollSound(part);
        if (result.state !== "ready") {
          part.state = result.state;
          save(job);
          return false;
        }
        part.state = "downloading";
        save(job);
        await download(result.downloadUrl, part.file, part.duration);
      }
      part.state = "ready";
      delete part.error;
      job.state = "processing";
      job.progress =
        job.parts.filter((p) => p.state === "ready").length / job.parts.length;
      save(job);
    } catch (e) {
      if (part.state !== "submission_uncertain") part.state = "failed";
      part.error = String(e.message).slice(0, 500);
      part.terminal = !!e.terminal;
      save(job);
      throw e;
    }
    return false;
  }
  job.stage = "Assembling speaking takes";
  save(job);
  await assembleSpeakers(job.input, job.parts, output, store);
  return true;
}
