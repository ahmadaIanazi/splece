export const aiLanes = ["text", "assistant", "image", "video", "audio"];
export const laneLabels = {
  text: "Text",
  assistant: "Assistant",
  image: "Image",
  video: "Video",
  audio: "Audio",
};
export const laneProviders = {
  text: ["deepseek", "openai", "openrouter", "venice"],
  assistant: ["deepseek", "openai", "openrouter", "venice"],
  image: ["venice", "fal", "xai"],
  video: ["venice", "fal", "xai"],
  audio: ["fal"],
};
export function routingDefaults(live = false) {
  return Object.fromEntries(
    aiLanes.map((lane) => [
      lane,
      {
        enabled: live,
        provider: ["text", "assistant"].includes(lane)
          ? "deepseek"
          : lane === "audio"
            ? "fal"
            : "venice",
        model: "",
      },
    ]),
  );
}
export function validateRoute(lane, value) {
  if (
    !aiLanes.includes(lane) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    throw Error("Choose an AI feature.");
  if (
    typeof value.enabled !== "boolean" ||
    !laneProviders[lane].includes(value.provider) ||
    typeof value.model !== "string" ||
    value.model.length > 200
  )
    throw Error("Choose a supported provider and model.");
  return {
    enabled: value.enabled,
    provider: value.provider,
    model: value.model,
  };
}
export const textEndpoints = {
  deepseek: "https://api.deepseek.com",
  venice: "https://api.venice.ai/api/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};
export function textRequest(config, request) {
  const provider = config.provider || config.mode;
  const body = { ...request, model: config.model || request.model };
  if (provider !== "deepseek") delete body.thinking;
  if (provider === "openai") {
    if (body.max_tokens) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    delete body.temperature;
    delete body.top_p;
    // DeepSeek strict tool schemas use an extension not shared by every model.
    if (body.tools)
      body.tools = body.tools.map((t) => ({
        ...t,
        function: { ...t.function, strict: false },
      }));
  }
  if (provider === "openrouter")
    body.provider = { require_parameters: true, allow_fallbacks: false };
  return body;
}

// Catalog token prices are per token; other pricing shapes remain explicitly unknown.
export function tokenPricing(value) {
  if (
    !value ||
    !["prompt", "completion"].every(
      (k) =>
        value[k] != null &&
        value[k] !== "" &&
        Number.isFinite(Number(value[k])) &&
        Number(value[k]) >= 0,
    )
  )
    return null;
  return { prompt: Number(value.prompt), completion: Number(value.completion) };
}
