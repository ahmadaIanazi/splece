import { recordPlanningMessage, planningReply, syncPlanningDrafts } from "./planning-conversation.mjs";
import { editorPlanningSignature } from "./structure-context.mjs";
import { storyPlan, validateStory } from "./authoring.mjs";
import { projectReferenceDraft } from "./asset-scope.mjs";
import { isStructureClip } from "./structure.mjs";
import { descendants } from "./story-tree.mjs";

const copy = (v) => structuredClone(v);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const cleanPlan = (plan) =>
  Object.fromEntries(
    Object.entries(plan).filter(
      ([k]) =>
        ![
          "history",
          "characters",
          "assets",
          "at",
          "versionId",
          "versionTitle",
          "sourceJobId",
        ].includes(k),
    ),
  );

// Compare only fields changed by this response. Independent section jobs can
// finish in any order without overwriting intervening writing in other sections.
function merge(base, proposed, current, path = "Structure") {
  if (equal(base, proposed)) return copy(current);
  if (equal(current, base) || equal(current, proposed)) return copy(proposed);
  if (object(base) && object(proposed) && object(current)) {
    const result = copy(current);
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(proposed),
    ])) {
      if (equal(base[key], proposed[key])) continue;
      result[key] = merge(
        base[key],
        proposed[key],
        current[key],
        `${path} · ${key}`,
      );
      if (result[key] === undefined) delete result[key];
    }
    return result;
  }
  throw Error(
    `${path} was edited while development was running. The saved result is kept; your writing has not been replaced.`,
  );
}

export function structureVersionList(project) {
  return (storyPlan(project).history || [])
    .map((v, i) => ({
      id: v.versionId || `legacy:${i}:${v.at || 0}`,
      title: v.versionTitle || v.title || "Structure version",
      at: v.at,
      sourceJobId: v.sourceJobId,
      beatCount: v.beats?.length || 0,
    }))
    .reverse();
}
function archive(plan, title, sourceJobId) {
  return [
    ...(plan.history || []),
    {
      ...copy(cleanPlan(plan)),
      versionId: crypto.randomUUID(),
      versionTitle: title,
      at: Date.now(),
      ...(sourceJobId ? { sourceJobId } : {}),
    },
  ].slice(-50);
}

export function structureRestoreImpact(project, target) {
  const current = storyPlan(project),
    next = new Map((target.beats || []).map((n) => [n.id, n]));
  const changedNodeIds = (current.beats || [])
    .filter((n) => !equal(n, next.get(n.id)))
    .map((n) => n.id);
  const changed = new Set(changedNodeIds);
  const clips = (project.clips || [])
    .filter((c) => changed.has(c.storyBeatId || c.structureNodeId))
    .map((c) => ({ id: c.id, title: c.name || c.title || "Editor clip" }));
  const drafts = (project.drafts || [])
    .filter((d) => changed.has(d.storyBeatId))
    .map((d) => ({ id: d.id, title: d.name || "Prompt" }));
  return {
    clips,
    drafts,
    changedNodeIds,
    removedNodeIds: changedNodeIds.filter((id) => !next.has(id)),
    message:
      "Restoring changes the Structure outline. Existing Editor clips, timing, prompts and generated takes stay intact; their linked Structure items may change or disappear.",
  };
}

export function restoreStructureVersion(
  project,
  id,
  { confirmed = false } = {},
) {
  const plan = storyPlan(project),
    index = structureVersionList(project).find((v) => v.id === id);
  if (!index) throw Error("This Structure version is no longer available.");
  const saved = (plan.history || []).find(
    (v, i) => (v.versionId || `legacy:${i}:${v.at || 0}`) === id,
  );
  const impact = structureRestoreImpact(project, saved);
  if (!confirmed && (impact.clips.length || impact.drafts.length))
    return { needsConfirmation: true, impact };
  validateStory({ ...saved, characters: [], assets: [] }, project);
  project.storyPlans[project.episodeId] = {
    ...copy(cleanPlan(saved)),
    history: archive(plan, "Before restoring a version"),
  };
  return { restored: true, impact };
}

