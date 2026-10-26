import React, { useEffect, useRef, useState } from "react";
import { scrubTime } from "../shared/timeline-gestures.mjs";
import { tc } from "./state";
import "./timeline-playhead.css";

export function TimelinePlayhead({ time, zoom, fps, maxTime, timeline, onSeek, onPause, onTogglePlay }) {
  const gesture = useRef(null);
  const frame = useRef(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    gesture.current?.scroller.classList.remove("timeline-scrubbing");
  }, []);

  const move = (event, finish = false) => {
    const drag = gesture.current;
    if (!drag || event.pointerId !== drag.id) return;
    event.stopPropagation();
    const rect = drag.scroller.getBoundingClientRect();
    drag.at = scrubTime({
      clientX: event.clientX, left: rect.left, scrollLeft: drag.scroller.scrollLeft,
      zoom: drag.zoom, fps, maxTime, offset: drag.offset,
    });
    // Coalesce pointer events to one seek per screen refresh, including a final seek.
    if (finish) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      onSeek(drag.at);
    } else if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (gesture.current) onSeek(gesture.current.at);
      });
    }
  };
  const end = (event) => {
    const drag = gesture.current;
    if (!drag || event.pointerId !== drag.id) return;
    if (event.type === "pointerup") move(event, true);
    cancelAnimationFrame(frame.current);
    frame.current = null;
    drag.scroller.classList.remove("timeline-scrubbing");
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div className={`playhead${dragging ? " is-scrubbing" : ""}`} style={{ left: time * zoom }}>
      <button
        className="playhead-grip"
        role="slider"
        aria-label="Playhead"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={maxTime}
        aria-valuenow={time}
        aria-valuetext={tc(time)}
        title="Drag to scrub · arrows: one frame · Space: play/pause"
        onPointerDown={(event) => {
          if (event.button !== 0 || !timeline.current) return;
          event.preventDefault();
          event.stopPropagation();
          const scroller = timeline.current;
          gesture.current = {
            id: event.pointerId, scroller, zoom, at: time,
            offset: event.clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft - time * zoom,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
          scroller.classList.add("timeline-scrubbing");
          onPause();
          setDragging(true);
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
          const step = event.shiftKey ? 1 : 1 / fps;
          const next = event.key === "ArrowLeft" ? time - step
            : event.key === "ArrowRight" ? time + step
              : event.key === "Home" ? 0 : event.key === "End" ? maxTime : null;
          if (next === null && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === " " && !event.repeat) onTogglePlay?.();
          if (next !== null) {
            onPause();
            onSeek(Math.max(0, Math.min(maxTime, next)));
          }
        }}
      ><i aria-hidden="true" /></button>
    </div>
  );
}
