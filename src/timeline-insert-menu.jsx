import React, { useEffect, useRef } from 'react';
import { Clapperboard, Image, AudioLines, WandSparkles, Layers, Archive, Sparkles } from 'lucide-react';
import './timeline-insert-menu.css';

const primary = [
  ['video', 'Video', Clapperboard], ['image', 'Image', Image],
  ['audio', 'Audio', AudioLines], ['effect', 'Effect', WandSparkles],
];
export function TimelineInsertMenu({ onChoose, onClose, onConnectPhotos, style }) {
  const root = useRef(null);
  useEffect(() => { root.current?.querySelector('button')?.focus({ preventScroll: true }); }, []);
  const choose = kind => { onClose(); onChoose(kind); };
  return <div ref={root} className="timeline-insert-menu" role="dialog" aria-label="Insert into timeline" style={style}
    onKeyDown={event => {
      const buttons = [...root.current.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
          (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    <div className="timeline-insert-primary">{primary.map(([kind, label, Icon]) =>
      <button type="button" key={kind} onClick={() => choose(kind)}><Icon size={19} strokeWidth={1.5} aria-hidden="true"/><span>{label}</span></button>
    )}</div>
    <div className="timeline-insert-secondary">
      <button type="button" onClick={() => choose('group')}><Layers size={14} aria-hidden="true"/>Group</button>
      <button type="button" onClick={() => choose('library')}><Archive size={14} aria-hidden="true"/>Library</button>
      {onConnectPhotos && <button type="button" onClick={() => { onClose(); onConnectPhotos(); }}><Sparkles size={14} aria-hidden="true"/>Connect photos</button>}
    </div>
  </div>;
}
