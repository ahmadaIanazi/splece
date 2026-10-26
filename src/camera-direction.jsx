import { claimCamera, fieldOwner } from "../shared/composer-assistant.mjs";
import React, { useEffect, useRef, useState } from 'react';
import { Camera, Sparkles, RotateCcw } from 'lucide-react';
import { cameraAtPoint, elevations, framings, readCamera, viewpoints, writeCamera } from '../shared/camera-direction.mjs';
import './camera-direction.css';

function Figure({ x = 120, y = 85, scale = 1, profile = false }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} fill="currentColor">
    <ellipse cy="-24" rx={profile ? 9 : 13} ry="16" />
    <path d="M-15-4 Q0-11 15-4 L23 42 13 45 8 15 9 75 0 75-2 43-5 75-14 75-11 15-19 45-28 42Z" />
  </g>;
}
export function CameraDirection({ scene, index, change }) {
  const [draft, setDraft] = useState(null);
  const drag = useRef(null);
  const [flash, setFlash] = useState([]);
  const stamp = JSON.stringify(scene.assistant?.changed || {});
  useEffect(() => {
    setFlash(Object.entries(scene.assistant?.changed || {}).filter(([,v])=> Date.now()-v.at < 4500).map(([k])=>k));
    const timer = setTimeout(()=>setFlash([]),4500);
    return ()=>clearTimeout(timer);
  }, [stamp]);
  const flashClass = field => flash.includes(field) ? 'assistant-changed-control' : '';
  const parsed = readCamera(scene.camera);
  const view = draft || parsed;
  const blocked = !!scene.cameraDirection || !parsed.recognized;
  const update = patch => change(s => { s.camera = writeCamera(s.camera, patch); claimCamera(s, Object.keys(patch)); });
  const point = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    // Match the interaction area to the visible orbit, independently of zoom.
    return cameraAtPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };
  const finish = event => {
    if (!drag.current) return;
    const patch = point(event);
    drag.current = null;
    setDraft(null);
    update(patch);
  };
  const x = 24 + Math.max(0, viewpoints.indexOf(view.viewpoint || 'Front view')) * 38;
  const y = 120 - Math.max(0, elevations.indexOf(view.elevation || 'Eye level')) * 30;
  const scale = { Auto: .8, 'Wide shot': .65, 'Medium shot': 1.25, 'Close-up': 2.8, 'Extreme close-up': 5, 'Over the shoulder': 1.15 }[view.framing];
  return <section className="camera-stage" aria-label={`Shot ${index + 1} visual camera direction`}>
    {blocked && <p className="camera-stage-notice">Your written direction is active. Edit it in Write to use visual presets.</p>}
    <fieldset disabled={blocked}>
      <div className="camera-stage-visuals">
        <div className="camera-orbit-wrap">
          <div className="camera-orbit" role="group" aria-label="Drag camera position" onPointerDown={e => {
            if (blocked || e.button !== 0) return;
            e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = true; setDraft({ ...parsed, ...point(e) });
          }} onPointerMove={e => { if (drag.current) setDraft({ ...parsed, ...point(e) }); }}
          onPointerUp={finish} onPointerCancel={() => { drag.current = null; setDraft(null); }}
          onLostPointerCapture={() => { drag.current = null; setDraft(null); }}>
            <svg viewBox="0 0 200 150" aria-hidden="true">
              <ellipse className="camera-orbit-line" cx="100" cy="84" rx="78" ry="31" />
              <ellipse className="camera-orbit-line" cx="100" cy="78" rx="38" ry="65" />
              <path className="camera-orbit-line" d="M22 84 Q100-32 178 84 M22 84 Q100 155 178 84" />
              <g className="camera-subject"><Figure x={100} y={75} scale={.55} /></g>
              <path className="camera-sight" d={`M${x} ${y} L100 75`} />
              <g className="camera-position" transform={`translate(${x - 10} ${y - 8})`}><rect width="20" height="16" rx="4" /><path d="m20 5 7-4v14l-7-4" /></g>
            </svg>
          </div>
          <small>Drag to place the camera</small>
        </div>
        <div className="camera-mini-preview">
          <svg viewBox="0 0 240 150" aria-label="Schematic framing preview" role="img">
            <path className="camera-preview-grid" d="M80 0v150M160 0v150M0 50h240M0 100h240" />
            <path className="camera-preview-ground" d={`M0 ${view.elevation === 'Low angle' ? 120 : 85}h240`} />
            <g className="camera-preview-person" transform={`rotate(${view.elevation === 'Overhead' ? -35 : 0} 120 75)`}>
              <Figure x={120} y={view.framing.includes('close-up') || view.framing === 'Close-up' ? 130 : 65} scale={scale} profile={view.viewpoint?.includes('profile')} />
              {view.framing === 'Over the shoulder' && <Figure x={25} y={140} scale={2} />}
            </g>
          </svg>
          <small>{[view.framing, view.elevation, view.viewpoint].filter(Boolean).join(' · ')}</small>
        </div>
      </div>
      <div className="camera-framings" aria-label="Framing">
        {framings.map(f => <button key={f + (view.framing === f ? stamp : "")} className={view.framing === f ? flashClass("framing") : ""} aria-pressed={view.framing === f} onClick={() => update({ framing: f })} title={f}>
          {f === 'Auto' ? <Sparkles size={13} /> : <Camera size={13} />}{f.replace(' shot', '')}
        </button>)}
      </div>
      <div className="camera-position-fields">
        <label className={flashClass("elevation")}>Height<select aria-label="Camera height" value={view.elevation || ''} onChange={e => update({ elevation: e.target.value || null })}><option value="">Auto</option>{elevations.map(v => <option key={v}>{v}</option>)}</select></label>
        <label className={flashClass("viewpoint")}>View<select aria-label="Camera viewpoint" value={view.viewpoint || ''} onChange={e => update({ viewpoint: e.target.value || null })}><option value="">Auto</option>{viewpoints.map(v => <option key={v}>{v}</option>)}</select></label>
        <button className="camera-reset" title="Reset framing and position to Auto" aria-label="Reset framing and position to Auto" onClick={() => change(s => { s.camera = 'Auto'; claimCamera(s, ['framing','elevation','viewpoint']); })}><RotateCcw size={15} /></button>
      </div>
    </fieldset>
    <div className="assistant-field-ownership" aria-label="Camera control ownership">
      {['framing','elevation','viewpoint','movement'].map(field => <button key={field} title={`Click to ${fieldOwner(scene,field)==='manual'?'follow your writing':'keep this value manual'}`} aria-label={`${field}: ${fieldOwner(scene,field)==='manual'?'manual':'following writing'}`} onClick={()=>change(s=>claimCamera(s,[field],fieldOwner(s,field)==='manual'?'following':'manual'))}>{field === 'elevation'?'Height':field} <small>{fieldOwner(scene,field)==='manual'?'Manual':'Following'}</small></button>)}
    </div>
    <small className="camera-stage-caption">Schematic preview · direction guides the model; references still influence composition.</small>
  </section>;
}
