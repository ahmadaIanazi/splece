import { createProviderRegistry } from "./provider-registry.mjs";
import { falPayload, falEndpoints, falModel } from "./adapters/fal.mjs";
import { providerId } from "../shared/providers.mjs";
import { referenceRoles } from "../shared/reference-roles.mjs";
import { studioMode } from "./mode.mjs";
import { imageDimensions } from "./media.mjs";
import {
  referenceCapabilities,
  referenceBindings,
  referenceErrors,
} from "../shared/references.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { models as demos } from "./domain.mjs";
import { createVeniceSettings } from "./smart.mjs";
import { VeniceAdapter } from "./providers.mjs";
import { providerTransport } from "./security.mjs";

export function normalizeVideoCatalog(raw, fetchedAt = Date.now()) {
  if (!Array.isArray(raw.data))
    throw new Error("Venice returned an invalid model catalog");
  return raw.data.map((m) => {
    const c = m.model_spec?.constraints || {};
    const durations = (c.durations || [])
      .filter((x) => /^\d+s$/.test(x))
      .map((x) => parseInt(x))
      .sort((a, b) => a - b);
    const type = c.model_type;
    const mapping = referenceCapabilities(m.id, type);
    const special =
      /reference-to-video|multi-angle|keyframe|transition/.test(m.id) &&
      !["flat", "elements"].includes(mapping.referenceMode) &&
      !mapping.requiresEnd;
    const supported =
      !m.model_spec?.offline &&
      !special &&
      (["text-to-video", "image-to-video"].includes(type) ||
        mapping.requiresEnd) &&
      durations.length > 0;
    return {
      id: m.id,
      name: `${m.model_spec?.name || m.id} · ${m.id}`,
      provider: "Venice",
      providerId: "venice",
      connectionId: "venice",
      endpointId: m.id,
      operation: type,
      outputKind: "video",
      durations,
      aspects: c.aspect_ratios || [],
      resolutions: [...(c.resolutions || [])].sort(
        (a, b) => resolution(a) - resolution(b),
      ),
      ...mapping,
      audio: !!c.audio,
      audioConfigurable: !!c.audio_configurable,
      promptLimit: c.prompt_character_limit || 2500,
      referenceRoles: referenceRoles.map(r => r.id),
      type,
      supported,
      unavailableReason: supported
        ? null
        : m.model_spec?.offline
          ? "Provider offline"
          : "Requires a specialized reference, editing or enhancement workflow",
      constraints: c,
      pricing: m.model_spec?.pricing || null,
      providerDefaults: m.model_spec?.defaults || null,
      studioDefaults: {
        duration: durations[0] ?? null,
        resolution:
          [...(c.resolutions || [])].sort(
            (a, b) => resolution(a) - resolution(b),
          )[0] ?? null,
        aspect: c.aspect_ratios?.[0] ?? null,
        audio: false,
      },
      metadata: m,
      catalogVersion: String(fetchedAt),
      fetchedAt,
    };
  });
}
function resolution(s) {
  return /k$/i.test(s)
    ? parseFloat(s) * 1024
    : parseInt(s.replace(/\D/g, "")) || 0;
}
export function videoPayload(settings, model, prompt = "") {
  if (!model?.supported)
    throw new Error(
      model?.unavailableReason ||
        "Refresh Venice models and select a supported model",
    );
  for (const [key, choices] of Object.entries({
    duration: model.durations,
    aspect: model.aspects,
    resolution: model.resolutions,
  }))
    if (choices.length && !choices.includes(settings[key]))
      throw new Error(
        `Unsupported ${key}; select the model again to update its settings`,
      );
  const result = { model: model.id, duration: settings.duration + "s", prompt };
  if (model.aspects.length) result.aspect_ratio = settings.aspect;
  if (model.resolutions.length) result.resolution = settings.resolution;
  if (model.audioConfigurable) result.audio = !!settings.audio;
  return result;
}
export function createVideoService({
  data,
  store,
  fetcher = fetch,
  transport = providerTransport({ demo: false, timeoutMs: 120000 }),
  registry = createProviderRegistry({ data, transport }),
}) {
  const credentials = createVeniceSettings(data),
    configFile = path.join(data, "video-settings.json"),
    catalogFile = path.join(data, "video-catalog.json");
  const read = async (file, fallback) => {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return fallback;
      throw e;
    }
  };
  const write = async (file, value) => {
    const tmp = file + "." + randomUUID();
    await fs.writeFile(tmp, JSON.stringify(value), {
      flush: true,
      mode: 0o600,
    });
    await fs.rename(tmp, file);
  };
  const quotes = new Map();
  const service = {
    async status() {
      const config = await read(configFile, { mode: "demo" }),
        catalog = await read(catalogFile, { models: [] });
      const globalMode = await studioMode(data);
      if (globalMode) config.mode = globalMode === "test" ? "demo" : "venice";
      return {
        ...config,
        hasKey: !!(await credentials.key()),
        fetchedAt: catalog.fetchedAt,
        models: [
          ...catalog.models.map((m) => ({
            ...m,
            ...referenceCapabilities(m.id, m.type),
            referenceRoles: referenceRoles.map(r => r.id),
            supported:
              !m.unavailableReason ||
              (m.unavailableReason !== "Provider offline" &&
                (["flat", "elements"].includes(
                  referenceCapabilities(m.id, m.type).referenceMode,
                ) ||
                  referenceCapabilities(m.id, m.type).requiresEnd)),
          })),
          ...((await registry.catalog("fal")).models || []),
        ],
      };
    },
    async setMode(mode) {
      if (!["demo", "venice"].includes(mode))
        throw new Error("Unknown video mode");
      if (
        mode === "venice" &&
        !(await credentials.key()) &&
        !(await registry.credentials("fal").key())
      )
        throw new Error("Save a video provider API key first");
      await write(configFile, { mode });
      return service.status();
    },
    async refresh() {
      const response = await fetcher(
        "https://api.venice.ai/api/v1/models?type=video",
        { redirect: "error", signal: AbortSignal.timeout(30000) },
      );
      if (!response.ok)
        throw new Error(`Model discovery failed (${response.status})`);
      const fetchedAt = Date.now(),
        models = normalizeVideoCatalog(await response.json(), fetchedAt);
      await write(catalogFile, { models, fetchedAt });
      return service.status();
    },
    async models() {
      const s = await service.status();
      return {
        models:
          s.mode === "demo"
            ? [
                ...demos,
                ...falEndpoints.map((e) => ({
                  ...falModel(e),
                  name: falModel(e).name + " · Offline",
                })),
              ]
            : s.models,
        mode: s.mode,
        liveEnabled: s.mode === "venice",
        fetchedAt: s.fetchedAt,
      };
    },
    async adapter(id = "venice") {
      return registry.adapter(id);
    },
    async quote(settings, quantity = 1) {
      quantity = Math.max(1, Math.min(12, Number(quantity) || 1));
      const status = await service.status();
      if (status.mode === "demo") {
        if (
          !(await service.models()).models.some((m) => m.id === settings.model)
        )
          throw new Error("Select an Offline sample model");
        return {
          amount: 0,
          unit: "credits",
          quantity,
          type: "exact",
          quotedAt: Date.now(),
          settings,
          version: "demo-v2",
        };
      }
      const model = status.models.find((m) => m.id === settings.model),
        requestPayload = videoPayload(settings, model);
      const result = await (
        await service.adapter(providerId(model) || "venice")
      ).quote({ requestPayload, capabilities: model });
      if (
        typeof result.quote !== "number" ||
        !Number.isFinite(result.quote) ||
        result.quote < 0
      )
        throw new Error("The provider did not return a usable price");
      const quote = {
        id: randomUUID(),
        amount: result.quote,
        unit: "USD",
        quantity,
        total: result.quote * quantity,
        type: "estimate",
        quotedAt: Date.now(),
        settings,
        version: model.catalogVersion,
        live: true,
        providerId: providerId(model) || "venice",
        note: result.note,
        basis: result.basis,
      };
      quotes.set(quote.id, quote);
      for (const [id, q] of quotes)
        if (Date.now() - q.quotedAt > 300000) quotes.delete(id);
      return quote;
    },
    async authorize(settings, quoteId) {
      const s = await service.status();
      if (s.mode === "demo")
        return {
          model: (await service.models()).models.find(
            (m) => m.id === settings.model,
          ),
          price: { amount: 0, unit: "credits" },
          provider: "Local simulator",
        };
      const q = quotes.get(quoteId);
      if (
        !q ||
        Date.now() - q.quotedAt > 300000 ||
        JSON.stringify(q.settings) !== JSON.stringify(settings)
      )
        throw new Error("Refresh the price estimate before generating");
      const model = s.models.find((m) => m.id === settings.model);
      videoPayload(settings, model);
      if (q.version !== model.catalogVersion)
        throw new Error("Model catalog changed; refresh the price estimate");
      return {
        model,
        price: { ...q },
        provider: model.provider,
        providerId: providerId(model) || "venice",
      };
    },
    async prepare(snapshot, project) {
      const m = snapshot.capabilities,
        payload = videoPayload(
          snapshot.draft.settings,
          m,
          snapshot.compiled.text,
        );
      const issues = referenceErrors(snapshot.compiled, m);
      if (issues.length) throw new Error(issues.join(" "));
      const loadImage = async (file) => {
        const bytes = await fs.readFile(file);
        if (bytes.length > 20 * 1024 * 1024)
          throw new Error("Reference image exceeds 20 MB");
        const mime = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".webp": "image/webp",
        }[path.extname(file).toLowerCase()];
        if (!mime) throw new Error("Use PNG, JPEG or WebP reference images");
        const dimensions = await imageDimensions(file),
          c = m.constraints || {},
          short = Math.min(dimensions.width, dimensions.height),
          ratio = dimensions.width / dimensions.height;
        if (
          c.reference_image_min_short_side_pixels &&
          short < c.reference_image_min_short_side_pixels
        )
          throw new Error(
            `This model requires image short side of at least ${c.reference_image_min_short_side_pixels}px; original image retained`,
          );
        if (
          (c.reference_image_min_aspect_ratio &&
            ratio < c.reference_image_min_aspect_ratio) ||
          (c.reference_image_max_aspect_ratio &&
            ratio > c.reference_image_max_aspect_ratio)
        )
          throw new Error(
            "Reference aspect ratio is outside this model limits; choose another image or model",
          );
        return `data:${mime};base64,${bytes.toString("base64")}`;
      };
      const loadMedia = async (media) => {
        if (media.frameSource) {
          const source = store.media(media.frameSource.takeId);
          if (!source || source.projectId !== project.id || !media.frameFile)
            throw new Error(
              "Continuity reference could not be prepared from this project",
            );
          const file = path.resolve(project.folder, media.frameFile);
          if (
            !file.startsWith(
              path.resolve(project.folder, "references") + path.sep,
            )
          )
            throw new Error("Invalid continuity reference path");
          return loadImage(file);
        }
        const saved = store.media(media.id);
        if (!saved || saved.projectId !== project.id)
          throw new Error("Reference image is missing from this project");
        return loadImage(saved.original || saved.path);
      };
      const bindings = referenceBindings(snapshot.compiled.references, m);
      for (const binding of bindings) {
        const images = await Promise.all(binding.media.map(loadMedia));
        payload[binding.field] ??= [];
        payload[binding.field].push(
          binding.field === "elements"
            ? {
                frontal_image_url: images[0],
                ...(images.length > 1
                  ? { reference_image_urls: images.slice(1) }
                  : {}),
              }
            : images[0],
        );
      }
      snapshot.referenceBindings = bindings.map(({ media, ...b }) => ({
        ...b,
        mediaIds: media.map((m) => m.id),
      }));
      for (const key of ["start", "end"]) {
        const frame = snapshot.compiled.boundaries[key];
        if (!frame || !m.frames || (key === "end" && !m.endFrame)) continue;
        if (!frame.file)
          throw new Error(
            `The ${key} frame could not be prepared; choose an available source`,
          );
        payload[key === "start" ? "image_url" : "end_image_url"] =
          await loadImage(path.join(project.folder, frame.file));
        frame.sentToProvider = true;
      }
      if (m.referenceMode === "single" && !payload.image_url) {
        const ref = snapshot.compiled.references.find((r) => r.selectedMedia);
        if (ref) payload.image_url = await loadMedia(ref.selectedMedia);
      }
      if (payload.prompt.length > m.promptLimit)
        throw new Error(
          "Prompt including reference roles exceeds this model limit; your draft is retained",
        );
      if (Buffer.byteLength(JSON.stringify(payload)) > 25 * 1024 * 1024)
        throw new Error(
          "Combined reference request exceeds 25 MB. Choose smaller reference images; originals remain saved.",
        );
      snapshot.requestPayload =
        m.providerId === "fal" ? falPayload(payload, m) : payload;
      snapshot.providerId = m.providerId || "venice";
      snapshot.connectionId = m.connectionId || snapshot.providerId;
      snapshot.capabilityVersion = m.capabilityVersion || m.catalogVersion;
    },
  };
  return service;
}
// Download URLs never receive the API key. Restrict to the documented Venice share host.
export async function downloadVideo(url, fetcher = fetch, provider = "venice") {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    !(provider === "fal"
      ? u.hostname === "fal.media" || u.hostname.endsWith(".fal.media")
      : u.hostname === "private-share.venice.ai") ||
    u.username ||
    u.password ||
    u.port
  )
    throw new Error(
      "Unrecognized provider download host; transfer paused with the provider job retained",
    );
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok)
    throw new Error(
      `Video transfer failed (${response.status}); retry download only`,
    );
  return response;
}
export async function writeVideoResponse(response, file) {
  let size = 0;
  const limit = new Transform({
    transform(chunk, enc, callback) {
      size += chunk.length;
      callback(
        size > 2 * 1024 ** 3
          ? new Error("Video exceeds 2 GB download limit")
          : null,
        chunk,
      );
    },
  });
  if (!response.body) throw new Error("Empty video response");
  await pipeline(
    Readable.fromWeb(response.body),
    limit,
    createWriteStream(file),
  );
  if (!size) throw new Error("Empty video download");
}
