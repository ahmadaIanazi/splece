import React, { useState } from "react";
import { Check, Play, Pause } from "lucide-react";
import {
  projectTemplates,
  templateCategories,
} from "../shared/project-templates.mjs";
import "./project-templates.css";

export function TemplateBrowser({ selectedId, onSelect }) {
  const [category, setCategory] = useState("All");
  const [previewId, setPreviewId] = useState("");
  const visible = projectTemplates.filter(
    (t) => category === "All" || t.category === category,
  );
  return (
    <section className="starter-catalog" aria-label="Project templates">
      <div className="starter-catalog-heading">
        <h3>Or start with a template</h3>
      </div>
      <div
        className="starter-filters"
        role="group"
        aria-label="Template categories"
      >
        {templateCategories.map((c) => (
          <button
            key={c}
            aria-pressed={c === category}
            onClick={() => {
              setCategory(c);
              setPreviewId("");
            }}
          >
            {c === "All" ? "All templates" : c}
          </button>
        ))}
      </div>
      <div className="starter-grid">
        {visible.map((t) => (
          <div
            key={t.id}
            className="starter-card"
            data-selected={selectedId === t.id}
          >
            <button
              className="starter-card-select"
              aria-label={`Use ${t.name}`}
              aria-pressed={selectedId === t.id}
              onClick={() => onSelect(t)}
              title={t.summary}
            >
              <div className="starter-card-art">
                <img src={t.poster} alt="" loading="lazy" />
                {previewId === t.id && (
                  <video
                    src={t.preview}
                    poster={t.poster}
                    autoPlay
                    muted
                    loop
                    playsInline
                    aria-hidden="true"
                    onError={() => setPreviewId("")}
                  />
                )}
                {selectedId === t.id && (
                  <span className="starter-check">
                    <Check size={13} />
                  </span>
                )}
              </div>
              <span className="starter-card-copy">{t.name}</span>
            </button>
            <button
              className="starter-card-play"
              aria-label={`${previewId === t.id ? "Stop preview of" : "Preview"} ${t.name}`}
              aria-pressed={previewId === t.id}
              onClick={() => setPreviewId(previewId === t.id ? "" : t.id)}
            >
              {previewId === t.id ? <Pause size={12} /> : <Play size={12} />}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
