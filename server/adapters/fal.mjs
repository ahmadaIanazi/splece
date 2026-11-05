import { supportsSoundReference } from "../../shared/video-sound-continuity.mjs";
import { createHash } from "node:crypto";
import { ProviderError } from "../providers.mjs";
import { providerTransport } from "../security.mjs";
import { referenceRoles } from "../../shared/reference-roles.mjs";

export const falEndpoints = [
  "text-to-video",
  "image-to-video",
  "reference-to-video",
].map((mode) => `alibaba/wan-3.0/${mode}`);
const revision = "fal-wan3-v2";
function inputSchema(schema) {
  return Object.values(schema?.components?.schemas || {}).find(
    (s) => s.properties?.prompt && s.properties?.resolution,
  );
}
const concrete = (s = {}) => ({
  ...s,
  ...(s.anyOf?.find((x) => x.type !== "null") || {}),
});
export function falModel(
  endpoint,
  metadata = {},
  schema = null,
  fetchedAt = Date.now(),
) {
  const type = endpoint.split("/").at(-1),
    frames = type === "image-to-video",
    refs = type === "reference-to-video";
  const input = inputSchema(schema),
    props = input?.properties || {};
  const mapped = [
    "prompt",
    "resolution",
    "aspect_ratio",
    "duration",
    "audio",
    "enable_prompt_expansion",
    "start_image_url",
    "end_image_url",
    "reference_image_urls",
    "reference_audio_urls",
  ];
  const schemaChanged =
    !!schema &&
    (!input ||
      (input.required || []).some((k) => !mapped.includes(k)) ||
      [
        "prompt",
        "resolution",
        "aspect_ratio",
        "duration",
        "audio",
        "enable_prompt_expansion",
        ...(frames
          ? ["start_image_url"]
          : refs
            ? ["reference_image_urls"]
            : []),
      ].some((k) => !props[k]));
  const supported =
    falEndpoints.includes(endpoint) &&
    !schemaChanged &&
    metadata.status !== "deprecated";
  const duration = concrete(props.duration),
    prompt = concrete(props.prompt);
  const min = duration.minimum ?? 2,
    max = duration.maximum ?? 30;
  const resolutions = (
    props.resolution?.enum || ["480p", "720p", "1080p"]
  ).filter((v) => ["480p", "720p", "1080p"].includes(v));
  const aspects = (
    props.aspect_ratio?.enum || ["16:9", "9:16", "1:1", "4:3", "3:4"]
  ).filter((v) => v !== "adaptive");
  return {
    id: `fal:${endpoint}`,
    endpointId: endpoint,
    providerId: "fal",
    connectionId: "fal",
    provider: "fal.ai",
    name: `fal.ai · Wan 3.0 · ${refs ? "References" : frames ? "First / last frame" : "Text to video"}`,
    type,
    operation: type,
    outputKind: "video",
    supported,
    unavailableReason: supported
      ? null
      : "The provider schema changed or this endpoint needs a verified Splece workflow mapping.",
    durations: [5, 10, 15, 20, 25, 30].filter((v) => v >= min && v <= max),
    durationRange: { min, max, step: 1 },
    aspects,
    resolutions,
    referenceMode: refs ? "flat" : frames ? "single" : "none",
    referenceLabel: "Image ",
    continuityAsReference: refs,
    maxReferences: refs
      ? Math.min(10, props.reference_image_urls?.maxItems ?? 10)
      : frames
        ? 1
        : 0,
    frames,
    endFrame: frames && (!schema || !!props.end_image_url),
    audio: true,
    audioConfigurable: true,
    audioReferences: refs && (!schema || !!props.reference_audio_urls),
    promptLimit: prompt.maxLength ?? 20000,
    referenceRoles: referenceRoles.map(r => r.id),
    constraints: {
      exclusiveInputs: ["frames", "references"],
      maxImageBytes: 20 * 1024 * 1024,
    },
    providerDefaults: {
      resolution: props.resolution?.default ?? "1080p",
      duration: props.duration?.default ?? 5,
      audio: props.audio?.default ?? true,
      aspect: props.aspect_ratio?.default ?? "adaptive",
    },
    studioDefaults: {
      resolution: "480p",
      duration: 5,
      aspect: "16:9",
      audio: true,
    },
    source: `https://fal.ai/models/${endpoint}/api`,
    verifiedAt: "2026-10-26",
    capabilityVersion: revision,
    catalogVersion: createHash("sha256")
      .update(JSON.stringify({ revision, schema, metadata }))
      .digest("hex")
      .slice(0, 20),
    fetchedAt,
    metadata,
    schema,
  };
}
export function falPayload(payload, model) {
  if (!falEndpoints.includes(model.endpointId))
    throw Error("Unsupported fal workflow");
  const result = {
    prompt: payload.prompt,
    resolution: payload.resolution,
    aspect_ratio: payload.aspect_ratio,
    duration: parseInt(payload.duration),
    audio: !!payload.audio,
    enable_prompt_expansion: false,
  };
  if (model.referenceMode === "single") {
    if (!payload.image_url)
      throw Error("This fal workflow requires a start frame.");
    result.start_image_url = payload.image_url;
    if (payload.end_image_url) result.end_image_url = payload.end_image_url;
  } else if (model.referenceMode === "flat") {
    if (
      (!payload.reference_image_urls?.length && !payload.reference_audio_urls?.length) ||
      (payload.reference_image_urls?.length || 0) > model.maxReferences
    )
      throw Error("Wan reference mode needs an image or audio reference, with at most 10 images.");
    if (payload.reference_image_urls?.length) result.reference_image_urls = payload.reference_image_urls;
  }
  if (payload.reference_audio_urls?.length) {
    if (!supportsSoundReference(model) || !result.audio || payload.reference_audio_urls.length !== 1)
      throw Error("Sound continuation needs one audio sample and native audio on Wan References.");
    result.reference_audio_urls = payload.reference_audio_urls;
  }
  if (
    payload.elements?.length ||
    (payload.reference_image_urls?.length && model.referenceMode !== "flat") ||
    (payload.image_url && model.referenceMode !== "single") ||
    (payload.end_image_url && model.referenceMode !== "single")
  )
    throw Error(
      "These frame and reference inputs cannot be combined in this fal workflow.",
    );
  return result;
}
export function falQueueURL(value) {
  const u = new URL(value);
  if (
    u.origin !== "https://queue.fal.run" ||
    u.username ||
    u.password ||
    !/^\/[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*\/requests\/[\w-]+(?:\/status|\/cancel)?$/.test(
      u.pathname,
    )
  )
    throw new ProviderError("Unrecognized fal job URL", "poll", 422);
  return u.href;
}
export class FalAdapter {
  constructor({
    key,
    transport = providerTransport({ demo: false }),
    allowSubmit = async () => false,
  } = {}) {
    this.key = key;
    this.transport = transport;
    this.allowSubmit = allowSubmit;
  }
  async call(url, body, method) {
    const r = await this.transport(url, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        Authorization: `Key ${this.key}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return r;
  }
  async data(response, stage = "poll") {
    if (!response.ok)
      throw new ProviderError(
        `fal.ai request failed (${response.status})`,
        stage,
        response.status,
      );
    return response.json();
  }
  async catalog() {
    // Pricing requires authentication; the public catalog alone cannot verify a key.
    await this.data(
      await this.call(
        "https://api.fal.ai/v1/models/pricing?endpoint_id=" +
          encodeURIComponent(falEndpoints[0]),
      ),
      "catalog",
    );
    const params = new URLSearchParams({ expand: "openapi-3.0" });
    falEndpoints.forEach((id) => params.append("endpoint_id", id));
    const raw = await this.data(
      await this.call("https://api.fal.ai/v1/models?" + params),
      "catalog",
    );
    if (!Array.isArray(raw.models) || !raw.models.length)
      throw Error(
        "fal returned an empty model catalog; the previous catalog is retained.",
      );
    const fetchedAt = Date.now();
    const models = raw.models
      .filter((m) => falEndpoints.includes(m.endpoint_id))
      .map((m) => falModel(m.endpoint_id, m.metadata, m.openapi, fetchedAt));
    if (!models.length)
      throw Error(
        "No recognized fal workflows returned; previous catalog retained.",
      );
    return { fetchedAt, models };
  }
  async quote(snapshot) {
    const endpoint = snapshot.capabilities.endpointId;
    const result = await this.data(
      await this.call("https://api.fal.ai/v1/models/pricing/estimate", {
        estimate_type: "historical_api_price",
        endpoints: { [endpoint]: { call_quantity: 1 } },
      }),
      "quote",
    );
    if (
      result.currency !== "USD" ||
      typeof result.total_cost !== "number" ||
      result.total_cost < 0 ||
      !Number.isFinite(result.total_cost)
    )
      throw Error("fal did not return a usable cost estimate.");
    return {
      quote: result.total_cost,
      basis: "historical",
      note: "Historical cost per call; duration, resolution and audio can change the final charge. This is not a settings-specific quote.",
    };
  }
  async submit(snapshot) {
    if (!(await this.allowSubmit()))
      throw new ProviderError("Offline mode blocks fal generation.", "validation");
    const endpoint = snapshot.capabilities.endpointId;
    if (!falEndpoints.includes(endpoint))
      throw new ProviderError("Unsupported fal endpoint", "validation");
    let r;
    try {
      r = await this.call(
        "https://queue.fal.run/" + endpoint,
        snapshot.requestPayload,
      );
    } catch {
      throw new ProviderError(
        "Submission response lost; do not resubmit automatically.",
        "submission_uncertain",
      );
    }
    if (r.status >= 500 || r.status === 408)
      throw new ProviderError(
        "fal acceptance is uncertain.",
        "submission_uncertain",
        r.status,
      );
    if (!r.ok)
      throw new ProviderError(
        `fal rejected submission (${r.status})`,
        "submission",
        r.status,
      );
    try {
      const v = await r.json();
      if (!/^[\w-]{8,200}$/.test(v.request_id || ""))
        throw Error("Missing request ID");
      return {
        providerJobId: v.request_id,
        providerRequestId: v.request_id,
        providerUrls: {
          status: falQueueURL(v.status_url),
          result: falQueueURL(v.response_url),
          cancel: v.cancel_url ? falQueueURL(v.cancel_url) : null,
        },
      };
    } catch {
      throw new ProviderError(
        "fal acceptance response could not be saved; recover its request ID before continuing.",
        "submission_uncertain",
      );
    }
  }
  urls(job) {
    if (job.providerUrls) return job.providerUrls;
    const endpoint = job.snapshot.capabilities.endpointId;
    if (
      !falEndpoints.includes(endpoint) ||
      !/^[\w-]{8,200}$/.test(job.providerJobId || "")
    )
      throw new ProviderError("Invalid saved fal request", "poll", 422);
    const base =
      "https://queue.fal.run/" +
      endpoint.split("/").slice(0, 2).join("/") +
      "/requests/" +
      job.providerJobId;
    return { status: base + "/status", result: base, cancel: base + "/cancel" };
  }
  async poll(job) {
    const urls = this.urls(job);
    const state = await this.data(await this.call(falQueueURL(urls.status)));
    if (["FAILED", "CANCELLED"].includes(state.status))
      return { state: "failed", raw: state };
    if (state.status !== "COMPLETED")
      return { state: "processing", raw: state };
    const r = await this.call(falQueueURL(urls.result));
    // Completed queue entries can contain a model validation/generation error.
    if ([400, 422].includes(r.status))
      return {
        state: "failed",
        raw: { status: r.status },
        error: "fal could not generate this request. Review the saved inputs.",
      };
    const output = await this.data(r);
    if (!output.video?.url)
      throw new ProviderError("fal completed without a video URL", "poll", 422);
    return {
      state: "completed",
      downloadUrl: output.video.url,
      raw: state,
      actualPrompt: output.actual_prompt || null,
    };
  }
}
