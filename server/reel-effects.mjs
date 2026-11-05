import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  reelOptions,
  cropSegments,
  readableCaptions,
  reelSourceKey,
  suggestHighlights,
  validateReelPlan,
  captionElements,
  localEffectPresets,
} from "../shared/reel-effects.mjs";
import { takeSourceIn } from "../shared/repair.mjs";
import { mediaPose } from "../shared/media-animation.mjs";
import { elementPose } from "../shared/elements.mjs";
import { renderEpisode, probe, thumbnail } from "./media.mjs";
import { renderElementOverlay } from "./elements.mjs";
import { addonProcess } from "./addon-process.mjs";
import ffmpeg from "./ffmpeg-path.mjs";
const stamp = async (file) => {
  const s = await fs.stat(file);
  return `${s.size}:${s.mtimeMs}`;
};
const error = (message, status = 400) =>
  Object.assign(Error(message), { status });
export function cropExpression(points, axis) {
  let expr = String(points.at(-1)[axis] ?? (axis === "zoom" ? 1 : 0.5));
  for (const segment of cropSegments(points, axis).reverse()) {
    const u = `clip((t-${segment.from})/${segment.to - segment.from},0,1)`;
    const [a, b, c, d] = segment.coefficients;
    expr = `if(lt(t,${segment.to}),(${a})+${u}*((${b})+${u}*((${c})+${u}*(${d}))),${expr})`;
  }
  return expr;
}
// Pad to the portrait canvas before zooming so wide framing can include
// everyone. zoompan evaluates scale and position per frame (crop size cannot).
export function portraitFilter(shot, source, width, height) {
  const ratio = source.width / source.height, aspect = 9 / 16;
  const fit = Math.min(ratio / aspect, aspect / ratio);
  const expression = axis => cropExpression(shot.crop, axis).replace(/\bt\b/g, "(on/24)");
  const x = expression("x"), y = expression("y"), z = expression("zoom");
  const rx = Math.min(1, ratio / aspect), ry = Math.min(1, aspect / ratio);
  const cx = `if(gte(1/(zoom*${rx}),1),0.5,clip((${x}),1/(2*zoom*${rx}),1-1/(2*zoom*${rx})))`;
  const cy = `if(gte(1/(zoom*${ry}),1),0.5,clip((${y}),1/(2*zoom*${ry}),1-1/(2*zoom*${ry})))`;
  return `pad=w='ceil(max(iw,ih*9/16)/2)*2':h='ceil(max(ih,iw*16/9)/2)*2':x=(ow-iw)/2:y=(oh-ih)/2:color=black,zoompan=z='max(1,(${z})/${fit})':x='clip(iw*(0.5+((${cx})-0.5)*${rx})-iw/zoom/2,0,iw-iw/zoom)':y='clip(ih*(0.5+((${cy})-0.5)*${ry})-ih/zoom/2,0,ih-ih/zoom)':d=1:s=${width}x${height}:fps=24,setsar=1`;
}
export function localEffectFilter(recipe) {
  return (
    {
      punch:
        "scale=ceil(iw*1.14/2)*2:ceil(ih*1.14/2)*2,crop=trunc(iw/1.14/2)*2:trunc(ih/1.14/2)*2:x='(in_w-out_w)/2+(in_w-out_w)*0.25*sin(t*0.7)':y='(in_h-out_h)/2'",
      warm: "eq=contrast=1.07:saturation=1.13:brightness=0.015,colorbalance=rs=.05:bs=-.035,vignette=PI/7",
      dream:
        "split[clean][soft];[soft]gblur=sigma=7[blur];[clean][blur]blend=all_mode=screen:all_opacity=0.16,eq=saturation=0.92",
      retro:
        "eq=contrast=.94:saturation=.65:brightness=.025,noise=alls=7:allf=t+u,vignette=PI/6",
      trail: "tmix=frames=3:weights=1 0.45 0.2",
    }[recipe] || "null"
  );
}
// Map a selected timeline interval into a standalone clip, preserving the mixed soundtrack.
export function intervalInputs(project, source, from, to) {
  const clip = project.clips.find((c) => c.id === source.clipId),
    start = clip.start + from,
    duration = to - from;
  const audio = (project.audioClips || []).flatMap((c) => {
    const a = Math.max(start, c.start),
      b = Math.min(start + duration, c.start + c.duration);
    return b > a + 0.01
      ? [
          {
            ...c,
            start: a - start,
            in: (c.in || 0) + a - c.start,
            duration: b - a,
            fadeIn: a === c.start ? Math.min(c.fadeIn || 0, b - a) : 0,
            fadeOut:
              b === c.start + c.duration ? Math.min(c.fadeOut || 0, b - a) : 0,
          },
        ]
      : [];
  });
  const elements = (project.elements || [])
    .filter((e) => !e.episodeId || e.episodeId === project.episodeId)
    .flatMap((e) => {
      const a = Math.max(start, e.start),
        b = Math.min(start + duration, e.start + e.duration);
      if (b - a < 0.1) return [];
      const keys = [
        a,
        ...(e.keyframes || [])
          .map((k) => e.start + k.t)
          .filter((t) => t > a && t < b),
        b,
      ];
      return [
        {
          ...e,
          ...elementPose(e, a),
          start: a - start,
          duration: b - a,
          keyframes: e.keyframes?.length
            ? keys.map((t) => ({ ...elementPose(e, t), t: t - a }))
            : [],
        },
      ];
    });
  const visual = clip.visual?.keyframes?.length
    ? {
        ...clip.visual,
        ...mediaPose(clip, start),
        keyframes: [
          from,
          ...clip.visual.keyframes
            .map((k) => k.at * clip.duration)
            .filter((t) => t > from && t < to),
          to,
        ].map((t) => ({
          ...mediaPose(clip, clip.start + t),
          at: (t - from) / duration,
        })),
      }
    : clip.visual;
  return {
    clip: {
      ...clip,
      visual,
      start: 0,
      in: source.in + from,
      duration,
      fadeIn: from === 0 ? clip.fadeIn : 0,
      fadeOut: to === clip.duration ? clip.fadeOut : 0,
    },
    audio,
    elements,
  };
}
export function createReelEffects({
  store,
  data,
  addons,
  processRunner = addonProcess,
  renderTimeline = renderEpisode,
  checkpoint = async () => {},
}) {
  const db = store.db;
  db.exec(
    "CREATE TABLE IF NOT EXISTS reel_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS reel_request ON reel_jobs(projectId,json_extract(body,'$.requestId'));",
  );
  const save = (j) => {
    db.prepare("INSERT OR REPLACE INTO reel_jobs VALUES(?,?,?,?)").run(
      j.id,
      j.projectId,
      j.state,
      JSON.stringify(j),
    );
    return j;
  };
  const list = (pid) =>
    db
      .prepare(
        "SELECT body FROM reel_jobs WHERE projectId=? ORDER BY json_extract(body,'$.createdAt') DESC LIMIT 30",
      )
      .all(pid)
      .map((r) => JSON.parse(r.body));
  const requestJob = (pid, id) => {
    const row = db
      .prepare(
        "SELECT body FROM reel_jobs WHERE projectId=? AND json_extract(body,'$.requestId')=?",
      )
      .get(pid, id);
    return row ? JSON.parse(row.body) : null;
  };
  const get = (pid, id) => {
    const row = db
      .prepare("SELECT body FROM reel_jobs WHERE projectId=? AND id=?")
      .get(pid, id);
    const j = row ? JSON.parse(row.body) : null;
    if (!j) throw error("This effect is unavailable.", 404);
    return j;
  };
  const view = (j) => {
    const c = structuredClone(j);
    delete c.snapshot;
    delete c.guardElements;
    delete c.outputElements;
    delete c.savedPlan;
    delete c.folder;
    delete c.files;
    c.sources = c.sources.map(({ path, original, ...s }) => s);
    if (c.media) {
      delete c.media.path;
      delete c.media.poster;
    }
    return c;
  };
  for (const row of db
    .prepare("SELECT body FROM reel_jobs WHERE state IN ('queued','running')")
    .all()) {
    const j = JSON.parse(row.body);
    save({
      ...j,
      state: "interrupted",
      message:
        "Interrupted. Your original edit is unchanged. Make a fresh preview.",
    });
  }
  const controllers = new Map();
  let queue = Promise.resolve();
  const ff = (j, args, signal) =>
    processRunner(
      ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-threads",
        "2",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
        ...args,
      ],
      { cwd: j.folder, signal, timeout: 1800000 },
    );
  const owned = (pid, id) => {
    const m = store.media(id);
    if (!m || m.projectId !== pid)
      throw error("A source is no longer available in this project.");
    return m;
  };
  async function unchanged(j) {
    const entry = store.get(j.projectId);
    if (
      !entry ||
      store.removing.has(j.projectId) ||
      entry.project.episodeId !== j.episodeId
    )
      throw error("Open the original edit before continuing.");
    for (const source of j.sources) {
      const clip = entry.project.clips.find((c) => c.id === source.clipId);
      if (!clip || reelSourceKey(clip) !== source.key || source.reframeKey && JSON.stringify(clip.reelSource) !== source.reframeKey)
        throw error("The footage changed. Make a fresh preview.");
    }
    if (
      JSON.stringify(entry.project.audioClips || []) !==
        JSON.stringify(j.snapshot.audioClips || []) ||
      JSON.stringify(entry.project.elements || []) !==
        JSON.stringify(j.guardElements || j.snapshot.elements || [])
    )
      throw error("The sound or overlays changed. Make a fresh preview.");
    for (const f of j.files) {
      if (f.mediaId) {
        const m = owned(j.projectId, f.mediaId);
        if ((m.original || m.path) !== f.path)
          throw error("A source file changed. Make a fresh preview.");
      }
      if ((await stamp(f.path)) !== f.stamp)
        throw error("A source file changed. Make a fresh preview.");
    }
  }
  async function timelinePart(j, source, from, to, resolution, output, folder) {
    const { clip, audio, elements } = intervalInputs(
      j.snapshot,
      source,
      from,
      to,
    );
    await renderTimeline(
      [clip],
      () => owned(j.projectId, source.mediaId),
      folder,
      output,
      {
        aspect: j.snapshot.settings?.export?.aspect || "16:9",
        resolution,
        fps: 24,
      },
      audio,
      (c) => owned(j.projectId, c.mediaId),
      elements,
    );
  }
  function enqueue(j, task) {
    if (controllers.has(j.id)) return view(get(j.projectId, j.id));
    if (controllers.size >= 2)
      throw error("Wait for the current local effect to finish.", 409);
    const controller = new AbortController();
    controllers.set(j.id, controller);
    j.state = "queued";
    save(j);
    queue = queue
      .catch(() => {})
      .then(async () => {
        try {
          if (controller.signal.aborted) throw Error("Cancelled");
          j.state = "running";
          save(j);
          await unchanged(j);
          await task(j, controller.signal);
          if (controller.signal.aborted) throw Error("Cancelled");
          await unchanged(j);
          save(j);
        } catch (e) {
          j.state = controller.signal.aborted ? "cancelled" : "failed";
          j.message =
            e.message?.length < 350
              ? e.message
              : "This effect could not finish. Try a shorter selection or another preset.";
          save(j);
        } finally {
          controllers.delete(j.id);
        }
      });
    return view(j);
  }
  async function analyze(j, signal) {
    await fs.mkdir(j.folder, { recursive: true });
    for (const [index, source] of j.sources.entries()) {
      if (signal.aborted) throw Error("Cancelled");
      j.message = `Preparing footage ${index + 1} of ${j.sources.length}`;
      save(j);
      const normalized = path.join(j.folder, `${source.id}.mp4`);
      await timelinePart(
        j,
        source,
        0,
        source.duration,
        "480p",
        normalized,
        path.join(j.folder, `analysis-${index}`),
      );
      if (signal.aborted) throw Error("Cancelled");
      const info = await probe(normalized);
      source.width = info.width;
      source.height = info.height;
      source.preview = `/api/projects/${j.projectId}/reels/${j.id}/source/${source.id}`;
      const wav = path.join(j.folder, `${source.id}.wav`),
        pcm = path.join(j.folder, `${source.id}.pcm`);
      await ff(
        j,
        [
          "-i",
          normalized,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          wav,
        ],
        signal,
      );
      await ff(j, ["-i", wav, "-f", "s16le", pcm], signal);
      const samples = await fs.readFile(pcm);
      source.activity = [];
      for (let off = 0; off < samples.length; off += 32000) {
        let sum = 0,
          count = 0;
        for (
          let p = off;
          p < Math.min(samples.length, off + 32000) - 1;
          p += 2
        ) {
          const v = samples.readInt16LE(p) / 32768;
          sum += v * v;
          count++;
        }
        source.activity.push(Math.sqrt(sum / (count || 1)));
      }
      source.captions = [];
      if (j.options.captions && !j.options.reframe) {
        j.message = `Listening locally · ${index + 1} of ${j.sources.length}`;
        save(j);
        const transcript = await addons.execute(
          "captions",
          {
            path: wav,
            output: path.join(j.folder, `words-${index}`),
            language: j.options.language,
          },
          { signal },
        );
        source.captions = (transcript.segments || [])
          .filter((c) => c.text?.trim() && c.end > c.start)
          .map((c) => ({
            start: Math.max(0, c.start),
            end: Math.min(source.duration, c.end),
            text: c.text.trim().slice(0, 500),
          }))
          .filter((c) => c.end > c.start);
      }
      source.captions = readableCaptions(source.captions);
      j.message = `Finding cuts · ${index + 1} of ${j.sources.length}`;
      save(j);
      await ff(
        j,
        [
          "-i",
          normalized,
          "-vf",
          `select='gt(scene,0.28)',metadata=mode=print:file=cuts-${index}.txt`,
          "-an",
          "-f",
          "null",
          "-",
        ],
        signal,
      );
      const cuts = await fs.readFile(
        path.join(j.folder, `cuts-${index}.txt`),
        "utf8",
      );
      source.cuts = [...cuts.matchAll(/pts_time:([\d.]+)/g)].map((m) =>
        Number(m[1]),
      );
      await fs.rm(pcm, { force: true });
      await fs.rm(wav, { force: true });
    }
    j.plan = j.options.reframe ? validateReelPlan(j.savedPlan, j.sources, j.options.duration) : suggestHighlights(j.sources, j.options);
    if (j.options.reframe) j.reviewedAt = Date.now();
    // Merge adjacent phrases without losing transcript words.
    while (j.plan.reduce((n, p) => n + p.captions.length, 0) > 48) {
      const shot = [...j.plan].sort(
        (a, b) => b.captions.length - a.captions.length,
      )[0];
      if (
        shot.captions.length < 2 ||
        shot.captions[0].text.length + shot.captions[1].text.length > 498
      )
        break;
      const a = shot.captions.shift(),
        b = shot.captions.shift();
      shot.captions.unshift({
        start: a.start,
        end: b.end,
        text: a.text + " " + b.text,
      });
    }
    j.state = "quoted";
    j.message =
      j.options.recipe === "reel"
        ? "Highlights ready. Check framing and captions."
        : "Preview ready to render.";
  }
  async function render(j, signal) {
    const width = j.options.resolution === "1080p" ? 1080 : 480,
      height = width === 1080 ? 1920 : 854,
      parts = [];
    for (const [i, shot] of j.plan.entries()) {
      if (signal.aborted) throw Error("Cancelled");
      const source = j.sources.find((s) => s.id === shot.sourceId),
        base = path.join(j.folder, `base-${i}.mp4`),
        out = path.join(j.folder, `part-${i}.mp4`);
      j.message = `Rendering ${i + 1} of ${j.plan.length}`;
      save(j);
      await timelinePart(
        j,
        source,
        shot.from,
        shot.to,
        j.options.resolution,
        base,
        path.join(j.folder, `render-${i}`),
      );
      const filter =
        j.options.recipe === "reel"
          ? portraitFilter(shot, source, width, height)
          : localEffectFilter(j.options.recipe);
      await ff(
        j,
        [
          "-i",
          base,
          "-filter_complex",
          `[0:v]${filter},format=yuv420p[v]`,
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
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-t",
          String(shot.to - shot.from),
          out,
        ],
        signal,
      );
      parts.push(out);
    }
    await fs.writeFile(
      path.join(j.folder, "join.txt"),
      parts.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n"),
    );
    const merged = path.join(j.folder, "merged.mp4");
    await ff(
      j,
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "join.txt",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        merged,
      ],
      signal,
    );
    const duration = j.plan.reduce((n, p) => n + p.to - p.from, 0),
      captions = [...(j.options.captions ? captionElements(j.plan) : []), ...(j.outputElements || [])],
      output = path.join(j.folder, "result.mp4");
    if (captions.length) {
      j.message = "Adding captions";
      save(j);
      await renderElementOverlay(
        merged,
        output,
        captions,
        width,
        height,
        24,
        duration,
      );
    } else await fs.copyFile(merged, output);
    if (signal.aborted) throw Error("Cancelled");
    await unchanged(j);
    const info = await probe(output);
    if (
      !info.video ||
      Math.abs(info.duration - duration) > 0.2 ||
      (j.options.recipe === "reel" &&
        (info.width !== width || info.height !== height))
    )
      throw Error(
        "The rendered result did not match the requested timing or format.",
      );
    const id = randomUUID(),
      poster = path.join(j.folder, "poster.jpg");
    await thumbnail(output, poster, Math.min(0.2, duration / 2));
    j.media = {
      id,
      projectId: j.projectId,
      kind: "video",
      path: output,
      poster,
      duration: info.duration,
      audio: info.audio,
      width: info.width,
      height: info.height,
      name: localEffectPresets.find((p) => p.id === j.options.recipe).name,
      url: `/api/media/${id}`,
      thumbnail: `/api/media/${id}/thumbnail`,
      localEffect: { jobId: j.id, recipe: j.options.recipe },
    };
    store.putMedia(j.media);
    j.state = "ready";
    j.message = "Ready to watch and download";
    j.completedAt = Date.now();
    await checkpoint(j.projectId);
  }
  return {
    list: (pid) => list(pid).map(view),
    get: (pid, id) => view(get(pid, id)),
    async create(pid, body) {
      const entry = store.get(pid);
      if (!entry || store.removing.has(pid))
        throw error("Project unavailable.", 404);
      if (entry.revision !== body.revision)
        throw error("Save your latest edit first.", 409);
      if (
        typeof body.requestId !== "string" ||
        body.requestId.length > 100 ||
        body.requestId.length < 8
      )
        throw error("Start a fresh effect request.");
      const prior = requestJob(pid, body.requestId);
      if (prior) return view(prior);
      const options = reelOptions(body);
      if (body.reframe !== undefined && typeof body.reframe !== "boolean") throw error("Choose a valid framing mode.");
      options.reframe = body.reframe === true;
      if (options.reframe && options.recipe !== "reel") throw error("Saved framing is available for Reels.");
      if (options.captions && !options.reframe) addons.requireReady("captions");
      if (
        !Array.isArray(body.clipIds) ||
        body.clipIds.some((id) => typeof id !== "string")
      )
        throw error("Choose footage from the timeline.");
      const project = entry.project,
        clips = project.clips
          .filter((c) => body.clipIds.includes(c.id) && c.activeTake)
          .sort((a, b) => a.start - b.start);
      if (
        !clips.length ||
        clips.length > 30 ||
        clips.some((c) => !(c.duration > 0.15)) ||
        clips.reduce((n, c) => n + c.duration, 0) > 600
      )
        throw error(
          "Choose up to 10 minutes of footage, across no more than 30 clips.",
        );
      if (clips.some((c) => (c.speed ?? 1) !== 1 || c.reverse || c.repair))
        throw error(
          "Use regular-speed footage for this effect. Export a sped-up, reversed or repaired edit and use that video instead.",
        );
      if (options.reframe && clips.some(c => !c.reelSource?.reframeMediaId || c.in || Math.abs(c.duration-c.reelSource.duration)>.001))
        throw error("Use the original result shot timing to reopen its saved framing.");
      const sources = clips.map((c, i) => {
        const media = owned(pid, options.reframe ? c.reelSource.reframeMediaId : c.activeTake);
        if (!["video", "image"].includes(media.kind || "video"))
          throw error("Choose footage or images.");
        return {
          id: `source-${i}`,
          order: i,
          clipId: c.id,
          mediaId: media.id,
          ...(options.reframe ? { reframeKey: JSON.stringify(c.reelSource) } : {}),
          in: options.reframe ? 0 : takeSourceIn(
            c,
            c.takes?.find((t) => t.id === c.activeTake) || media,
          ),
          duration: c.duration,
          key: reelSourceKey(c),
          name: c.name || media.name || `Clip ${i + 1}`,
        };
      });
      const files = [];
      for (const id of new Set([
        ...sources.map((s) => s.mediaId),
        ...(project.audioClips || []).map((a) => a.mediaId),
      ])) {
        const m = owned(pid, id),
          file = m.original || m.path;
        files.push({ mediaId: id, path: file, stamp: await stamp(file) });
      }
      const existing = requestJob(pid, body.requestId);
      if (existing) return view(existing);
      const id = randomUUID(),
        j = {
          id,
          requestId: body.requestId,
          projectId: pid,
          episodeId: project.episodeId,
          state: "queued",
          options,
          sources,
          files,
          snapshot: structuredClone(project),
          folder: path.join(project.folder || data, "reels", id),
          createdAt: Date.now(),
          message: "Preparing locally…",
        };
      if (options.reframe) {
        j.guardElements = structuredClone(project.elements || []);
        let outputAt = 0;
        j.outputElements = clips.flatMap((clip,i) => {
          const elements = intervalInputs(project,sources[i],0,clip.duration).elements.filter(e=>!e.reelCaption).map(e=>({...e,start:e.start+outputAt}));
          outputAt += clip.duration;
          return elements;
        });
        j.snapshot.elements = [];
        j.snapshot.settings.export.aspect = clips[0].reelSource.reframeAspect || "16:9";
        if (clips.some(c => c.reelSource.reframeAspect !== clips[0].reelSource.reframeAspect)) throw error("Reopen shots with the same source format together.");
        for (const clip of j.snapshot.clips) {
          const source = sources.find(s => s.clipId === clip.id);
          if (!source) continue;
          const media = owned(pid, source.mediaId);
          Object.assign(clip, { activeTake:media.id, takes:[media], in:0, visual:undefined, mute:true, volume:1 });
        }
        j.savedPlan = clips.map((clip, i) => ({ ...structuredClone(clip.reelSource.shot), id:randomUUID(), sourceId:sources[i].id, from:0, to:clip.duration,
          captions:(project.elements || []).filter(e => e.reelCaption && e.start < clip.start+clip.duration && e.start+e.duration > clip.start).map(e=>({start:Math.max(0,e.start-clip.start),end:Math.min(clip.duration,e.start+e.duration-clip.start),text:e.text})) }));
      }
      return enqueue(j, analyze);
    },
    async review(pid, id, plan) {
      let j = get(pid, id);
      if (j.state !== "quoted")
        throw error("This preview is already rendering.", 409);
      await unchanged(j);
      j = get(pid, id);
      if (j.state !== "quoted" || controllers.has(id))
        throw error("This preview is already rendering.", 409);
      j.plan = validateReelPlan(plan, j.sources, j.options.duration);
      j.reviewedAt = Date.now();
      save(j);
      return view(j);
    },
    async render(pid, id, plan) {
      const j = get(pid, id);
      if (["queued", "running", "ready"].includes(j.state)) return view(j);
      if (j.state !== "quoted") throw error("Make a fresh preview first.");
      await unchanged(j);
      j.plan = validateReelPlan(plan, j.sources, j.options.duration);
      j.message = "Rendering your effect…";
      return enqueue(j, render);
    },
    cancel(pid, id) {
      const j = get(pid, id);
      controllers.get(id)?.abort();
      if (j.state === "quoted") {
        j.state = "cancelled";
        save(j);
      }
      return view(j);
    },
    source(pid, id, sourceId) {
      const j = get(pid, id);
      if (!j.sources.some((s) => s.id === sourceId))
        throw error("Source unavailable.", 404);
      return path.join(j.folder, `${sourceId}.mp4`);
    },
    close() {
      for (const c of controllers.values()) c.abort();
    },
    idle: () => queue,
  };
}
export function installReelEffects(app, service) {
  app.put("/api/projects/:id/reels/:job/review", async (req, res) =>
    res.json(
      await service.review(req.params.id, req.params.job, req.body.plan),
    ),
  );
  app.get("/api/projects/:id/reels", (req, res) =>
    res.json(service.list(req.params.id)),
  );
  app.post("/api/projects/:id/reels", async (req, res) =>
    res.status(202).json(await service.create(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/reels/:job/render", async (req, res) =>
    res
      .status(202)
      .json(await service.render(req.params.id, req.params.job, req.body.plan)),
  );
  app.post("/api/projects/:id/reels/:job/cancel", (req, res) =>
    res.json(service.cancel(req.params.id, req.params.job)),
  );
  app.get("/api/projects/:id/reels/:job/source/:source", (req, res) =>
    res.sendFile(
      path.resolve(
        service.source(req.params.id, req.params.job, req.params.source),
      ),
    ),
  );
}
