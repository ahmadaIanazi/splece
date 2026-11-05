import { FalAdapter, falQueueURL } from "./fal.mjs";
const models = [
  "fal-ai/esrgan",
  "fal-ai/video-upscaler",
  "alibaba/wan-3.0/image-to-video",
];
export class FalEffectsAdapter extends FalAdapter {
  async estimate(model) {
    if (!models.includes(model)) throw Error("Unsupported effect model.");
    const q = await this.quote({ capabilities: { endpointId: model } });
    return { amount: q.quote, basis: q.basis, note: q.note, currency: "USD" };
  }
  async submitEffect(model, input) {
    if (!models.includes(model)) throw Error("Unsupported effect model.");
    if (!(await this.allowSubmit())) throw Error("Offline blocks AI effects.");
    let r;
    try {
      r = await this.call("https://queue.fal.run/" + model, input);
    } catch {
      throw Object.assign(
        Error(
          "Provider acceptance is unknown. Recover the existing fal request ID; this pass will not submit again.",
        ),
        { uncertain: true },
      );
    }
    if (r.status >= 500 || r.status === 408)
      throw Object.assign(
        Error("Provider acceptance is unknown. Recover the fal request ID."),
        { uncertain: true },
      );
    if (!r.ok)
      throw Object.assign(
        Error(
          `fal rejected this effect (${r.status}). Check connection, credits or input, then retry.`,
        ),
        { rejected: true },
      );
    try {
      const v = await r.json();
      if (!/^[\w-]{8,200}$/.test(v.request_id || "")) throw Error();
      return {
        providerJobId: v.request_id,
        providerUrls: {
          status: falQueueURL(v.status_url),
          result: falQueueURL(v.response_url),
        },
      };
    } catch {
      throw Object.assign(
        Error(
          "Provider acceptance could not be saved. Recover the fal request ID.",
        ),
        { uncertain: true },
      );
    }
  }
  async pollEffect(model, stage) {
    if (
      !models.includes(model) ||
      !/^[\w-]{8,200}$/.test(stage.providerJobId || "")
    )
      throw Error("Invalid saved effect request.");
    const base = `https://queue.fal.run/${model.split("/").slice(0, 2).join("/")}/requests/${stage.providerJobId}`;
    const urls = stage.providerUrls || {
      status: base + "/status",
      result: base,
    };
    const state = await this.data(await this.call(falQueueURL(urls.status)));
    if (["FAILED", "CANCELLED"].includes(state.status))
      throw Object.assign(
        Error(
          "The provider could not complete this pass. The accepted request is retained; no automatic resubmission.",
        ),
        { terminal: true },
      );
    if (state.status !== "COMPLETED") return { state: "processing" };
    const result = await this.data(await this.call(falQueueURL(urls.result)));
    const url = (model === "fal-ai/esrgan" ? result.image : result.video)?.url;
    if (!url) throw Error("Completed effect has no media. Retry retrieval.");
    return { state: "ready", downloadUrl: url };
  }
}
