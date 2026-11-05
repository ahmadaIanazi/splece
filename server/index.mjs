import { createDerivedProjects, installDerivedProjectRoutes } from './derived-projects.mjs';
import { createReelEffects, installReelEffects } from './reel-effects.mjs';
import {exportFileName} from "../shared/export-presentation.mjs";
import { createAddonService, installAddonRoutes } from "./addons.mjs";
import { createLocalTools, installLocalToolRoutes } from "./local-tools.mjs";
import { createOpenverse, installOpenverseRoutes } from "./openverse.mjs";
import { installAIRouting } from "./ai-routing.mjs";
import { createEffectsService, installEffectsRoutes } from './effects.mjs';
import {createFolderSettings, installFolderRoutes, chooseFolder} from "./folders.mjs";
import {elementsFor} from "../shared/elements.mjs";
import { hasComposerWriting } from "../shared/composer-sequence.mjs";
import {installAssetIntelligence} from "./asset-intelligence.mjs";
import { installPhotoAnalysis } from "./photo-analysis.mjs";
import {createImageService, installImageRoutes} from "./asset-images.mjs";
import { installWorkflowRoutes } from "./workflows.mjs";
import { optimizedSubmissionDraft } from "../shared/submission-optimization.mjs";
import { installComposerAssistant } from "./composer-assistant.mjs";
import { installComparisonRoutes } from "./comparison.mjs";
import {createLipSyncService, installLipSyncRoutes} from "./lip-sync.mjs";
import { credentials } from "./connections.mjs";
import {
  createSoundtrackService,
  installSoundtrackRoutes,
} from "./soundtrack.mjs";
import { createDerivativeCache } from "./derivative-cache.mjs";
import { createPreviewCache } from "./preview-cache.mjs";
import { jobView } from "./job-view.mjs";
import { installProjectLifecycle } from "./project-lifecycle.mjs";
import { materializeProjectTemplate } from "./project-templates.mjs";
import { initializeProjectConcept } from "../shared/project-start.mjs";
import { installLibraryOrganizationRoutes } from "./library-organization.mjs";
import { createAssetLibrary, installLibraryRoutes } from "./library.mjs";
import { installTreatmentRoutes } from "./clip-treatment.mjs";
import { createFrameCache } from "./frame-cache.mjs";
import { settingsDefaults } from "./settings-defaults.mjs";
import {
  resolveProjectDefaults,
  settingGroups,
} from "../shared/settings-defaults.mjs";
import {
  createProviderRegistry,
  installConnectionRoutes,
} from "./provider-registry.mjs";
import { isLiveJob } from "../shared/providers.mjs";
import {
  waveform,
  validateAudio,
  mixArguments,
  audioPlayback,
} from "./audio.mjs";
import { installLauncherControl } from "./launcher.mjs";
import { installUpdateRoutes } from "./updates.mjs";
import { createBillingService, installBillingRoutes } from "./billing.mjs";
import { generationTarget } from "../shared/generation-slots.mjs";
import { studioMode, saveStudioMode } from "./mode.mjs";
import { createCatalogService, installCatalogRoutes } from "./catalog.mjs";
import {
  createVeniceSettings,
  createDeepSeekSettings,
  discoverDeepSeekModels,
} from "./smart.mjs";
import { installAuthoringRoutes } from "./authoring.mjs";
import { createVideoService } from "./video.mjs";
import { installSmartRoutes } from "./smart.mjs";
import {
  upgradeProject,
  validatePreparation,
  timelineIssues,
} from "../shared/studio.mjs";
import { createPortableStore } from "./portable.mjs";
import { localSession, providerTransport } from "./security.mjs";
import { providerEvidence } from "./providers.mjs";
import { startWorker } from "./jobs.mjs";
import { randomBytes } from "node:crypto";
import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { openStore } from "./store.mjs";
import {
  id,
  models,
  newProject,
  newDraft,
  compilePrompt,
  normalizeSettings,
  validateProject,
} from "./domain.mjs";
import {
  providerFrame,
  probe,
  thumbnail,
  renderDemo,
  renderEpisode,
  run,
} from "./media.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.resolve(
  process.env.STUDIO_DATA_DIR || path.join(root, "data"),
);
await fs.mkdir(data, { recursive: true });
if (!(await studioMode(data))) await saveStudioMode(data, "test");
const baseDefaults = upgradeProject(newProject("Defaults")).settings;
baseDefaults.audioDefaults = { volume: 1, mute: false };
baseDefaults.videoDefaults = {};
baseDefaults.workflows = {version:1,flows:{}};
const defaults = settingsDefaults(data, baseDefaults);
const store = openStore(path.join(data, "studio.sqlite"), (settings) =>
  resolveProjectDefaults(settings, defaults.get()),
);
const previews = createPreviewCache({ store, data });
const derivatives = createDerivativeCache({ store, data });
const app = express();
const registry = createProviderRegistry({ data });
const video = createVideoService({ data, store, registry });
const portable = createPortableStore(store);
const folders = await createFolderSettings(data);
const library = createAssetLibrary(store, data);
const port = Number(process.env.PORT || 4310);
app.use((req, res, next) => {
  const host = req.headers.host?.split(":")[0];
  if (!["127.0.0.1", "localhost", "["].includes(host))
    return res.status(403).json({ error: "Local access only" });
  const origin = req.headers.origin;
  if (
    origin &&
    !["http://localhost:" + port, "http://127.0.0.1:" + port].includes(origin)
  )
    return res.status(403).json({ error: "Origin not allowed" });
  if (req.headers["sec-fetch-site"] === "cross-site")
    return res.status(403).json({ error: "Cross-site requests are disabled" });
  next();
});
app.use(localSession());
app.use(express.json({ limit: "20mb" }));
const addons = await createAddonService({ data });
const localTools = createLocalTools({ store, data, addons });
let httpServer;
await installLauncherControl(app, {
  store,
  root,
  data,
  extraActiveJobs: () => addons.list().filter((a) => ["installing", "removing"].includes(a.status)).length,
  stop: () => {
    httpServer.close(() => process.exit(0));
    httpServer.closeIdleConnections();
    setTimeout(() => httpServer.closeAllConnections(), 1000).unref();
  },
});
installAddonRoutes(app, addons);
installLocalToolRoutes(app, localTools);
installOpenverseRoutes(app, createOpenverse({ store, addons }));
await installUpdateRoutes(app, {root,data});
const imageService = createImageService({store,data,checkpoint:id=>portable.checkpoint(id)});
installWorkflowRoutes(app, {getProject: id => getProject(id)});
const soundtrack = createSoundtrackService({ store, data });
installSoundtrackRoutes(app, soundtrack);
const lipSync = createLipSyncService({store,data});
installLipSyncRoutes(app, lipSync);
const effects = createEffectsService({ store, data, checkpoint: id => portable.checkpoint(id) });
installEffectsRoutes(app, effects);
const reels = createReelEffects({store,data,addons,checkpoint:id=>portable.checkpoint(id)});
installReelEffects(app,reels);
installDerivedProjectRoutes(app, createDerivedProjects({store, projectsRoot: async () => folders.writable(folders.get().projectsRoot)}));
installComparisonRoutes(app, {store,data,effects});
installLibraryRoutes(app, { library, getProject: (id) => getProject(id) });
installLibraryOrganizationRoutes(app, store);
installProjectLifecycle(app, { store, library });
installTreatmentRoutes(app, { store, getProject: (id) => getProject(id) });
installConnectionRoutes(app, registry, data);
app.get("/api/studio/defaults", (_req, res) => res.json(defaults.get()));
app.put("/api/studio/defaults", (req, res) => {
  try {
    res.json(defaults.save(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get("/api/video/settings", async (_req, res) =>
  res.json(await video.status()),
);

installImageRoutes(app,imageService);
installPhotoAnalysis(app,{store,data});
installAssetIntelligence(app,{store,data,checkpoint:id=>portable.checkpoint(id)});
app.get("/api/studio/mode", async (_req, res) =>
  res.json({ mode: await studioMode(data) }),
);
app.put("/api/studio/mode", async (req, res) =>
  res.json(await saveStudioMode(data, req.body.mode)),
);
const upload = multer({
  dest: path.join(data, "uploads"),
  limits: { fileSize: 1024 * 1024 * 1024 },
});
const getProject = (id) => {
  const p = store.get(id);
  if (!p) {
    const e = new Error("Project not found");
    e.status = 404;
    throw e;
  }
  const needsUpgrade = p.project.schemaVersion !== 2;
  upgradeProject(p.project);
  if (needsUpgrade) p.revision = store.save(p.project, p.revision);
  return p;
};
app.get("/api/models", async (_req, res) => res.json(await video.models()));
const videoDefaultsFile = path.join(data, "video-defaults.json");
app.get("/api/video-defaults", async (_req, res) => {
  try {
    res.json(JSON.parse(await fs.readFile(videoDefaultsFile, "utf8")));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    res.json({});
  }
});
app.put("/api/video-defaults", async (req, res) => {
  const mode =
    req.body.mode === "venice"
      ? "venice"
      : (await studioMode(data,"video")) === "live"
        ? "venice"
        : "demo";
  const { models } =
    mode === "venice" ? await video.status() : await video.models();
  const model = models.find(
    (m) => m.id === req.body.model && m.supported !== false,
  );
  if (!model) throw Error("Choose an available model before saving defaults.");
  const settings = {
    model: model.id,
    audio: model.audioConfigurable ? !!req.body.audio : !!model.audio,
  };
  for (const [key, values] of Object.entries({
    duration: model.durations,
    resolution: model.resolutions,
    aspect: model.aspects,
  })) {
    if (values?.length && !values.includes(req.body[key]))
      throw Error("Unsupported default " + key);
    if (values?.length) settings[key] = req.body[key];
  }
  let saved = {};
  try {
    saved = JSON.parse(await fs.readFile(videoDefaultsFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  saved[mode] = settings;
  const temp = videoDefaultsFile + "." + id();
  await fs.writeFile(temp, JSON.stringify(saved, null, 2));
  await fs.rename(temp, videoDefaultsFile);
  res.json(saved);
});
app.get("/api/venice/video", async (_req, res) =>
  res.json(await video.status()),
);
app.put("/api/venice/video", async (req, res) =>
  res.json(await video.setMode(req.body.mode)),
);
app.post("/api/venice/video/refresh", async (_req, res) =>
  res.json(await video.refresh()),
);
app.get("/api/projects", (_req, res) => res.json(store.list()));
installFolderRoutes(app, {data, store, folders});
app.post("/api/folder", async (req, res) => res.json({path: await chooseFolder(req.body?.initial || folders.get().projectsRoot)}));
app.post("/api/projects", async (req, res) => {
  const p = upgradeProject(
    newProject(String(req.body.name || "Untitled project").slice(0, 100)),
  );
  p.settings.inherit = Object.keys(settingGroups);
  p.settings = resolveProjectDefaults(p.settings, defaults.get());
  const parent = await folders.writable(req.body.folder || folders.get().projectsRoot);
  p.folder = path.join(
    parent,
    `${p.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "Project"}-${p.id.slice(0, 8)}`,
  );
  await fs.mkdir(p.folder, { recursive: true });
  await fs.mkdir(path.join(p.folder, "media"), { recursive: true });
  await fs.mkdir(path.join(p.folder, "exports"), { recursive: true });
  if (
    req.body.libraryIds !== undefined &&
    (!Array.isArray(req.body.libraryIds) ||
      req.body.libraryIds.length > 100 ||
      req.body.libraryIds.some((id) => typeof id !== "string"))
  )
    throw Error("Choose valid concept references.");
  for (const libraryId of new Set(req.body.libraryIds || []))
    p.assets.push(await library.adopt(libraryId, p));
  if (req.body.templateId || req.body.format || req.body.concept || req.body.libraryIds?.length)
    initializeProjectConcept(p, req.body);
  await materializeProjectTemplate(p, req.body, store);
  const revision = store.save(p, 0);
  await mirror(p);
  res.json({ project: p, revision });
});
async function mirror(p) {
  return portable.checkpoint(p.id);
}
app.post("/api/projects/open", async (req, res) =>
  res.json(await portable.open(req.body.folder)),
);
app.post("/api/projects/:id/backup", async (req, res) =>
  res.json(await portable.checkpoint(req.params.id)),
);
app.get("/api/providers", async (_req, res) =>
  res.json({ ...(await video.models()), evidence: providerEvidence }),
);
app.post("/api/providers/enable", (_req, res) =>
  res.status(403).json({
    error: "Use Settings → Venice video mode. Kie is not enabled.",
  }),
);
app.post("/api/providers/credentials", async (req, res) => {
  if (!["venice", "kie"].includes(req.body.provider))
    throw new Error("Unknown provider");
  const file = path.join(data, "credentials.json");
  let keys = {};
  try {
    keys = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {}
  keys[req.body.provider] = String(req.body.key || "");
  await fs.writeFile(file, JSON.stringify(keys), { mode: 0o600, flush: true });
  await fs.chmod(file, 0o600);
  res.json({ saved: true, mode: "demo" });
});
app.get("/api/projects/:id", (req, res) => res.json(getProject(req.params.id)));
app.put("/api/projects/:id", async (req, res) => {
  const old = getProject(req.params.id);
  const p = upgradeProject(validateProject(req.body.project));
  if (p.id !== old.project.id) throw new Error("Project id mismatch");
  p.folder = old.project.folder;
  validateAudio(p.audioClips);
  const revision = store.save(p, req.body.revision);
  let libraryError = null;
  await library.sync(p).catch((e) => {
    libraryError = e.message;
  });
  let backupError = null;
  await mirror(p).catch((e) => {
    backupError = e.message;
  });
  res.json({ revision, backupError, libraryError });
});
app.get("/api/projects/:id/history", (req, res) =>
  res.json(
    store.db
      .prepare(
        "SELECT revision,at FROM history WHERE projectId=? ORDER BY revision DESC LIMIT 100",
      )
      .all(req.params.id),
  ),
);
app.get("/api/projects/:id/history/:revision", (req, res) => {
  const row = store.db
    .prepare("SELECT body FROM history WHERE projectId=? AND revision=?")
    .get(req.params.id, +req.params.revision);
  if (!row) return res.sendStatus(404);
  res.json(JSON.parse(row.body));
});
app.get("/api/projects/:id/jobs", (req, res) =>
  res.json(store.jobViews(req.params.id)),
);
app.post("/api/projects/:id/quote", async (req, res) =>
  res.json(await video.quote(req.body.settings, req.body.quantity)),
);
app.post("/api/projects/:id/jobs", async (req, res) => {
  const { project, revision } = getProject(req.params.id);
  if (req.body.requestId) {
    const existing = store
      .jobs(project.id)
      .find((j) => j.requestId === req.body.requestId);
    if (existing) return res.json(jobView(existing));
  }
  const draft = project.drafts.find((d) => d.id === req.body.draftId);
  if (!draft) throw new Error("Draft not found");
  if (revision !== req.body.revision) {
    const e = new Error("Save the latest draft before generating");
    e.status = 409;
    throw e;
  }
  const authorization = await video.authorize(draft.settings, req.body.quoteId);
  if (!authorization.model)
    throw new Error("Select a model for the current video mode");
  if (
    authorization.provider !== "Local simulator" &&
    req.body.mode !== "venice"
  )
    throw new Error("Review Online mode and its price before generating");
  if (!draft.scenes.some(hasComposerWriting))
    throw new Error("Add dialogue or an action before generating");
  const model = authorization.model;
  const target = generationTarget(project, draft, store.jobs(project.id));
  let submissionDraft = draft;
  if (draft.optimizeOnGenerate) {
    const row = store.db.prepare("SELECT body FROM smart_jobs WHERE id=? AND projectId=?").get(req.body.optimizerJobId || '', project.id);
    submissionDraft = optimizedSubmissionDraft(project, draft, row ? JSON.parse(row.body) : null, model, authorization.provider === "Local simulator" ? "test" : "live");
  } else if (req.body.optimizerJobId) throw Error("Model adaptation was disabled. Review the current prompt before generating.");
  const generationDraft = {
    ...submissionDraft,
    targetId: target?.id || draft.targetId,
    start: target?.start ?? draft.start,
  };
  const compiled = compilePrompt(project, generationDraft, model);
  const validation = validatePreparation(
    project,
    generationDraft,
    compiled,
    model,
  );
  if (validation.errors.length)
    throw new Error(validation.errors.map((e) => e.message).join(" "));
  if (req.body.requestId) {
    const existing = store
      .jobs(project.id)
      .find((j) => j.requestId === req.body.requestId);
    if (existing) return res.json(jobView(existing));
  }
  const job = {
    id: id(),
    projectId: project.id,
    kind: "generation",
    episodeId: project.episodeId,
    batchId: req.body.batchId || null,
    requestId: req.body.requestId || id(),
    state: "queued",
    statusHistory: [{ state: "queued", at: Date.now() }],
    createdAt: Date.now(),
    dueAt: Date.now(),
    simulation:
      authorization.provider !== "Local simulator"
        ? "normal"
        : req.body.simulation || "normal",
    snapshot: {
      draft: structuredClone(generationDraft),
      ...(draft.optimizeOnGenerate ? { authoredDraft: structuredClone(draft), optimizerJobId: req.body.optimizerJobId } : {}),
      compiled,
      capabilities: structuredClone(model),
      validation,
      requestPayload: {
        model: draft.settings.model,
        prompt: compiled.text,
        settings: structuredClone(draft.settings),
        references: compiled.references,
        boundaries: compiled.boundaries,
        mode: "demo",
      },
      projectRevision: revision,
      template: structuredClone(project.settings),
      targetId: generationDraft.targetId,
      start: generationDraft.start,
      end: generationDraft.start + draft.settings.duration,
      provider: authorization.provider,
      providerId:
        model.providerId ||
        (authorization.provider === "Local simulator" ? "demo" : "venice"),
      connectionId: model.connectionId || "venice",
      executionMode:
        authorization.provider === "Local simulator" ? "test" : "live",
      model: draft.settings.model,
      price: authorization.price,
    },
    providerJobId: null,
    media: null,
  };
  job.state = "preparing";
  store.putJob(job);
  try {
    for (const [key, frame] of Object.entries(compiled.boundaries)) {
      if (
        !frame ||
        !model.frames ||
        (key === "end" && model.endFrame === false)
      )
        continue;
      const media = store.media(frame.takeId);
      if (!media) continue;
      const folder = path.join(project.folder, "references");
      await fs.mkdir(folder, { recursive: true });
      const file = path.join(folder, job.id + "-" + key + ".jpg");
      await providerFrame(
        media.original || media.path,
        file,
        Math.min(media.duration - 0.05, frame.time),
      );
      job.snapshot.compiled.boundaries[key] = {
        ...frame,
        file: path.relative(project.folder, file),
        sentToProvider: false,
      };
    }
    for (const ref of compiled.references.filter(
      (r) => r.kind === "continuity",
    )) {
      const image = ref.selectedMediaList[0];
      const frame = image.frameSource;
      const media = store.media(frame.takeId);
      if (!media || media.projectId !== project.id)
        throw new Error("Continuity source video is missing from this project");
      const folder = path.join(project.folder, "references");
      await fs.mkdir(folder, { recursive: true });
      const file = path.join(
        folder,
        job.id + "-continuity-" + (ref.boundaryKey || "start") + ".jpg",
      );
      await providerFrame(
        media.original || media.path,
        file,
        Math.max(0, Math.min(media.duration - 0.05, frame.time)),
      );
      image.frameFile = path.relative(project.folder, file);
      ref.selectedMedia = image;
      job.snapshot.compiled[
        ref.boundaryKey === "end"
          ? "continuityEndReference"
          : "continuityReference"
      ].file = image.frameFile;
    }
    if (
      authorization.provider !== "Local simulator" ||
      ["fal", "xai"].includes(model.providerId)
    )
      await video.prepare(job.snapshot, project);
  } catch (error) {
    job.state = "failed";
    job.error = "Local preparation failed before submission: " + error.message;
    store.putJob(job);
    throw error;
  }
  job.state = "queued";
  store.putJob(job);
  await portable.checkpoint(project.id);
  await fs.mkdir(path.join(project.folder, "generations"), { recursive: true });
  await fs.writeFile(
    path.join(project.folder, "generations", job.id + ".json"),
    JSON.stringify(job, null, 2),
  );
  res.status(201).json(jobView(job));
});
app.get("/api/jobs/:id/receipt", (req, res) => {
  const job = store.job(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.attachment(job.id + "-receipt.json").json(job);
});
app.post("/api/jobs/:id/cancel", (req, res) => {
  const j = store.job(req.params.id);
  if (!j) throw new Error("Job not found");
  if (isLiveJob(j) && j.state !== "queued")
    throw new Error(
      "Cancellation after provider submission is not enabled. This job stays tracked until its result is saved.",
    );
  if (["queued", "running"].includes(j.state)) {
    j.state = "cancelled";
    store.putJob(j);
  }
  res.json(j);
});
app.post("/api/jobs/:id/retry", (req, res) => {
  const j = store.job(req.params.id);
  if (!j) throw new Error("Job not found");
  if (j.state === "submission_uncertain")
    throw new Error(
      "Recover the provider ID instead of resubmitting this uncertain job",
    );
  if (
    !["failed", "download_failed", "interrupted", "unreachable"].includes(
      j.state,
    )
  )
    throw new Error("Job is not retryable");
  if (isLiveJob(j) && !j.providerJobId)
    throw new Error(
      "Review the current price and generate from the saved draft; this request will not be resubmitted automatically",
    );
  j.state = j.providerCompletedAt
    ? "download_pending"
    : j.providerJobId
      ? "running"
      : "queued";
  j.simulation = "normal";
  j.pollAt = Date.now();
  j.error = null;
  store.putJob(j);
  res.json(j);
});
app.post("/api/jobs/:id/recover", (req, res) => {
  const j = store.job(req.params.id);
  if (j?.state !== "submission_uncertain")
    throw new Error("This job does not need ID recovery");
  if (
    isLiveJob(j) &&
    !/^[a-zA-Z0-9_-]{8,200}$/.test(req.body.providerJobId || "")
  )
    throw new Error("Enter the provider request ID for this request");
  if (!isLiveJob(j) && req.body.providerJobId !== j.recoveryId)
    throw new Error("The sample recovery ID does not match the accepted request");
  j.providerJobId = req.body.providerJobId;
  j.state = "running";
  j.pollAt = Date.now() + 500;
  j.simulation = "normal";
  j.submitCount = 1;
  store.putJob(j);
  res.json(j);
});
app.post(
  "/api/projects/:id/import",
  upload.single("file"),
  async (req, res) => {
    const { project } = getProject(req.params.id);
    const file = req.file;
    if (!file) throw new Error("Choose a media file");
    const mediaId = id(),
      folder = path.join(project.folder, "media");
    await fs.mkdir(folder, { recursive: true });
    const ext = path.extname(file.originalname).toLowerCase();
    const original = path.join(folder, mediaId + "-original" + ext);
    await fs.rename(file.path, original);
    const image = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
    const audio = [".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"].includes(
      ext,
    );
    const output = path.join(folder, mediaId + (audio ? ".m4a" : ".mp4"));
    let info = image ? { duration: 5, audio: false } : await probe(original);
    const originalDuration = info.duration;
    if (image)
      await run([
        "-loop",
        "1",
        "-i",
        original,
        "-t",
        "5",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        output,
      ]);
    else if (audio)
      await run([
        "-i",
        original,
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
        output,
      ]);
    // Video originals stay canonical; playback proxies live in a disposable cache.
    const poster = audio ? null : path.join(folder, mediaId + ".jpg");
    if (poster)
      await thumbnail(
        image ? output : original,
        poster,
        Math.min(0.2, info.duration / 2),
      );
    const m = {
      id: mediaId,
      projectId: project.id,
      path: image || audio ? output : original,
      original,
      poster,
      duration: info.duration,
      originalDuration,
      ...(info.playback ? { playback: info.playback } : {}),
      audio: info.audio || audio,
      name: file.originalname,
      kind: image ? "image" : audio ? "audio" : "video",
      url: "/api/media/" + mediaId,
      thumbnail: poster ? "/api/media/" + mediaId + "/thumbnail" : "/audio.svg",
    };
    store.putMedia(m);
    if (m.kind === "video") previews.ensure(m).catch(() => {});
    await portable.checkpoint(project.id);
    res.json(m);
  },
);
app.post("/api/media/:id/optimize-preview", async (req, res) => {
  const media = store.media(req.params.id);
  if (!media) return res.sendStatus(404);
  if (["image", "audio"].includes(media.kind))
    return res.status(400).json({ error: "Choose a video clip to optimize." });
  const cached = await previews.ensure(media, 2, true);
  res.json({ id: media.id, playback: cached.info.playback });
});
app.get("/api/media/:id/preview-status", async (req, res) => {
  const media = store.media(req.params.id);
  if (!media) return res.sendStatus(404);
  res.json(await previews.status(media));
});
app.post("/api/preview/working-set", async (req, res) => {
  if (!Array.isArray(req.body.mediaIds) || req.body.mediaIds.length > 2)
    return res
      .status(400)
      .json({ error: "A preview session holds at most two videos." });
  await previews.pin(
    req.body.client,
    req.body.mediaIds.map((id) => store.media(id)).filter(Boolean),
  );
  res.json({ ok: true });
});
app.get("/api/media/:id/preview", async (req, res) => {
  const media = store.media(req.params.id);
  if (!media) return res.sendStatus(404);
  await previews.send(media, res);
});
app.get("/api/media/:id/waveform", async (req, res) => {
  const media = store.media(req.params.id);
  if (!media) return res.sendStatus(404);
  res.json(
    await waveform(media, path.join(data, "audio-cache"), derivatives.remember),
  );
});
app.get("/api/media/:id/audio", async (req, res) => {
  const media = store.media(req.params.id);
  if (!media) return res.sendStatus(404);
  await derivatives.send(
    await audioPlayback(media, path.join(data, "audio-cache")),
    res,
  );
});
app.post("/api/projects/:id/audio-mix", async (req, res) => {
  const { project, revision } = getProject(req.params.id);
  if (req.body.revision !== revision)
    return res
      .status(409)
      .json({ error: "Project changed. Save it and try again." });
  const clips = project.audioClips;
  if (!clips.length) throw new Error("Add audio before creating a mix.");
  const mediaFor = (c) => {
    const media = store.media(c.mediaId);
    return media?.projectId === project.id ? media : null;
  };
  const start = Math.min(...clips.map((c) => c.start)),
    mid = id();
  const output = path.join(project.folder, "media", mid + "-mix.wav");
  await fs.mkdir(path.dirname(output), { recursive: true });
  try {
    await run([
      ...mixArguments(clips, mediaFor, start),
      "-c:a",
      "pcm_s24le",
      output + ".partial.wav",
    ]);
    await fs.rename(output + ".partial.wav", output);
    const info = await probe(output);
    const media = {
      id: mid,
      projectId: project.id,
      path: output,
      original: output,
      name: "Audio mix",
      thumbnail: "/audio.svg",
      kind: "audio",
      audio: true,
      duration: info.duration,
      url: "/api/media/" + mid,
    };
    store.putMedia(media);
    await portable.checkpoint(project.id);
    res.json({ media, start, sourceClips: clips });
  } finally {
    await fs.rm(output + ".partial.wav", { force: true });
  }
});
app.get("/api/media/:id", async (req, res) => {
  const m = store.media(req.params.id);
  if (!m) return res.sendStatus(404);
  const cached = await previews.ready(await previews.describe(m));
  if (cached) return previews.send(m, res);
  if (!["image", "audio"].includes(m.kind)) previews.status(m).catch(() => {});
  res.sendFile(m.path);
});
app.get("/api/media/:id/original", (req, res) => {
  const m = store.media(req.params.id);
  if (!m || m.kind !== "image") return res.status(404).end();
  res.sendFile(m.original);
});
app.get("/api/media/:id/thumbnail", (req, res) => {
  const m = store.media(req.params.id);
  if (!m?.poster) return res.sendStatus(404);
  res.sendFile(m.poster);
});
const cachedFrame = createFrameCache();
app.get("/api/media/:id/frame", async (req, res) => {
  const m = store.media(req.params.id);
  if (!m) return res.sendStatus(404);
  const time = Math.max(
    0,
    Math.min(m.duration - 0.05, Number(req.query.time) || 0),
  );
  const folder = path.join(data, "frames");
  await fs.mkdir(folder, { recursive: true });
  const out = path.join(folder, `${m.id}-${time.toFixed(2)}.jpg`);
  await cachedFrame(m.path, out, time);
  await derivatives.send(out, res);
});
app.post("/api/projects/:id/demo", async (req, res) => {
  const { project } = getProject(req.params.id);
  const sample = path.join(data, "sample.mp4");
  if (!existsSync(sample))
    throw new Error("Sample footage is missing. Run npm run setup:demo first.");
  const media = [];
  for (let i = 0; i < 3; i++) {
    const mid = id(),
      file = path.join(project.folder, "media", mid + ".mp4"),
      poster = file + ".jpg";
    await renderDemo(
      sample,
      file,
      { duration: 10, aspect: "16:9" },
      [4, 22, 40][i],
    );
    await thumbnail(file, poster, 0.5);
    const m = {
      id: mid,
      projectId: project.id,
      path: file,
      poster,
      duration: 10,
      audio: false,
      name: `Sample footage ${i + 1}`,
      url: "/api/media/" + mid,
      thumbnail: "/api/media/" + mid + "/thumbnail",
      attribution:
        "Big Buck Bunny © 2008 Blender Foundation · CC BY 3.0 · peach.blender.org",
    };
    store.putMedia(m);
    media.push(m);
  }
  await portable.checkpoint(project.id);
  res.json(media);
});
app.post("/api/projects/:id/export", async (req, res) => {
  const { project, revision } = getProject(req.params.id);
  if (revision !== req.body.revision) throw new Error("Save before exporting");
  if (!project.clips.length && !elementsFor(project).length) throw new Error("The timeline is empty");
  const issues = timelineIssues(project.clips);
  if (issues.length) throw new Error(issues.map((i) => i.message).join("; "));
  const job = {
    id: id(),
    projectId: project.id,
    kind: "export",
    state: "queued",
    createdAt: Date.now(),
    dueAt: Date.now(),
    snapshot: {
      fileName: exportFileName(req.body.fileName || project.name),
      clips: structuredClone(project.clips),
      elements: structuredClone(elementsFor(project)),
      audioClips: structuredClone(project.audioClips),
      export: structuredClone(project.settings.export),
      projectRevision: revision,
    },
  };
  store.putJob(job);
  res.json(job);
});
app.get("/api/exports/:id", (req, res) => {
  const j = store.job(req.params.id);
  if (!j || j.kind !== "export" || j.state !== "ready")
    return res.sendStatus(404);
  res.download(j.output, exportFileName(j.snapshot.fileName || getProject(j.projectId).project.name));
});
app.get("/api/exports/:id/preview", (req,res)=>{
  const j=store.job(req.params.id);
  if (!j || j.kind!=="export" || j.state!=="ready") return res.sendStatus(404);
  res.sendFile(path.resolve(j.output));
});
installAIRouting(app,{data});
installCatalogRoutes(
  app,
  createCatalogService({
    data,
    venice: createVeniceSettings(data),
    deepseek: createVeniceSettings(data, "deepseek"),
    video,
    discover: discoverDeepSeekModels,
  }),
);
installComposerAssistant(app, {store, data, models: async () => (await video.models()).models});
installSmartRoutes(app, {
  video,
  store,
  data,
  getProject,
  checkpoint: portable.checkpoint,
});
installAuthoringRoutes(app, {
  store,
  data,
  getProject,
  checkpoint: portable.checkpoint,
  video,
});
installBillingRoutes(
  app,
  createBillingService({
    store,
    data,
    settings: {
      venice: createVeniceSettings(data),
      deepseek: createVeniceSettings(data, "deepseek"),
      fal: credentials(data, "fal"),
    },
  }),
  getProject,
);
startWorker({
  store,
  data,
  checkpoint: portable.checkpoint,
  video,
  preparePreview: async (media) => {
    previews.ensure(media).catch(() => {});
  },
});
app.use("/api", (err, req, res, next) => {
  console.error(err.message);
  if (req.file) fs.unlink(req.file.path).catch(() => {});
  res.status(err.status || 400).json({ error: err.message });
});
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist", "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
httpServer = app.listen(port, "127.0.0.1", () =>
  console.log(`Frame studio: http://127.0.0.1:${port}`),
);
