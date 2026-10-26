import React, { useState, useRef, useEffect } from "react";
import {
  Image,
  ArrowLeftToLine,
  ArrowRightToLine,
  X,
  Plus,
  Clapperboard,
  AudioLines,
  Sparkles,
} from "lucide-react";
import { createPortal } from "react-dom";
import { takeSourceIn } from "../shared/repair.mjs";
import { tc } from "./state";
import "./timeline-insert-menu.css";

export function TimelineFrameAction({
  clip,
  fps = 24,
  time,
  zoom,
  viewport,
  open,
  onToggle,
  onUse,
  onInsert,
  onInsertImage,
  onInsertAudio,
  onConnectImages,
  onAttach,
  onDragStart,
}) {
  const [insertOpen, setInsertOpen] = useState(false);
  const insertRoot = useRef(null);
  useEffect(() => {
    if (!insertOpen) return;
    insertRoot.current?.querySelector(".frame-insert-options button")?.focus({ preventScroll: true });
    const dismiss = event => {
      if (!insertRoot.current?.contains(event.target)) setInsertOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [insertOpen]);
  useEffect(() => setInsertOpen(false), [clip.id, time]);
  const [ghost, setGhost] = useState(null),
    dragged = useRef(false),
    cleanup = useRef(null);
  useEffect(() => () => cleanup.current?.(), []);
  const media = clip.takes.find((t) => t.id === clip.activeTake);
  if (!media) return null;
  const sourceTime = Math.max(
    0,
    Math.min(
      media.duration - 1 / fps,
      takeSourceIn(clip, media) + time - clip.start,
    ),
  );
  const imageUrl = `/api/media/${media.id}/frame?time=${sourceTime.toFixed(6)}`;
  function begin(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX,
      y = e.clientY;
    const frame = {
      clipId: clip.id,
      takeId: media.id,
      time: sourceTime,
      timelineCapture: true,
    };
    dragged.current = false;
    let target = null;
    const move = (ev) => {
      if (!dragged.current && Math.hypot(ev.clientX - x, ev.clientY - y) < 5)
        return;
      if (!dragged.current) {
        dragged.current = true;
        onDragStart?.();
        document.body.classList.add("dragging-timeline-frame");
      }
      setGhost({ x: ev.clientX, y: ev.clientY });
      target?.classList.remove("frame-drop-hover");
      target = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-frame-boundary]");
      target?.classList.add("frame-drop-hover");
    };
    const release = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      document.body.classList.remove("dragging-timeline-frame");
      target?.classList.remove("frame-drop-hover");
      setGhost(null);
      cleanup.current = null;
    };
    const end = () => {
      const key = target?.dataset.frameBoundary;
      release();
      if (key) onAttach(key, frame);
    };
    const cancel = () => release();
    cleanup.current = release;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  }
  return (
    <div
      className="timeline-frame-action"
      style={{
        left: Math.max(
          viewport.left + 18,
          Math.min(time * zoom, viewport.left + viewport.width - 18),
        ),
        "--frame-popover-shift": `${Math.min(0, viewport.left + viewport.width - time * zoom - 240)}px`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="frame-action-trigger"
        aria-label="Use playhead frame"
        title="Drag to Start or End in the prompt · click for a new prompt"
        aria-expanded={open}
        onPointerDown={begin}
        onClick={() => {
          if (!dragged.current) onToggle();
        }}
      >
        <img src={imageUrl} alt="Playhead frame" draggable={false} />
      </button>
      <div className="frame-insert-root" ref={insertRoot} onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setInsertOpen(false);
          insertRoot.current?.querySelector(".frame-insert-trigger")?.focus();
        }
      }}>
        <button type="button" className="frame-insert-trigger"
          aria-label="Insert at playhead" title="Insert at playhead"
          aria-expanded={insertOpen} aria-haspopup="dialog"
          onClick={event => {
            event.stopPropagation();
            if (open) onToggle();
            setInsertOpen(value => !value);
          }}><Plus size={12} /></button>
        {insertOpen && <div className="frame-insert-options" role="dialog" aria-label="Insert at playhead" style={{ left: Math.min(0, viewport.left + viewport.width - Math.max(viewport.left + 18, Math.min(time * zoom, viewport.left + viewport.width - 18)) - (onConnectImages ? 290 : 220)) }}>
          {[
            ["Video", Clapperboard, onInsert, "Create a clip prompt here"],
            ["Image", Image, onInsertImage, "Import an image here"],
            ["Audio", AudioLines, onInsertAudio, "Add audio from your library"],
            ["Connect photos", Sparkles, onConnectImages, "Create a clip between these photographs"],
          ].filter(([, , action]) => action).map(([label, Icon, action, title]) => <button type="button" key={label} title={title} onClick={() => {
            setInsertOpen(false);
            action();
          }}><Icon size={19} strokeWidth={1.5} /><span>{label}</span></button>)}
        </div>}
      </div>
      {ghost &&
        createPortal(
          <img
            className="timeline-frame-ghost"
            src={imageUrl}
            alt=""
            style={{ left: ghost.x + 12, top: ghost.y - 45 }}
          />,
          document.body,
        )}
      {open && (
        <div
          className="frame-action-popover"
          role="dialog"
          aria-label="Use selected frame"
        >
          <header>
            <span>{tc(time)}</span>
            <button aria-label="Close frame actions" onClick={onToggle}>
              <X size={14} />
            </button>
          </header>
          <img
            alt="Selected timeline frame"
            src={`/api/media/${media.id}/frame?time=${sourceTime.toFixed(6)}`}
          />
          <button onClick={() => onUse("start")}>
            <ArrowLeftToLine size={14} /> Start frame in new prompt
          </button>
          <button onClick={() => onUse("end")}>
            <ArrowRightToLine size={14} /> End frame in new prompt
          </button>
        </div>
      )}
    </div>
  );
}

export function TimelineFrameMarkers({ usages, clip, zoom, onOpen }) {
  const [opened, setOpened] = useState(null);
  const groups = new Map();
  for (const usage of usages) {
    if (usage.clipId !== clip.id) continue;
    const key = usage.at.toFixed(5);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(usage);
  }
  return [...groups].map(([key, items]) => (
    <React.Fragment key={key}>
      <button
        className={`frame-usage-dot ${items.every((x) => x.key === "end") ? "end" : ""}`}
        style={{ left: (items[0].at - clip.start) * zoom }}
        title={items.map((x) => `${x.key} · ${x.name}`).join("\n")}
        aria-label={`Frame used in ${items.length} prompt${items.length === 1 ? "" : "s"} at ${tc(items[0].at)}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (items.length === 1) onOpen(items[0].draftId);
          else setOpened(opened === key ? null : key);
        }}
      />
      {opened === key && (
        <div
          className="frame-usage-menu"
          style={{ left: (items[0].at - clip.start) * zoom }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <header>
            <span>Frame references</span>
            <button
              aria-label="Close frame references"
              onClick={() => setOpened(null)}
            >
              <X size={12} />
            </button>
          </header>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setOpened(null);
                onOpen(item.draftId);
              }}
            >
              <span>{item.key === "start" ? "Start" : "End"}</span>
              {item.name}
            </button>
          ))}
        </div>
      )}
    </React.Fragment>
  ));
}
