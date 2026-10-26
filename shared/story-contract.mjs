import { descendants } from "./story-tree.mjs";
// Provider-facing contract. Required typed fields keep creative prose separate
// from application structure; relational validation still runs after decoding.
const text = { type: "string" },
  texts = { type: "array", items: text };
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const list = (items) => ({ type: "array", items });
const choice = (values) => ({ type: "string", enum: values });
const number = (minimum = 0, maximum = 86400) => ({
  type: "number",
  minimum,
  maximum,
});
const voice = object(
  Object.fromEntries(
    [
      "tone",
      "timbre",
      "pitch",
      "pace",
      "accent",
      "language",
      "description",
    ].map((k) => [k, text]),
  ),
);
export const storyTool = {
  type: "function",
  function: {
    name: "submit_story_changes",
    strict: true,
    description:
      "Return a planning reply and only changed or new structure items. This saves a proposed plan, never generates media.",
    parameters: object({
      title: text,
      synopsis: text,
      planning: object({
        reply: {
          ...text,
          description:
            "At most three short sentences. For uncertainty ask ONE focused question, with up to three concrete suggestions. Never an intake checklist.",
        },
        suggestions: texts,
      }),
      characters: list(
        object({ id: text, name: text, description: text, voice }),
      ),
      assets: list(
        object({
          id: text,
          kind: choice(["location", "prop", "style"]),
          name: text,
          description: text,
        }),
      ),
      setup: object({
        format: text,
        targetDuration: number(1),
        durationSkipped: { type: "boolean" },
        castCount: { type: "integer", minimum: 0, maximum: 100 },
        castIds: texts,
        heroIds: texts,
        language: text,
        region: text,
        accent: text,
        dialogueStyle: choice(["silent", "balanced", "dialogue-led"]),
        personalityBrief: text,
        minorCharacters: text,
        directionBrief: text,
        grouping: choice(["act", "chapter"]),
        complete: { type: "boolean" },
        assetIds: texts,
        referenceIds: texts,
      }),
      beats: list(
        object({
          id: text,
          parentId: text,
          nodeType: choice(["group", "clip"]),
          kind: choice(["act", "chapter", "scene", "generation"]),
          title: text,
          act: text,
          description: text,
          start: number(),
          duration: number(0.01),
          childNodeType: choice(["group", "clip", ""]),
          generationMode: choice(["compact", "multiple"]),
          generationDuration: {
            type: "integer",
            enum: [5, 10, 15, 20, 25, 30],
          },
          characterIds: texts,
          locationId: text,
          assetIds: texts,
          camera: text,
          movement: text,
          transition: text,
          cameraDirection: text,
          dialogue: list(
            object({ speaker: text, text, delivery: text, direction: text }),
          ),
        }),
      ),
      removedBeatIds: texts,
    }),
  },
};
export function storyToolFor(input) {
  const parent = input.plan?.beats?.find((b) => b.id === input.expandId);
  if (
    input.action !== "children" ||
    parent?.generationMode !== "compact" ||
    parent.childNodeType === "group"
  )
    return storyTool;
  const tool = structuredClone(storyTool),
    props = tool.function.parameters.properties;
  // A single object enforces compact scenes even where a provider's strict mode
  // does not support maxItems on arrays. The application owns descendant removal.
  props.developedClip = props.beats.items;
  props.developedClip.properties.parentId = {
    type: "string",
    enum: [parent.id],
  };
  props.developedClip.properties.kind = {
    type: "string",
    enum: ["generation"],
  };
  props.developedClip.properties.nodeType = { type: "string", enum: ["clip"] };
  delete props.beats;
  delete props.removedBeatIds;
  tool.function.parameters.required = Object.keys(props);
  tool.function.description =
    "Develop exactly ONE compact clip for the selected scene. Put the complete action and all existing spoken lines in developedClip. Reuse the existing child ID when possible. No separate cuts.";
  return tool;
}
export const storyToolInstructions = `Return your answer ONLY through submit_story_changes. This typed tool contract overrides earlier JSON examples. Return beats containing ONLY new or changed items, not the entire unchanged plan. Keep every unchanged ID by omitting it from beats. removedBeatIds is empty unless the user expressly requests removal or you replace the selected group's descendants for action=children. Never remove Editor-linked items. For a question or uncertainty, give a useful reply and suggestions; do not invent an outline when the user asks for choices first. For contradictory requirements, ask one focused clarifying question and leave the outline unchanged. Preserve saved setup values unless the user asks to change them. With no saved duration, use targetDuration=60 and durationSkipped=true; zero is not a duration. castCount=0 is valid for product-only/no-character stories. All setup descriptions are plain text. Use empty arrays for no references. Every character ID in beats, castIds, heroIds and dialogue MUST match either an input library character or a complete character object you define in characters in THIS response. Locations and props similarly need existing IDs or complete definitions in assets. Never put characters in a separate cast field. Do not infer a library identity that was not supplied. Exact quoted or explicitly supplied spoken lines must remain whole, verbatim, in the original language and punctuation; never split, translate or paraphrase them across clips. A silent request has no dialogue or narrator. New plans use scene groups directly as roots, with 1–3 prepared child clips in the first scene; no unnecessary act wrapper. Do not claim media was generated. Write a concise friendly reply in the user's language. Avoid jargon and repeated questions about details the user already gave.`;

