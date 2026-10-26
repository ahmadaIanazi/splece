import React, { useState, useRef, useEffect } from "react";
import { Settings2, X, ChevronDown } from "lucide-react";
import { isStructureClip } from "../shared/structure.mjs";
import { descendants, formatStoryTime as fmt } from "../shared/story-tree.mjs";
import { adjustStructureTiming } from "../shared/structure-document.mjs";

export function StructureCardSettings({ node, plan, editNode, move }) {
  const clip = isStructureClip(node);
  const excluded = descendants(plan.beats, node.id);
  return (
    <details className="structure-card-settings">
      <summary>
        <Settings2 size={14} /> Section settings
      </summary>
      <label className="structure-title-edit">
        <span>Title</span>
        <input
          aria-label="Section title"
          value={node.title}
          onChange={(e) =>
            editNode((n) => {
              n.title = e.target.value;
            })
          }
        />
      </label>
      <div className="structure-setting-row">
        <span>Section type</span>
        <div
          className="structure-segments"
          role="group"
          aria-label="Section type"
        >
          {["group", "clip"].map((type) => (
            <button
              key={type}
              aria-pressed={(clip ? "clip" : "group") === type}
              disabled={
                type === "clip" &&
                plan.beats.some((b) => b.parentId === node.id)
              }
              onClick={() =>
                editNode((n) => {
                  n.nodeType = type;
                  n.kind = type === "clip" ? "generation" : "scene";
                })
              }
            >
              {type === "clip" ? "Clip" : "Group"}
            </button>
          ))}
        </div>
      </div>
      <label className="structure-setting-row">
        <span>Inside</span>
        <select
          aria-label="Parent group"
          value={node.parentId || ""}
          onChange={(e) => move(node.id, e.target.value || null, "inside")}
        >
          <option value="">Top level</option>
          {plan.beats
            .filter((b) => !isStructureClip(b) && !excluded.has(b.id))
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
        </select>
      </label>
      {!clip && (
        <>
          <div className="structure-setting-row">
            <span>Develop into</span>
            <div
              className="structure-segments"
              role="group"
              aria-label="AI child item type"
            >
              {["group", "clip"].map((type) => (
                <button
                  key={type}
                  aria-pressed={(node.childNodeType || "clip") === type}
                  onClick={() =>
                    editNode((n) => {
                      n.childNodeType = type;
                    })
                  }
                >
                  {type === "clip" ? "Clips" : "Nested groups"}
                </button>
              ))}
            </div>
          </div>
          <div className="structure-setting-row">
            <span>Filming</span>
            <div
              className="structure-segments"
              role="group"
              aria-label="Group clip mode"
            >
              {[
                ["multiple", "Separate clips"],
                ["compact", "One clip"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  aria-pressed={(node.generationMode || "multiple") === mode}
                  onClick={() =>
                    editNode((n) => {
                      n.generationMode = mode;
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="structure-setting-row">
            <span>Target per clip</span>
            <div
              className="structure-segments"
              role="group"
              aria-label="Group clip duration"
            >
              {[5, 10, 15, 20, 25, 30].map((seconds) => (
                <button
                  key={seconds}
                  aria-pressed={(node.generationDuration || 10) === seconds}
                  onClick={() =>
                    editNode((n) => {
                      n.generationDuration = seconds;
                    })
                  }
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <small className="structure-control-hint">
        Adjust section timing from the ruler beside this section.
      </small>
    </details>
  );
}

export function StructureRuler({ node, plan, edit, open, toggle, close }) {
  const [duration, setDuration] = useState(node.duration);
  const [start, setStart] = useState(node.start);
  const [error, setError] = useState("");
  const drag = useRef(null);
  const pending = useRef(node.duration);
  useEffect(() => {
    setDuration(node.duration);
    pending.current = node.duration;
    setStart(node.start);
  }, [node.id, node.duration, node.start]);
  const commit = (patch) => {
    if (
      (patch.duration === undefined || patch.duration === node.duration) &&
      (patch.start === undefined || patch.start === node.start)
    )
      return;
    try {
      edit((p) => adjustStructureTiming(p, node.id, patch));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const maxDuration = Math.max(
    isStructureClip(node) ? 60 : 300,
    Math.ceil(node.duration / 60) * 120,
  );
  const maxStart =
    Math.max(
      60,
      plan.setup?.targetDuration || 60,
      ...plan.beats.map((b) => b.start + b.duration),
    ) * 2;
  return (
    <div
      className="structure-ruler-control"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        className="structure-time-marker"
        aria-label={"Timing for " + node.title}
        aria-expanded={open}
        title="Adjust timing"
        onClick={toggle}
      >
        <span>{fmt(start)}</span>
        <i />
        <small>{fmt(duration)}</small>
      </button>
      <button
        className="structure-time-stretch"
        role="slider"
        aria-label={"Extend " + node.title}
        aria-orientation="vertical"
        aria-valuemin={1}
        aria-valuemax={Math.max(maxDuration, duration)}
        aria-valuenow={duration}
        aria-valuetext={fmt(duration)}
        title="Drag down to extend; up to shorten"
        style={{
          "--ruler-length": Math.min(76, Math.max(24, duration * 1.5)) + "px",
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, duration: node.duration };
          pending.current = node.duration;
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const value = Math.max(
            1,
            Math.round(
              drag.current.duration + (e.clientY - drag.current.y) / 3,
            ),
          );
          pending.current = value;
          setDuration(value);
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          drag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          commit({ duration: pending.current });
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDuration(node.duration);
        }}
        onKeyDown={(e) => {
          if (!["ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
          e.preventDefault();
          const value =
            e.key === "Home"
              ? 1
              : Math.max(1, node.duration + (e.key === "ArrowDown" ? 1 : -1));
          setDuration(value);
          commit({ duration: value });
        }}
      >
        <ChevronDown size={11} />
      </button>
      {open && (
        <section
          className="structure-time-popover"
          aria-label={"Adjust timing for " + node.title}
        >
          <header>
            <b>{node.title}</b>
            <button className="icon" aria-label="Close timing" onClick={close}>
              <X size={14} />
            </button>
          </header>
          <label>
            <span>
              Duration <output>{fmt(duration)}</output>
            </span>
            <input
              type="range"
              aria-label="Section duration"
              min="1"
              max={maxDuration}
              step="1"
              value={duration}
              onChange={(e) => setDuration(+e.target.value)}
              onPointerUp={(e) => commit({ duration: +e.currentTarget.value })}
              onKeyUp={(e) => commit({ duration: +e.currentTarget.value })}
              onBlur={(e) => commit({ duration: +e.currentTarget.value })}
            />
          </label>
          <div
            className="structure-segments"
            role="group"
            aria-label="Duration presets"
          >
            {(isStructureClip(node)
              ? [5, 10, 15, 20, 30]
              : [15, 30, 60, 120, 300]
            ).map((n) => (
              <button
                key={n}
                aria-pressed={duration === n}
                onClick={() => {
                  setDuration(n);
                  commit({ duration: n });
                }}
              >
                {fmt(n)}
              </button>
            ))}
          </div>
          <label>
            <span>
              Starts at <output>{fmt(start)}</output>
            </span>
            <input
              type="range"
              aria-label="Section start"
              min="0"
              max={maxStart}
              step="1"
              value={start}
              onChange={(e) => setStart(+e.target.value)}
              onPointerUp={(e) => commit({ start: +e.currentTarget.value })}
              onKeyUp={(e) => commit({ start: +e.currentTarget.value })}
              onBlur={(e) => commit({ start: +e.currentTarget.value })}
            />
          </label>
          <small>
            Outline timing. Extending a section shifts later sections; existing
            video stays in place.
          </small>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
