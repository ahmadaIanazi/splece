// Stable provider IDs are separate from display labels and Test/Live execution mode.
export const providerDefinitions = [
  {id:"xai",name:"xAI · Grok",tasks:["image","video"],keyUrl:"https://console.x.ai/",description:"Grok Imagine images, edits and video",authHosts:["api.x.ai"]},
  {
    id: "venice",
    name: "Venice",
    tasks: ["video", "image", "text"],
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
    tasks: ["video", "image", "audio"],
    keyUrl: "https://fal.ai/dashboard/keys",
    description: "Wan 3.0 video · MMAudio sound · ElevenLabs dialogue",
    authHosts: ["api.fal.ai", "queue.fal.run", "rest.fal.ai"],
  },
  {id:'openai',name:'OpenAI',tasks:['text'],keyUrl:'https://platform.openai.com/api-keys',description:'Writing, planning and assistance',authHosts:['api.openai.com']},
  {id:'openrouter',name:'OpenRouter',tasks:['text'],keyUrl:'https://openrouter.ai/settings/keys',description:'One connection, many text and vision models',authHosts:['openrouter.ai']},
];
export function providerId(value) {
  if (value && typeof value === "object")
    return value.providerId || providerId(value.provider);
  return (
    { xAI: "xai", Venice: "venice", DeepSeek: "deepseek", "fal.ai": "fal", Kie: "kie" }[
      value
    ] || value
  );
}
export function isLiveJob(job) {
  if (job?.snapshot?.executionMode)
    return job.snapshot.executionMode === "live";
  return ["venice", "fal", "kie", "xai"].includes(providerId(job?.snapshot || {}));
}
