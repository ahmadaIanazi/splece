// Stable provider IDs are separate from display labels and Test/Live execution mode.
export const providerDefinitions = [
  {
    id: "venice",
    name: "Venice",
    tasks: ["video", "text"],
    keyUrl: "https://venice.ai/settings/api",
    description: "Video generation and prompt enhancement",
    authHosts: ["api.venice.ai"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    tasks: ["text"],
    keyUrl: "https://platform.deepseek.com/api_keys",
    description: "Story planning and smart prompting",
    authHosts: ["api.deepseek.com"],
  },
  {
    id: "fal",
    name: "fal.ai",
    tasks: ["video", "audio"],
    keyUrl: "https://fal.ai/dashboard/keys",
    description: "Wan 3.0 video · MMAudio sound · ElevenLabs dialogue",
    authHosts: ["api.fal.ai", "queue.fal.run", "rest.fal.ai"],
  },
];
export function providerId(value) {
  if (value && typeof value === "object")
    return value.providerId || providerId(value.provider);
  return (
    { Venice: "venice", DeepSeek: "deepseek", "fal.ai": "fal", Kie: "kie" }[
      value
    ] || value
  );
}
export function isLiveJob(job) {
  if (job?.snapshot?.executionMode)
    return job.snapshot.executionMode === "live";
  return ["venice", "fal", "kie"].includes(providerId(job?.snapshot || {}));
}