export function applyStructureJob(project, job) {
  project.storyJobReceipts ??= {};
  if (
    project.storyJobReceipts[job.id] ||
    project.appliedStoryJobs?.includes(job.id)
  )
    return { skipped: true };
  if (job.state !== "ready" || !job.result?.proposal) return { skipped: true };
  if (job.episodeId !== project.episodeId) return { skipped: true };
  try {
    if (job.result.editorSignature && job.result.editorSignature !== editorPlanningSignature(project)) throw Error("The Editor changed during development. Your saved result is kept; refresh the plan before using it.");
    const current = storyPlan(project),
      rawBase = job.result.originalPlan;
    if (!rawBase)
      throw Error(
        "The original Structure is missing. The result remains saved.",
      );
    const scopeProject = {
      ...project,
      storyPlans: { ...project.storyPlans, [project.episodeId]: rawBase },
    };
    const base = validateStory(
      { ...rawBase, characters: [], assets: [] },
      scopeProject,
    );
    const rawProposal = copy(job.result.proposal);
    const referenceIds = new Map(
      [...(rawProposal.characters || []), ...(rawProposal.assets || [])].map(
        (a, i) => [a.id, `reference:${job.id}:${i}`],
      ),
    );
    for (const asset of [
      ...(rawProposal.characters || []),
      ...(rawProposal.assets || []),
    ])
      asset.id = referenceIds.get(asset.id);
    for (const node of [
      ...(rawProposal.beats || []),
      rawProposal.setup || {},
    ]) {
      for (const key of [
        "characterIds",
        "assetIds",
        "referenceIds",
        "castIds",
        "heroIds",
      ])
        if (Array.isArray(node[key]))
          node[key] = node[key].map((id) => referenceIds.get(id) || id);
      node.locationId = referenceIds.get(node.locationId) || node.locationId;
      for (const line of node.dialogue || [])
        line.speaker = referenceIds.get(line.speaker) || line.speaker;
    }
    const proposed = validateStory(rawProposal, scopeProject);
    const normalizedCurrent = validateStory(
      { ...current, characters: [], assets: [] },
      project,
    );
    if (job.action === "children" && job.originBeatId) {
      const source = base.beats.find((b) => b.id === job.originBeatId),
        now = normalizedCurrent.beats.find((b) => b.id === job.originBeatId);
      for (const key of [
        "description",
        "characterIds",
        "assetIds",
        "locationId",
        "dialogue",
      ])
        if (!equal(source?.[key], now?.[key]))
          throw Error(
            "The parent direction or references changed while its clips were developing. The saved result is kept for recovery.",
          );
    }
    // New model IDs are namespaced per saved job so parallel jobs cannot collide.
    const oldIds = new Set(base.beats.map((b) => b.id));
    const ids = new Map(
      proposed.beats
        .filter((b) => !oldIds.has(b.id))
        .map((b, i) => [b.id, `story:${job.id}:${i}`]),
    );
    proposed.beats = proposed.beats.map((b) => ({
      ...b,
      id: ids.get(b.id) || b.id,
      parentId: ids.get(b.parentId) || b.parentId,
    }));
    const existing = new Map(normalizedCurrent.beats.map((b) => [b.id, b]));
    const next = new Map(proposed.beats.map((b) => [b.id, b]));
    const mergedNodes = new Map(
      (current.beats || []).map((b) => [b.id, copy(b)]),
    );
    for (const b of base.beats) {
      const n = next.get(b.id),
        c = existing.get(b.id);
      if (equal(b, n)) continue;
      if (!n) {
        if (!equal(b, c))
          throw Error(
            `“${b.title}” changed while development was running. Its result is saved.`,
          );
        mergedNodes.delete(b.id);
      } else {
        const merged = merge(b, n, c, b.title);
        mergedNodes.set(b.id, { ...mergedNodes.get(b.id), ...merged });
      }
    }
    for (const b of proposed.beats)
      if (!oldIds.has(b.id)) mergedNodes.set(b.id, copy(b));
    const { beats: _, ...baseFields } = cleanPlan(base),
      { beats: __, ...proposalFields } = cleanPlan(proposed);
    const { beats: ___, ...currentFields } = cleanPlan(normalizedCurrent);
    const merged = {
      ...current,
      ...merge(baseFields, proposalFields, currentFields),
      beats: [...mergedNodes.values()],
    };
    const impact = structureRestoreImpact(project, merged);
    if (
      impact.removedNodeIds.some(
        (id) =>
          (project.clips || []).some(
            (c) => (c.storyBeatId || c.structureNodeId) === id,
          ) || (project.drafts || []).some((d) => d.storyBeatId === id),
      )
    )
      throw Error(
        "Development would replace an item already linked to the Editor. Your saved result is kept without changing those links.",
      );
    const newAssets = [...proposed.characters, ...proposed.assets].map(
      projectReferenceDraft,
    );
    validateStory(
      { ...merged, characters: [], assets: [] },
      { ...project, assets: [...project.assets, ...newAssets] },
    );
    merged.history = archive(
      current,
      `Before ${job.action || "development"}`,
      job.id,
    );
    project.assets.push(...newAssets);
    project.storyPlans ??= {};
    project.storyPlans[project.episodeId] = merged;
    if (job.action === "conversation") {
      syncPlanningDrafts(project, normalizedCurrent, merged);
      const response = planningReply(job.result.planning);
      recordPlanningMessage(project,{id:`reply:${job.id}`,role:"assistant",text:response.reply,at:Date.now(),jobId:job.id});
      project.planningSessions[project.episodeId].suggestions=response.suggestions;
    }
    project.storyJobReceipts[job.id] = {
      state: "applied",
      at: Date.now(),
      message: "Added to Structure. Undo is available.",
    };
    project.appliedStoryJobs = [
      ...new Set([...(project.appliedStoryJobs || []), job.id]),
    ];
    return { applied: true };
  } catch (e) {
    project.storyJobReceipts[job.id] = {
      state: "conflict",
      at: Date.now(),
      message: e.message,
    };
    return { conflict: true, message: e.message };
  }
}

