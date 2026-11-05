import React, { useRef, useState } from "react";
import { Plus, ChevronDown, X } from "lucide-react";
import { morphPresets, morphVibes } from "../shared/morph-effects.mjs";
import { FrameControls, boundaryPreview } from "./frame-controls";
import { EffectFootage } from "./reel-effects";
import { GenerationDuration } from "./generation-duration";

export function MotionPreview({ frames = {}, media, preset }) {
  return (
    <EffectFootage
      recipe={preset?.id || "smooth"}
      media={media}
      start={boundaryPreview(frames.start)}
      end={boundaryPreview(frames.end)}
    />
  );
}
export function MorphControls({
  project,
  context,
  value,
  onChange,
  frames,
  frameOverrides,
  onFrameChange,
  onUpload,
  uploadBusy,
}) {
  const [editing, setEditing] = useState(null),
    upload = useRef(null),
    uploadRole = useRef(null);
  const change = (patch) => onChange({ ...value, ...patch });
  const clip = context.clip,
    complete = !!clip?.activeTake;
  const prepared = {
    boundaries: frames,
    before: context.before,
    after: context.after,
  };
  const draft = { frameOverrides };
  const editFrames = (fn) => {
    const next = structuredClone(draft);
    fn(next);
    onFrameChange(next.frameOverrides);
  };
  const chooseUpload = (role) => {
    uploadRole.current = role;
    upload.current?.click();
  };
  const drop = (event, role) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      onUpload(role, file);
      return;
    }
    const id = event.dataTransfer.getData("asset"),
      asset = project.assets.find((a) => a.id === id);
    if (asset?.media?.kind === "image")
      onFrameChange({
        ...frameOverrides,
        [role]: {
          mode: "manual",
          frame: {
            kind: "image",
            mediaId: asset.media.id,
            takeId: asset.media.id,
            time: 0,
          },
        },
      });
  };
  const rangeDuration = value.range
    ? value.range.to - value.range.from
    : Math.min(2, clip?.duration || 2);
  return (
    <>
      <p className="effect-context-label">
        {complete
          ? "Transform this clip"
          : clip
            ? "Fill this clip"
            : context.before && context.after
              ? "Transition between these clips"
              : "Add a transition at this point"}
      </p>
      {complete && (
        <div className="effect-scope" role="group" aria-label="Effect scope">
          <button
            aria-pressed={!value.range}
            onClick={() => change({ range: null })}
          >
            Whole clip
          </button>
          <button
            aria-pressed={!!value.range}
            onClick={() => {
              const from = Math.min(
                Math.max(context.at, clip.start),
                clip.start +
                  clip.duration -
                  1 / (project.settings?.export?.fps || 24),
              );
              change({
                range: {
                  from,
                  to: Math.min(clip.start + clip.duration, from + 2),
                },
              });
            }}
          >
            Set duration
          </button>
        </div>
      )}
      {complete && value.range && (
        <div className="effect-range">
          <label>
            Starts at{" "}
            <input
              aria-label="Effect start within clip"
              type="number"
              step={1 / (project.settings?.export?.fps || 24)}
              min={0}
              max={Math.max(0, clip.duration - rangeDuration)}
              value={+(value.range.from - clip.start).toFixed(3)}
              onChange={(e) => {
                const from =
                  clip.start +
                  Math.max(
                    0,
                    Math.min(
                      clip.duration - rangeDuration,
                      +e.target.value || 0,
                    ),
                  );
                change({ range: { from, to: from + rangeDuration } });
              }}
            />{" "}
            s in clip
          </label>
          <span>{rangeDuration.toFixed(1)}s affected</span>
          <GenerationDuration
            value={rangeDuration}
            durations={Array.from(
              {
                length: Math.max(
                  1,
                  Math.floor(
                    Math.min(
                      30,
                      clip.start + clip.duration - value.range.from,
                    ) * 10,
                  ),
                ),
              },
              (_, i) => (i + 1) / 10,
            )}
            label="Effect range duration"
            onChange={(duration) =>
              change({
                range: {
                  from: value.range.from,
                  to: value.range.from + duration,
                },
              })
            }
          />
        </div>
      )}
      <div className="creative-timing effect-timing">
        <div className="creative-time-heading">
          {["start", "end"].map((role, i) => (
            <React.Fragment key={role}>
              {i === 1 && (
                <span className="creative-duration">{value.duration}s</span>
              )}
              <button
                className={`creative-frame ${role}`}
                data-frame-boundary={role}
                aria-label={`Change ${role} frame`}
                aria-expanded={editing === role}
                onClick={() => setEditing(editing === role ? null : role)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => drop(e, role)}
              >
                {boundaryPreview(frames[role]) ? (
                  <img
                    alt={`${role === "start" ? "First" : "Last"} frame`}
                    src={boundaryPreview(frames[role])}
                  />
                ) : (
                  <Plus size={20} />
                )}
                <span>{role === "start" ? "First frame" : "Last frame"}</span>
                <ChevronDown size={11} />
              </button>
            </React.Fragment>
          ))}
        </div>
        <GenerationDuration
          value={value.duration}
          durations={Array.from({ length: 29 }, (_, i) => i + 2)}
          onChange={(duration) => change({ duration })}
          label="Effect generation duration"
        />
      </div>
      <p className="effect-frame-caption">
        {complete
          ? "Frames follow the selected clip or range."
          : context.before && context.after
            ? "Previous clip’s last frame → next clip’s first frame."
            : "Add the missing frame to continue."}{" "}
        Drop an image or open a frame to change it.
      </p>
      <input
        ref={upload}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload effect frame"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onUpload(uploadRole.current, file);
        }}
      />
      {editing && (
        <div className="effect-frame-picker">
          <header>
            <strong>
              {editing === "start" ? "First frame" : "Last frame"}
            </strong>
            <button
              className="icon"
              aria-label="Close frame picker"
              onClick={() => setEditing(null)}
            >
              <X size={14} />
            </button>
          </header>
          <FrameControls
            only={editing}
            project={project}
            prepared={prepared}
            draft={draft}
            change={editFrames}
            time={context.at}
            onUpload={chooseUpload}
            uploadBusy={uploadBusy}
          />
          <details>
            <summary>Pick an image</summary>
            <div className="boundary-source-grid">
              {project.assets
                .filter((a) => a.media?.kind === "image")
                .map((a) => (
                  <button
                    key={a.id}
                    aria-label={`Use ${a.name}`}
                    onClick={() => {
                      onFrameChange({
                        ...frameOverrides,
                        [editing]: {
                          mode: "manual",
                          frame: {
                            kind: "image",
                            mediaId: a.media.id,
                            takeId: a.media.id,
                            time: 0,
                          },
                        },
                      });
                      setEditing(null);
                    }}
                  >
                    <img
                      src={
                        a.media.thumbnail || `/api/media/${a.media.id}/original`
                      }
                      alt=""
                    />
                    <span>{a.name}</span>
                  </button>
                ))}
            </div>
          </details>
        </div>
      )}
      <div className="effect-movements" role="group" aria-label="Movement">
        {morphPresets.map((p) => (
          <button
            key={p.id}
            aria-pressed={value.preset === p.id}
            onClick={() => change({ preset: p.id })}
            title={p.description}
          >
            <MotionPreview frames={frames} preset={p} />
            {p.name}
          </button>
        ))}
      </div>
      <small>
        Motion guides use your endpoint frames. Review the generated result
        before applying.
      </small>
      <label className="effect-guidance">
        <textarea
          rows={2}
          maxLength={1000}
          aria-label="Optional effect guidance"
          placeholder="Any extra direction? (optional)"
          value={value.guidance}
          onChange={(e) => change({ guidance: e.target.value })}
        />
      </label>
      <details className="effect-options">
        <summary>
          More options{" "}
          <span>
            {value.resolution} · {value.aspect}
          </span>
        </summary>
        <label>
          Vibe
          <select
            value={value.vibe}
            onChange={(e) => change({ vibe: e.target.value })}
          >
            {morphVibes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quality
          <select
            value={value.resolution}
            onChange={(e) => change({ resolution: e.target.value })}
          >
            {["480p", "720p", "1080p"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Format
          <select
            value={value.aspect}
            onChange={(e) => change({ aspect: e.target.value })}
          >
            {["16:9", "9:16", "1:1", "4:3", "3:4"].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
      </details>
      {complete && (
        <small>
          Picture changes only{value.range ? " in this range" : ""}. Original
          sound and timing stay. Motion is fitted to{" "}
          {value.range ? rangeDuration.toFixed(1) : clip.duration.toFixed(1)}s.
        </small>
      )}
    </>
  );
}