export function materializeStoryChanges(changes, input) {
  if (
    !changes ||
    typeof changes !== "object" ||
    !Array.isArray(changes.beats) ||
    !Array.isArray(changes.removedBeatIds)
  )
    throw Object.assign(Error(
      "The planning response is missing its changes. Your plan is unchanged.",
    ), { code: "STORY_FORMAT" });
  const base = input.plan,
    removed = new Set(changes.removedBeatIds),
    changed = new Set();
  for (const id of removed)
    if (!base.beats.some((b) => b.id === id))
      throw Error(
        "The planning response removed an unknown section. Your plan is unchanged.",
      );
  const byId = new Map(
    base.beats
      .filter((b) => !removed.has(b.id))
      .map((b) => [b.id, structuredClone(b)]),
  );
  for (const beat of changes.beats) {
    if (changed.has(beat.id) || removed.has(beat.id))
      throw Error(
        "The planning response contains conflicting section IDs. Your plan is unchanged.",
      );
    changed.add(beat.id);
    byId.set(beat.id, {
      ...byId.get(beat.id),
      ...beat,
      end: beat.start + beat.duration,
    });
  }
  return {
    ...structuredClone(base),
    ...changes,
    brief: base.brief || base.setup?.concept || input.planningMessage || "",
    setup: { ...base.setup, ...changes.setup },
    beats: [...byId.values()],
  };
}

export function parseStoryCompletion(data, input) {
  const c = data?.choices?.[0];
  if (!["stop", "tool_calls"].includes(c?.finish_reason))
    throw Error(
      "The planning response was cut short. Your plan is unchanged. Try developing one scene at a time.",
    );
  const calls = c.message?.tool_calls;
  if (calls?.length) {
    if (
      calls.length !== 1 ||
      calls[0].function?.name !== storyTool.function.name
    )
      throw Error(
        "The planning response used an unexpected format. Your plan is unchanged.",
      );
    let { value, normalized } = parseStoryJson(calls[0].function.arguments);
    if (value?.developedClip) {
      const parent = input.plan.beats.find((b) => b.id === input.expandId);
      if (
        input.action !== "children" ||
        parent?.generationMode !== "compact" ||
        parent.childNodeType === "group"
      )
        throw Error("Unexpected compact scene response. Nothing applied.");
      const scope = descendants(input.plan.beats, parent.id);
      scope.delete(parent.id);
      scope.delete(value.developedClip.id);
      value = {
        ...value,
        beats: [value.developedClip],
        removedBeatIds: [...scope],
      };
    }
    return {
      ...materializeStoryChanges(value, input),
      ...(normalized
        ? {
            responseWarnings: [
              "Removed redundant closing punctuation after a complete JSON response; no story content changed.",
            ],
          }
        : {}),
    };
  }
  // Saved pre-contract responses can still be recovered locally, without billing.
  const { value, normalized } = parseStoryJson(c?.message?.content);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected a story plan object. Nothing applied.");
  return {
    ...value,
    ...(normalized
      ? {
          responseWarnings: [
            "Removed redundant closing punctuation after a complete JSON response; no story content changed.",
          ],
        }
      : {}),
  };
}

export function parseStoryJson(source) {
  if (typeof source !== "string")
    throw Error("Unreadable story JSON. Nothing applied.");
  try {
    return { value: JSON.parse(source), normalized: false };
  } catch {}
  // Observed live even in strict tool mode: a complete JSON object followed by
  // one redundant closing brace. Only discard trailing closers, never synthesize
  // missing content, edit strings, accept a second document or salvage truncation.
  const s = source.trim();
  let depth = 0,
    inString = false,
    escaped = false;
  if (s.startsWith("{"))
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{" || c === "[") depth++;
      if (c === "}" || c === "]") depth--;
      if (depth === 0) {
        if (/^[}\]\s]{1,16}$/.test(s.slice(i + 1))) {
          try {
            return { value: JSON.parse(s.slice(0, i + 1)), normalized: true };
          } catch {}
        }
        break;
      }
    }
  throw Error("Unreadable story JSON. Nothing applied.");
}
