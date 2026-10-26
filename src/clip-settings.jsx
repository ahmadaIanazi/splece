import React, { useState } from "react";
import { RotateCcw, Gauge, LoaderCircle } from "lucide-react";
import { Modal } from "./components";
import { api, uid, tc } from "./state";
import {
  treatmentSource,
  treatmentSignature,
} from "../shared/clip-treatment.mjs";
export function ClipSettings({
  project,
  clip,
  jobs,
  flush,
  onJob,
  onApply,
  onClose,
}) {
  const media = clip.takes.find((t) => t.id === clip.activeTake),
    source = treatmentSource(clip);
  const [speed, setSpeed] = useState(media?.treatment?.speed || 1),
    [reverse, setReverse] = useState(!!media?.treatment?.reverse),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const job = jobs
    .filter((j) => j.kind === "clip-treatment" && j.clipId === clip.id)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const running = busy || ["queued", "rendering"].includes(job?.state);
  const matching =
    job?.snapshot.speed === speed &&
    job?.snapshot.reverse === reverse &&
    job?.sourceSignature === treatmentSignature(clip);
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const revision = await flush();
      onJob(
        await api(`/projects/${project.id}/clip-treatment`, {
          clipId: clip.id,
          revision,
          requestId: uid(),
          speed,
          reverse,
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Clip settings" onClose={onClose}>
      <div className="clip-treatment-panel">
        <label className="clip-treatment-reverse">
          <span>
            <RotateCcw size={17} />
            Reverse clip
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Reverse clip"
            checked={reverse}
            disabled={running}
            onChange={(e) => setReverse(e.target.checked)}
          />
        </label>
        <label>
          <Gauge size={17} /> Speed <output>{speed.toFixed(2)}×</output>
        </label>
        <input
          aria-label="Clip playback speed"
          type="range"
          min=".25"
          max="4"
          step=".01"
          value={speed}
          disabled={running}
          onChange={(e) => setSpeed(+e.target.value)}
        />
        <div className="clip-speed-presets">
          {[0.25, 0.5, 1, 1.5, 2, 4].map((v) => (
            <button
              key={v}
              disabled={running}
              aria-pressed={v === speed}
              onClick={() => setSpeed(v)}
            >
              {v}×
            </button>
          ))}
          <input
            type="number"
            aria-label="Exact clip speed"
            min=".25"
            max="4"
            step=".01"
            value={speed}
            disabled={running}
            onChange={(e) =>
              setSpeed(Math.min(4, Math.max(0.25, Number(e.target.value) || 1)))
            }
          />
        </div>
        <p className="muted">
          {tc(clip.duration)} → {tc(source.duration / speed)} · Following clips
          move with the new length.
        </p>
        <small>
          Processed locally, including audio. Your original stays in the take
          stack.
        </small>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {job?.state === "failed" && (
          <p role="alert" className="error">
            {job.error}
          </p>
        )}
        {matching && job?.state === "ready" && (
          <video
            controls
            preload="metadata"
            src={job.media.url}
            aria-label="Adjusted clip preview"
          />
        )}
        {matching && job?.state === "ready" ? (
          <button
            className="primary"
            onClick={() => {
              try {
                onApply(job.media, job.sourceSignature);
                onClose();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Apply adjusted take
          </button>
        ) : (
          <button className="primary" disabled={running} onClick={prepare}>
            {running ? (
              <>
                <LoaderCircle className="spin" size={15} />
                Processing locally…
              </>
            ) : (
              "Prepare adjusted take"
            )}
          </button>
        )}
      </div>
    </Modal>
  );
}
