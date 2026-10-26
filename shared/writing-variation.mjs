import { actionLines } from "./shot-direction.mjs";
import {
  assertProtectedPrompt,
  protectedContent,
} from "./prompt-protection.mjs";
export function normalizeWritingVariation(value, input) {
  if (
    !Array.isArray(value?.scenes) ||
    value.scenes.length !== input.draft.scenes.length
  )
    throw Error(
      "The writing response is incomplete. Your original is unchanged.",
    );
  const seen = new Set();
  const repairs = [];
  const scenes = value.scenes.map((item) => {
    const original = input.draft.scenes.find((s) => s.id === item.id);
    if (
      !original ||
      seen.has(item.id) ||
      typeof item.text !== "string" ||
      (!item.text.trim() && original.text?.trim())
    )
      throw Error(
        "The writing response contains an invalid shot. Your original is unchanged.",
      );
    seen.add(item.id);
    if (item.text.length > 40000)
      throw Error("The writing response is too long.");
    if (input.operation === "optimize-writing") {
      assertProtectedPrompt(item.text, protectedContent(
        { scenes: [{ text: original.text || "", dialogue: [] }], notes: "" },
        original.text || "",
      ));
      const recovered = repairAssetMentions(original.text || "", item.text);
      if (recovered.text !== item.text)
        repairs.push(
          `Shot ${input.draft.scenes.indexOf(original) + 1}: ${recovered.message}`,
        );
      item = { ...item, text: recovered.text };
    }
    // Protect authored quotes, negatives and reference roles, without injecting dialogue into prose.
    assertProtectedPrompt(
      item.text,
      protectedContent(
        { scenes: [{ text: original.text || "", dialogue: [] }], notes: "" },
        original.text || "",
      ),
    );
    const mentions = (text) =>
      [...String(text || "").matchAll(/@\[[^\]]+\]/g)].map((m) => m[0]).sort();
    if (
      JSON.stringify(mentions(item.text)) !==
      JSON.stringify(mentions(original.text))
    )
      throw Error(
        "The writing response changed an asset mention. Your original is unchanged.",
      );
    const beforeLines = actionLines(original.text),
      afterLines = actionLines(item.text);
    if (
      beforeLines.length !== afterLines.length ||
      beforeLines.some(
        (line, i) =>
          JSON.stringify(mentions(line)) !==
          JSON.stringify(mentions(afterLines[i])),
      )
    )
      throw Error(
        "The writing response changed action-line timing or moved a reference between actions. Your original is unchanged.",
      );
    return { id: item.id, text: item.text };
  });
  return {
    kind: "writing-variation",
    scenes,
    changes: [
      ...(Array.isArray(value.changes)
        ? value.changes.filter((x) => typeof x === "string")
        : []),
      ...repairs,
    ],
  };
}
export function addWritingVariation(project, job, { activate = true } = {}) {
  if (job.state !== "ready" || job.result?.kind !== "writing-variation")
    return null;
  const existing = project.drafts.find((d) => d.smartVariationJobId === job.id);
  if (existing) return existing;
  const source = project.drafts.find((d) => d.id === job.draftId);
  if (!source)
    throw Error("The source prompt was removed. No variation was created.");
  const draft = structuredClone(job.input.draft);
  draft.id = "smart-" + job.id;
  draft.name =
    job.input.operation === "optimize-writing"
      ? source.name.replace(/(?: · Optimized)+$/, "") + " · Optimized"
      : source.name + " · " + (job.input.style || "polished");
  if (job.input.operation === "optimize-writing")
    draft.optimizationReceipt = {
      profile: job.input.optimization,
      textModel: job.result.model,
      usage: job.billing?.usage || job.result.usage,
      estimate: job.billing?.estimate || null,
    };
  draft.promptGroupId =
    source.promptGroupId ||
    (source.storyBeatId ? "story:" + source.storyBeatId : "draft:" + source.id);
  source.promptGroupId = draft.promptGroupId;
  draft.smartVariationJobId = job.id;
  draft.closed = false;
  // The submitted snapshot owns the writing; present-day placement owns the timeline.
  for (const key of [
    "start",
    "targetId",
    "generationSlotId",
    "storyBeatId",
    "episodeId",
  ])
    if (source[key] !== undefined) draft[key] = source[key];
  delete draft.smartAccepted;
  delete draft.sourceGenerationId;
  for (const scene of draft.scenes)
    scene.text = job.result.scenes.find((s) => s.id === scene.id).text;
  project.drafts.push(draft);
  if (activate) project.activeDraftId = draft.id;
  return draft;
}

// Repair syntax only when the authored identity is unambiguous; never guess a new asset.
export function repairAssetMentions(original, proposed) {
  const mentions = (text) =>
    [...text.matchAll(/@\[([^\]]+)\]/g)].map((m) => m[0]).sort();
  const before = actionLines(original),
    after = actionLines(proposed);
  if (before.length !== after.length)
    return {
      text: original,
      message:
        "kept your action lines because the response changed their structure.",
    };
  let kept = false;
  const lines = after.map((line, i) => {
    for (const mention of mentions(before[i])) {
      const name = mention.slice(2, -1),
        escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      line = line.replace(
        new RegExp("@" + escaped + "(?![\\p{L}\\p{N}_])", "gu"),
        mention,
      );
    }
    if (
      JSON.stringify(mentions(before[i])) !== JSON.stringify(mentions(line))
    ) {
      kept = true;
      return before[i];
    }
    return line;
  });
  return {
    text: (() => {
      const match = /^(?:Negative\s*:|\[Negative\])[^]*$/im.exec(proposed);
      const body = match ? proposed.slice(0, match.index) : proposed;
      let index = 0;
      return body.split(/(\r?\n)/).map(line => {
        if (!line.trim()) return line;
        const next = lines[index++];
        return next === line.trim() ? line : next;
      }).join("") + (match ? proposed.slice(match.index) : "");
    })(),
    message: kept
      ? "kept the original action where an asset mention was lost; other writing was enhanced."
      : "restored asset mention formatting.",
  };
}
