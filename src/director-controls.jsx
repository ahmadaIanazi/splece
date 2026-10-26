import React, { useRef } from "react";
import { Camera, Minus, Plus, Sun } from "lucide-react";
import {
  durationStops,
  durationText,
  palettes,
} from "../shared/director-desk.mjs";

export function Fader({
  label,
  value,
  onPreview,
  onCommit,
  min = 0,
  max = 100,
  ends,
  unit = "%",
  step = 1,
}) {
  const latest = useRef(value);
  latest.current = value;
  return (
    <label className="desk-fader">
      <span>
        {label}
        <output>
          {Math.round(value)}
          {unit}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        style={{ "--range-fill": `${((value - min) / (max - min)) * 100}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          latest.current = Number(e.target.value);
          onPreview(latest.current);
        }}
        onPointerUp={() => onCommit(latest.current)}
        onKeyUp={() => onCommit(latest.current)}
        onBlur={() => onCommit(latest.current)}
      />
      {ends && (
        <small>
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </small>
      )}
    </label>
  );
}
export function Dial({ value, onPreview, onCommit, feedback }) {
  const current = useRef(value),
    drag = useRef(null);
  const index = durationStops.reduce(
    (best, n, i) =>
      Math.abs(n - value) < Math.abs(durationStops[best] - value) ? i : best,
    0,
  );
  const pick = (i) => {
    const n = durationStops[Math.max(0, Math.min(5, i))];
    if (n !== current.current) {
      feedback?.();
      current.current = n;
      onPreview(n);
    }
  };
  return (
    <div className="desk-dial-wrap" dir="ltr">
      <div
        className="desk-dial"
        role="slider"
        aria-label="Story length"
        aria-valuemin={Math.min(5, value)}
        aria-valuemax={Math.max(600, value)}
        aria-valuenow={value}
        aria-valuetext={durationText(value)}
        tabIndex={0}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, index };
          current.current = value;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            pick(
              drag.current.index +
                Math.round((drag.current.y - e.clientY) / 22),
            );
        }}
        onPointerUp={() => {
          if (drag.current) {
            onCommit(current.current);
            drag.current = null;
          }
        }}
        onPointerCancel={() => {
          onPreview(value);
          drag.current = null;
        }}
        onKeyDown={(e) => {
          const delta = ["ArrowUp", "ArrowRight"].includes(e.key)
            ? 1
            : ["ArrowDown", "ArrowLeft"].includes(e.key)
              ? -1
              : 0;
          if (delta || ["Home", "End"].includes(e.key)) {
            e.preventDefault();
            pick(e.key === "Home" ? 0 : e.key === "End" ? 5 : index + delta);
            onCommit(current.current);
          }
        }}
      >
        <div
          className="desk-dial-face"
          style={{ "--dial-angle": `${-135 + index * 54}deg` }}
        >
          <i />
          <strong>{durationText(value)}</strong>
          <small>story length</small>
        </div>
      </div>
      <div className="desk-detents">
        {durationStops.map((n) => (
          <button
            type="button"
            key={n}
            aria-pressed={n === value}
            onClick={() => {
              feedback?.();
              onCommit(n);
            }}
          >
            {durationText(n)}
          </button>
        ))}
      </div>
      <small className="desk-hint">Drag up · ↑ or → to increase</small>
    </div>
  );
}
export function XYPad({ desk, onPreview, onCommit }) {
  const drag = useRef(false),
    last = useRef({});
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    last.current = {
      realism: Math.round(
        Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      ),
      energy: Math.round(
        Math.max(
          0,
          Math.min(100, 100 - ((e.clientY - r.top) / r.height) * 100),
        ),
      ),
    };
    onPreview(last.current);
  };
  return (
    <>
      <div
        className="desk-xy"
        dir="ltr"
        role="group"
        aria-label="Mood pad"
        onPointerDown={(e) => {
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => {
          if (drag.current) move(e);
        }}
        onPointerUp={() => {
          if (drag.current) onCommit(last.current);
          drag.current = false;
        }}
        onPointerCancel={() => {
          onPreview({});
          drag.current = false;
        }}
      >
        <span className="xy-top">Energetic</span>
        <span className="xy-bottom">Calm</span>
        <span className="xy-left">Drawn</span>
        <span className="xy-right">Real</span>
        <i style={{ left: `${desk.realism}%`, top: `${100 - desk.energy}%` }} />
      </div>
      <div className="desk-inline-controls">
        <Fader
          label="Realism"
          value={desk.realism}
          onPreview={(v) => onPreview({ realism: v })}
          onCommit={(v) => onCommit({ realism: v })}
        />
        <Fader
          label="Energy"
          value={desk.energy}
          onPreview={(v) => onPreview({ energy: v })}
          onCommit={(v) => onCommit({ energy: v })}
        />
      </div>
    </>
  );
}
export function SunArc({ desk, onPreview, onCommit }) {
  const dragging = useRef(false),
    last = useRef(desk.sun);
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    last.current = Math.round(
      Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
    );
    onPreview({
      sun: last.current,
      light: desk.light,
    });
  };
  return (
    <>
      <div
        className="desk-sun-arc"
        dir="ltr"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) move(e);
        }}
        onPointerUp={() => {
          if (dragging.current)
            onCommit({
              sun: last.current,
              light: desk.light,
            });
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
          onPreview({});
        }}
      >
        <svg viewBox="0 0 240 90" aria-hidden="true">
          <path
            d="M12 78 Q120 -55 228 78"
            fill="none"
            stroke="currentColor"
            strokeDasharray="2 6"
          />
          <path d="M10 80H230" stroke="currentColor" opacity=".2" />
        </svg>
        <Sun
          size={26}
          style={{
            left: `${8 + desk.sun * 0.84}%`,
            top: `${68 - Math.sin((desk.sun / 100) * Math.PI) * 56}%`,
          }}
        />
        <small>Left</small>
        <small>Right</small>
      </div>
      <Fader
        label="Light position"
        value={desk.sun}
        onPreview={(v) => onPreview({ sun: v })}
        onCommit={(v) => onCommit({ sun: v })}
      />
    </>
  );
}
export function PaletteWheel({ desk, onCommit }) {
  return (
    <div className="desk-palette-wheel" aria-label="Color palettes">
      {palettes.map((p, i) => (
        <button
          type="button"
          key={p.id}
          title={p.label}
          aria-label={p.label}
          aria-pressed={!desk.customColors?.length && desk.palette === p.id}
          onClick={() => onCommit({ palette: p.id })}
          style={{
            "--swatch": p.colors[0],
            "--swatch2": p.colors[1],
            "--swatch3": p.colors[2],
            "--position": `${i * 72}deg`,
          }}
        >
          <i />
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  );
}
export function CameraRig({ desk, onPreview, onCommit }) {
  return (
    <>
      <div className="desk-camera-rig" aria-hidden="true">
        <div style={{ transform: `rotate(${(desk.angle - 50) * 0.25}deg)` }}>
          <Camera size={46} />
          <span style={{ transform: `rotate(${desk.lens * 2.7}deg)` }}>◉</span>
        </div>
        <i />
        <small>
          {desk.lens < 25
            ? "The whole setting"
            : desk.lens < 55
              ? "With the subject"
              : desk.lens < 85
                ? "Closer to the subject"
                : "The tiny details"}
        </small>
      </div>
      <Fader
        label="Framing"
        value={desk.lens}
        ends={["Wide", "Detail"]}
        onPreview={(v) => onPreview({ lens: v })}
        onCommit={(v) => onCommit({ lens: v })}
      />
      <Fader
        label="Camera height"
        value={desk.angle}
        ends={["Looking down", "Looking up"]}
        onPreview={(v) => onPreview({ angle: v })}
        onCommit={(v) => onCommit({ angle: v })}
      />
      <Fader
        label="Camera movement"
        value={desk.movement}
        ends={["Still", "Move closer"]}
        onPreview={(v) => onPreview({ movement: v, path: [] })}
        onCommit={(v) => onCommit({ movement: v, path: [] })}
      />
    </>
  );
}
export function SetPlan({ desk, onPreview, onCommit }) {
  const drawing = useRef(false),
    points = useRef([]);
  const point = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(5, Math.min(95, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(5, Math.min(95, ((e.clientY - r.top) / r.height) * 100)),
    };
  };
  return (
    <div className="desk-set-plan">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label="Draw a camera path around the subject. Movement and position sliders are available below."
        onPointerDown={(e) => {
          drawing.current = true;
          points.current = [point(e)];
          e.currentTarget.setPointerCapture(e.pointerId);
          onPreview({ path: points.current });
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = point(e),
            last = points.current.at(-1);
          if (
            Math.hypot(p.x - last.x, p.y - last.y) > 5 &&
            points.current.length < 40
          ) {
            points.current = [...points.current, p];
            onPreview({ path: points.current });
          }
        }}
        onPointerUp={() => {
          if (drawing.current) onCommit({ path: points.current });
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
          onPreview({});
        }}
      >
        <circle
          cx="50"
          cy="50"
          r="34"
          fill="none"
          stroke="currentColor"
          strokeDasharray="1 3"
          opacity=".3"
        />
        <circle cx="50" cy="50" r="7" fill="currentColor" opacity=".5" />
        <polyline
          points={desk.path.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="var(--action-primary)"
          strokeWidth="1.8"
        />
        <rect
          x={50 + Math.sin(((desk.orbit - 50) / 100) * Math.PI * 2) * 34 - 4}
          y={50 + Math.cos(((desk.orbit - 50) / 100) * Math.PI * 2) * 34 - 3}
          width="8"
          height="6"
          rx="1"
          fill="var(--action-primary)"
        />
      </svg>
      <span>Draw a path · top view</span>
      <button
        type="button"
        onClick={() => onCommit({ path: [] })}
        disabled={!desk.path.length}
      >
        Clear path
      </button>
    </div>
  );
}
