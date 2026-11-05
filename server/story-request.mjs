import {textEndpoints,textRequest} from "../shared/ai-routing.mjs";
import { usageReceipt } from "../shared/costs.mjs";
import { parseStoryCompletion } from "../shared/story-contract.mjs";

// Completed but malformed JSON or a missing change envelope gets one format retry.
// Timeouts, HTTP failures, truncation and semantic validation never auto-retry.
export async function requestStructuredStory({
  input,
  request,
  config,
  key,
  transport,
  onUsage,
  onProgress = () => {},
}) {
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await transport(
      (textEndpoints[config.provider || config.mode] || textEndpoints.deepseek) + ((config.provider || config.mode) === "deepseek" ? "/beta/chat/completions" : "/chat/completions"),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(textRequest(config,request)),
      },
    );
    if (!response.ok)
      throw Error(
        `${config.provider || "Text provider"} returned ${response.status}. No automatic paid retry.`,
      );
    const data = await response.json();
    attempts.push(usageReceipt(data, config));
    const billing = combinedStoryUsage(attempts);
    await onUsage(billing);
    try {
      const value = parseStoryCompletion(data, input);
      if (attempt)
        value.responseWarnings = [
          ...(value.responseWarnings || []),
          "A malformed completed response was retried once; both text requests are included in the cost estimate.",
        ];
      return { value, usage: billing.usage };
    } catch (error) {
      // Keep a completed response available for diagnosis without logging prompts
      // or silently accepting incomplete changes. Never store request credentials.
      error.providerResponse = data;
      if (
        attempt ||
        config.storyFormatRetries === 0 ||
        !(error.message.startsWith("Unreadable story JSON") || error.code === "STORY_FORMAT")
      )
        throw error;
      await onProgress({
        phase: "format-repair",
        message: "Checking the response format…",
      });
      request = {
        ...request,
        temperature: 0,
        messages: [
          ...request.messages,
          {
            role: "system",
            content:
              "The previous completed response did not satisfy the typed tool format. Submit ALL required tool argument fields, including beats and removedBeatIds arrays (empty when unchanged), or developedClip for a compact scene. Use valid JSON punctuation only: no XML attributes, code fences or text outside the function arguments. Follow the original request and preserve all exact authored dialogue. This is the only format retry.",
          },
        ],
      };
    }
  }
}
export function combinedStoryUsage(attempts) {
  if (attempts.length === 1) return attempts[0];
  const latest = attempts.at(-1),
    usage = attempts.every((a) => a.usage)
      ? Object.fromEntries(
          [
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            "prompt_cache_hit_tokens",
            "prompt_cache_miss_tokens",
          ].map((k) => [
            k,
            attempts.reduce((s, a) => s + (Number(a.usage[k]) || 0), 0),
          ]),
        )
      : null;
  const estimate = attempts.every((a) => a.estimate)
    ? {
        ...latest.estimate,
        amount: attempts.reduce((s, a) => s + a.estimate.amount, 0),
        low: attempts.reduce((s, a) => s + a.estimate.low, 0),
        note:
          "Combined token estimate for " + attempts.length + " text attempts.",
      }
    : null;
  return {
    ...latest,
    usage,
    estimate,
    attempts,
    responseIds: attempts.map((a) => a.responseId).filter(Boolean),
  };
}
