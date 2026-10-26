import { creativeControls, normalizeCreativeDirection, effectiveCreativeDirection, creativeDirectionText } from './creative-presets.mjs';

export const directionControls = creativeControls;
export const DIRECTION_VERSION = 1;
// Coverage is an editorial preview, not a claim that a generated take was changed.
// Half-open intervals exclude clips touching only the start or end boundary.
export function directionClipCoverage(project, range) {
  if (!range || range.enabled === false || range.resolved === false) return [];
  return (project.clips || []).filter(c =>
    (!c.episodeId || c.episodeId === project.episodeId) &&
    Number.isFinite(c.start) && Number.isFinite(c.duration) && c.duration > 0 &&
    c.start < range.end && c.start + c.duration > range.start
  ).map(c => ({id:c.id, start:Math.max(c.start,range.start), end:Math.min(c.start+c.duration,range.end)}));
}
const validTime = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 86400;
export function normalizeDirectionRange(range) {
  if (!range || typeof range !== 'object' || Array.isArray(range)) throw Error('Direction must be a record.');
  if (typeof range.id !== 'string' || !range.id.trim() || range.id.length > 200) throw Error('Direction needs a stable ID.');
  if (!validTime(range.start) || !validTime(range.end) || range.end <= range.start) throw Error('Direction must have a valid start and later end, in seconds.');
  for (const key of ['episodeId', 'groupId']) if (range[key] != null && typeof range[key] !== 'string') throw Error(`${key} must be text.`);
  if (range.enabled !== undefined && typeof range.enabled !== 'boolean') throw Error('Direction enabled must be boolean.');
  return { id: range.id, ...(range.episodeId ? {episodeId:range.episodeId} : {}), title: typeof range.title === 'string' ? range.title.slice(0,300) : 'Direction', start: range.start, end: range.end, ...(range.groupId ? {groupId:range.groupId} : {}), enabled: range.enabled !== false, settings: normalizeCreativeDirection(range.settings) };
}
export function directionRanges(project) {
  const episode = project.episodeId;
  const beats = project.storyPlans?.[episode]?.beats || [];
  const result = [], seen = new Set();
  for (const raw of Array.isArray(project.directionRanges) ? project.directionRanges : []) {
    let range;
    try { range = normalizeDirectionRange(raw); } catch { continue; }
    if ((range.episodeId && range.episodeId !== episode) || seen.has(range.id)) continue;
    seen.add(range.id);
    const resolved = { ...range, storedStart: range.start, storedEnd: range.end, resolved: true, timingSource: 'absolute' };
    if (range.groupId) {
      const group = beats.find(b => b.id === range.groupId && b.nodeType !== 'clip' && !['clip','generation'].includes(b.kind));
      if (!group) Object.assign(resolved, {resolved:false,timingSource:'missing-group'});
      else {
        const ids = new Set([group.id]);
        let changed = true;
        while (changed) { changed = false; for (const b of beats) if (ids.has(b.parentId) && !ids.has(b.id)) {ids.add(b.id);changed=true;} }
        const drafts = (project.drafts || []).filter(d => (!d.episodeId || d.episodeId === episode) && ids.has(d.storyBeatId));
        const targets = new Set(drafts.flatMap(d => [d.targetId,d.generationSlotId]).filter(Boolean));
        const clips = (project.clips || []).filter(c => (!c.episodeId || c.episodeId === episode) && (ids.has(c.storyBeatId) || ids.has(c.structureNodeId) || targets.has(c.id) || c.generationTargets?.some(id=>targets.has(id)) || drafts.some(d=>d.id===c.sourceDraftId)) && validTime(c.start) && Number.isFinite(c.duration) && c.duration > 0);
        const start = clips.length ? Math.min(...clips.map(c=>c.start)) : group.start;
        const end = clips.length ? Math.max(...clips.map(c=>c.start+c.duration)) : group.end ?? group.start + group.duration;
        if (validTime(start) && validTime(end) && end > start) Object.assign(resolved,{start,end,timingSource:clips.length?'edited-group':'planned-group'});
        else Object.assign(resolved,{resolved:false,timingSource:'missing-group'});
      }
    }
    result.push(resolved);
  }
  return result;
}
// Palette alternatives are mutually exclusive across precedence layers.
function merge(...layers) {
  const value = {};
  for (const layer of layers) {
    const selected = normalizeCreativeDirection(layer);
    if (selected.palette) delete value.customPalette;
    if (selected.customPalette) delete value.palette;
    Object.assign(value,selected);
  }
  return value;
}
export function timedDirectionSegments(project, draft) {
  const start = draft.start, duration = draft.settings?.duration;
  if (!validTime(start) || !Number.isFinite(duration) || duration <= 0) return [];
  const ranges = directionRanges({...project,episodeId:draft.episodeId || project.episodeId}).filter(r=>r.enabled && r.resolved && r.start < start+duration && r.end > start && creativeDirectionText(r.settings));
  if (!ranges.length) return [];
  const cuts = [...new Set([0,duration,...ranges.flatMap(r=>[Math.max(0,r.start-start),Math.min(duration,r.end-start)])])].sort((a,b)=>a-b);
  const baseline = effectiveCreativeDirection(project,{...draft,creativeDirection:undefined});
  const segments=[];
  for (let i=0;i<cuts.length-1;i++) {
    const a=cuts[i],b=cuts[i+1];
    const active=ranges.filter(r=>r.start<start+b && r.end>start+a);
    const settings=merge(baseline,...active.map(r=>r.settings),draft.creativeDirection);
    delete settings.pacing;
    const previous=segments.at(-1);
    if(previous && JSON.stringify(previous.settings)===JSON.stringify(settings)) previous.end=b;
    else segments.push({start:a,end:b,settings});
  }
  return segments;
}
export function timelineDirectionSignature(project,draft) {
  // Manual prepared directions (including frozen absence) supersede timeline defaults.
  if (draft.sectionOverrides?.['Creative direction'] !== undefined) return '[]';
  return JSON.stringify(timedDirectionSegments(project,draft));
}
const seconds = n => String(Math.round(n*1000)/1000);
export function timelineCreativeSection(project,draft,automation,model) {
  if (!automation.specs || draft.sectionOverrides?.['Creative direction'] !== undefined) return null;
  const segments=timedDirectionSegments(project,draft);
  if(!segments.length) return null;
  const lines=['Timed visual defaults, measured in seconds from this clip’s beginning. Apply only during each stated interval and the named scene’s actual overlap; do not retime actions, add cuts, or extend a scene to match these intervals. Authored prose, dialogue, shot direction and supplied frames/references take precedence.'];
  (draft.scenes || []).forEach((scene,index)=>{
    for(const segment of segments) {
      const settings=merge(segment.settings,scene.creativeDirection);
      delete settings.pacing;
      const custom=!!scene.cameraDirection?.trim();
      const framing=!!scene.camera && scene.camera!=='Auto';
      const movement=!!scene.movement && scene.movement!=='Auto';
      if(!automation.camera || custom || framing) {delete settings.lens;delete settings.cameraAngle;delete settings.cameraPosition;delete settings.cameraPath;}
      if(!automation.camera || custom || framing || movement) {delete settings.movement;delete settings.cameraPath;}
      const text=creativeDirectionText(settings);
      if(text) lines.push(`Scene ${index+1}, only within clip ${seconds(segment.start)}–${seconds(segment.end)}s: ${text.replaceAll('\n',' ')}`);
    }
  });
  return {label:'Creative direction',source:'Timed direction defaults · explicit shot direction wins',text:lines.length>1?lines.join('\n'):''};
}

export function validateDirectionRanges(value) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 2000) throw Error('Direction ranges must be an array of up to 2000 records.');
  const ids=new Set();
  for(const raw of value) {
    const range=normalizeDirectionRange(raw);
    if(ids.has(range.id)) throw Error('Direction IDs must be unique.');
    ids.add(range.id);
  }
}
export function timelineDirectionContext(project,draft) {
  if (draft.sectionOverrides?.['Creative direction'] !== undefined) return null;
  const segments=timedDirectionSegments(project,draft);
  if(!segments.length) return null;
  return {version:DIRECTION_VERSION,segments,ranges:directionRanges({...project,episodeId:draft.episodeId || project.episodeId}).filter(r=>r.enabled && r.resolved && r.start<draft.start+draft.settings.duration && r.end>draft.start)};
}
