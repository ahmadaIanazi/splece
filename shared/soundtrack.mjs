import { AMBIENCE_MODEL } from "./sound-design.mjs";
// Soundtrack intent, edit dependencies and application are shared by server and UI.
// Provider outputs never replace picture or original clip audio.
import {
  dialogueScript,
  dialogueSignature,
  dialogueInput,
} from "./soundtrack-dialogue.mjs";
import { takeSourceIn } from "./repair.mjs";
import { freeAudioLane } from "./audio-editing.mjs";

export const soundtrackRoles = ["effect", "ambience", "dialogue"];
// Independent layers can queue together; replacing the same layer must wait.
export function activeSoundtrackRun(runs, episodeId, roles = soundtrackRoles) {
  return runs.find(r => r.episodeId === episodeId &&
    ["queued", "processing"].includes(r.state) &&
    r.units.some(u => roles.includes(u.role)));
}

// Keep completed but unapplied results discoverable without replaying receipts or undo.
export function soundtrackReviewUnits(project, runs) {
  const reviewIds = new Set((project.production?.audioPlans || [])
    .filter(p => p.kind === "soundtrack")
    .flatMap(p => (p.cues || []).filter(c => c.status === "needs-review").map(c => c.id)));
  const covered = new Set();
  return runs.flatMap(run => run.units.flatMap(unit => {
    const keys = unit.sources.map(s => `${unit.role}:${s.clipId}`);
    const newer = keys.every(key => covered.has(key));
    keys.forEach(key => covered.add(key));
    if (newer || unit.state !== "ready" || !reviewIds.has(unit.id) ||
      project.audioClips.some(a => a.id === unit.id)) return [];
    return [{ ...unit, runId: run.id }];
  }));
}
const round = (v) => Math.round(Number(v || 0) * 1000000) / 1000000;
export function soundSource(clip) {
  const take = clip?.takes?.find((t) => t.id === clip.activeTake);
  if (!take) return null;
  return {
    clipId: clip.id,
    mediaId: take.id,
    start: round(clip.start),
    in: round(takeSourceIn(clip, take)),
    duration: round(clip.duration),
  };
}
export function soundSourceKey(source) {
  return JSON.stringify([source?.mediaId, source?.in, source?.duration]);
}
export function sourceChanges(project, sources) {
  const current = new Map(project.clips.map((c) => [c.id, soundSource(c)]));
  const changed = sources.filter(
    (s) => soundSourceKey(s) !== soundSourceKey(current.get(s.clipId)),
  );
  const offsets = sources.map((s) => current.get(s.clipId)?.start - s.start);
  const movedTogether = offsets.every(
    (d) => Number.isFinite(d) && Math.abs(d - offsets[0]) < 0.001,
  );
  const affected = new Set(changed.map((s) => s.clipId));
  // Mark changed joins, not every second of a long ambience bed.
  for (let i = 1; i < sources.length; i++) {
    const left = sources[i - 1],
      right = sources[i];
    const a = current.get(left.clipId),
      b = current.get(right.clipId);
    if (
      !a ||
      !b ||
      Math.abs(b.start - a.start - (right.start - left.start)) > 0.001
    ) {
      affected.add(left.clipId);
      affected.add(right.clipId);
    }
  }
  return {
    changed,
    affected: sources.filter((s) => affected.has(s.clipId)),
    movedTogether,
    offset: movedTogether ? offsets[0] : 0,
  };
}
export function soundtrackChanges(project, unit) {
  const changes = sourceChanges(project, unit.sources);
  if (unit.role === "dialogue" && unit.scriptSignature != null) {
    const clip = project.clips.find((c) => c.id === unit.sources[0]?.clipId);
    if (!clip || dialogueSignature(project, clip) !== unit.scriptSignature) {
      changes.changed = unit.sources;
      changes.affected = unit.sources;
    }
  }
  return changes;
}
export function soundUnitState(project, unit) {
  const changes = soundtrackChanges(project, unit);
  return {
    ...changes,
    stale: changes.changed.length > 0 || !changes.movedTogether,
    start: unit.start + changes.offset,
  };
}
export function soundtrackDirtyClips(project, role) {
  const ids = new Set();
  for (const audio of project.audioClips || []) {
    if (!audio.soundtrack || (role && audio.soundtrack.role !== role)) continue;
    const { affected } = soundtrackChanges(project, audio.soundtrack);
    for (const s of affected) ids.add(s.clipId);
  }
  return ids;
}
export function createSoundtrackPlan(project, options, makeId) {
  const roles = [...new Set(options.roles || soundtrackRoles)].filter((r) =>
    soundtrackRoles.includes(r),
  );
  if (!roles.length) throw Error("Choose effects, ambience or dialogue.");
  const range =
    options.range == null
      ? null
      : {
          from: Number(options.range.from),
          to: Number(options.range.to),
        };
  if (
    range &&
    (!Number.isFinite(range.from + range.to) ||
      range.from < 0 ||
      range.to <= range.from)
  )
    throw Error("Highlight a valid time range on the ruler.");
  const requested = options.clipIds == null ? null : new Set(options.clipIds);
  const clips = project.clips
    .filter(
      (c) =>
        (!requested || requested.has(c.id)) &&
        (!range || (c.start < range.to && c.start + c.duration > range.from)),
    )
    .sort((a, b) => a.start - b.start);
  if (!clips.length || clips.some((c) => !soundSource(c)))
    throw Error(
      "Choose clips with completed footage. Planned clips have no sound to analyse yet.",
    );
  if (clips.length > 120)
    throw Error("Choose up to 120 clips for one soundtrack pass.");
  const sources = clips.map(soundSource);
  if (
    sources.some(
      (s) =>
        !Number.isFinite(s.start + s.in + s.duration) ||
        s.start < 0 ||
        s.in < 0 ||
        s.duration <= 0 ||
        s.duration > 3600,
    )
  )
    throw Error("Invalid soundtrack timing.");
  if (sources.reduce((n, s) => n + s.duration, 0) > 3600)
    throw Error("Choose up to one hour per soundtrack pass.");
  const groups = [];
  for (const s of sources) {
    const last = groups.at(-1);
    if (
      last &&
      Math.abs(last.at(-1).start + last.at(-1).duration - s.start) < 0.001
    )
      last.push(s);
    else groups.push([s]);
  }
  const id = makeId(),
    units = [];
  const add = (role, ss) => {
    const start = Math.max(ss[0].start, range?.from ?? 0);
    const end = Math.min(
      ss.at(-1).start + ss.at(-1).duration,
      range?.to ?? Infinity,
    );
    units.push({
      id: makeId(),
      role,
      ...(role === "ambience" ? { model: AMBIENCE_MODEL } : {}),
      sources: ss,
      start: round(start),
      duration: round(end - start),
      partialRange: !!range,
      state: "queued",
      progress: 0,
    });
  };
  // Generate through picture cuts, not independently at each clip boundary.
  for (const role of ["effect", "ambience"]) {
    if (!roles.includes(role)) continue;
    const dirty = soundtrackDirtyClips(project, role);
    for (const group of groups) {
      const covered = group.every((s) =>
        project.audioClips?.some(
          (a) =>
            a.soundtrack?.role === role &&
            a.soundtrack.sources.some((v) => v.clipId === s.clipId),
        ),
      );
      if (
        !options.changedOnly ||
        group.some((s) => dirty.has(s.clipId)) ||
        !covered
      )
        add(role, group);
    }
  }
  const dialogueDirty = soundtrackDirtyClips(project, "dialogue");
  if (roles.includes("dialogue"))
    for (const clip of clips) {
      const script = dialogueScript(project, clip);
      // Select whole spoken lines by their onset. Never crop words at a range edge.
      const start = Math.max(clip.start, range?.from ?? 0);
      const lines = script
        .filter(
          (l) =>
            !range ||
            (clip.start + l.start >= range.from &&
              clip.start + l.start < range.to),
        )
        .map((l) => ({ ...l, start: round(clip.start + l.start - start) }));
      const existing = project.audioClips?.some(
        (a) =>
          a.soundtrack?.role === "dialogue" &&
          a.soundtrack.sources.some((s) => s.clipId === clip.id),
      );
      if (!lines.length && (!existing || (range && script.length))) continue;
      if (options.changedOnly && existing && !dialogueDirty.has(clip.id))
        continue;
      if (lines.some((l) => l.missing))
        throw Error(
          "Assign a character to every spoken line in the clip prompt before creating dialogue.",
        );
      if (lines.some((l) => dialogueInput(l).text.length > 4500))
        throw Error(
          "A dialogue line is too long. Split it into shorter lines in the prompt (maximum 4,500 characters including voice direction).",
        );
      add("dialogue", [sources.find((s) => s.clipId === clip.id)]);
      Object.assign(units.at(-1), {
        lines,
        scriptSignature: dialogueSignature(project, clip),
        clearDialogue: !lines.length,
        reviewDialogue: options.reviewDialogue === true,
      });
    }
  if (!units.length)
    throw Error(
      roles.length === 1 &&
        roles[0] === "dialogue" &&
        !clips.some((c) => dialogueScript(project, c).length)
        ? "No spoken lines in this selection. Add dialogue and speakers in the clip prompt."
        : "This soundtrack is already up to date.",
    );
  if ((project.audioClips?.length || 0) + units.length > 256)
    throw Error(
      "This pass exceeds the 256 audio clip limit. Choose a smaller range or remove unused audio.",
    );
  const contexts = clips.map((c) => {
    const draft = project.drafts?.find(
      (d) =>
        d.id === c.draftId ||
        d.id === c.sourceDraftId ||
        d.targetId === c.id ||
        (c.storyBeatId && d.storyBeatId === c.storyBeatId),
    );
    const beat = project.storyPlans?.[project.episodeId]?.beats?.find(
      (b) => b.id === c.storyBeatId,
    );
    return {
      clipId: c.id,
      title: draft?.name || beat?.title || "Clip",
      description: beat?.description || "",
      scenes: draft?.scenes || [],
      notes: draft?.notes || "",
      environment: project.assets.filter(a => a.kind === "location" && [beat?.locationId, ...(draft?.scenes || []).map(s => s.locationId)].includes(a.id)).map(a => a.description).join(" "),
    };
  });
  return {
    id,
    projectId: project.id,
    episodeId: project.episodeId,
    kind: "soundtrack",
    schemaVersion: 1,
    executionMode: "test",
    providerId: "local-test",
    cost: 0,
    changedOnly: !!options.changedOnly,
    state: "queued",
    createdAt: new Date().toISOString(),
    direction: String(options.direction || "").slice(0, 2000),
    sources,
    contexts,
    units,
  };
}
export function soundReceipts(project) {
  return new Set(
    (project.production?.audioPlans || [])
      .filter((p) => p.kind === "soundtrack")
      .flatMap((p) => p.receipts || []),
  );
}
export function applySoundtrackResults(project, run) {
  if (run.projectId !== project.id || run.episodeId !== project.episodeId)
    return 0;
  project.production ??= {
    schemaVersion: 1,
    audioPlans: [],
    effects: [],
    transitions: [],
    dependencies: [],
  };
  const plans = (project.production.audioPlans ??= []);
  let plan = plans.find((p) => p.id === run.id);
  const ready = run.units.filter(
    (u) =>
      u.state === "ready" &&
      u.media &&
      !u.delivered &&
      !plan?.receipts?.includes(u.id),
  );
  if (!ready.length) return 0;
  if (!plan) {
    plan = {
      id: run.id,
      kind: "soundtrack",
      episodeId: run.episodeId,
      receipts: [],
      cues: [],
      revision: 1,
    };
    plans.push(plan);
  }
  for (const unit of ready) {
    const state = soundUnitState(project, unit);
    plan.receipts.push(unit.id);
    plan.cues.push({
      id: unit.id,
      role: unit.role,
      anchor: {
        type: "placement",
        placementId: unit.sources[0].clipId,
        edge: "start",
        offset: 0,
      },
      mediaId: unit.media.id,
      sources: unit.sources,
      start: unit.start,
      duration: unit.duration,
      status: state.stale || unit.needsTiming ? "needs-review" : "ready",
    });
    if(unit.originalMedia && !project.assets.some(a=>a.id===unit.originalMedia.id))
      project.assets.push({id:unit.originalMedia.id,kind:"audio",name:unit.originalMedia.name,media:unit.originalMedia,scope:"project",tags:["dialogue","original"],version:1});
    // Store every output as an asset, even if the picture changed during the job.
    if (!project.assets.some((a) => a.id === unit.media.id))
      project.assets.push({
        id: unit.media.id,
        kind: "audio",
        name: unit.media.name,
        description:
          run.executionMode === "live"
            ? `AI soundtrack · fal.ai ${unit.role === "dialogue" ? "ElevenLabs v3" : unit.model === AMBIENCE_MODEL ? "ElevenLabs Sound Effects v2" : "MMAudio V2"}`
            : "Offline soundtrack sample",
        media: unit.media,
        scope: "project",
        tags: [
          "soundtrack",
          unit.role,
          run.executionMode === "live" ? "ai" : "test",
        ],
        version: 1,
      });
    if (state.stale || unit.needsTiming) continue;
    const end = state.start + unit.duration;
    const targets = new Set(unit.sources.map((s) => s.clipId));
    // Subtract the replacement range from older generated sound. Keep the tails
    // (and their original source offsets), rather than doubling an existing bed.
    project.audioClips = project.audioClips.flatMap((a) => {
      // On-screen speech is auditioned before it changes the current mix.
      // Keep the old performance; replace only older unapproved candidates.
      if (unit.reviewDialogue && !a.soundtrack?.pendingLipSync) return [a];
      if (
        !unit.partialRange &&
        a.soundtrack?.role === unit.role &&
        a.soundtrack.sources.every((s) => targets.has(s.clipId))
      )
        return [];
      if (
        a.soundtrack?.role !== unit.role ||
        a.start >= end ||
        a.start + a.duration <= state.start
      )
        return [a];
      const pieces = [];
      if (a.start < state.start)
        pieces.push({
          ...structuredClone(a),
          id: a.id + ":before:" + unit.id,
          duration: state.start - a.start,
          fadeOut: 0.04,
        });
      if (a.start + a.duration > end)
        pieces.push({
          ...structuredClone(a),
          id: a.id + ":after:" + unit.id,
          start: end,
          in: a.in + end - a.start,
          duration: a.start + a.duration - end,
          fadeIn: 0.04,
        });
      return pieces;
    });
    if (run.changedOnly)
      project.audioClips = project.audioClips.filter(
        (a) =>
          !a.soundtrack ||
          a.soundtrack.sources.some((s) =>
            project.clips.some((c) => c.id === s.clipId),
          ),
      );
    if (unit.clearDialogue) continue;
    const lane = freeAudioLane(
      project.audioClips,
      state.start,
      unit.duration,
      unit.role === "effect" ? 0 : unit.role === "dialogue" ? 2 : 1,
    );
    project.audioClips.push({
      id: unit.id,
      mediaId: unit.media.id,
      name:
        unit.role === "effect"
          ? "Effects"
          : unit.role === "dialogue"
            ? "Dialogue"
            : "Ambience",
      start: state.start,
      in: 0,
      duration: unit.duration,
      sourceDuration: unit.media.duration,
      volume: unit.role === "ambience" ? 0.55 : unit.role === "effect" ? 0.8 : 1,
      mute: unit.reviewDialogue === true,
      fadeIn: Math.min(0.04, unit.duration / 4),
      fadeOut: Math.min(0.04, unit.duration / 4),
      lane,
      soundtrack: {
        runId: run.id,
        role: unit.role,
        scriptSignature: unit.scriptSignature,
        ...(unit.role === 'dialogue' && unit.parts ? {lineTimings: unit.parts.map(p=>({start:p.actualStart ?? p.start,duration:p.actualDuration ?? p.audioDuration ?? p.duration}))} : {}),
        ...(unit.reviewDialogue ? { pendingLipSync: true } : {}),
        originStart: unit.start,
        sources: structuredClone(unit.sources),
      },
    });
    project.audioLanes = Math.max(project.audioLanes || 1, lane + 1);
  }
  return ready.length;
}
export function followSoundtrackEdits(before, after) {
  if (before.episodeId !== after.episodeId) return;
  for (const audio of after.audioClips || []) {
    if (!audio.soundtrack) continue;
    const old = before.audioClips?.find((a) => a.id === audio.id);
    if (!old) continue;
    const oldState = sourceChanges(before, audio.soundtrack.sources);
    const newState = sourceChanges(after, audio.soundtrack.sources);
    if (oldState.movedTogether && newState.movedTogether)
      audio.start = Math.max(
        0,
        audio.start + newState.offset - oldState.offset,
      );
  }
}
