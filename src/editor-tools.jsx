import React, { useRef } from "react";
import { NotebookPen, Clapperboard, SlidersHorizontal, WandSparkles, Shapes, AudioLines, Type, Square, Circle, ArrowUpRight, X } from "lucide-react";

const tools = [
  {id:"plan", label:"Plan", icon:NotebookPen},
  {id:"prompt", label:"Composer", icon:Clapperboard},
  {id:"direction", label:"Direction", icon:SlidersHorizontal},
  {id:"effects", label:"Effects", icon:WandSparkles},
  {id:"elements", label:"Elements", icon:Shapes},
  {id:"sound", label:"Sound", icon:AudioLines},
];
export function EditorToolRail({ value, collapsed, onSelect }) {
  const buttons = useRef([]);
  return <nav className="editor-tool-rail" aria-label="Main sidebar">
    <div role="tablist" aria-label="Studio tools" aria-orientation="vertical">
      {tools.map(({id,label,icon:Icon},index) => <button
        key={id} ref={node => { buttons.current[index] = node; }}
        id={`workspace-tab-${id}`} role="tab" aria-label={label}
        aria-selected={!collapsed && value === id} aria-controls={`workspace-panel-${id}`}
        tabIndex={value === id || (!value && index === 0) ? 0 : -1}
        title={!collapsed && value === id ? `Collapse ${label}` : `Open ${label}`}
        onClick={() => onSelect(id)}
        onKeyDown={event => {
          let next;
          if(event.key === "ArrowDown") next = (index + 1) % tools.length;
          if(event.key === "ArrowUp") next = (index + tools.length - 1) % tools.length;
          if(event.key === "Home") next = 0;
          if(event.key === "End") next = tools.length - 1;
          if(next !== undefined) {
            event.preventDefault(); event.stopPropagation();
            buttons.current[next]?.focus(); onSelect(tools[next].id, true);
          }
        }}>
        <Icon size={17} aria-hidden="true"/><span>{label}</span>
      </button>)}
    </div>
  </nav>;
}

const elements = [
  {id:"text", label:"Text", icon:Type, sample:"Aa"},
  {id:"rectangle", label:"Rectangle", icon:Square},
  {id:"ellipse", label:"Circle", icon:Circle},
  {id:"arrow", label:"Arrow", icon:ArrowUpRight},
];
export function ElementsPalette({ onAdd, onClose, disabled }) {
  return <section className="elements-palette" aria-label="Insert elements">
    <header><h2>Elements</h2><button aria-label="Close elements" onClick={onClose}><X size={17}/></button></header>
    <div className="elements-palette-grid">
      {elements.map(({id,label,icon:Icon,sample}) => <button key={id} disabled={disabled} onClick={() => onAdd(id)} aria-label={`Add ${id}`}>
        <span className="element-sample" aria-hidden="true">{sample || <Icon size={38} strokeWidth={1.4}/>}</span>
        <span>{label}</span>
      </button>)}
    </div>
    <p>Added at the playhead. Edit directly in the preview.</p>
  </section>;
}
