import React, { useState } from 'react';
import { qualityDefaults, qualityResolution, validateQualityPresets } from '../shared/generation-quality.mjs';
import { imageModels } from '../shared/asset-generation.mjs';
export function GenerationQualitySettings({value = {}, onChange, models = []}) {
  const [modelId, setModelId] = useState('');
  const [error, setError] = useState('');
  const all = [...models, ...imageModels];
  const model = all.find(m=>m.id===modelId);
  const pair = modelId ? value.models?.[modelId] || {} : value;
  const options = model?.resolutions || ['480p','720p','1080p','1440p','2160p'];
  return <section className="generation-quality-settings">
    <h3>Draft & Final</h3>
    <p>Start in Draft. Final uses a red button and may cost more. These presets keep your selected model.</p>
    <label className="field"><span>Preset for</span><select aria-label="Quality preset model" value={modelId} onChange={e=>setModelId(e.target.value)}>
      <option value="">All video & image models</option>
      {all.filter((m,i,a)=>a.findIndex(v=>v.id===m.id)===i).map(m=><option key={m.id} value={m.id}>{m.name || m.id}</option>)}
    </select></label>
    {['draft','final'].map(q=><label className="field" key={q}><span>{q==='draft'?'Draft':'Final'} resolution</span><select aria-label={`${q} preset resolution`} value={pair[q] || ''} onChange={e=>{
      const next = structuredClone(value);
      const target = modelId ? ((next.models ??= {})[modelId] ??= {}) : next;
      if(e.target.value) target[q]=e.target.value; else delete target[q];
      try {onChange(validateQualityPresets(next));setError('');} catch(e) {setError(e.message);}
    }}><option value="">{modelId ? `Automatic · ${qualityResolution(value,model,q) || 'provider default'}` : `Default · ${qualityDefaults[q]}`}</option>{options.map(v=><option key={v}>{v}</option>)}</select></label>)}
    {error && <p role="alert">{error}</p>}
    <small>Unsupported Draft sizes use the lowest available resolution. Final uses the nearest supported size. Fixed-size image models keep their native output.</small>
  </section>;
}
