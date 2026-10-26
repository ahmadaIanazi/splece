import { isStructureClip } from "./structure.mjs";
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const PLANNING_MESSAGE_LIMIT = 20000;
export function validatePlanningMessage(value) {
  if (typeof value !== "string" || !value.trim())
    throw Error("Write an idea or ask for a suggestion before sending.");
  if (value.length > PLANNING_MESSAGE_LIMIT)
    throw Error("This message is too long. Send up to 20,000 characters at a time; your draft is still here.");
  return value.trim();
}
export function planningReply(value = {}) {
  value ||= {};
  return {
    reply:
      clean(value.reply, 1600) ||
      "The plan is ready to review. Start with the references, then develop one scene at a time.",
    suggestions: (Array.isArray(value.suggestions) ? value.suggestions : [])
      .map((v) => clean(v, 180))
      .filter(Boolean)
      .slice(0, 3),
  };
}
export function planningMessages(project) {
  return (project.planningSessions?.[project.episodeId]?.messages || [])
    .filter((m) => ["user", "assistant"].includes(m.role))
    .slice(-40)
    .map((m) => ({
      id: clean(m.id, 100),
      role: m.role,
      text: clean(m.text, PLANNING_MESSAGE_LIMIT),
      at: m.at,
      jobId: m.jobId,
    }));
}
export function recordPlanningMessage(project, message) {
  project.planningSessions ??= {};
  const session = (project.planningSessions[project.episodeId] ??= {
    messages: [],
  });
  if (!session.messages.some((m) => m.id === message.id))
    session.messages.push(message);
  // Conversation is saved on disk; do not silently prune the author's history.
}
export function planningColumns(plan) {
  const byId = new Map(plan.beats.map((n) => [n.id, n])),
    children = new Map();
  for (const n of plan.beats) {
    const parent = byId.has(n.parentId) ? n.parentId : "";
    const list = children.get(parent) || [];
    list.push(n);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.start - b.start);
  return (children.get("") || []).map((root) => {
    const nodes = [],
      stack = [{ node: root, depth: 0 }],
      seen = new Set();
    while (stack.length) {
      const { node, depth } = stack.pop();
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      nodes.push({ ...node, boardDepth: depth });
      for (const child of [...(children.get(node.id) || [])].reverse())
        stack.push({ node: child, depth: depth + 1 });
    }
    return { root, nodes, clips: nodes.filter(isStructureClip) };
  });
}
export function planningReferenceIds(plan) {
  return new Set(
    [
      ...(plan.setup?.castIds || []),
      ...(plan.setup?.assetIds || []),
      ...plan.beats.flatMap((n) => [
        ...(n.characterIds || []),
        ...(n.assetIds || []),
        n.locationId,
        ...(n.dialogue || []).map((d) => d.speaker),
      ]),
    ].filter(Boolean),
  );
}
export function conversationFixture(input) {
  const p = structuredClone(input.plan);
  p.characters = [];
  p.assets = [];
  p.setup = { ...p.setup, planningVersion: 2, complete: true };
  if (!p.setup.concept) p.setup.concept = input.planningMessage;
  // Test fixtures honor explicit basic constraints without pretending to be an LLM.
  const durationMatch = input.planningMessage.match(
    /\b(\d{1,4})[ -]*(seconds?|s|minutes?|m)\b/i,
  );
  if (durationMatch)
    p.setup.targetDuration = Math.max(
      5,
      Math.min(
        3600,
        Number(durationMatch[1]) *
          (durationMatch[2].toLowerCase().startsWith("m") ? 60 : 1),
      ),
    );
  if (/\b(no dialogue|silent|no speech)\b/i.test(input.planningMessage))
    p.setup.dialogueStyle = "silent";
  if (!p.brief) p.brief = p.setup.concept;
  if (!p.beats.length) {
    const character = input.assets.find((a) => a.kind === "character");
    const id = character?.id || crypto.randomUUID();
    if (!character)
      p.characters.push({
        id,
        name: "Story lead",
        description:
          "A friendly traveler, distinctive everyday clothing. " +
          input.planningMessage,
      });
    p.setup.castIds = [...new Set([...(p.setup.castIds || []), id])];
    const duration = Math.max(15, p.setup.targetDuration || 30),
      span = duration / 3;
    p.beats = ["The invitation", "A small surprise", "A new beginning"].map(
      (title, i) => ({
        id: crypto.randomUUID(),
        kind: "scene",
        nodeType: "group",
        parentId: "",
        childNodeType: "clip",
        title,
        start: i * span,
        duration: span,
        description: input.planningMessage,
        characterIds: [id],
        dialogue: [],
        generationMode: "multiple",
        generationDuration: 5,
      }),
    );
    const first = p.beats[0];
    p.beats.push(
      ...["Establish the place", "Follow the character"].map((title, i) => ({
        id: crypto.randomUUID(),
        kind: "generation",
        nodeType: "clip",
        parentId: first.id,
        title,
        start: (i * span) / 2,
        duration: span / 2,
        description: `${title}. ${input.planningMessage}`,
        characterIds: [id],
        dialogue: [],
        camera: "Auto",
        movement: "No movement",
      })),
    );
  } else {
    const target =
      p.beats.find((n) => n.id === input.planningFocusId) ||
      p.beats.find(isStructureClip) ||
      p.beats[0];
    if (target)
      target.description = [
        target.description,
        `Direction: ${input.planningMessage}`,
      ]
        .filter(Boolean)
        .join("\n");
  }
  p.planning = planningReply({
    reply:
      "Offline sample plan updated. Your first scene has clip prompts ready; create or choose the character reference before generating footage.",
    suggestions: [],
  });
  return p;
}

// Carry plan edits into still-inherited writing. A manually edited prompt and
// every completed take remain independent, so planning never rewrites a take.
export function syncPlanningDrafts(project, before, after) {
  const oldById = new Map(before.beats.map((n) => [n.id, n]));
  const nextById = new Map(after.beats.map((n) => [n.id, n]));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const draft of project.drafts || []) {
    if (draft.episodeId !== project.episodeId) continue;
    const old = oldById.get(draft.storyBeatId),
      next = nextById.get(draft.storyBeatId);
    if (!old || !next) continue;
    if (draft.name === old.title) draft.name = next.title;
    for (const scene of draft.scenes || []) {
      if (scene.assistant?.sourceStoryId !== next.id) continue;
      for (const [field, nodeField] of [
        ["text", "description"],
        ["characterIds", "characterIds"],
        ["locationId", "locationId"],
        ["dialogue", "dialogue"],
      ]) {
        if (equal(scene[field], old[nodeField]))
          scene[field] = structuredClone(next[nodeField]);
      }
    }
    const refs = (n) => [
      ...new Set(
        [
          ...(n.characterIds || []),
          ...(n.assetIds || []),
          n.locationId,
          ...(n.dialogue || []).map((l) => l.speaker),
        ].filter(Boolean),
      ),
    ];
    if (equal(draft.referenceIds, refs(old))) draft.referenceIds = refs(next);
  }
}
