import React, { useRef } from "react";
import { Shapes, Layers, Film, AudioLines, SlidersHorizontal } from "lucide-react";
import "./timeline-modes.css";

const modes = [
  { id: "all", label: "All", icon: Layers },
  { id: "video", label: "Video", icon: Film },
  { id: "sound", label: "Sound", icon: AudioLines },
  { id: "direction", label: "Direction", icon: SlidersHorizontal },
  { id: "elements", label: "Elements", icon: Shapes },
];

export function TimelineModes({
  value = "all",
  onChange,
  soundActive,
  soundDirty,
}) {
  const buttons = useRef([]);
  const select = (index) => {
    buttons.current[index]?.focus();
    onChange(modes[index].id);
  };
  return (
    <nav className="timeline-modes" aria-label="Timeline views">
      <div
        role="tablist"
        aria-label="Timeline view"
        aria-orientation="vertical"
      >
        {modes.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={value === id}
            tabIndex={value === id ? 0 : -1}
            className={`timeline-mode${value === id ? " active" : ""}`}
            title={
              id === "sound" && soundDirty
                ? "Sound · changes to apply"
                : `${label} timeline`
            }
            onClick={() => onChange(id)}
            onKeyDown={(event) => {
              let next;
              if (event.key === "ArrowDown" || event.key === "ArrowRight")
                next = (index + 1) % modes.length;
              if (event.key === "ArrowUp" || event.key === "ArrowLeft")
                next = (index + modes.length - 1) % modes.length;
              if (event.key === "Home") next = 0;
              if (event.key === "End") next = modes.length - 1;
              if (next !== undefined) {
                event.preventDefault();
                event.stopPropagation();
                select(next);
              }
            }}
          >
            <span className="timeline-mode-icon">
              <Icon size={17} strokeWidth={1.65} aria-hidden="true" />
              {id === "sound" && (soundActive || soundDirty) && (
                <span
                  className={`timeline-mode-dot${soundDirty ? " dirty" : ""}`}
                  aria-hidden="true"
                />
              )}
            </span>
            <span>{label}</span>
            {id === "sound" && soundDirty && (
              <span className="timeline-mode-sr">Changes to apply</span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