export function suppressUndoneStructureJobs(before, after) {
  for (const [id, receipt] of Object.entries(before.storyJobReceipts || {})) {
    if (
      receipt.state !== "applied" ||
      after.storyJobReceipts?.[id]?.state === "applied"
    )
      continue;
    after.storyJobReceipts ??= {};
    after.storyJobReceipts[id] = {
      ...receipt,
      state: "undone",
      message: "Undone. The generated result is still saved.",
    };
  }
}

export function undevelopedStructureGroups(plan, selected = []) {
  const scope = new Set(
    selected.flatMap((id) => [...descendants(plan.beats || [], id)]),
  );
  return (plan.beats || [])
    .filter(
      (n) =>
        !isStructureClip(n) &&
        (!selected.length || scope.has(n.id)) &&
        !(plan.beats || []).some((b) => b.parentId === n.id),
    )
    .map((n) => n.id);
}

export function replaceStructureReference(
  project,
  fromId,
  toId,
  { scopeIds = [] } = {},
) {
  const from = project.assets.find((a) => a.id === fromId),
    to = project.assets.find((a) => a.id === toId);
  if (!from || !to || from.kind !== to.kind)
    throw Error("Choose a replacement of the same reference type.");
  if (fromId === toId) return { changed: 0 };
  const plan = storyPlan(project),
    history = archive(plan, `Before replacing ${from.name}`);
  const scope = new Set(
    scopeIds.flatMap((id) => [...descendants(plan.beats || [], id)]),
  );
  const selected = (plan.beats || []).filter(
    (n) => !scopeIds.length || scope.has(n.id),
  );
  const selectedIds = new Set(selected.map((n) => n.id));
  let changed = 0;
  const ids = (list) => [
    ...new Set(list.map((id) => (id === fromId ? toId : id))),
  ];
  const namePattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${from.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
    "gu",
  );
  const mentions = (text) =>
    typeof text === "string"
      ? text
          .split(/("[^"\n]*"|“[^”\n]*”)/g)
          .map((part, i) =>
            i % 2 ? part : part.replace(namePattern, () => to.name),
          )
          .join("")
      : text;
  function remap(n) {
    const before = JSON.stringify(n);
    for (const key of [
      "characterIds",
      "assetIds",
      "referenceIds",
      "castIds",
      "heroIds",
    ])
      if (Array.isArray(n[key])) n[key] = ids(n[key]);
    if (n.locationId === fromId) n.locationId = toId;
    for (const key of [
      "title",
      "name",
      "description",
      "text",
      "general",
      "notes",
      "contextNotes",
      "brief",
      "synopsis",
      "concept",
    ])
      if (n[key]) n[key] = mentions(n[key]);
    for (const line of n.dialogue || [])
      if (line.speaker === fromId) line.speaker = toId;
    if (n.referenceOptions?.[fromId]) delete n.referenceOptions[fromId];
    if (before !== JSON.stringify(n)) changed++;
  }
  selected.forEach(remap);
  if (!scopeIds.length) {
    remap(plan);
    if (plan.setup) remap(plan.setup);
  }
  for (const d of project.drafts || [])
    if (selectedIds.has(d.storyBeatId)) {
      remap(d);
      (d.scenes || []).forEach(remap);
      // Compiled text cannot be reused after changing its reference identities.
      delete d.preparedOverride;
      delete d.smartSignature;
    }
  if (changed) plan.history = history;
  return { changed };
}
