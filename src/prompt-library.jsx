import React, { useState } from 'react';
import recipes from '../shared/prompt-recipes.json';
import { promptCategories, promptPresets, renderPromptPreset, applyPromptPreset } from '../shared/prompt-library.mjs';
import './prompt-library.css';

// Mount inside the existing library surface, not a persistent composer panel.
export function PromptLibrary({ project, draft, change, onApplied }) {
  const [category, setCategory] = useState('portrait-identity');
  const [selected, setSelected] = useState(null);
  const [fields, setFields] = useState({});
  const [message, setMessage] = useState('');
  const preset = promptPresets.find(p => p.id === selected);
  let rendered;
  try { if (preset) rendered = renderPromptPreset(preset.id, fields); } catch { /* Incomplete form. */ }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setMessage('Copied.'); }
    catch { setMessage('Copy was unavailable. Select the text below to copy it.'); }
  }
  return <section className="prompt-library" aria-label="Prompt library">
    <header><h3>Prompt library</h3><p>Original recipes and reusable starting points.</p></header>
    <label>Category<select value={category} onChange={e => { setCategory(e.target.value); setSelected(null); setFields({}); setMessage(''); }}>{promptCategories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    <h4>Reusable presets</h4>
    <div className="prompt-library-choices">{promptPresets.filter(p => p.category === category).map(p => <button type="button" key={p.id} aria-pressed={selected === p.id} onClick={() => { setSelected(p.id); setFields({}); setMessage(''); }}>{p.title}<small>{p.target === 'image' ? 'Image prompt · copy' : 'Video prompt'}</small></button>)}</div>
    {preset && <div className="prompt-library-preset">
      {preset.fields.map(key => <label key={key}>{key}<textarea value={fields[key] || ''} onChange={e => setFields({ ...fields, [key]: e.target.value })} /></label>)}
      {preset.note && <p>{preset.note}</p>}
      {rendered && <><pre tabIndex={0}>{rendered.text}</pre><button type="button" onClick={() => copy(rendered.text)}>Copy preset</button>{preset.target === 'video' && project && draft && change && <button type="button" onClick={() => {
        try { change(p => applyPromptPreset(p, draft.id, preset.id, fields)); setMessage('Saved as a new variation. Original writing retained.'); onApplied?.(); } catch (e) { setMessage(e.message); }
      }}>Add as new variation</button>}</>}
    </div>}
    <h4>Verbatim originals</h4><p>Saved exactly as supplied. Example choices apply only to that recipe. Audio/video reference examples require a compatible external workflow.</p>
    {recipes.filter(r => r.categories.includes(category)).map(r => <details key={r.id}><summary>{r.title}</summary><small>User-supplied tutorial · original wording</small><pre tabIndex={0}>{r.verbatim}</pre><button type="button" onClick={() => copy(r.verbatim)}>Copy original</button></details>)}
    <p role="status">{message}</p>
  </section>;
}
