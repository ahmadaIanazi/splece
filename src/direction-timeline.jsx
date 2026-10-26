import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Link2, SlidersHorizontal, Film } from "lucide-react";
import { createPortal } from "react-dom";
import { DirectionComposer, directionFamily } from "./direction-composer";
import {
  directionClipCoverage,
  directionControls,
  directionRanges,
  normalizeDirectionRange,
} from "../shared/timeline-direction.mjs";
import { isStructureClip } from "../shared/structure.mjs";
import { editedStoryTiming } from "../shared/timeline-navigation.mjs";
import { tc, uid } from "./state";
import "./direction-timeline.css";

const LIMIT = 86400;
const summary = (settings) =>
  directionControls
    .filter((control) => !control.planningOnly)
    .flatMap((control) => {
      const option = control.options.find(
        (item) => item.id === settings?.[control.id],
      );
      return option ? [option.name] : [];
    })
    .join(" · ");

export function DirectionTimeline({
  project,
  composerHost,
  onClose,
  zoom,
  viewport = { left: 0, width: 0 },
  time = 0,
  range,
  selectedGroupId,
  update,
  onSeek,
  focused = false,
  onFocus,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const fps = project.settings?.export?.fps || 24;
  const step = 1 / fps;
  const records = useMemo(() => directionRanges(project), [project]);
  const plan = project.storyPlans?.[project.episodeId];
  const groups = (plan?.beats || []).filter((node) => !isStructureClip(node));
  const selected =
    records.find((record) => record.id === selectedId) ||
    (focused ? records.at(-1) : null);
  const active =
    selected && preview?.id === selected.id
      ? { ...selected, ...preview }
      : selected;
  const coverage = directionClipCoverage(project, active).sort(
    (a, b) => a.start - b.start,
  );
  const clips = useMemo(
    () =>
      (project.clips || [])
        .filter((c) => !c.episodeId || c.episodeId === project.episodeId)
        .sort((a, b) => a.start - b.start)
        .map((c, index) => {
          const take = c.takes?.find((t) => t.id === c.activeTake);
          const node = plan?.beats?.find(
            (n) => n.id === c.storyBeatId || n.id === c.structureNodeId,
          );
          const draft = project.drafts?.find(
            (d) => d.id === c.sourceDraftId || d.targetId === c.id,
          );
          return {
            ...c,
            title:
              node?.title || draft?.title || c.title || `Clip #${index + 1}`,
            thumbnail: take?.thumbnail,
          };
        }),
    [project.clips, project.drafts, project.episodeId, plan],
  );
  const viewWidth = Math.max(180, (viewport.width || 560) - 24);
  const anchored = { marginLeft: (viewport.left || 0) + 12, width: viewWidth };
  const hasRange =
    Number.isFinite(range?.from) &&
    Number.isFinite(range?.to) &&
    range.to > range.from;
  const lanes = [];
  const bands = records
    .map((record) =>
      preview?.id === record.id ? { ...record, ...preview } : record,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((record) => {
      let lane = lanes.findIndex((end) => end <= record.start);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = record.end;
      return { ...record, lane };
    });

  useEffect(
    () => () => gesture.current?.(),
    [project.id, project.episodeId, focused],
  );

  const patch = (id, changes) =>
    update((next) => {
      const index = (next.directionRanges || []).findIndex(
        (record) => record.id === id,
      );
      if (index < 0) return;
      next.directionRanges[index] = normalizeDirectionRange({
        ...next.directionRanges[index],
        ...changes,
      });
    });
  const open = (record, seek = true) => {
    setSelectedId(record.id);
    onFocus?.();
    if (seek) onSeek?.(record.start);
  };
  const add = (groupId = "", settings = {}) => {
    let start = Math.min(
      LIMIT - step,
      Math.max(0, hasRange ? range.from : time),
    );
    let end = Math.min(
      LIMIT,
      Math.max(start + step, hasRange ? range.to : start + 5),
    );
    const group = groups.find((node) => node.id === groupId);
    if (group) {
      const timing = editedStoryTiming(project).get(group.id);
      start = timing?.start ?? group.start ?? start;
      end = Math.max(
        start + step,
        timing?.end ?? group.end ?? start + (group.duration || 5),
      );
    }
    const record = normalizeDirectionRange({
      id: uid(),
      episodeId: project.episodeId,
      title: group
        ? `${group.title} direction`
        : summary(settings) || "New direction",
      start,
      end,
      ...(group ? { groupId: group.id } : {}),
      enabled: true,
      settings,
    });
    update((next) => {
      (next.directionRanges ??= []).push(record);
    });
    setSelectedId(record.id);
    onFocus?.();
  };
  const bind = (record, groupId) => {
    // Keep the effective edit times when detaching, not the original stored times.
    patch(record.id, {
      groupId: groupId || undefined,
      start: record.start,
      end: record.end,
    });
  };
  const adjusted = (record, delta, edge) => {
    const round = (value) => Math.round(value * fps) / fps;
    if (edge === "start")
      return {
        start: Math.max(
          0,
          Math.min(record.end - step, round(record.start + delta)),
        ),
        end: record.end,
      };
    if (edge === "end")
      return {
        start: record.start,
        end: Math.min(
          LIMIT,
          Math.max(record.start + step, round(record.end + delta)),
        ),
      };
    const start = Math.max(
      0,
      Math.min(
        LIMIT - (record.end - record.start),
        round(record.start + delta),
      ),
    );
    return { start, end: start + record.end - record.start };
  };
  const drag = (event, record, edge) => {
    event.stopPropagation();
    suppressClick.current = false;
    if (event.button !== 0 || record.groupId || !record.resolved) return;
    event.preventDefault();
    gesture.current?.();
    setSelectedId(record.id);
    const origin = event.clientX;
    const pointerId = event.pointerId;
    let moved = false;
    let next = { start: record.start, end: record.end };
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (!moved && Math.abs(ev.clientX - origin) < 3) return;
      moved = true;
      next = adjusted(
        record,
        (ev.clientX - origin) / Math.max(zoom, 0.01),
        edge,
      );
      setPreview({ id: record.id, ...next });
    };
    const clear = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      gesture.current = null;
      setPreview(null);
    };
    const cancel = () => {
      suppressClick.current = moved;
      clear();
    };
    const key = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        cancel();
      }
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      move(ev);
      clear();
      suppressClick.current = moved;
      if (moved && (next.start !== record.start || next.end !== record.end)) {
        patch(record.id, next);
        open({ ...record, ...next }, false);
      }
    };
    gesture.current = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  };
  const nudge = (event, record, edge) => {
    if (
      record.groupId ||
      !record.resolved ||
      !["ArrowLeft", "ArrowRight"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    patch(
      record.id,
      adjusted(
        record,
        (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : step),
        edge,
      ),
    );
  };

  return (
    <section
      className={`direction-timeline${focused ? " focused" : ""}`}
      aria-label="Timed creative direction"
      style={{ "--direction-accent": directionFamily(active || {}).color }}
    >
      {focused && (
        <div
          className="direction-clip-strip"
          aria-label="Clips affected by direction"
        >
          {clips
            .filter(
              (c) =>
                (c.start + c.duration) * zoom >= viewport.left - 100 &&
                c.start * zoom <= viewport.left + viewport.width + 100,
            )
            .map((clip) => {
              const overlap = coverage.find((c) => c.id === clip.id);
              return (
                <button
                  key={clip.id}
                  className={`direction-context-clip${overlap ? " affected" : ""}`}
                  style={{
                    left: clip.start * zoom,
                    width: Math.max(2, clip.duration * zoom),
                  }}
                  aria-label={`${clip.title}${overlap ? `, direction overlaps ${tc(overlap.start)} to ${tc(overlap.end)}` : ", outside selected direction"}`}
                  title={`${clip.title} · ${tc(clip.start)}–${tc(clip.start + clip.duration)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onSeek?.(clip.start)}
                >
                  {clip.thumbnail ? (
                    <img src={clip.thumbnail} alt="" draggable={false} />
                  ) : (
                    <Film size={16} />
                  )}
                  <span>{clip.title}</span>
                  {overlap && (
                    <i
                      className="direction-coverage"
                      style={{
                        left:
                          ((overlap.start - clip.start) / clip.duration) * 100 +
                          "%",
                        width:
                          ((overlap.end - overlap.start) / clip.duration) *
                            100 +
                          "%",
                      }}
                    />
                  )}
                </button>
              );
            })}
        </div>
      )}
      <div
        className="direction-tools"
        style={anchored}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="direction-heading">
          <SlidersHorizontal size={12} aria-hidden="true" /> Direction{" "}
          <small>{records.length || ""}</small>
        </span>
        <div className="direction-tool-actions">
          {focused && groups.some((group) => group.id === selectedGroupId) && (
            <button
              type="button"
              onClick={() => add(selectedGroupId)}
              title="Add direction that follows the selected group"
            >
              <Link2 size={12} /> Selected group
            </button>
          )}
          <button
            type="button"
            onClick={() => add()}
            title={
              hasRange
                ? "Add direction across selected time range"
                : "Add five seconds of direction at playhead"
            }
          >
            <Plus size={13} /> {hasRange ? "Add to range" : "Add direction"}
          </button>
        </div>
      </div>
      <div
        className="direction-band-lanes"
        style={{ height: Math.max(1, lanes.length) * 31 + 6 }}
      >
        {!records.length && (
          <p className="direction-empty" style={{ ...anchored, maxWidth: 560 }}>
            {focused
              ? "Set lighting, look and camera defaults for a moment or a group."
              : "Timed visual defaults"}
          </p>
        )}
        {bands
          .filter(
            (record) =>
              record.end * zoom >= viewport.left - 100 &&
              record.start * zoom <= viewport.left + viewport.width + 100,
          )
          .map((record) => (
            <div
              key={record.id}
              data-direction-id={record.id}
              className={`direction-band${selected?.id === record.id ? " selected" : ""}${record.enabled === false ? " disabled" : ""}${!record.resolved ? " unresolved" : ""}${preview?.id === record.id ? " dragging" : ""}${record.groupId ? " bound" : ""}`}
              style={{
                "--band-color": directionFamily(record).color,
                left: record.start * zoom,
                width: Math.max(6, (record.end - record.start) * zoom),
                top: record.lane * 31 + 3,
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {!record.groupId && record.resolved && (
                <button
                  type="button"
                  className="direction-band-handle start"
                  aria-label={`Resize start of ${record.title}`}
                  title="Drag to resize · arrow keys adjust one frame"
                  onPointerDown={(event) => drag(event, record, "start")}
                  onKeyDown={(event) => nudge(event, record, "start")}
                />
              )}
              <button
                type="button"
                className="direction-band-body"
                aria-pressed={selected?.id === record.id}
                title={`${record.title} · ${tc(record.start)}–${tc(record.end)}${record.groupId ? " · follows group" : " · drag to move"}${record.enabled === false ? " · disabled" : ""}\n${summary(record.settings) || "Choose visual defaults"}`}
                onPointerDown={(event) => drag(event, record)}
                onKeyDown={(event) => nudge(event, record)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  open(record);
                }}
              >
                {record.groupId ? (
                  <Link2 size={11} aria-hidden="true" />
                ) : (
                  React.createElement(directionFamily(record).icon, {
                    size: 12,
                    "aria-hidden": true,
                  })
                )}
                <span>{record.title || "Direction"}</span>
                <small>{summary(record.settings)}</small>
              </button>
              {!record.groupId && record.resolved && (
                <button
                  type="button"
                  className="direction-band-handle end"
                  aria-label={`Resize end of ${record.title}`}
                  title="Drag to resize · arrow keys adjust one frame"
                  onPointerDown={(event) => drag(event, record, "end")}
                  onKeyDown={(event) => nudge(event, record, "end")}
                />
              )}
            </div>
          ))}
      </div>
      {focused &&
        composerHost &&
        createPortal(
          <DirectionComposer
            selected={active}
            groups={groups}
            coverage={coverage}
            patch={patch}
            add={add}
            bind={bind}
            adjusted={adjusted}
            step={step}
            hasRange={hasRange}
            onClose={onClose}
            remove={(id) => {
              update((next) => {
                next.directionRanges = (next.directionRanges || []).filter(
                  (r) => r.id !== id,
                );
              });
              setSelectedId(null);
            }}
          />,
          composerHost,
        )}
    </section>
  );
}
