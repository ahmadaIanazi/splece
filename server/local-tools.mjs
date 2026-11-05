import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "./ffmpeg-path.mjs";
import { addonProcess } from "./addon-process.mjs";
import { localToolAddons } from "../shared/addons.mjs";
import {
  localClipDescription,
  localSourceKey,
  rankLocalSounds,
  localSoundQuery,
  localClipName,
} from "../shared/local-tools.mjs";
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const actions = new Set([
  "sound",
  "levels",
  "describe",
  "rank",
  "beats",
  "cuts",
  "captions",
]);

export function createLocalTools({
  store,
  data,
  addons,
  processRunner = addonProcess,
}) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS local_analysis(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,body TEXT NOT NULL)",
  );
  const save = (job) =>
    store.db
      .prepare("INSERT OR REPLACE INTO local_analysis VALUES(?,?,?)")
      .run(job.id, job.projectId, JSON.stringify(job));
  const list = (projectId) =>
    store.db
      .prepare(
        "SELECT body FROM local_analysis WHERE projectId=? ORDER BY rowid DESC LIMIT 30",
      )
      .all(projectId)
      .map((r) => JSON.parse(r.body));
  for (const row of store.db.prepare("SELECT body FROM local_analysis").all()) {
    const job = JSON.parse(row.body);
    if (["queued", "running"].includes(job.state)) {
      job.state = "failed";
      job.error =
        "Analysis was interrupted. Run it again; your edit is unchanged.";
      save(job);
    }
  }
  const controllers = new Map();
  let queue = Promise.resolve();
  const mediaFor = (projectId, id) => {
    const media = store.media(id);
    if (!media || media.projectId !== projectId)
      throw fail("This media is not available in the project.");
    return media;
  };
  async function perform(job, project, options, controller) {
    const temp = path.join(data, "local-analysis", job.id),
      signal = controller.signal;
    const ff = (args) =>
      processRunner(
        ffmpeg,
        ["-hide_banner", "-nostdin", "-y", "-threads", "1", ...args],
        { signal, timeout: 600000 },
      );
    try {
      if (signal.aborted) throw Error("Cancelled");
      job.state = "running";
      save(job);
      await fs.mkdir(temp, { recursive: true });
      const results = [],
        sounds = [],
        captions = [];
      const rankings = new Map();
      const rankSounds = async (candidates, query) => {
        const key = localSoundQuery(query);
        if (!rankings.has(key)) rankings.set(key, await addons.execute("earshot", {
          action: "rank", paths: candidates.map((c) => c.media.path), query: key,
        }, { signal }));
        return rankings.get(key);
      };
      const assets = project.assets.filter(
        (a) =>
          a.kind === "audio" &&
          a.media?.audio &&
          Number.isFinite(a.media.duration) &&
          a.media.duration > 0,
      );
      for (const source of job.sources) {
        if (signal.aborted) throw Error("Cancelled");
        const clip = project.clips.find((c) => c.id === source.id),
          media = mediaFor(project.id, clip.activeTake);
        const name = localClipName(project, clip);
        job.message = `${results.length + 1} of ${job.sources.length} · ${name}`;
        save(job);
        if (job.action === "sound") {
          const query = options.query || localClipDescription(project, clip);
          const matches = rankLocalSounds(assets, query);
          let asset = options.assetId
            ? assets.find((a) => a.id === options.assetId)
            : matches[0]?.asset;
          let sourceIn = 0,
            availableDuration = asset?.media.duration || 0;
          if (options.semantic && !options.assetId && assets.length) {
            const candidates = assets
              .filter((a) => a.media.duration <= 600)
              .slice(0, 20)
              .map((a) => ({
                asset: a,
                media: mediaFor(project.id, a.media.id),
              }));
            // CLAP is English-oriented; expand the supported bilingual acoustic vocabulary locally.
            if (!candidates.length)
              throw Error(
                "Import an audio recording under 10 minutes for local matching.",
              );
            const english = localSoundQuery(query);
            const rank = await rankSounds(candidates, query);
            const best = rank.results?.find(
              (r) =>
                ["strong", "plausible"].includes(r.verdict) && !r.near_silent,
            );
            asset = candidates.find((c) => c.media.path === best?.path)?.asset;
            if (asset) {
              const found = await addons.execute(
                "earshot",
                {
                  action: "find",
                  path: mediaFor(project.id, asset.media.id).path,
                  query: english || query,
                  duration: asset.media.duration,
                },
                { signal },
              );
              const segment = found.segments?.[0];
              sourceIn = Math.max(
                0,
                Math.min(
                  asset.media.duration - 0.1,
                  Number(segment?.start) || 0,
                ),
              );
              availableDuration = Math.min(
                asset.media.duration - sourceIn,
                Number(segment?.end) > sourceIn
                  ? Number(segment.end) - sourceIn
                  : asset.media.duration - sourceIn,
              );
            }
          }
          if (!asset) {
            results.push({
              clipId: clip.id,
              name,
              message:
                "No matching local sound. Import a sound, add descriptive tags, or choose one manually.",
            });
            continue;
          }
          mediaFor(project.id, asset.media.id);
          sounds.push({
            id: randomUUID(),
            assetId: asset.id,
            mediaId: asset.media.id,
            start: clip.start,
            in: sourceIn,
            duration: Math.min(
              clip.duration,
              options.semantic && !options.assetId
                ? availableDuration
                : asset.media.duration,
            ),
            name: asset.name,
            volume: 0.5,
          });
          results.push({
            clipId: clip.id,
            name,
            message: `${asset.name} · ${options.assetId ? "your choice" : options.semantic ? "matched by local sound analysis" : "matched from names and tags"}`,
          });
          continue;
        }
        const input = path.join(temp, `${results.length}.wav`);
        if (!["cuts", "rank"].includes(job.action)) {
          if (!media.audio) {
            results.push({
              clipId: clip.id,
              name,
              message: "This take has no audio.",
            });
            continue;
          }
          await ff([
            "-ss",
            String(clip.in || 0),
            "-i",
            media.path,
            "-t",
            String(clip.duration),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            job.action === "captions" ? "1" : "2",
            "-ar",
            job.action === "captions" ? "16000" : "48000",
            "-c:a",
            "pcm_s16le",
            input,
          ]);
        }
        let result;
        if (job.action === "levels") {
          let log = "";
          await processRunner(
            ffmpeg,
            [
              "-hide_banner",
              "-nostdin",
              "-i",
              input,
              "-af",
              "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
              "-f",
              "null",
              "-",
            ],
            {
              signal,
              onProgress: (s) => {
                log = (log + s).slice(-15000);
              },
            },
          );
          const measured = JSON.parse(
            log.match(/\{[^{}]*"input_i"[^{}]*\}/s)?.[0] || "{}",
          );
          result = {
            loudness: Number.isFinite(Number(measured.input_i))
              ? Number(measured.input_i)
              : null,
            peak: Number.isFinite(Number(measured.input_tp))
              ? Number(measured.input_tp)
              : null,
          };
        } else if (job.action === "cuts") {
          const video = path.join(temp, `${results.length}.mp4`);
          await ff([
            "-ss",
            String(clip.in || 0),
            "-i",
            media.path,
            "-t",
            String(clip.duration),
            "-an",
            "-vf",
            "scale=640:-2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            video,
          ]);
          result = await addons.execute(
            "scenes",
            { action: "cuts", path: video },
            { signal },
          );
        } else if (job.action === "rank") {
          const candidates = assets
            .filter((a) => a.media.duration <= 600)
            .slice(0, 20)
            .map((a) => ({
              asset: a,
              media: mediaFor(project.id, a.media.id),
            }));
          if (!candidates.length)
            throw Error("Import sounds into this project’s Library first.");
          const rank = await rankSounds(candidates, options.query || localClipDescription(project, clip));
          // Return original evidence with paths removed, and stable asset IDs for manual selection.
          result = {
            summary: `${candidates.length} recordings checked on this computer. Matches are suggestions; preview a recording before choosing it.`,
            ranking: (rank.results || []).flatMap((r) => {
              const candidate = candidates.find((c) => c.media.path === r.path);
              return candidate
                ? [
                    {
                      id: candidate.asset.id,
                      name: candidate.asset.name,
                      verdict: r.verdict,
                      score: r.z,
                    },
                  ]
                : [];
            }),
          };
        } else {
          result = await addons.execute(
            localToolAddons[job.action],
            {
              action: job.action,
              path: input,
              output: path.join(temp, `caption-${results.length}`),
              language: options.language || "auto",
              prompt: options.vocabulary || "",
            },
            { signal },
          );
          delete result.path;
          if (job.action === "captions")
            for (const segment of result.segments || []) {
              const from = Math.max(0, segment.start),
                to = Math.min(clip.duration, segment.end);
              if (to - from >= 0.1 && segment.text?.trim())
                captions.push({
                  id: randomUUID(),
                  clipId: clip.id,
                  start: clip.start + from,
                  duration: to - from,
                  text: segment.text.slice(0, 2000),
                });
            }
        }
        results.push({
          clipId: clip.id,
          name,
          start: clip.start,
          result,
        });
      }
      job.result = { items: results, sounds, captions };
      if (job.action === "sound")
        job.result.note =
          "Suggested sounds start at each clip boundary. Review their timing before applying. Existing sound and manual levels stay unchanged.";
      if (job.action === "captions")
        job.result.note =
          "Draft captions from the local base model. Check names and dialects, edit the text here, then add it to the timeline.";
      if (job.action === "beats")
        job.result.note = "Timing suggestions from the footage’s original audio, before mixing. Speech can produce a false tempo; audition the markers before editing to them.";
      job.state = "ready";
      job.message = "Ready to review";
    } catch (e) {
      job.state = signal.aborted ? "cancelled" : "failed";
      job.error = e.message;
    } finally {
      save(job);
      controllers.delete(job.id);
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
  return {
    list,
    create(projectId, options) {
      const entry = store.get(projectId);
      if (!entry) throw fail("Project not found", 404);
      if (entry.revision !== options.revision)
        throw fail("Save your latest changes before analyzing.", 409);
      if (!actions.has(options.action)) throw fail("Unknown local tool.");
      if (options.language != null && !["auto", "ar", "en"].includes(options.language))
        throw fail("Choose Auto, Arabic, or English for captions.");
      if (options.vocabulary != null && (typeof options.vocabulary !== "string" || options.vocabulary.length > 500))
        throw fail("Keep caption names and terms under 500 characters.");
      if (
        typeof options.query !== "undefined" &&
        (typeof options.query !== "string" || options.query.length > 2000)
      )
        throw fail("Keep the sound description under 2,000 characters.");
      if (localToolAddons[options.action])
        addons.requireReady(localToolAddons[options.action]);
      if (options.action === "sound" && options.semantic && !options.assetId)
        addons.requireReady("earshot");
      if (controllers.size >= 4)
        throw fail(
          "Wait for an analysis to finish before starting another.",
          409,
        );
      const project = entry.project;
      if (
        options.clipIds != null &&
        (!Array.isArray(options.clipIds) ||
          options.clipIds.some((id) => typeof id !== "string"))
      )
        throw fail("Invalid clip selection.");
      const clips = project.clips.filter(
        (c) =>
          c.activeTake && (!options.clipIds || options.clipIds.includes(c.id)),
      ).sort((a, b) => a.start - b.start);
      if (!clips.length) throw fail("Add footage to the timeline first.");
      if (
        clips.some((c) => !Number.isFinite(c.duration) || c.duration <= 0) ||
        clips.reduce((n, c) => n + c.duration, 0) > 600
      )
        throw fail(
          "Analyze up to 10 minutes at a time. Choose a smaller selection.",
        );
      if (
        options.assetId &&
        !project.assets.some(
          (a) =>
            a.id === options.assetId && a.kind === "audio" && a.media?.audio,
        )
      )
        throw fail("Choose a sound from this project’s Library.");
      const job = {
        id: randomUUID(),
        projectId,
        episodeId: project.episodeId,
        action: options.action,
        state: "queued",
        sources: clips.map((c) => ({ id: c.id, key: localSourceKey(c) })),
        createdAt: Date.now(),
        message: "Waiting for local analysis…",
      };
      const controller = new AbortController();
      controllers.set(job.id, controller);
      save(job);
      queue = queue
        .catch(() => {})
        .then(() => perform(job, project, options, controller));
      return job;
    },
    review(projectId, id, edits) {
      const job = list(projectId).find((j) => j.id === id);
      if (!job || job.state !== "ready" || job.action !== "captions")
        throw fail("These captions are not ready to edit.", 409);
      if (!Array.isArray(edits) || edits.length > 1000 || edits.some((e) =>
        !e || typeof e.text !== "string" || !e.text.trim() || e.text.length > 2000 ||
        !job.result.captions.some((c) => c.id === e.id)))
        throw fail("Enter caption text for an existing result (up to 2,000 characters).");
      for (const edit of edits) job.result.captions.find((c) => c.id === edit.id).text = edit.text.trim();
      save(job);
      return job;
    },
    cancel(projectId, id) {
      const job = list(projectId).find((j) => j.id === id);
      if (!job) throw fail("Analysis not found", 404);
      controllers.get(id)?.abort();
      return job;
    },
  };
}
export function installLocalToolRoutes(app, service) {
  app.post("/api/projects/:id/local-tools/:job/review", (req, res) =>
    res.json(service.review(req.params.id, req.params.job, req.body.edits)),
  );
  app.get("/api/projects/:id/local-tools", (req, res) =>
    res.json(service.list(req.params.id)),
  );
  app.post("/api/projects/:id/local-tools", (req, res) =>
    res.status(202).json(service.create(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/local-tools/:job/cancel", (req, res) =>
    res.json(service.cancel(req.params.id, req.params.job)),
  );
}
