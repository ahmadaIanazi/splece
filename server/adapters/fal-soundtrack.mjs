import { TARGETED_LIP_MODEL } from "../../shared/face-assignment.mjs";
import { LIP_SYNC_MODEL } from "../../shared/lip-sync.mjs";
import { AMBIENCE_MODEL, AMBIENCE_RATE } from "../../shared/sound-design.mjs";
import {
  soundFailure,
  validateSoundInput,
} from "../../shared/soundtrack-retry.mjs";
import {
  DIALOGUE_MODEL,
  DIALOGUE_RATE,
} from "../../shared/soundtrack-dialogue.mjs";
import { FalAdapter, falQueueURL } from "./fal.mjs";
import { SOUND_MODEL, SOUND_RATE } from "../../shared/soundtrack-ai.mjs";

// Keep validation explanations, never provider echoes of media, credentials or input bodies.
async function soundResponse(response, terminal = false) {
  if (response.ok) return response.json();
  const body = await response.json().catch(() => ({}));
  const clean = (text) =>
    String(text || "")
      .replace(/data:[^\s]+/gi, "[media]")
      .replace(/https?:\/\/[^\s]+/gi, "[URL]")
      .replace(/[A-Za-z0-9+/=_-]{80,}/g, "[omitted]")
      .slice(0, 180);
  const details = Array.isArray(body.detail)
    ? body.detail
        .slice(0, 3)
        .map(
          (d) =>
            `${(d.loc || []).filter((v) => typeof v === "string").join(".")}: ${clean(d.msg)}`,
        )
        .join("; ")
    : clean(
        typeof body.detail === "string"
          ? body.detail
          : body.message || body.error?.message,
      );
  const hint =
    response.status === 422
      ? "Input validation failed"
      : [401, 403].includes(response.status)
        ? "Check the fal connection"
        : response.status === 402
          ? "Check fal credits"
          : "Request failed";
  throw Object.assign(
    Error(`fal.ai (${response.status}) · ${details || hint}`),
    {
      code: soundFailure(details).code,
      fields: Array.isArray(body.detail)
        ? [
            ...new Set(
              body.detail.flatMap((d) =>
                (d.loc || []).filter((v) =>
                  [
                    "prompt",
                    "video_url",
                    "duration",
                    "num_steps",
                    "seed",
                    "cfg_strength",
                  ].includes(v),
                ),
              ),
            ),
          ]
        : [],
      terminal:
        terminal && [400, 401, 402, 403, 404, 422].includes(response.status),
    },
  );
}

export class FalSoundtrackAdapter extends FalAdapter {
  async pricing(model = SOUND_MODEL) {
    const value = await this.data(
      await this.call(
        "https://api.fal.ai/v1/models/pricing?endpoint_id=" +
          encodeURIComponent(model),
      ),
      "quote",
    );
    const price = value.prices?.find((p) => p.endpoint_id === model);
    if (
      !price ||
      price.currency !== "USD" ||
      !(
        model === DIALOGUE_MODEL
          ? [
              "character",
              "characters",
              "1000 characters",
              "1000_characters",
              "1000_character",
            ]
          : ["second", "seconds", "video_second", "video seconds", ...([LIP_SYNC_MODEL,TARGETED_LIP_MODEL].includes(model) ? ["minute", "minutes"] : [])]
      ).includes(price.unit) ||
      !Number.isFinite(price.unit_price) ||
      price.unit_price <= 0
    )
      throw Error(
        "fal returned an unsupported soundtrack price. Online submission is blocked until a verified estimate is available.",
      );
    return {
      ...(model === DIALOGUE_MODEL ? DIALOGUE_RATE : model === AMBIENCE_MODEL ? AMBIENCE_RATE : SOUND_RATE),
      rate: price.unit_price / (price.unit.startsWith("1000") ? 1000 : price.unit.startsWith("minute") ? 60 : 1),
      basis: "provider",
      checkedAt: new Date().toISOString(),
    };
  }
  async submitSound(input, model = SOUND_MODEL) {
    if (![SOUND_MODEL, DIALOGUE_MODEL, AMBIENCE_MODEL, LIP_SYNC_MODEL, TARGETED_LIP_MODEL].includes(model))
      throw Error("Unsupported soundtrack model.");
    if (!(await this.allowSubmit()))
      throw Error("Offline mode blocks fal soundtrack submission.");
    if (model === SOUND_MODEL) validateSoundInput(input);
    if (model === AMBIENCE_MODEL && (typeof input.text !== "string" || !input.text.trim() || input.text.length > 450 || !Number.isFinite(input.duration_seconds) || input.duration_seconds < 0.5 || input.duration_seconds > 22)) throw Error("Invalid ambience caption or duration.");
    let response;
    try {
      response = await this.call("https://queue.fal.run/" + model, input);
    } catch {
      throw Object.assign(
        Error(
          "Submission response lost. Check fal's request history; this section will not be submitted again automatically.",
        ),
        { uncertain: true },
      );
    }
    if (response.status >= 500 || response.status === 408)
      throw Object.assign(
        Error(
          "fal acceptance is uncertain. Check its request history before continuing.",
        ),
        { uncertain: true },
      );
    if (!response.ok) await soundResponse(response, true);
    try {
      const v = await response.json();
      if (!/^[\w-]{8,200}$/.test(v.request_id || ""))
        throw Error("Missing request ID");
      return {
        providerJobId: v.request_id,
        providerUrls: {
          status: falQueueURL(v.status_url),
          result: falQueueURL(v.response_url),
          cancel: v.cancel_url ? falQueueURL(v.cancel_url) : null,
        },
      };
    } catch {
      throw Object.assign(
        Error(
          "fal acceptance could not be saved. Recover its request ID before continuing.",
        ),
        { uncertain: true },
      );
    }
  }
  urls(part) {
    if (!/^[\w-]{8,200}$/.test(part.providerJobId || ""))
      throw Error("Invalid saved soundtrack request.");
    const model = part.model || SOUND_MODEL;
    if (![SOUND_MODEL, DIALOGUE_MODEL, AMBIENCE_MODEL, LIP_SYNC_MODEL, TARGETED_LIP_MODEL].includes(model))
      throw Error("Unsupported saved soundtrack model.");
    const base = `https://queue.fal.run/${model.split("/").slice(0, 2).join("/")}/requests/${part.providerJobId}`;
    return (
      part.providerUrls || {
        status: base + "/status",
        result: base,
        cancel: base + "/cancel",
      }
    );
  }
  async pollSound(part) {
    const urls = this.urls(part);
    const state = await soundResponse(
      await this.call(falQueueURL(urls.status)),
    );
    if (["FAILED", "CANCELLED"].includes(state.status))
      throw Object.assign(
        Error(
          "fal could not complete this soundtrack section. Create a new generation after checking the input.",
        ),
        { terminal: true },
      );
    if (state.status !== "COMPLETED")
      return {
        state: state.status === "IN_QUEUE" ? "queued" : "processing",
        queuePosition: state.queue_position,
      };
    const value = await soundResponse(
      await this.call(falQueueURL(urls.result)),
      true,
    );
    const url =
      [DIALOGUE_MODEL, AMBIENCE_MODEL].includes(part.model) ? value.audio?.url : value.video?.url;
    if (!url)
      throw Error(
        "fal completed without a soundtrack video. Retry retrieval only.",
      );
    return { state: "ready", downloadUrl: url };
  }
  async cancelSound(part) {
    const url = this.urls(part).cancel;
    if (url) await this.data(await this.call(falQueueURL(url), null, "PUT"));
  }
}
