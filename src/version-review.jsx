import React, { useState } from "react";
export function VersionReview({ clip, jobs, onUse, onRemove, onCompare }) {
  const [selected, setSelected] = useState(clip.activeTake);
  const take =
    clip.takes.find((t) => t.id === selected) ||
    clip.takes.find((t) => t.id === clip.activeTake) ||
    clip.takes[0];
  if (!take) return <p>No versions available.</p>;
  return (
    <section className="version-review">
      <div className="version-preview">
        {take.kind === "image" ? (
          <img src={take.url} alt="Selected version" />
        ) : (
          <video
            key={take.id}
            src={take.url}
            poster={take.thumbnail}
            controls
            preload="metadata"
          />
        )}
      </div>
      <div
        className="version-review-list"
        role="group"
        aria-label="Available versions"
      >
        {[...clip.takes].reverse().map((t, i) => (
          <button
            key={t.id}
            aria-pressed={t.id === take.id}
            onClick={() => setSelected(t.id)}
          >
            <img src={t.thumbnail} alt="" />
            <span>
              <strong>
                Version {clip.takes.length - i}
                {t.id === clip.activeTake ? " · In edit" : ""}
              </strong>
              <small>
                {jobs.find((j) => j.id === t.jobId)?.snapshot?.draft?.name ||
                  (!/^(take|version) \d+$/i.test(t.name || "") && t.name) ||
                  "Saved result"}
              </small>
              <small>{(t.duration || clip.duration).toFixed(2)}s</small>
            </span>
          </button>
        ))}
      </div>
      <footer>
        <button disabled={clip.takes.length < 2} onClick={onCompare}>
          Compare versions
        </button>
        <button
          disabled={clip.takes.length < 2}
          title={
            clip.takes.length < 2
              ? "Keep at least one version, or remove the clip from the timeline"
              : undefined
          }
          onClick={() => onRemove(take.id)}
        >
          Remove version
        </button>
        <button
          className="primary"
          disabled={take.id === clip.activeTake}
          onClick={() => onUse(take)}
        >
          Use version
        </button>
      </footer>
      <small>
        Previewing keeps your edit unchanged. Removed versions stay in Library;
        Undo restores the stack.
      </small>
    </section>
  );
}
