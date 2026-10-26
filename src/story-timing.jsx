import React, { useState, useEffect } from "react";
import {
  formatStoryTime as fmt,
  allocateStoryTime,
  resizeStorySection,
} from "../shared/story-tree.mjs";
export function StoryBudget({ plan, edit, select }) {
  const roots = plan.beats
    .filter((b) => !b.parentId)
    .sort((a, b) => a.start - b.start);
  const target = plan.setup?.targetDuration || 60,
    allocated = roots.reduce((n, b) => n + b.duration, 0);
  const extent = Math.max(0, ...roots.map((b) => b.start + b.duration));
  return (
    <section className="story-budget">
      <header>
        <b>Suggested story length</b>
        <span>
          {fmt(target)} total · {Math.round((target / 60) * 10) / 10} min
        </span>
      </header>
      <div className="story-budget-bar">
        {roots.map((b) => (
          <button
            key={b.id}
            onClick={() => select(b.id)}
            style={{ flex: b.duration }}
            title={`${b.title} · ${fmt(b.start)}–${fmt(b.start + b.duration)}`}
          >
            <b>{b.title}</b>
            <span>
              {fmt(b.duration)} · {Math.round((b.duration / target) * 100)}%
            </span>
          </button>
        ))}
      </div>
      <p>
        {fmt(allocated)} assigned to {roots.length} large sections ·{" "}
        {allocated > target
          ? `${fmt(allocated - target)} over budget`
          : `${fmt(target - allocated)} unassigned`}
        {extent > target && " · outline extends past the target"}
      </p>
      <div className="author-actions">
        <button
          disabled={!roots.length}
          onClick={() => edit((p) => allocateStoryTime(p))}
        >
          Fit sections to target
        </button>
        <button
          disabled={!roots.length}
          onClick={() => edit((p) => allocateStoryTime(p, "", true))}
        >
          Divide target equally
        </button>
      </div>
      <small>
        Fits the outline proportionally and moves its scenes and generations
        with it. Rendered clips and timeline remarks stay unchanged.
      </small>
    </section>
  );
}
export function SectionTiming({ plan, beat, edit }) {
  const [value, setValue] = useState(fmt(beat.duration)),
    [error, setError] = useState("");
  useEffect(() => {
    setValue(fmt(beat.duration));
    setError("");
  }, [beat.id, beat.duration]);
  const parent = plan.beats.find((b) => b.id === beat.parentId),
    local = beat.start - (parent?.start || 0);
  const children = plan.beats.filter((b) => b.parentId === beat.id);
  function save() {
    const parts = value.trim().split(":").map(Number),
      duration = parts.length === 2 ? parts[0] * 60 + parts[1] : NaN;
    if (
      parts.length !== 2 ||
      parts.some((n) => !Number.isFinite(n) || n < 0) ||
      parts[1] >= 60 ||
      duration < 0.01
    ) {
      setError("Use minutes:seconds, for example 2:30.");
      return;
    }
    try {
      const copy = structuredClone(plan);
      resizeStorySection(copy, beat.id, duration);
      edit((p) => {
        p.beats = copy.beats;
      });
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="section-timing">
      <header>
        <b>{parent ? `Inside ${parent.title}` : "Inside the story"}</b>
        <span>
          {Math.round(
            (beat.duration /
              (parent?.duration ||
                plan.setup?.targetDuration ||
                beat.duration)) *
              100,
          )}
          % of parent
        </span>
      </header>
      <div className="story-fields">
        <label className="field">
          <span>Duration · minutes:seconds</span>
          <input
            aria-label="Section duration minutes seconds"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
        </label>
        <div>
          <small>Within {parent ? "parent" : "story"}</small>
          <p>
            {fmt(local)}–{fmt(local + beat.duration)}
          </p>
          <small>
            Movie timeline {fmt(beat.start)}–{fmt(beat.start + beat.duration)}
          </small>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <small>
        Timing is optional guidance. It does not block story development.
      </small>
      {children.length > 0 && (
        <button
          onClick={() => edit((p) => allocateStoryTime(p, beat.id, true))}
        >
          Divide {fmt(beat.duration)} equally across {children.length}{" "}
          {children[0].kind}s
        </button>
      )}
    </section>
  );
}
