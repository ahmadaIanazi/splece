import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Images,
  FolderOpen,
  X,
  File,
  ChevronDown,
} from "lucide-react";
import { Modal } from "./components";
import { api } from "./state";
import { TemplateBrowser } from "./project-templates";
import { CreativeDirection } from "./creative-direction";
import { findProjectTemplate } from "../shared/project-templates.mjs";
const emptyDraft = {
  name: "",
  format: "blank",
  concept: "",
  libraryIds: [],
  folder: "",
  templateId: "",
  creativeDirection: {},
  includeSample: true,
  aspect: "16:9",
};
export function ProjectStart({ onClose, onCreate }) {
  const [draft, setDraft] = useState(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("splece-project-start"));
        const restored = { ...emptyDraft, ...saved };
        return {
          ...restored,
          concept: typeof restored.concept === "string" ? restored.concept : "",
          libraryIds: Array.isArray(restored.libraryIds)
            ? restored.libraryIds
            : [],
          templateId: findProjectTemplate(restored.templateId)?.id || "",
        };
      } catch {
        return { ...emptyDraft };
      }
    }),
    [assets, setAssets] = useState([]),
    [libraryOpen, setLibraryOpen] = useState(false),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [defaultFolder, setDefaultFolder] = useState("");
  useEffect(() => { api("/studio/folders").then(v => setDefaultFolder(v.projectsRoot)).catch(() => {}); }, []);
  const writing = useRef(null);
  const change = (patch) => setDraft((d) => ({ ...d, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem("splece-project-start", JSON.stringify(draft));
    } catch {
      /* Storage may be unavailable. The form remains usable. */
    }
  }, [draft]);
  useEffect(() => {
    if (!libraryOpen && !draft.libraryIds.length) return;
    let live = true;
    api("/library/assets")
      .then((v) => {
        if (live)
          setAssets(
            v.filter((e) => !["audio", "footage"].includes(e.asset.kind)),
          );
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [libraryOpen, draft.libraryIds.length]);
  const attach = (entry) => {
    const el = writing.current,
      start = el?.selectionStart ?? draft.concept.length,
      end = el?.selectionEnd ?? start,
      mention = `@[${entry.asset.name}]`;
    change({
      concept:
        draft.concept.slice(0, start) +
        (start ? " " : "") +
        mention +
        " " +
        draft.concept.slice(end),
      libraryIds: [...new Set([...draft.libraryIds, entry.id])],
    });
    el?.focus();
  };
  async function create(start = "plan") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = start === "blank" ? { ...emptyDraft, name: draft.name, folder: draft.folder, includeSample: false } : draft;
      await onCreate(body, { start });
      try {
        localStorage.removeItem("splece-project-start");
      } catch {}
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const template = findProjectTemplate(draft.templateId);
  return (
    <Modal
      title="New project"
      className="project-start-modal starter-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="starter-form" inert={busy} aria-busy={busy}>
        <div className="starter-create-row">
          <div className="starter-name">
            <input
              autoFocus
              aria-label="Project name"
              placeholder="Name your project"
              value={draft.name}
              onChange={(e) => change({ name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  create();
                }
              }}
            />
            <div className="starter-choice" aria-live="polite">
              {template ? (
                <button
                  aria-label="Remove template and start blank"
                  onClick={() =>
                    change({
                      templateId: "",
                      format: "blank",
                      creativeDirection: {},
                      includeSample: false,
                      aspect: "16:9",
                    })
                  }
                >
                  <img src={template.poster} alt="" />
                  {template.name} <X size={13} />
                </button>
              ) : (
                <span>
                  <File size={13} /> Blank project
                </span>
              )}
            </div>
          </div>
          <div className="starter-entry-actions"><button
            className="primary starter-create"
            disabled={busy}
            onClick={() => create("plan")}
          >
            {busy ? "Creating…" : "Start planning"}
            <ArrowRight size={15} />
          </button>
          <button className="starter-skip" disabled={busy} onClick={() => create("blank")}>Start creating</button></div>
        </div>
        <div className="starter-scroll-area">
          <TemplateBrowser
            selectedId={draft.templateId}
            onSelect={(t) => {
              if (t.id === draft.templateId) return;
              change({
                templateId: t.id,
                format: t.format,
                creativeDirection: t.direction,
                aspect: t.aspect,
                includeSample: true,
              });
            }}
          />
          <details className="starter-options">
            <summary>
              <ChevronDown size={14} /> More options
            </summary>
            <div
              className="project-idea-layout"
              data-library-open={libraryOpen}
            >
              <section>
                <div className="idea-writing-tools">
                  <label htmlFor="starter-idea">Your idea</label>
                  <button
                    aria-label="Concept assets"
                    aria-expanded={libraryOpen}
                    onClick={() => setLibraryOpen(!libraryOpen)}
                  >
                    <Images size={17} />
                  </button>
                </div>
                {template && (
                  <div className="starter-example-line">
                    <button
                      onClick={() => change({ concept: template.concept })}
                      disabled={!!draft.concept.trim()}
                    >
                      Use example idea
                    </button>
                  </div>
                )}
                <textarea
                  id="starter-idea"
                  ref={writing}
                  aria-label="Project freewriting"
                  placeholder={
                    template
                      ? template.concept
                      : "An idea, a place, a moment. Start writing…"
                  }
                  value={draft.concept}
                  onChange={(e) => change({ concept: e.target.value })}
                  onDragOver={(e) => {
                    if (
                      e.dataTransfer.types.includes(
                        "application/splece-concept-asset",
                      )
                    )
                      e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const entry = assets.find(
                      (a) =>
                        a.id ===
                        e.dataTransfer.getData(
                          "application/splece-concept-asset",
                        ),
                    );
                    if (entry) {
                      e.preventDefault();
                      attach(entry);
                    }
                  }}
                />
                <div className="concept-references">
                  {draft.libraryIds.map((id) => {
                    const e = assets.find((a) => a.id === id);
                    return (
                      e && (
                        <span key={id}>
                          {e.asset.media && (
                            <img
                              src={e.asset.media.thumbnail || e.asset.media.url}
                              alt=""
                            />
                          )}
                          {e.asset.name}
                          <button
                            aria-label={
                              "Remove concept reference " + e.asset.name
                            }
                            onClick={() =>
                              change({
                                libraryIds: draft.libraryIds.filter(
                                  (x) => x !== id,
                                ),
                                concept: draft.concept.replaceAll(
                                  `@[${e.asset.name}]`,
                                  e.asset.name,
                                ),
                              })
                            }
                          >
                            <X size={12} />
                          </button>
                        </span>
                      )
                    );
                  })}
                </div>
                <div className="starter-project-options">
                  <label>
                    Project shape{" "}
                    <select
                      aria-label="Project shape"
                      value={draft.aspect}
                      onChange={(e) => change({ aspect: e.target.value })}
                    >
                      <option value="16:9">Landscape · 16:9</option>
                      <option value="9:16">Portrait · 9:16</option>
                      <option value="1:1">Square · 1:1</option>
                    </select>
                  </label>
                  {template && (
                    <label className="starter-sample-toggle">
                      <input
                        type="checkbox"
                        checked={draft.includeSample}
                        onChange={(e) =>
                          change({ includeSample: e.target.checked })
                        }
                      />
                      <span>
                        Include the sample cut
                        <small>
                          Illustrative footage you can replace. No generation
                          needed.
                        </small>
                      </span>
                    </label>
                  )}
                </div>
                <CreativeDirection
                  value={draft.creativeDirection}
                  onChange={(creativeDirection) =>
                    change({ creativeDirection })
                  }
                />
                <footer>
                  <details>
                    <summary>Project folder</summary>
                    <p className="muted">Saved inside {draft.folder || defaultFolder || "your default project folder"}</p>
                    <input
                      aria-label="Local project folder"
                      placeholder={defaultFolder || "Default project folder"}
                      value={draft.folder}
                      onChange={(e) => change({ folder: e.target.value })}
                    />
                    <button
                      aria-label="Choose project folder"
                      onClick={async () => {
                        try {
                          change({ folder: (await api("/folder", {initial: draft.folder || defaultFolder})).path });
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      <FolderOpen size={15} />
                    </button>
                  </details>
                </footer>
              </section>
              {libraryOpen && (
                <aside aria-label="Concept reference library">
                  <input
                    aria-label="Search concept assets"
                    placeholder="Characters, places, products…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div>
                    {assets
                      .filter((e) =>
                        (e.asset.name + " " + e.asset.kind)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((e) => (
                        <button
                          key={e.id}
                          draggable
                          onDragStart={(event) =>
                            event.dataTransfer.setData(
                              "application/splece-concept-asset",
                              e.id,
                            )
                          }
                          onClick={() => attach(e)}
                        >
                          {e.asset.media ? (
                            <img
                              draggable={false}
                              src={e.asset.media.thumbnail || e.asset.media.url}
                              alt=""
                            />
                          ) : (
                            <Images size={24} />
                          )}
                          <span>{e.asset.name}</span>
                          <small>{e.asset.kind}</small>
                        </button>
                      ))}
                  </div>
                  {!assets.length && (
                    <p className="muted">
                      Your shared visual assets will appear here. You can add
                      references later.
                    </p>
                  )}
                </aside>
              )}
            </div>
          </details>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
