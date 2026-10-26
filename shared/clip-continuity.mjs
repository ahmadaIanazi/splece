// Planned intent never becomes observed evidence automatically.
export const continuityVersion = '2026-10-24.1';
export function validateContinuity(value, project) {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('Continuity must be a record.');
  const result = { version: continuityVersion };
  for (const key of ['opening', 'plannedEnd']) {
    if (value[key] == null) continue;
    const state = value[key];
    if (!state || typeof state.text !== 'string' || state.text.length > 8000) throw Error('Continuity state must be text up to 8000 characters.');
    const provenance = key === 'plannedEnd' ? 'planned' : state.provenance;
    if (!['planned', 'user-confirmed', 'observed'].includes(provenance)) throw Error('Choose planned, user-confirmed or observed continuity.');
    const source = state.source;
    if (provenance === 'observed') {
      const clip = project.clips.find(c => c.id === source?.clipId);
      if (!clip?.takes?.some(t => t.id === source?.takeId) || !Number.isFinite(source?.time) || source.time < 0) throw Error('Observed continuity needs a known local take and frame time.');
    }
    result[key] = { text: state.text, provenance, ...(source ? { source: structuredClone(source) } : {}) };
  }
  return result;
}
export function clipContinuityContext(project, draft) {
  const value = validateContinuity(draft.continuity, project);
  if (!value) return null;
  const opening = value.opening;
  // A note tied to an older take remains visible as intent, never current evidence.
  const sourceClip = project.clips.find(c => c.id === opening?.source?.clipId);
  const stale = !!(opening?.source?.takeId && sourceClip?.activeTake !== opening.source.takeId);
  return { ...value, opening: opening ? { ...opening, stale } : undefined };
}
export function continuitySection(project, draft) {
  const context = clipContinuityContext(project, draft);
  if (!context?.opening?.text.trim() && !context?.plannedEnd?.text.trim()) return null;
  const lines = ['These notes apply only to this clip. Opening-frame visible wardrobe, props and layout take priority over reference sheets and textual plans. Explicit authored changes remain authoritative. Never add cast from a prior or future clip.'];
  if (context.opening?.text.trim()) {
    const o = context.opening;
    const label = o.stale ? 'Prior take note (stale; verify before treating as current)' : o.provenance === 'planned' ? 'Planned opening (intent, not observed)' : o.provenance === 'observed' ? 'User-recorded observation of a referenced frame (not machine-verified)' : 'User-confirmed opening';
    lines.push(`${label}: ${o.text}`);
  }
  if (context.plannedEnd?.text.trim()) lines.push(`Planned ending (target only; not evidence of a generated result): ${context.plannedEnd.text}`);
  return { label: 'Clip continuity', source: 'Clip-local state and provenance', text: lines.join('\n') };
}
export function carryPlannedContinuity(sourceDraft, destinationDraft) {
  if (destinationDraft.continuity?.opening?.text?.trim()) return false;
  const text = sourceDraft.continuity?.plannedEnd?.text;
  if (!text?.trim()) return false;
  destinationDraft.continuity = { ...destinationDraft.continuity, version: continuityVersion, opening: { text, provenance: 'planned' } };
  return true;
}

// Select the nearest completed timeline slot, never a future/overlapping clip or
// an arbitrary earlier variation. A take's frozen plan wins over edited drafts.
export function priorClipContinuitySource(project, destinationDraft, jobs = []) {
  const episode = destinationDraft.episodeId || project.episodeId;
  const sameEpisode = item => !item.episodeId || item.episodeId === episode;
  const excluded = new Set([destinationDraft.targetId, destinationDraft.generationSlotId].filter(Boolean));
  const before = (project.clips || []).filter(c => sameEpisode(c) && !excluded.has(c.id) && !(c.generationTargets || []).some(id => excluded.has(id)) && Number.isFinite(c.start) && Number.isFinite(c.duration) && c.duration > 0 && c.start + c.duration <= destinationDraft.start + 0.01)
    .sort((a,b) => (b.start+b.duration)-(a.start+a.duration) || b.start-a.start || a.id.localeCompare(b.id));
  if (!before.length) return null;
  const clip = before[0];
  if (before[1] && Math.abs(before[1].start + before[1].duration - clip.start - clip.duration) < 0.01)
    return { clip, draft: null, origin: 'unavailable', reason: 'Multiple clips end here. Choose the opening state manually.' };
  const take = clip.takes?.find(t => t.id === clip.activeTake);
  const matches = take ? jobs.filter(j => j.kind === 'generation' && (!j.projectId || j.projectId === project.id) && (take.jobId ? j.id === take.jobId : j.media?.id === take.id) && j.snapshot?.draft && sameEpisode(j.snapshot.draft)) : [];
  if (matches.length === 1) return { clip, take, draft: matches[0].snapshot.draft, origin: 'active-take-plan', jobId: matches[0].id };
  if (matches.length > 1) return { clip, draft: null, origin: 'unavailable', reason: 'The active take has ambiguous source records.' };
  const candidates = (project.drafts || []).filter(d => d.id !== destinationDraft.id && sameEpisode(d));
  const explicit = clip.sourceDraftId && candidates.find(d => d.id === clip.sourceDraftId);
  if (explicit) return { clip, take, draft: explicit, origin: 'draft-only-plan' };
  const targets = new Set([clip.id, ...(clip.generationTargets || [])]);
  const linked = candidates.filter(d => targets.has(d.targetId) || targets.has(d.generationSlotId));
  return linked.length === 1 ? { clip, take, draft: linked[0], origin: 'draft-only-plan' } : { clip, take, draft: null, origin: 'unavailable', reason: linked.length ? 'Multiple prompt variations belong to the prior clip. Choose its ending manually.' : 'The prior clip has no saved source prompt.' };
}
