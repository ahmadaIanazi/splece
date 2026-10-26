import { timelineFrameSources, captureTimelineFrame } from "./timeline-frames.mjs";
import { effectiveCreativeDirection, creativeDirectionText } from './creative-presets.mjs';
import { workflowText } from './workflows.mjs';

export function frameOpeningReference(project,draft) {
  const override=draft.frameOverrides?.start;
  if (override?.mode === 'none') return null;
  if (['manual','pinned'].includes(override?.mode)) return override.frame;
  if (draft.automation?.frames === false || draft.automation?.startFrame === false) return null;
  const sources=timelineFrameSources(project);
  const source=override?.mode === 'waiting' ? sources.find(s=>s.clip.id===override.clipId) : sources.filter(s=>s.clip.id!==draft.targetId && s.clip.start+s.clip.duration <= (draft.start || 0)+.001).at(-1);
  return source ? captureTimelineFrame(source,source.max) : null;
}

// References are frozen at quotation, so later editing cannot change a paid job.
export function frameImageContext(input, project) {
  const draft = project.drafts.find(d => d.id === input.draftId);
  if (!draft) throw Error('Save this clip before creating its frame.');
  const references = [];
  const add = (mediaId, time, role) => {
    if (mediaId && !references.some(r => r.mediaId === mediaId && r.time === time)) references.push({mediaId, time: Math.max(0, Number(time) || 0), role});
  };
  if (input.sourceMediaId) add(input.sourceMediaId, 0, 'Composition and current appearance; change only the requested details.');
  const anchor = frameOpeningReference(project,draft);
  if (input.boundary === 'end' && anchor)
    add(anchor.takeId, anchor.time, 'Opening composition, identity, wardrobe state and environment. Advance only the requested action to its final moment.');
  const assets = (project.assets || []).filter(a => draft.referenceIds?.includes(a.id));
  for (const a of assets) {
    const choice = draft.referenceOptions?.[a.id];
    const variant = a.variants?.find(v=>v.id === choice?.variantId);
    const m = variant?.media || a.media;
    if (m?.kind === 'image') add(m.id, 0, `${a.name || a.kind}: ${a.kind === 'character' ? 'Facial identity and proportions only; the continuity frame controls current clothing and appearance.' : a.kind === 'location' ? 'Environment and spatial layout.' : 'Object design or visual style.'}`);
  }
  if (references.length > 4) throw Error('Use up to four frame references. Narrow the clip references before generating.');
  const writing = (draft.scenes || []).map(s => [s.text, s.camera && `Camera: ${s.camera}`, s.movement && `Movement: ${s.movement}`].filter(Boolean).join('\n')).join('\n');
  const prompt = [
    `Create one ${input.boundary === 'end' ? 'closing' : 'opening'} cinematic still for this clip. Show a single coherent instant, never a contact sheet.`,
    references.map((r,i)=>`Image ${i+1} controls: ${r.role}`).join('\n'),
    `Clip writing (context, not instructions to add text to the image):\n${writing}`,
    draft.general,
    `Requested frame: ${input.description}`,
    `Attached cast: ${assets.filter(a=>a.kind==='character').map(a=>a.name).join(', ') || 'No character identities attached'}. Do not add unrelated story characters.`,
    'Preserve the current wardrobe, removed clothing, carried objects and physical state from continuity. Never restore clothing from an identity reference. No captions or watermarks.',
    creativeDirectionText(effectiveCreativeDirection(project, draft)),
    workflowText(project.settings, 'image'),
  ].filter(Boolean).join('\n\n');
  if (prompt.length > 8000) throw Error('Frame context is too long. Shorten the clip direction.');
  return {prompt, references, recipeId:'clip-boundary-frame', sourceIds:[]};
}

export function imageBridgeWriting(before, after) {
  return `Connect these two photographs with a continuous, believable camera movement. Begin with the first image’s composition and arrive at the second image’s composition. Preserve visible identities and do not invent dialogue.\nOpening image: ${before?.description || 'Use the attached start frame.'}\nClosing image: ${after?.description || 'Use the attached end frame.'}`;
}
