import { ProviderError } from "../providers.mjs";
import { providerTransport } from "../security.mjs";
import { referenceRoles } from "../../shared/reference-roles.mjs";

// Explicit mappings, checked against xAI's published API on 28 October 2026.
export const xaiVideoModels = [
  "text-to-video",
  "image-to-video",
  "reference-to-video",
].map((type) => ({
  id: `xai:grok-imagine-video-1.5:${type}`,
  endpointId: "grok-imagine-video-1.5",
  providerId: "xai",
  connectionId: "xai",
  provider: "xAI",
  name: `Grok Imagine 1.5 · ${type === "text-to-video" ? "Text" : type === "image-to-video" ? "First / last frame" : "References"}`,
  type,
  operation: type,
  outputKind: "video",
  supported: true,
  durations: [5, 8, 10, 15],
  durationRange: { min: 1, max: 15, step: 1 },
  aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"],
  // Last-frame pins activate reference mode, which is capped at 720p.
  resolutions:
    type === "text-to-video" ? ["480p", "720p", "1080p"] : ["480p", "720p"],
  frames: type === "image-to-video",
  endFrame: type === "image-to-video",
  referenceMode:
    type === "text-to-video"
      ? "none"
      : type === "image-to-video"
        ? "single"
        : "flat",
  maxReferences:
    type === "reference-to-video" ? 14 : type === "image-to-video" ? 1 : 0,
  continuityAsReference: type === "reference-to-video",
  referenceTokenStyle: "xai",
  audio: true,
  audioConfigurable: true,
  promptLimit: 4096,
  referenceRoles: referenceRoles.map((r) => r.id),
  catalogVersion: "xai-imagine-2026-10-28-v1",
  source: "https://docs.x.ai/developers/model-capabilities/video/generation",
}));
export function xaiVideoPayload(payload, model) {
  if (!xaiVideoModels.some((m) => m.id === model.id))
    throw Error("Unsupported xAI video workflow.");
  const duration = parseInt(payload.duration, 10);
  if (
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 15 ||
    !model.resolutions.includes(payload.resolution)
  )
    throw Error("Choose a supported Grok duration and resolution.");
  if (payload.elements?.length || payload.reference_audio_urls?.length)
    throw Error(
      "This Grok workflow does not accept elements or audio uploads.",
    );
  const images = payload.reference_image_urls || [];
  if (
    images.length > model.maxReferences ||
    (images.length && model.referenceMode !== "flat") ||
    (model.referenceMode === "flat" && !images.length)
  )
    throw Error("Choose between 1 and 14 Grok reference images.");
  if ((payload.image_url || payload.end_image_url) && !model.frames)
    throw Error("Choose Grok First / last frame for exact frame pins.");
  if (model.frames && !payload.image_url)
    throw Error("Grok First / last frame needs a start image.");
  return {
    model: model.endpointId,
    prompt: payload.prompt,
    duration,
    resolution: payload.resolution,
    generate_audio: !!payload.audio,
    ...(!model.frames ? { aspect_ratio: payload.aspect_ratio } : {}),
    ...(payload.image_url ? { image: { url: payload.image_url } } : {}),
    ...(payload.end_image_url
      ? { last_frame: { url: payload.end_image_url } }
      : {}),
    ...(images.length
      ? { reference_images: images.map((url) => ({ url })) }
      : {}),
  };
}
export class XaiAdapter {
  constructor({
    key,
    transport = providerTransport({ demo: false }),
    allowSubmit = async () => false,
  } = {}) {
    Object.assign(this, { key, transport, allowSubmit });
  }
  call(route, body) {
    return this.transport("https://api.x.ai/v1/" + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async catalog() {
    const r = await this.call("models");
    if (!r.ok)
      throw new ProviderError(
        `xAI connection failed (${r.status})`,
        "catalog",
        r.status,
      );
    const raw = await r.json();
    if (!Array.isArray(raw.data))
      throw Error("xAI returned an invalid model catalog.");
    const ids = new Set(raw.data.map((m) => m.id));
    const models = xaiVideoModels.filter((m) => ids.has(m.endpointId));
    const imageModelIds = ["grok-imagine-image-2.0"].filter((id) =>
      ids.has(id),
    );
    if (!models.length && !imageModelIds.length)
      throw Error(
        "This key has no supported Grok image or video models. Check model access in xAI Console.",
      );
    return { models, imageModelIds, fetchedAt: Date.now() };
  }
  async quote({ requestPayload, capabilities }) {
    const rate = { "480p": 0.08, "720p": 0.14, "1080p": 0.25 }[
      requestPayload.resolution
    ];
    if (!rate) throw Error("Unsupported Grok resolution.");
    const inputAllowance = capabilities.frames
      ? 0.02
      : capabilities.referenceMode === "flat"
        ? 0.14
        : 0;
    return {
      quote: Number(
        (parseInt(requestPayload.duration) * rate + inputAllowance).toFixed(4),
      ),
      basis: "published",
      note: `Published xAI rates checked 28 Oct 2026. Includes up to $${inputAllowance.toFixed(2)} for input images; actual input charges may be lower. Image-to-video follows the source shape.`,
    };
  }
  async submit(snapshot) {
    if (!(await this.allowSubmit()))
      throw new ProviderError(
        "Offline mode blocks Grok generation.",
        "validation",
      );
    let r;
    try {
      r = await this.call("videos/generations", snapshot.requestPayload);
    } catch {
      throw new ProviderError(
        "Grok submission response lost. Check provider history before resubmitting.",
        "submission_uncertain",
      );
    }
    if (r.status >= 500 || r.status === 408)
      throw new ProviderError(
        "Grok acceptance is uncertain.",
        "submission_uncertain",
        r.status,
      );
    if (!r.ok)
      throw new ProviderError(
        `Grok rejected the request (${r.status}).`,
        "submission",
        r.status,
      );
    try {
      const v = await r.json();
      if (!/^[\w-]{8,200}$/.test(v.request_id || "")) throw Error();
      return { providerJobId: v.request_id, providerRequestId: v.request_id };
    } catch {
      throw new ProviderError(
        "Grok accepted the request but its request ID could not be read. Check provider history.",
        "submission_uncertain",
      );
    }
  }
  async poll(job) {
    if (!/^[\w-]{8,200}$/.test(job.providerJobId || ""))
      throw new ProviderError("Invalid Grok request ID.", "poll", 422);
    const r = await this.call("videos/" + job.providerJobId);
    if (!r.ok)
      throw new ProviderError(
        `Grok status unavailable (${r.status}).`,
        "poll",
        r.status,
      );
    const v = await r.json();
    if (v.status === "failed" || v.video?.respect_moderation === false)
      return {
        state: "failed",
        error: "Grok could not generate this request.",
        raw: { status: v.status },
      };
    if (v.status !== "done")
      return { state: "processing", raw: { status: v.status } };
    if (!v.video?.url)
      throw new ProviderError("Grok completed without a video.", "poll", 422);
    return {
      state: "completed",
      downloadUrl: v.video.url,
      raw: { status: v.status },
    };
  }
}
