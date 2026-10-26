import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Film, Play } from "lucide-react";
import { homeDuration } from "../shared/home-projects.mjs";
import {
  projectTemplates,
  templateCategories,
} from "../shared/project-templates.mjs";

export function HomeCover({ cover, title, previewing = false }) {
  const [failed, setFailed] = useState(false);
  const video = useRef(null);
  useEffect(() => setFailed(false), [cover?.thumbnail]);
  const hue = [...title].reduce(
    (n, ch) => (n * 31 + ch.charCodeAt(0)) % 360,
    210,
  );
  return (
    <span className="home-cover" style={{ "--cover-hue": hue }}>
      {cover && !failed ? (
        <img
          src={cover.thumbnail}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="home-cover-fallback">
          <Film size={28} />
          <span>{cover ? "Preview unavailable" : "Your next story"}</span>
        </span>
      )}
      {previewing && cover?.url && (
        <video
          ref={video}
          src={cover.url}
          muted
          playsInline
          autoPlay
          aria-hidden="true"
          onLoadedMetadata={() => {
            if (video.current) video.current.currentTime = cover.start || 0;
          }}
          onTimeUpdate={() => {
            const el = video.current;
            if (
              el &&
              el.currentTime >= (cover.start || 0) + (cover.duration || 3)
            )
              el.currentTime = cover.start || 0;
          }}
          onEnded={() => {
            const el = video.current;
            if (el) {
              el.currentTime = cover.start || 0;
              el.play().catch(() => {});
            }
          }}
        />
      )}
      {cover && (
        <span className="home-cover-play">
          <Play size={15} fill="currentColor" /> Preview clip
        </span>
      )}
    </span>
  );
}

export function ProjectMeta({ project }) {
  const summary = project.summary;
  const date = new Date(project.updated);
  const days = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 86400000),
  );
  const edited =
    days === 0
      ? "Edited today"
      : days === 1
        ? "Edited yesterday"
        : `Edited ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return (
    <span className="home-card-meta">
      <span>{edited}</span>
      {summary && <span>{summary.aspect}</span>}
      {summary && !summary.hasFootage && <span>No footage yet</span>}
      {!!summary?.pending && summary.hasFootage && <span>In progress</span>}
    </span>
  );
}

export function ProjectDuration({ summary }) {
  return summary?.duration > 0 ? (
    <span className="home-cover-duration" title="Current edit duration">
      {homeDuration(summary.duration)}
    </span>
  ) : null;
}

export function HomeTemplates({
  full = false,
  onChoose,
  previewId,
  previewProps,
}) {
  const [category, setCategory] = useState("All");
  const list = full
    ? projectTemplates.filter(
        (t) => category === "All" || t.category === category,
      )
    : projectTemplates.slice(0, 3);
  return (
    <section className="home-templates" aria-label="Project templates">
      {full && (
        <div
          className="home-template-filters"
          role="group"
          aria-label="Template categories"
        >
          {templateCategories.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c === "All" ? "All templates" : c}
            </button>
          ))}
        </div>
      )}
      <div className="home-template-grid">
        {list.map((t) => (
          <button
            className="home-template-card"
            key={t.id}
            onClick={() => onChoose(t)}
            {...previewProps(`template-${t.id}`)}
          >
            <HomeCover
              title={t.name}
              cover={{ thumbnail: t.poster, url: t.preview, duration: 3 }}
              previewing={previewId === `template-${t.id}`}
            />
            <span className="home-template-copy">
              <small>{t.category}</small>
              <b>{t.name}</b>
              <span>
                Use template <ArrowUpRight size={14} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
