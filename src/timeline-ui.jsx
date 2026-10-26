import React, { useMemo, useState, useRef } from "react";
import {
  MoreHorizontal,
  Layers,
  ChevronUp,
  ChevronDown,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  AudioLines,
  Archive,
  History,
  Search,
  X,
  Plus,
  RotateCcw,
  Check,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import { JobProgress } from "./job-progress";
import { jobProgress } from "../shared/job-progress.mjs";
import { tc } from "./state";
import { generationPool } from "../shared/generation-pool.mjs";

function TimelineThumbnail({ src, fallback }) {
  const [attempt, setAttempt] = useState(0);
  if (attempt > 1 || (attempt === 1 && !fallback)) return null;
  return (
    <img
      alt=""
      loading="lazy"
      draggable={false}
      src={attempt ? fallback : src}
      onError={() => setAttempt((value) => value + 1)}
    />
  );
}

export function GenerationShelf({
  project,
  jobs,
  expanded,
  onToggle,
  onHistory,
  onDetails,
  onRestore,
  onDrag,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const dragged = useRef(false);
  const pool = useMemo(() => generationPool(project, jobs), [project, jobs]);
  const visible = pool.filter(
    (e) =>
      (filter === "all" || !e.onTimeline) &&
      e.name.toLowerCase().includes(query.toLowerCase()),
  );
  const episodeJobs = jobs.filter(
    (j) =>
      j.kind === "generation" &&
      (!j.snapshot?.draft?.episodeId ||
        j.snapshot.draft.episodeId === project.episodeId),
  );
  const running = episodeJobs.filter((j) => !jobProgress(j).terminal);
  const drag = (e, key) => {
    if (e.target.closest(".pool-card-footer button")) return;
    dragged.current = false;
    onDrag(e, key, () => {
      dragged.current = true;
    });
  };
  const suppressDragClick = (e) => {
    if (!dragged.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragged.current = false;
  };
  return (
    <div className={"film-shelf " + (expanded ? "pool-expanded" : "")}>
      <div className="shelf-label">
        <span>
          <Layers size={14} /> {expanded ? "GENERATION POOL" : "GENERATIONS"}{" "}
          {running.length > 0 && <small>{running.length} active</small>}
        </span>
        <div className="shelf-actions">
          <button
            onClick={onHistory}
            title="Generation history"
            aria-label="Generation history"
          >
            <History size={14} />
          </button>
          <button
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Close generation pool" : "Open generation pool"
            }
          >
            {expanded ? <X size={14} /> : <Archive size={14} />}{" "}
            {expanded ? "Close" : "Pool"}
          </button>
        </div>
      </div>
      {expanded ? (
        <>
          <div className="pool-tools">
            <label>
              <Search size={13} />
              <input
                aria-label="Search generated videos"
                placeholder="Find a video…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div role="group" aria-label="Pool filter">
              <button
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
              >
                All {pool.length}
              </button>
              <button
                className={filter === "unused" ? "active" : ""}
                onClick={() => setFilter("unused")}
              >
                Off timeline {pool.filter((e) => !e.onTimeline).length}
              </button>
            </div>
          </div>
          <div className="pool-grid" aria-label="Saved generation pool">
            {visible.map((entry) => (
              <article
                className="pool-card"
                key={entry.key}
                onPointerDown={(e) => drag(e, entry.key)}
                onClickCapture={suppressDragClick}
              >
                <button
                  className="pool-preview"
                  title="View video and generation details"
                  onClick={() => onDetails(entry.job, entry.media)}
                >
                  <img
                    src={entry.media.thumbnail}
                    alt={entry.name}
                    draggable={false}
                  />
                  <span>
                    {tc(entry.clip?.duration || entry.media.duration)}
                  </span>
                  {entry.clip?.takes.length > 1 && (
                    <span className="pool-takes">
                      <Layers size={11} /> {entry.clip.takes.length}
                    </span>
                  )}
                </button>
                <div className="pool-card-footer">
                  <div>
                    <b title={entry.name}>{entry.name}</b>
                    <small>
                      {entry.removed
                        ? "Removed · saved with all takes"
                        : entry.onTimeline
                          ? "In timeline"
                          : "Saved video"}
                    </small>
                  </div>
                  <button
                    title={
                      entry.onTimeline
                        ? "Show this take in timeline"
                        : "Restore to timeline at playhead"
                    }
                    aria-label={
                      (entry.onTimeline ? "Show " : "Restore ") + entry.name
                    }
                    onClick={() => onRestore(entry.key)}
                  >
                    {entry.onTimeline ? (
                      <Check size={15} />
                    ) : entry.removed ? (
                      <RotateCcw size={15} />
                    ) : (
                      <Plus size={15} />
                    )}
                  </button>
                </div>
              </article>
            ))}
            {!visible.length && (
              <div className="pool-empty">
                {query
                  ? "No matching videos."
                  : filter === "unused"
                    ? "Every saved video is in the timeline."
                    : "Completed videos stay here, even after you remove their timeline clips."}
              </div>
            )}
          </div>
          <small className="pool-hint">
            Drag a video to a cut, or restore at the playhead. All takes stay
            saved.
          </small>
        </>
      ) : (
        <div className="shelf-content">
          {episodeJobs
            .slice(-8)
            .reverse()
            .map((j) => {
              const entry = pool.find(
                (e) =>
                  e.media.id === j.media?.id ||
                  e.clip?.takes.some((t) => t.id === j.media?.id),
              );
              return (
                <button
                  key={j.id}
                  className="job-tile"
                  onPointerDown={(e) => entry && drag(e, entry.key)}
                  onClickCapture={suppressDragClick}
                  onClick={() => onDetails(j, j.media)}
                >
                  {j.media ? (
                    <img
                      alt="Generation preview"
                      src={j.media.thumbnail}
                      draggable={false}
                    />
                  ) : (
                    <div>
                      {j.state === "failed" ? (
                        <AlertCircle size={19} />
                      ) : (
                        <LoaderCircle size={19} className="spin" />
                      )}
                    </div>
                  )}
                  <JobProgress job={j} compact />
                </button>
              );
            })}
          {!episodeJobs.length && (
            <span className="shelf-empty">
              Your generations, together in one place.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ClipMixer({ clip, change, onAudio, onDetach, canDetach }) {
  return (
    <details className="clip-mixer">
      <summary
        title="Clip sound & audio mixer"
        aria-label="Clip sound & audio mixer"
      >
        <SlidersHorizontal size={16} />
      </summary>
      <div className="clip-mixer-panel">
        {clip ? (
          <>
            <b>Clip sound</b>
            <button disabled={!canDetach} onClick={onDetach}>
              <AudioLines size={15} /> Detach audio
            </button>
            <div className="mixer-volume">
              <button
                aria-label={
                  clip.mute ? "Unmute selected clip" : "Mute selected clip"
                }
                onClick={() => change((c) => (c.mute = !c.mute))}
              >
                {clip.mute ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <input
                aria-label="Clip volume"
                type="range"
                min="0"
                max="1"
                step=".05"
                value={clip.volume ?? 1}
                onChange={(e) => change((c) => (c.volume = +e.target.value))}
              />
              <output>{Math.round((clip.volume ?? 1) * 100)}%</output>
            </div>
            <div className="mixer-fades">
              {["fadeIn", "fadeOut"].map((key) => (
                <label key={key}>
                  {key === "fadeIn" ? "Fade in" : "Fade out"}
                  <input
                    aria-label={"Clip " + key}
                    type="number"
                    min="0"
                    max={clip.duration}
                    step=".1"
                    value={clip[key] || 0}
                    onChange={(e) =>
                      change(
                        (c) =>
                          (c[key] = Math.min(
                            c.duration,
                            Math.max(0, +e.target.value),
                          )),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </>
        ) : (
          <small>Select a clip to adjust its sound.</small>
        )}
        <button onClick={onAudio}>
          <AudioLines size={15} /> Audio mixer & tracks
        </button>
      </div>
    </details>
  );
}
export function TakeStack({
  plannedTitle,
  plannedType,
  clip,
  media,
  job,
  jobs,
  zoom,
  onTake,
  onBrowse,
  onMute,
  onSettings,
  selected,
}) {
  const idx = clip.takes.findIndex((t) => t.id === clip.activeTake);
  const activeJobs = jobs.filter((j) => !jobProgress(j).terminal);
  const status =
    activeJobs.at(-1) ||
    (!media
      ? job
      : job && !["ready", "cancelled"].includes(job.state)
        ? job
        : null);
  const depth = Math.min(
    2,
    Math.max(0, clip.takes.length - 1) + Number(activeJobs.length > 0),
  );
  return (
    <>
      {selected &&
        clip.takes.length > 1 &&
        [1, -1].map((direction) => {
          const alternate =
            clip.takes[
              (idx + direction + clip.takes.length) % clip.takes.length
            ];
          // At either end of the stack, show only the existing adjacent take.
          if (idx + direction < 0 || idx + direction >= clip.takes.length)
            return null;
          return (
            <button
              key={direction}
              className={
                "take-neighbor " + (direction === 1 ? "above" : "below")
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onTake(direction);
              }}
              aria-label={
                (direction === 1
                  ? "Preview newer take "
                  : "Preview older take ") +
                (idx + direction + 1)
              }
              title={
                (direction === 1 ? "Newer" : "Older") +
                " take · " +
                tc(alternate.duration)
              }
            >
              <img
                alt=""
                src={
                  alternate.thumbnail ||
                  `/api/media/${alternate.id}/frame?time=0`
                }
                draggable={false}
              />
              {direction === 1 ? (
                <ChevronUp size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
              <span>Take {idx + direction + 1}</span>
            </button>
          );
        })}
      {Array.from({ length: depth }, (_, i) => (
        <div
          className="take-depth"
          key={i}
          style={{
            transform: `translateY(${(i + 1) * 6}px) scaleX(${1 - (i + 1) * 0.035})`,
            zIndex: -i - 1,
          }}
        />
      ))}
      {status && media && (
        <div
          className="take-pending"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <JobProgress job={status} compact inline />
          <small>
            {activeJobs.length > 1
              ? `${activeJobs.length} new takes`
              : "New take"}
          </small>
        </div>
      )}
      <div className="take-face">
        {media && (
          <button
            className="take-settings"
            aria-label="Clip settings"
            title="Speed, reverse and clip settings"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSettings?.();
            }}
          >
            <MoreHorizontal size={15} />
          </button>
        )}
        {media ? (
          <div className="filmstrip">
            {Array.from(
              { length: Math.max(1, Math.ceil((clip.duration * zoom) / 115)) },
              (_, i) => (
                <TimelineThumbnail
                  key={`${media.id}:${clip.in}:${i}:${zoom}`}
                  fallback={media.thumbnail}
                  src={`/api/media/${media.id}/frame?time=${(clip.in + Math.min(clip.duration - 0.05, (i * 115) / zoom)).toFixed(2)}`}
                />
              ),
            )}
          </div>
        ) : (
          <div className="take-placeholder">
            <Plus size={20} />
            {plannedTitle && <b>{plannedTitle}</b>}
            <span>
              {tc(clip.start)} — {tc(clip.start + clip.duration)}
            </span>
          </div>
        )}
        {(media || activeJobs.length > 0) && (
          <div
            className="take-badges"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="take-count"
              aria-label={`Browse ${clip.takes.length} takes`}
              title="All takes · scroll the clip to switch"
              onClick={onBrowse}
            >
              <Layers size={12} />
              {idx + 1}/{clip.takes.length}
              {activeJobs.length > 0 && (
                <span className="take-working">+{activeJobs.length}</span>
              )}
            </button>
            {media?.audio && (
              <button
                className="take-sound"
                title={clip.mute ? "Unmute clip" : "Mute clip"}
                aria-label={clip.mute ? "Unmute clip" : "Mute clip"}
                onClick={onMute}
              >
                {clip.mute ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
            )}
          </div>
        )}
        {clip.takes.length > 1 && (
          <div
            className="wheel-arrows"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              title="Newer take"
              aria-label="Newer take"
              onClick={() => onTake(1)}
            >
              <ChevronUp size={14} />
            </button>
            <button
              title="Older take"
              aria-label="Older take"
              onClick={() => onTake(-1)}
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}
        {status && !media && (
          <div className={"slot-progress " + (media ? "with-preview" : "")}>
            <JobProgress job={status} compact inline />
            {activeJobs.length > 1 && (
              <span>{activeJobs.length} generating</span>
            )}
          </div>
        )}
        {!media && !status && (
          <span className="slot-empty">
            {plannedType === "group" ? "Develop group" : "Compose clip"}{" "}
            <span>↗</span>
          </span>
        )}
      </div>
    </>
  );
}
