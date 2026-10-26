import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Folder,
  Layers,
  BookOpen,
  Film,
  Plus,
  Minus,
} from "lucide-react";
import { descendants, storyDepth } from "../shared/story-tree.mjs";
import {
  isStructureClip,
  structureColor,
  structureLabel,
} from "../shared/structure.mjs";
import {
  structureStoryboard,
  moveStructureTime,
} from "../shared/structure-context.mjs";
import { structureDragType, referenceDragType } from "./structure-document";
import { editablePlannedSlot } from "../shared/planned-timeline.mjs";
import {
  plannedStructureSlot,
  resizeStructureClip,
  structureDurationTicks,
  structureGroupRuns,
} from "../shared/structure-timeline.mjs";
import { editorPlanningSignature } from "../shared/structure-context.mjs";
import { tc } from "./state";
const nodeIcon = (n) =>
  isStructureClip(n)
    ? Clapperboard
    : { act: Layers, chapter: BookOpen, scene: Film }[n.kind] || Folder;
export function StructureTimeline({
  project,
  plan,
  selected,
  onSelect,
  onMove,
  onAttach,
  update,
  onAdd,
  models = [],
}) {
  const [size, setSize] = useState(192),
    [folds, setFolds] = useState({}),
    [drop, setDrop] = useState(null),
    [destination, setDestination] = useState(null),
    [error, setError] = useState(""),
    [resizePreview, setResizePreview] = useState(null);
  const scroll = useRef(null),
    gesture = useRef(null),
    content = useRef(null),
    itemGesture = useRef(null),
    suppressClick = useRef(false),
    resizeGesture = useRef(null),
    latestProject = useRef(project);
  latestProject.current = project;
  useEffect(() => {
    const element = scroll.current;
    const zoom = (e) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        setSize((z) =>
          Math.max(124, Math.min(300, z + (e.deltaY < 0 ? 12 : -12))),
        );
      }
    };
    element.addEventListener("wheel", zoom, { passive: false });
    return () => element.removeEventListener("wheel", zoom);
  }, []);

  const displayed = useMemo(() => {
    if (!resizePreview) return project;
    const next = structuredClone(project);
    resizeStructureClip(next, resizePreview.id, resizePreview.duration, models);
    return next;
  }, [project, resizePreview, models]);
  const { cells, groups, ranges } = useMemo(
    () => structureStoryboard(displayed, folds),
    [displayed, folds],
  );
  const depth = Math.max(
      0,
      ...groups.map((g) => storyDepth(plan.beats, g.node)),
    ),
    bottom = 16 + (depth + 1) * 30;
  const runs = structureGroupRuns(plan, cells, groups);
  const inset = (depth + 1) * 5 + 5;
  const rulerTop = bottom + 94 + depth * 5;
  const width = Math.max(600, cells.length * size + 90),
    end = Math.max(0, ...[...ranges.values()].map((r) => r.end));
  const dropAt = (e) =>
    Math.max(
      0,
      Math.min(
        cells.length,
        Math.round(
          (e.clientX - e.currentTarget.getBoundingClientRect().left) / size,
        ),
      ),
    );
  const resizeHandlers = (n, edge) => ({
    onPointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const duration = ranges.get(n.id).end - ranges.get(n.id).start;
      resizeGesture.current = {
        id: n.id,
        x: e.clientX,
        duration,
        next: duration,
        signature: editorPlanningSignature(project),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e) {
      const g = resizeGesture.current;
      if (!g) return;
      const duration = Math.max(
        1,
        Math.min(
          3600,
          Math.round(
            g.duration +
              ((e.clientX - g.x) * (edge === "start" ? -1 : 1) * g.duration) /
                size,
          ),
        ),
      );
      g.next = duration;
      setResizePreview({ id: g.id, duration });
    },
    onPointerUp(e) {
      e.stopPropagation();
      const g = resizeGesture.current;
      resizeGesture.current = null;
      setResizePreview(null);
      if (!g || g.next === g.duration) return;
      if (g.signature !== editorPlanningSignature(latestProject.current)) {
        setError(
          "The edit changed while resizing. Try again with the updated timing.",
        );
        return;
      }
      try {
        update((p) => {
          if (!resizeStructureClip(p, g.id, g.next, models))
            throw Error(
              "This clip is no longer a planned placeholder. Trim its footage in the Editor.",
            );
        });
      } catch (err) {
        setError(err.message);
      }
    },
    onPointerCancel() {
      resizeGesture.current = null;
      setResizePreview(null);
    },
    onClick(e) {
      e.stopPropagation();
    },
    onKeyDown(e) {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const duration = ranges.get(n.id).end - ranges.get(n.id).start;
      const next = Math.max(
        1,
        Math.min(
          3600,
          duration + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 5 : 1),
        ),
      );
      update((p) => resizeStructureClip(p, n.id, next, models));
    },
  });
  const dropped = (e, n) => {
    e.preventDefault();
    e.stopPropagation();
    setDrop(null);
    const asset = e.dataTransfer.getData(referenceDragType),
      id = e.dataTransfer.getData(structureDragType);
    if (asset) onAttach(n.id, asset).catch((e) => setError(e.message));
    else if (id) onMove(id, n.id, isStructureClip(n) ? "before" : "inside");
  };
  const destinationAt = (id, x, y) => {
    const viewport = scroll.current.getBoundingClientRect();
    if (
      x < viewport.left ||
      x > viewport.right ||
      y < viewport.top ||
      y > viewport.bottom
    )
      return null;
    const hit = document.elementFromPoint(x, y);
    const group = hit?.closest("[data-structure-group]")?.dataset
      .structureGroup;
    const clipButton = hit?.closest("[data-structure-node]");
    let targetId = group,
      position = "inside",
      index = null;
    if (!targetId && clipButton) {
      targetId = clipButton.dataset.structureNode;
      const node = plan.beats.find((n) => n.id === targetId),
        box = clipButton.getBoundingClientRect();
      position = isStructureClip(node)
        ? x < box.left + box.width / 2
          ? "before"
          : "after"
        : "inside";
    }
    if (!targetId) {
      // Parent cards are visual containers; hit-test deepest visible container
      // so gaps inside a scene remain valid, explicit drop destinations.
      const boxes = [
        ...content.current.querySelectorAll("[data-group-box]"),
      ].filter((el) => {
        const b = el.getBoundingClientRect();
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
      });
      targetId = boxes.at(-1)?.dataset.groupBox;
    }
    if (!targetId) {
      index = Math.max(
        0,
        Math.min(
          cells.length,
          Math.round((x - viewport.left + scroll.current.scrollLeft) / size),
        ),
      );
      targetId = cells[index]?.id || cells.at(-1)?.id;
      position = index < cells.length ? "before" : "after";
    }
    if (!targetId) return null;
    const target = plan.beats.find((n) => n.id === targetId),
      parentId = position === "inside" ? targetId : target.parentId || "";
    const parent = plan.beats.find((n) => n.id === parentId);
    const targetCells =
      position === "inside"
        ? descendants(plan.beats, targetId)
        : new Set([targetId]);
    const indices = cells.flatMap((n, i) => (targetCells.has(n.id) ? [i] : []));
    index =
      position === "before" ? Math.min(...indices) : Math.max(...indices) + 1;
    if (!Number.isFinite(index)) index = 0;
    const branch = itemGesture.current?.branch || descendants(plan.beats, id);
    const invalid = branch.has(targetId)
      ? "Choose a different group or clip. A group cannot contain itself."
      : position === "inside" && isStructureClip(target)
        ? "Choose a group to place the clip inside."
        : "";
    return {
      id,
      targetId,
      position,
      parentId,
      index,
      invalid,
      label:
        invalid ||
        `${parent?.title || "Top level"} · ${position === "inside" ? "Add to group" : `${position} ${target.title}`}`,
    };
  };
  const pointerDrag = (id) => ({
    draggable: false,
    onPointerDown(e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      setError("");
      itemGesture.current = {
        id,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        branch: descendants(plan.beats, id),
        signature: JSON.stringify({
          editor: editorPlanningSignature(project),
          beats: plan.beats,
        }),
      };
      suppressClick.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e) {
      const g = itemGesture.current;
      if (!g) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6 && !g.moved) return;
      g.moved = true;
      const box = scroll.current.getBoundingClientRect();
      if (e.clientX > box.right - 30) scroll.current.scrollLeft += 12;
      if (e.clientX < box.left + 30) scroll.current.scrollLeft -= 12;
      const next = destinationAt(id, e.clientX, e.clientY);
      setDestination(next);
      setDrop(next && !next.invalid ? next.index : null);
    },
    onPointerUp(e) {
      const g = itemGesture.current;
      itemGesture.current = null;
      const next = g?.moved ? destinationAt(id, e.clientX, e.clientY) : null;
      setDestination(null);
      setDrop(null);
      if (!g?.moved) return;
      suppressClick.current = true;
      if (!next || next.invalid) return;
      const live = latestProject.current;
      if (
        g.signature !==
        JSON.stringify({
          editor: editorPlanningSignature(live),
          beats: live.storyPlans[live.episodeId].beats,
        })
      ) {
        setError(
          "The structure changed while dragging. Try again with the updated layout.",
        );
        return;
      }
      onMove(id, next.targetId, next.position);
    },
    onPointerCancel() {
      itemGesture.current = null;
      setDrop(null);
      setDestination(null);
    },
    onKeyDown(e) {
      if (e.key === "Escape") {
        itemGesture.current = null;
        suppressClick.current = true;
        setDrop(null);
        setDestination(null);
        e.stopPropagation();
      }
    },
    onClick() {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onSelect(id);
    },
  });
  return (
    <section className="structure-time-map" aria-label="Structure timeline">
      <header>
        <span>STORY TIMELINE</span>
        <small>
          Drag to arrange · drag clip edges to change planned duration
        </small>
      </header>
      {error && <p role="alert">{error}</p>}
      <div
        className="structure-time-scroll"
        ref={scroll}
        onPointerDown={(e) => {
          if (e.target.closest("button,input,[role=slider]")) return;
          gesture.current = { x: e.clientX, left: scroll.current.scrollLeft };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (gesture.current)
            scroll.current.scrollLeft =
              gesture.current.left - (e.clientX - gesture.current.x);
        }}
        onPointerUp={() => (gesture.current = null)}
        onPointerCancel={() => (gesture.current = null)}
      >
        <div
          className="structure-time-content"
          ref={content}
          style={{ width, height: rulerTop }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(structureDragType)) {
              e.preventDefault();
              setDrop(dropAt(e));
            }
          }}
          onDragLeave={() => setDrop(null)}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData(structureDragType);
            if (id) {
              try {
                const at = ranges.get(cells[dropAt(e)]?.id)?.start ?? end;
                update((p) => moveStructureTime(p, id, at));
              } catch (err) {
                setError(err.message);
              }
            }
            setDrop(null);
          }}
        >
          {runs.map(({ node: n, first, last }) => {
            const Icon = nodeIcon(n),
              level = storyDepth(plan.beats, n);
            return (
              <div
                key={`${n.id}:${first}`}
                data-group-box={n.id}
                className={`structure-time-item group ${selected === n.id ? "selected" : ""} ${destination?.parentId === n.id ? (destination.invalid ? "drop-invalid" : "drop-group") : ""}`}
                style={{
                  left: first * size + level * 5,
                  top: 8 + level * 30,
                  width: (last - first + 1) * size - 4 - level * 10,
                  height: bottom + 86 + (depth - level) * 5 - (8 + level * 30),
                  "--kind": structureColor(plan, n),
                }}
              >
                <button
                  {...pointerDrag(n.id)}
                  data-structure-group={n.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => dropped(e, n)}
                  aria-label={`Open ${structureLabel(plan, n)} ${n.title}`}
                >
                  <Icon size={14} />
                  <b>{n.title}</b>
                  <small>
                    {(ranges.get(n.id).end - ranges.get(n.id).start).toFixed(0)}
                    s
                  </small>
                </button>
                <button
                  className="structure-time-fold"
                  aria-label={`${folds[n.id] ? "Expand" : "Collapse"} timeline ${n.title}`}
                  aria-expanded={!folds[n.id]}
                  onClick={() => setFolds((f) => ({ ...f, [n.id]: !f[n.id] }))}
                >
                  {folds[n.id] ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
              </div>
            );
          })}
          {cells.map((n, i) => {
            const r = ranges.get(n.id),
              clip = isStructureClip(n),
              Icon = nodeIcon(n),
              slot = plannedStructureSlot(project, n.id),
              canResize = clip && (!slot || editablePlannedSlot(slot));
            return (
              <div
                key={n.id}
                className={`structure-time-item clip ${selected === n.id ? "selected" : ""} ${destination?.id === n.id ? "being-dragged" : ""} ${destination?.targetId === n.id && destination.position === "inside" && !destination.invalid ? "drop-group" : ""}`}
                style={{
                  left: i * size + inset,
                  top: bottom,
                  width: size - inset * 2,
                  "--kind": structureColor(plan, n),
                }}
              >
                <button
                  {...pointerDrag(n.id)}
                  data-structure-node={n.id}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(referenceDragType)) {
                      e.preventDefault();
                      e.stopPropagation();
                    } else {
                      e.preventDefault();
                      setDrop(i);
                    }
                  }}
                  onDrop={(e) => {
                    if (e.dataTransfer.types.includes(referenceDragType))
                      dropped(e, n);
                  }}
                  title={`${n.title} · ${tc(r.start)}–${tc(r.end)}`}
                  aria-label={`Open planned ${clip ? "clip" : "group"} ${n.title}`}
                >
                  <Icon size={16} />
                  <b>{n.title}</b>
                  <small>
                    {(r.end - r.start).toFixed(1)}s ·{" "}
                    {r.placed
                      ? "in edit"
                      : clip
                        ? "planned"
                        : folds[n.id]
                          ? "collapsed"
                          : "add clips"}
                  </small>
                </button>
                {canResize &&
                  ["start", "end"].map((edge) => (
                    <button
                      key={edge}
                      className={`structure-duration-handle ${edge}`}
                      role="slider"
                      aria-label={`Resize ${n.title} ${edge}`}
                      aria-valuemin={1}
                      aria-valuemax={3600}
                      aria-valuenow={r.end - r.start}
                      aria-valuetext={`${r.end - r.start} seconds planned`}
                      title="Drag to change planned duration · arrow keys adjust 1s, Shift 5s"
                      {...resizeHandlers(n, edge)}
                    />
                  ))}
              </div>
            );
          })}
          {destination && (
            <div
              className={`structure-drop-caption ${destination.invalid ? "invalid" : ""}`}
              role="status"
              aria-live="polite"
              style={{
                left: Math.max(
                  4,
                  Math.min((destination.index - 1) * size, width - 300),
                ),
                top: bottom - 28,
              }}
            >
              {destination.label}
            </div>
          )}
          {drop !== null && (
            <span className="structure-time-drop" style={{ left: drop * size }}>
              {!destination && tc(ranges.get(cells[drop]?.id)?.start ?? end)}
            </span>
          )}
          <button
            className="structure-time-add"
            style={{ left: cells.length * size + 12, top: bottom }}
            aria-label="Add planned clip"
            onClick={() => onAdd("clip")}
          >
            <Plus size={21} />
          </button>
        </div>
        <div
          className="structure-time-ruler"
          style={{ width }}
          aria-label="Clip duration ruler"
        >
          {cells.map((n, i) => {
            const r = ranges.get(n.id),
              duration = r.end - r.start;
            return (
              <div
                key={n.id}
                className="structure-ruler-segment"
                style={{ left: i * size, width: size }}
              >
                <span className="structure-ruler-time">{tc(r.start)}</span>
                {structureDurationTicks(duration, size).map((t) => (
                  <i
                    key={t.time}
                    className={t.major ? "major" : "minor"}
                    style={{ left: `${t.fraction * 100}%` }}
                    title={`${t.time}s into ${n.title}`}
                  >
                    {t.major && (size / duration) * 5 >= 23 && (
                      <small>{t.time}</small>
                    )}
                  </i>
                ))}
              </div>
            );
          })}
          {!!cells.length && (
            <span
              className="structure-ruler-end"
              style={{ left: cells.length * size }}
            >
              {tc(ranges.get(cells.at(-1).id).end)}
            </span>
          )}
        </div>
      </div>
      <footer className="structure-time-footer">
        <small>Clip time · equal-sized cards</small>
        <div>
          <button
            className="icon"
            aria-label="Zoom out Structure timeline"
            onClick={() => setSize((z) => Math.max(124, z - 20))}
          >
            <Minus size={14} />
          </button>
          <input
            aria-label="Structure timeline zoom"
            type="range"
            min="124"
            max="300"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <button
            className="icon"
            aria-label="Zoom in Structure timeline"
            onClick={() => setSize((z) => Math.min(300, z + 20))}
          >
            <Plus size={14} />
          </button>
        </div>
      </footer>
    </section>
  );
}
