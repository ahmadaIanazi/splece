import React, { useMemo, useState } from "react";
import { Sparkles, CircleAlert, Check } from "lucide-react";
import { generationArtwork } from "../shared/generation-artwork.mjs";
import "./generation-surface.css";

function ReferenceImage({ image, index }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="generation-reference"
      src={image.src}
      alt=""
      draggable={false}
      style={{ "--reference-index": index }}
      onError={() => setFailed(true)}
    />
  );
}

export function GenerationSurface({
  job,
  progress: p,
  surface,
  title,
  count = 1,
}) {
  const images = useMemo(() => generationArtwork(job), [job.snapshot]);
  const preview = surface === "preview";
  const attention = p.terminal && !["ready", "cancelled"].includes(job.state);
  const Glyph = attention
    ? CircleAlert
    : job.state === "ready"
      ? Check
      : Sparkles;
  const error = job.error?.includes("(402)")
    ? "Venice rejected payment (402). Check your Venice credits or billing before submitting again."
    : job.error;
  return (
    <div
      className={`generation-fill generation-fill-${surface}`}
      data-active={!p.terminal}
      data-indeterminate={p.percent === null && !p.terminal}
      data-attention={attention}
      style={{ "--generation-fill": `${p.percent ?? 0}%` }}
      title={[p.label, p.detail, error].filter(Boolean).join(" · ")}
    >
      <div className="generation-atmosphere" aria-hidden="true">
        <i className="generation-orbit" />
        {preview &&
          images.map((image, index) => (
            <ReferenceImage key={image.src} image={image} index={index} />
          ))}
      </div>
      <div className="generation-fill-level" aria-hidden="true" />
      <div className="generation-fill-shade" aria-hidden="true" />
      <div className="generation-fill-content">
        {!preview && (title || job.snapshot?.draft?.name) && (
          <small className="generation-fill-clip-name">
            {title || job.snapshot.draft.name}
          </small>
        )}
        {preview && (
          <>
            <span className="generation-fill-symbol">
              <Glyph size={25} strokeWidth={1.5} />
            </span>
            <p className="generation-fill-eyebrow">
              {p.terminal
                ? "Generation status"
                : "Your scene is coming together"}
            </p>
            <h2>
              {title || job.snapshot?.draft?.name || "Creating your video"}
            </h2>
          </>
        )}
        <div className="generation-fill-status">
            <strong aria-live={preview ? "polite" : undefined}>{p.label}</strong>
          <span>
            {p.percent !== null ? (
              <>
                <b>{p.percent}%</b>
                {job.state !== "ready" && <small> estimated</small>}
              </>
            ) : (
              `${p.elapsedSeconds}s`
            )}
          </span>
        </div>
        <progress
          className="generation-fill-accessible"
          aria-label={`${job.snapshot?.draft?.name || "Video"}: ${p.label}`}
          max="100"
          {...(p.percent !== null
            ? { value: p.percent }
            : p.terminal
              ? { value: 0 }
              : {})}
        />
        {preview && (
          <div className="generation-fill-details">
            {p.detail && <p>{p.detail}</p>}
            {error && <p className="generation-fill-error">{error}</p>}
            {job.lastPolledAt && (
              <small>
                Last checked {new Date(job.lastPolledAt).toLocaleTimeString()}
              </small>
            )}
          </div>
        )}
        {!preview && count > 1 && (
          <small className="generation-fill-count">{count} generating</small>
        )}
      </div>
      {preview && (
        <div className="generation-fill-footnote">
          <span>
            {images.length
              ? "Inspired by your frames & references"
              : "Shaping your scene"}
          </span>
          <span>Your draft and generation record are saved locally.</span>
        </div>
      )}
    </div>
  );
}
