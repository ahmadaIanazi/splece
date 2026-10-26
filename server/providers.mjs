import { composerSequenceText } from "../shared/composer-sequence.mjs";
import { cameraDirection } from "../shared/shot-direction.mjs";
import { providerTransport } from "./security.mjs";
export class ProviderError extends Error {
  constructor(message, stage, status) {
    super(message);
    this.stage = stage;
    this.status = status;
  }
}
async function json(response, stage) {
  if (!response.ok)
    throw new ProviderError(
      `Provider request failed (${response.status})`,
      stage,
      response.status,
    );
  return response.json();
}
export class VeniceAdapter {
  constructor({ key, transport = providerTransport() } = {}) {
    this.key = key;
    this.transport = transport;
  }
  call(route, body) {
    return this.transport("https://api.venice.ai/api/v1" + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async catalog() {
    return json(await this.call("/models?type=video"), "catalog");
  }
  payload(snapshot) {
    if (snapshot.requestPayload && !snapshot.requestPayload.mode)
      return snapshot.requestPayload;
    const d = snapshot.draft;
    const request = {
      model: d.settings.model,
      prompt: snapshot.compiled.text,
      duration: d.settings.duration + "s",
      aspect_ratio: d.settings.aspect,
      resolution: d.settings.resolution,
    };
    if (snapshot.inputs?.start) request.image_url = snapshot.inputs.start;
    if (snapshot.inputs?.end) request.end_image_url = snapshot.inputs.end;
    if (snapshot.inputs?.references?.length)
      request.reference_image_urls = snapshot.inputs.references;
    return request;
  }
  async quote(snapshot) {
    return json(
      await this.call(
        "/video/quote",
        Object.fromEntries(
          Object.entries(this.payload(snapshot)).filter(([key]) =>
            [
              "model",
              "duration",
              "resolution",
              "aspect_ratio",
              "audio",
            ].includes(key),
          ),
        ),
      ),
      "quote",
    );
  }
  async submit(snapshot) {
    let response;
    try {
      response = await this.call("/video/queue", this.payload(snapshot));
    } catch {
      throw new ProviderError(
        "Submission response lost; do not resubmit automatically.",
        "submission_uncertain",
      );
    }
    if (response.status >= 500 || response.status === 408)
      throw new ProviderError(
        "Provider acceptance is uncertain.",
        "submission_uncertain",
        response.status,
      );
    let result;
    if (!response.ok)
      throw new ProviderError(
        response.status === 402
          ? "Venice rejected payment (402). Check your Venice credits or billing before submitting again."
          : `Venice rejected submission (${response.status})`,
        "submission",
        response.status,
      );
    try {
      result = await response.json();
    } catch {
      throw new ProviderError(
        "Submission response unreadable; acceptance is uncertain.",
        "submission_uncertain",
      );
    }
    if (!result.queue_id)
      throw new ProviderError(
        "Queue identifier missing; acceptance is uncertain.",
        "submission_uncertain",
      );
    return {
      providerJobId: result.queue_id,
      providerRequestId: response.headers.get("x-request-id") || undefined,
      model: result.model || snapshot.draft.settings.model,
      downloadUrl: result.download_url,
    };
  }
  async poll(job, { stream = false } = {}) {
    const response = await this.call("/video/retrieve", {
      model: job.model || job.snapshot.model,
      queue_id: job.providerJobId,
      delete_media_on_completion: false,
    });
    if (!response.ok)
      throw new ProviderError(
        "Could not retrieve provider status",
        "poll",
        response.status,
      );
    if (response.headers.get("content-type")?.includes("video/"))
      return {
        state: "completed",
        ...(stream
          ? { response }
          : { bytes: new Uint8Array(await response.arrayBuffer()) }),
      };
    const result = await response.json();
    return {
      state: String(result.status || "processing").toLowerCase(),
      downloadUrl: result.download_url || job.downloadUrl,
      raw: result,
    };
  }
}
export class KieAdapter {
  constructor({ key, transport = providerTransport() } = {}) {
    this.key = key;
    this.transport = transport;
  }
  call(route, body) {
    return this.transport("https://api.kie.ai/api/v1" + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  payload(snapshot) {
    const d = snapshot.draft;
    const multi = !!d.nativeMultiShot;
    const input = {
      prompt: snapshot.compiled.text,
      duration: String(d.settings.duration),
      aspect_ratio: d.settings.aspect,
      mode: d.settings.mode || "std",
      multi_shots: multi,
      sound: !!d.settings.audio,
    };
    if (snapshot.inputs?.references?.length)
      throw new ProviderError(
        "Kling references require a verified element mapping; reference images cannot be silently discarded.",
        "validation",
      );
    if (snapshot.inputs?.end && !snapshot.inputs?.start)
      throw new ProviderError(
        "Kling end-frame input needs a start frame.",
        "validation",
      );
    if (multi) {
      const global =
        snapshot.compiled.sections
          ?.filter((s) => s.label !== "Scenes" && s.label !== "Scene controls")
          .map((s) => s.text)
          .join("\n") || "";
      delete input.prompt;
      input.multi_prompt = d.scenes.map((s, index) => ({
        prompt: [
          global,
          ...(snapshot.compiled.sceneControls || []).filter((line) =>
            line.startsWith(`Scene ${index + 1} `),
          ),
          s.text,
          cameraDirection(s) ? `Camera: ${cameraDirection(s)}.` : "",
          ...(s.sequence?.length ? ((snapshot.compiled.sceneControls || []).some(line => line.startsWith(`Scene ${index + 1} action control:`)) ? [] : [composerSequenceText(s, snapshot.compiled.references || [], (d.automation?.dialogue ?? snapshot.template?.automation?.dialogue) !== false)]) : (s.dialogue || []).map(
            (line) =>
              `${snapshot.compiled.references?.find((r) => r.id === line.speaker)?.name || line.speaker} (${line.delivery}; ${line.direction || ""}): “${line.text}”`,
          )),
        ]
          .filter(Boolean)
          .join("\n"),
        duration: Number(s.duration),
      }));
      if (
        input.multi_prompt.some(
          (s) =>
            s.prompt.length > 500 ||
            s.duration < 1 ||
            s.duration > 12 ||
            !Number.isInteger(s.duration),
        ) ||
        input.multi_prompt.reduce((n, s) => n + s.duration, 0) !==
          Number(d.settings.duration)
      )
        throw new ProviderError(
          "Review native shot lengths and prompts: each shot needs 1–12 whole seconds, at most 500 characters, and durations must total the generation length. No text was truncated.",
          "validation",
        );
      if (snapshot.inputs?.end)
        throw new ProviderError(
          "Native multi-shot mode does not support an end frame; retain it in the draft and review this choice.",
          "validation",
        );
    }
    if (snapshot.inputs?.start)
      input.image_urls = [
        snapshot.inputs.start,
        ...(!multi && snapshot.inputs.end ? [snapshot.inputs.end] : []),
      ];
    return { model: "kling-3.0/video", input };
  }
  async submit(snapshot) {
    let response;
    try {
      response = await this.call("/jobs/createTask", this.payload(snapshot));
    } catch {
      throw new ProviderError(
        "Submission response lost; do not resubmit automatically.",
        "submission_uncertain",
      );
    }
    if (response.status >= 500)
      throw new ProviderError(
        "Provider acceptance is uncertain.",
        "submission_uncertain",
        response.status,
      );
    const result = await json(response, "submission");
    if (result.code !== 200)
      throw new ProviderError(
        result.msg || "Provider rejected the job",
        "submission",
        result.code,
      );
    if (!result.data?.taskId)
      throw new ProviderError(
        "Task ID missing; acceptance is uncertain.",
        "submission_uncertain",
      );
    return { providerJobId: result.data.taskId };
  }
  async poll(job) {
    const result = await json(
      await this.call(
        "/jobs/recordInfo?taskId=" + encodeURIComponent(job.providerJobId),
      ),
      "poll",
    );
    if (result.code !== 200)
      throw new ProviderError(
        result.msg || "Status unavailable",
        "poll",
        result.code,
      );
    const data = result.data;
    const urls = data.resultJson ? JSON.parse(data.resultJson).resultUrls : [];
    return { state: data.state, downloadUrl: urls?.[0], raw: data };
  }
}
export const providerEvidence = {
  venice: {
    catalog: "https://docs.venice.ai/api-reference/endpoint/models/list",
    queue: "https://docs.venice.ai/api-reference/endpoint/video/queue",
    quote: "https://docs.venice.ai/api-reference/endpoint/video/quote",
    retrieve: "https://docs.venice.ai/api-reference/endpoint/video/retrieve",
  },
  kie: {
    capabilities: "https://docs.kie.ai/market/kling/kling-3-0",
    catalog:
      "Model-specific verified registry; no assumed universal catalog endpoint",
    pricing: "Unknown until a verified pricing record is supplied",
  },
  verifiedAt: "2026-10-21",
  liveTesting: false,
};
