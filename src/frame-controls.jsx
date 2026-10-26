import React, { useId, useLayoutEffect, useRef, useState } from "react";
import {
  Camera,
  ImagePlus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  ChevronDown,
} from "lucide-react";
import {
  timelineFrameSources,
  captureTimelineFrame,
} from "../shared/timeline-frames.mjs";
import { tc } from "./state";
import "./frame-controls.css";

export function boundaryPreview(frame) {
  if (!frame) return null;
  if (frame.mediaId || frame.kind === "image")
    return `/api/media/${encodeURIComponent(frame.mediaId || frame.takeId)}/original`;
  return frame.takeId
    ? `/api/media/${encodeURIComponent(frame.takeId)}/frame?time=${Number(frame.time) || 0}`
    : null;
}

function BoundaryCard({
  boundary,
  prepared,
  draft,
  project,
  change,
  time,
  renderGenerate,
  onUpload,
  uploadBusy = false,
}) {
  const [tab, setTab] = useState("capture");
  const picker = useRef(null);
  const resetScroll = () => {
    const body = picker.current?.closest(".companion-body");
    if (body) body.scrollTop = 0;
  };
  useLayoutEffect(resetScroll, [tab]);
  const id = useId();
  const sources = timelineFrameSources(project);
  const key = boundary;
  const continuity =
    key === "start"
      ? prepared.continuityReference
      : prepared.continuityEndReference;
  const frame = prepared.boundaries?.[key] || continuity;
  const preview = boundaryPreview(frame);
  const source =
    sources.find((s) => s.clip.id === frame?.clipId) ||
    sources.find((s) => s.take.id === frame?.takeId);
  const adjacentClip = key === "start" ? prepared.before : prepared.after;
  const adjacent = sources.find((s) => s.clip.id === adjacentClip?.id);
  const playhead = sources.find(
    (s) => time >= s.clip.start && time < s.clip.start + s.clip.duration,
  );
  const set = (override) =>
    change((d) => {
      d.frameOverrides ??= {};
      d.frameOverrides[key] = override;
      d.automation ??= {};
      d.automation.frames = true;
      d.automation[key + "Frame"] = true;
    });
  const capture = (s, at) =>
    set({ mode: "manual", frame: captureTimelineFrame(s, at) });
  const useImage = (media) => {
    set({
      mode: "manual",
      frame: {
        mediaId: media.id,
        takeId: media.id,
        kind: "image",
        time: 0,
        timelineCapture: true,
      },
    });
    setTab("capture");
    resetScroll();
    document
      .getElementById(`${id}-capture-tab`)
      ?.focus({ preventScroll: true });
  };
  const adjacentLabel =
    key === "start" ? "Previous clip · last frame" : "Next clip · first frame";
  const waiting = draft.frameOverrides?.[key]?.mode === "waiting";
  return (
    <section
      ref={picker}
      className="boundary-picker"
      aria-label={`${key === "start" ? "Start" : "End"} frame controls`}
    >
      {renderGenerate && (
        <div
          className="boundary-tabs"
          role="tablist"
          aria-label="Frame source"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "capture"
                : event.key === "End"
                  ? "generate"
                  : tab === "capture"
                    ? "generate"
                    : "capture";
            setTab(next);
            document
              .getElementById(`${id}-${next}-tab`)
              ?.focus({ preventScroll: true });
          }}
        >
          <button
            type="button"
            role="tab"
            id={`${id}-capture-tab`}
            aria-controls={`${id}-capture`}
            tabIndex={tab === "capture" ? 0 : -1}
            aria-selected={tab === "capture"}
            onClick={() => setTab("capture")}
          >
            <Camera size={14} />
            Capture
          </button>
          <button
            type="button"
            role="tab"
            id={`${id}-generate-tab`}
            aria-controls={`${id}-generate`}
            tabIndex={tab === "generate" ? 0 : -1}
            aria-selected={tab === "generate"}
            onClick={() => setTab("generate")}
          >
            <Sparkles size={14} />
            Generate
          </button>
        </div>
      )}
      {tab === "capture" ? (
        <div
          id={`${id}-capture`}
          role={renderGenerate ? "tabpanel" : undefined}
          aria-labelledby={renderGenerate ? `${id}-capture-tab` : undefined}
        >
          <div
            className={`boundary-stage ${preview ? "has-frame" : "is-empty"}`}
          >
            {preview ? (
              <img
                src={preview}
                alt={`${key === "start" ? "Start" : "End"} frame`}
              />
            ) : (
              <ImagePlus
                className="boundary-empty-icon"
                size={35}
                strokeWidth={1.2}
              />
            )}
            <button
              type="button"
              className="boundary-corner boundary-reset"
              title="Reset to automatic frame"
              aria-label={`Reset ${key} frame to automatic`}
              onClick={() => set({ mode: "auto" })}
            >
              <RotateCcw size={15} />
            </button>
            {(preview || waiting) && (
              <button
                type="button"
                className="boundary-corner boundary-remove"
                title="Remove frame"
                aria-label={`Remove ${key} frame`}
                onClick={() => set({ mode: "none" })}
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              type="button"
              className="boundary-adjacent"
              disabled={!adjacentClip}
              title={
                !adjacentClip
                  ? `No ${key === "start" ? "previous" : "next"} clip yet`
                  : adjacent
                    ? adjacentLabel
                    : "Use this boundary when the clip is ready"
              }
              onClick={() =>
                adjacent
                  ? capture(
                      adjacent,
                      key === "start" ? adjacent.max : adjacent.min,
                    )
                  : set({ mode: "waiting", clipId: adjacentClip.id })
              }
            >
              <Camera size={16} />
              <span>
                {waiting && !adjacent ? "Waiting for footage" : adjacentLabel}
              </span>
            </button>
          </div>
          <div className="boundary-tools">
            <button
              type="button"
              disabled={!playhead}
              title="Use the frame at the playhead"
              onClick={() =>
                capture(playhead, playhead.min + time - playhead.clip.start)
              }
            >
              <Camera size={14} />
              Playhead
            </button>
            {onUpload && (
              <button
                type="button"
                disabled={uploadBusy}
                onClick={() => onUpload(key, useImage)}
              >
                <Upload size={14} />
                {uploadBusy ? "Saving…" : "Upload"}
              </button>
            )}
            {preview && (
              <span
                className="boundary-source"
                title={source?.take.name || "Image frame"}
              >
                {frame?.kind === "image" || frame?.mediaId
                  ? "Image frame"
                  : tc(frame?.time || 0)}
              </span>
            )}
          </div>
          {!!sources.length && (
            <details className="boundary-timeline-picker">
              <summary>
                <ChevronDown size={14} />
                Choose from timeline
              </summary>
              <div className="boundary-source-grid">
                {sources.map((s) => (
                  <button
                    type="button"
                    key={s.clip.id}
                    title={`${s.take.name || "Timeline clip"} · ${tc(s.clip.start)}`}
                    aria-label={`Use ${s.take.name || "timeline clip"} at ${tc(s.clip.start)}`}
                    aria-pressed={source?.clip.id === s.clip.id}
                    onClick={() => capture(s, key === "start" ? s.max : s.min)}
                  >
                    <img
                      alt=""
                      loading="lazy"
                      src={
                        s.take.kind === "image"
                          ? `/api/media/${s.take.id}/original`
                          : s.take.thumbnail ||
                            `/api/media/${s.take.id}/thumbnail`
                      }
                    />
                    <span>{tc(s.clip.start)}</span>
                  </button>
                ))}
              </div>
              {source && frame && source.take.kind !== "image" && (
                <label className="boundary-scrubber">
                  <span>
                    Frame <output>{tc(frame.time)}</output>
                  </span>
                  <input
                    type="range"
                    min={source.min}
                    max={source.max}
                    step={1 / (project.settings?.export?.fps || 24)}
                    aria-label={`${key} frame scrubber`}
                    value={frame.time}
                    onChange={(e) => capture(source, e.target.value)}
                  />
                </label>
              )}
            </details>
          )}
          {continuity && preview && (
            <span
              className="boundary-guidance"
              title="This model receives the frame as a visual reference, rather than an exact first or last frame constraint."
            >
              Visual guidance
            </span>
          )}
        </div>
      ) : (
        <div
          id={`${id}-generate`}
          role="tabpanel"
          aria-labelledby={`${id}-generate-tab`}
        >
          {renderGenerate?.(key, { frame, onUse: useImage })}
        </div>
      )}
    </section>
  );
}

export function FrameControls({ only, time = 0, ...props }) {
  return (
    <div className={`boundary-controls ${only ? "single" : "pair"}`}>
      {(only ? [only] : ["start", "end"]).map((key) => (
        <BoundaryCard key={key} boundary={key} time={time} {...props} />
      ))}
    </div>
  );
}
