import {
  structureColor,
  structureLabel,
  isStructureClip,
  structurePath,
} from "../shared/structure.mjs";
import React, { useMemo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  editedStoryTiming,
  storyTimelineLabels,
} from "../shared/timeline-navigation.mjs";
import { tc } from "./state";

export function TimelineGuides({
  project,
  zoom,
  viewport,
  onSeek,
  onRemark,
  onSelect,
  onGroupPointerDown,
  selectedId,
  collapsedGroups = [],
  onToggleCollapse,
}) {
  const timings = useMemo(() => editedStoryTiming(project), [project]);
  const { labels, lanes } = useMemo(
    () => storyTimelineLabels(project, zoom, timings, viewport.left),
    [project, zoom, timings, viewport.left],
  );
  return (
    <div className="timeline-guides">
      {Array.from({ length: lanes }, (_, lane) => (
        <div className="story-guide-lane" key={lane}>
          {labels
            .filter(
              (b) =>
                b.lane === lane &&
                !structurePath(
                  project.storyPlans[project.episodeId].beats,
                  b.id,
                )
                  .slice(0, -1)
                  .some((n) => collapsedGroups.includes(n.id)),
            )
            .map((b) => (
              <div
                key={b.id}
                className="story-label-group"
                style={{ left: b.left, width: b.width }}
              >
                {onToggleCollapse && !isStructureClip(b) && (
                  <button
                    className="group-fold-toggle"
                    aria-label={`${collapsedGroups.includes(b.id) ? "Expand" : "Collapse"} ${b.title}`}
                    aria-expanded={!collapsedGroups.includes(b.id)}
                    title={`${collapsedGroups.includes(b.id) ? "Expand" : "Collapse"} group`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onToggleCollapse(b)}
                  >
                    {collapsedGroups.includes(b.id) ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </button>
                )}
                <button
                  className={`story-guide-label story-kind-${b.kind}`}
                  style={{
                    left: 16,
                    width: Math.max(1, b.width - 16),
                    "--story-kind-color": structureColor(
                      project.storyPlans[project.episodeId],
                      b,
                    ),
                  }}
                  aria-current={selectedId === b.id ? "location" : undefined}
                  aria-label={`Open ${structureLabel(project.storyPlans[project.episodeId], b).toLowerCase()}: ${b.title}`}
                  title={`${onGroupPointerDown && !isStructureClip(b) ? "Drag to move group · " : ""}${structureLabel(project.storyPlans[project.episodeId], b)} · ${b.title} · ${tc(b.start)}–${tc(b.end)} in this edit`}
                  onPointerDown={
                    onGroupPointerDown && !isStructureClip(b)
                      ? (e) => onGroupPointerDown(e, b)
                      : undefined
                  }
                  onClick={(e) => {
                    if (
                      onGroupPointerDown &&
                      !isStructureClip(b) &&
                      e.detail !== 0
                    )
                      return;
                    onSelect ? onSelect(b) : onSeek(b.start);
                  }}
                >
                  <span>{b.title}</span>
                </button>
              </div>
            ))}
        </div>
      ))}
      {Array.from({ length: Math.max(1, project.remarkLanes) }, (_, lane) => {
        const remarks = project.remarks
          .filter((r) => r.lane === lane)
          .sort((a, b) => a.start - b.start);
        let edge = -Infinity;
        return (
          <div
            className="remark-lane"
            key={lane}
            title="Double-click to add a fixed-time remark"
            onDoubleClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const start = Math.max(0, (e.clientX - rect.left) / zoom);
              onRemark({ text: "", start, end: start + 5, lane });
            }}
          >
            {remarks.map((r, i) => {
              const left = r.start * zoom;
              const width = Math.max(
                0,
                Math.min(
                  (r.end - r.start) * zoom - 8,
                  ((remarks[i + 1]?.start ?? Infinity) - r.start) * zoom - 10,
                  r.text.length * 6.5 + 18,
                ),
              );
              if (width < 30 || left < edge) return null;
              edge = left + width + 10;
              return (
                <button
                  key={r.id}
                  className={`remark story-kind-${project.storyPlans?.[project.episodeId]?.beats.find((b) => b.id === r.storyBeatId)?.kind || "remark"}`}
                  style={{ left, width }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={() => onRemark(r)}
                  title={`${r.text} · ${tc(r.start)}–${tc(r.end)} · fixed times`}
                >
                  <span>{r.text}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function TimelineRuler({
  children,
  zoom,
  viewport,
  fps,
  onSeek,
  onRange,
  maxTime = Infinity,
  range,
}) {
  const step = zoom >= fps * 5 ? 1 / fps : 1;
  const first = Math.max(0, Math.floor(viewport.left / zoom / step));
  const last = Math.ceil((viewport.left + viewport.width + 80) / zoom / step);
  const ticks = [];
  for (let i = first; i <= last; i++) {
    const at = i * step;
    const second = Math.abs(at - Math.round(at)) < 0.0001;
    const major = Math.abs(at / 10 - Math.round(at / 10)) < 0.0001;
    const label =
      major ||
      (zoom >= 45 && second && Math.round(at) % 5 === 0) ||
      (zoom >= 100 && second);
    ticks.push(
      <span
        key={i}
        className={`ruler-tick ${major ? "major" : second ? "second" : "frame"}`}
        style={{ left: at * zoom }}
      >
        {label && <b>{tc(at).slice(0, -2)}</b>}
      </span>,
    );
  }
  return (
    <div
      className="ruler"
      aria-label="Timeline ruler"
      title="Click to seek · drag to select a range"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        e.preventDefault();
        e.stopPropagation();
        const point = (ev) =>
          Math.max(
            0,
            Math.min(
              maxTime,
              Math.round(((ev.clientX - rect.left) / zoom) * fps) / fps,
            ),
          );
        const anchor = point(e),
          x = e.clientX;
        let moved = false;
        onRange?.(null);
        onSeek(anchor);
        const move = (ev) => {
          if (Math.abs(ev.clientX - x) > 4) moved = true;
          if (moved)
            onRange?.({
              from: Math.min(anchor, point(ev)),
              to: Math.max(anchor, point(ev)),
            });
        };
        const clear = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", cancel);
        };
        const up = (ev) => {
          move(ev);
          if (!moved || Math.abs(point(ev) - anchor) < 1 / fps) {
            onRange?.(null);
            onSeek(point(ev));
          }
          clear();
        };
        const cancel = () => {
          onRange?.(null);
          clear();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
      }}
    >
      {children}
      {range && (
        <span
          className="ruler-selected-range"
          style={{
            left: range.from * zoom,
            width: (range.to - range.from) * zoom,
          }}
        />
      )}
      {ticks}
    </div>
  );
}
