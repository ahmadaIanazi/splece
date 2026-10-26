import React, { useEffect, useState } from 'react';
import { api } from './state';
import { referenceRoles } from '../shared/reference-roles.mjs';
import { continuityVersion, priorClipContinuitySource, carryPlannedContinuity } from '../shared/clip-continuity.mjs';
import './prompt-library.css';

// Slot into reference inspector. All updates are draft-local.
export function ReferenceRoleControl({ asset, draft, project, onChange }) {
  const value = draft.referenceOptions?.[asset.id] || {};
  const role = value.role || (asset.kind === 'character' ? 'identity' : asset.kind === 'location' ? 'location' : asset.kind === 'prop' ? 'prop' : 'style');
  return <div className="reference-role-control"><label>Use for<select value={role} onChange={e => onChange({ ...value, role: e.target.value })}>{!referenceRoles.some(r => r.id === role) && <option value={role}>{role}</option>}{referenceRoles.map(r => <option value={r.id} key={r.id}>{r.label}</option>)}</select></label>
    {['clothing', 'pose', 'prop'].includes(role) && <label>Applies to<select value={value.targetAssetId || ''} onChange={e => onChange({ ...value, role, targetAssetId: e.target.value || null })}><option value="">Named subject in the prompt</option>{project.assets.filter(a => a.kind === 'character').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    <small>{referenceRoles.find(r => r.id === role)?.instruction}</small>
  </div>;
}
export function ClipContinuityEditor({ draft, onChange, project, jobs }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState('');
  const takeKey = project?.clips?.map(c => `${c.id}:${c.activeTake}`).join('|');
  useEffect(() => {
    if (!open || !project?.id || jobs) return;
    let current = true;
    setLoaded(null); setError('');
    api(`/projects/${encodeURIComponent(project.id)}/jobs`).then(items => {
      if (current) setLoaded({ projectId: project.id, takeKey, items });
    }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [open, project?.id, takeKey, jobs]);
  const availableJobs = jobs || (loaded?.projectId === project?.id && loaded?.takeKey === takeKey ? loaded.items : null);
  const prior = project ? priorClipContinuitySource(project, draft, availableJobs || []) : null;
  const waiting = !!(project?.id && !availableJobs && !error);

  const value = draft.continuity || {};
  function set(key, patch) { onChange({ ...value, version: continuityVersion, [key]: { text: '', provenance: 'planned', ...value[key], ...patch } }); }
  return <details className="clip-continuity-editor" onToggle={e => setOpen(e.currentTarget.open)}><summary>Continuity notes</summary><p>Current opening-frame clothing and props take priority over reference sheets. Planned endings are targets, not confirmed results.</p>
    {project && <div>
      <button type="button" disabled={waiting || !!error || !prior?.draft?.continuity?.plannedEnd?.text?.trim() || !!value.opening?.text?.trim()} onClick={() => {
        const next = structuredClone(draft);
        if (prior?.draft && carryPlannedContinuity(prior.draft, next)) onChange(next.continuity);
      }}>Carry prior clip’s planned ending</button>
      <p role="status">{waiting ? 'Loading the prior take’s saved prompt…' : error ? `Could not load prior take: ${error}` : value.opening?.text?.trim() ? 'Opening notes are already filled; they will not be replaced.' : !prior ? 'No earlier clip.' : !prior.draft ? prior.reason : !prior.draft.continuity?.plannedEnd?.text?.trim() ? 'The prior clip has no planned ending to carry.' : prior.origin === 'active-take-plan' ? 'Uses the active take’s saved plan, not an observed result.' : 'Uses the current source draft’s plan; the active take’s saved plan is unavailable.'}</p>
    </div>}
    <label>Opening state<textarea value={value.opening?.text || ''} onChange={e => set('opening', { text: e.target.value })} /></label>
    <label>Opening evidence<select value={value.opening?.provenance || 'planned'} onChange={e => set('opening', { provenance: e.target.value, source: undefined })}><option value="planned">Planned — not yet confirmed</option><option value="user-confirmed">I checked this state</option>{value.opening?.provenance === 'observed' && <option value="observed">Recorded from a frame</option>}</select></label>
    <label>Planned ending<textarea value={value.plannedEnd?.text || ''} onChange={e => set('plannedEnd', { text: e.target.value, provenance: 'planned' })} /></label>
  </details>;
}
