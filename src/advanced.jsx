import { ReferenceRoleControl } from "./clip-continuity";
import { isLiveJob } from "../shared/providers.mjs";
import React, { useState, useEffect } from "react";
import {
  Camera,
  Plus,
  Trash2,
  Pin,
  RotateCcw,
  Image,
  Volume2,
  VolumeX,
  History,
  Download,
  Copy,
  ArrowUp,
  ArrowDown,
  Check,
  Settings2,
  FolderOpen,
} from "lucide-react";
import { api, uid, tc } from "./state";
import {
  effectiveAutomation,
  automationDefaults,
  switchEpisode,
  editAsset,
  timelineIssues,
} from "../shared/studio.mjs";
// Shared controls live here to keep advanced editors independent of the application shell.
function Button({ title, children, onClick }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}
export function AutomationControls({ project, draft, change, labels }) {
  const effective = effectiveAutomation(project, draft);
  return Object.keys(automationDefaults).map((key) => (
    <label className="toggle-row" key={key}>
      <span>
        {labels[key] ||
          {
            startFrame: "Start frame",
            endFrame: "End frame",
            enhance: "Reviewed preparation",
          }[key]}
      </span>
      <select
        aria-label={(labels[key] || key) + " automation"}
        value={
          draft.automation[key] === undefined
            ? "inherit"
            : String(draft.automation[key])
        }
        onChange={(e) =>
          change((d) => {
            if (e.target.value === "inherit") delete d.automation[key];
            else d.automation[key] = e.target.value === "true";
          })
        }
      >
        <option value="inherit">
          Default · {effective[key] ? "on" : "off"}
        </option>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    </label>
  ));
}
export function VariantEditor({ asset, change, mediaAssets }) {
  return (
    <div className="variant-editor">
      <div className="section-title">
        <span>APPEARANCE VARIANTS</span>
        <Button
          title="Add asset variant"
          onClick={() =>
            change({
              ...asset,
              variants: [
                ...(asset.variants || []),
                {
                  id: uid(),
                  name: "New variation",
                  description: "",
                  tags: {
                    clothing: "",
                    pose: "",
                    angle: "",
                    expression: "",
                    condition: "",
                    lighting: "",
                    timeOfDay: "",
                  },
                  media: null,
                },
              ],
            })
          }
        >
          <Plus size={14} />
        </Button>
      </div>
      {(asset.variants || []).map((v) => (
        <article className="variant-card" key={v.id}>
          <div>
            <input
              aria-label="Variant name"
              value={v.name}
              onChange={(e) =>
                change({
                  ...asset,
                  variants: asset.variants.map((x) =>
                    x.id === v.id ? { ...x, name: e.target.value } : x,
                  ),
                })
              }
            />
            <Button
              title="Remove variant"
              onClick={() =>
                change({
                  ...asset,
                  variants: asset.variants.filter((x) => x.id !== v.id),
                })
              }
            >
              <Trash2 size={13} />
            </Button>
          </div>
          <textarea
            aria-label="Variant description"
            placeholder="Description of this variation"
            value={v.description}
            onChange={(e) =>
              change({
                ...asset,
                variants: asset.variants.map((x) =>
                  x.id === v.id ? { ...x, description: e.target.value } : x,
                ),
              })
            }
          />
          <div className="variant-tags">
            {Object.entries(v.tags)
              .filter(
                ([key, value]) =>
                  asset.kind === "character" ||
                  value ||
                  ["angle", "condition", "lighting", "timeOfDay"].includes(key),
              )
              .map(([key, value]) => (
                <label key={key}>
                  {key}
                  <input
                    aria-label={"Variant " + key}
                    value={value}
                    onChange={(e) =>
                      change({
                        ...asset,
                        variants: asset.variants.map((x) =>
                          x.id === v.id
                            ? {
                                ...x,
                                tags: { ...x.tags, [key]: e.target.value },
                              }
                            : x,
                        ),
                      })
                    }
                  />
                </label>
              ))}
          </div>
          <select
            aria-label="Variant reference media"
            value={v.media?.id || ""}
            onChange={(e) =>
              change({
                ...asset,
                variants: asset.variants.map((x) =>
                  x.id === v.id
                    ? {
                        ...x,
                        media:
                          mediaAssets.find((a) => a.media.id === e.target.value)
                            ?.media || null,
                      }
                    : x,
                ),
              })
            }
          >
            <option value="">Use base reference</option>
            {mediaAssets.map((a) => (
              <option key={a.id} value={a.media.id}>
                {a.name}
              </option>
            ))}
          </select>
          {v.media && <img alt={v.name} src={v.media.thumbnail} />}
          <details>
            <summary>Additional reference views</summary>
            <div className="variant-gallery">
              {mediaAssets
                .filter((a) => a.media.id !== v.media?.id)
                .map((a) => (
                  <label key={a.id}>
                    <input
                      type="checkbox"
                      aria-label={"Include reference view " + a.name}
                      checked={(v.mediaList || []).some(
                        (m) => m.id === a.media.id,
                      )}
                      onChange={(e) =>
                        change({
                          ...asset,
                          variants: asset.variants.map((x) =>
                            x.id === v.id
                              ? {
                                  ...x,
                                  mediaList: e.target.checked
                                    ? [...(x.mediaList || []), a.media]
                                    : (x.mediaList || []).filter(
                                        (m) => m.id !== a.media.id,
                                      ),
                                }
                              : x,
                          ),
                        })
                      }
                    />
                    <img alt={a.name} src={a.media.thumbnail} loading="lazy" />
                    <span>{a.name}</span>
                  </label>
                ))}
            </div>
          </details>
        </article>
      ))}
      {asset.kind === "character" && (
        <label className="field">
          <span>Default speaking delivery</span>
          <input
            value={asset.delivery || "Softly"}
            onChange={(e) => change({ ...asset, delivery: e.target.value })}
          />
        </label>
      )}
      {!!asset.history?.length && (
        <details>
          <summary>Asset versions · {asset.version}</summary>
          {asset.history.map((version, i) => (
            <div className="history-entry" key={i}>
              <span>
                v{version.version} · {version.description}
              </span>
              <Button
                title={"Restore asset version " + version.version}
                onClick={() => change({ ...version, history: asset.history })}
              >
                <RotateCcw size={14} />
              </Button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
export function ReferenceOptions({ asset, draft, change, project }) {
  const value = draft.referenceOptions?.[asset.id] || {};
  const set = (key, val) =>
    change((d) => {
      d.referenceOptions ??= {};
      d.referenceOptions[asset.id] = {
        ...d.referenceOptions[asset.id],
        [key]: val,
      };
    });
  return (
    <div className="reference-options">
      <select
        aria-label={asset.name + " variant"}
        value={value.variantId || "auto"}
        onChange={(e) => set("variantId", e.target.value)}
      >
        <option value="auto">Auto · match context</option>
        <option value="none">Base appearance only</option>
        {asset.variants?.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      {project ? <ReferenceRoleControl asset={asset} draft={draft} project={project} onChange={option => change(d => {
        d.referenceOptions ??= {};
        d.referenceOptions[asset.id] = { ...d.referenceOptions[asset.id], ...option };
      })} /> : (
      <select
        aria-label={asset.name + " reference role"}
        value={
          value.role ||
          (asset.kind === "character"
            ? "identity"
            : asset.kind === "location"
              ? "location"
              : "style")
        }
        onChange={(e) => set("role", e.target.value)}
      >
        {["identity", "location", "style", "palette", "lighting", "pose", "clothing"].map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      )}
      <label>
        <input
          type="checkbox"
          checked={!!value.required}
          onChange={(e) => set("required", e.target.checked)}
        />{" "}
        Required reference
      </label>
    </div>
  );
}
export { FrameControls } from "./frame-controls";
export function SceneExtras({ scene, assets, change, move, index, count }) {
  return (
    <div className="scene-extras">
      <div>
        <label>
          Seconds
          <input
            type="number"
            aria-label={"Scene " + (index + 1) + " duration"}
            min="0.1"
            step="0.1"
            placeholder="Auto"
            value={scene.duration ?? ""}
            onChange={(e) =>
              change(
                (s) =>
                  (s.duration = e.target.value === "" ? null : +e.target.value),
              )
            }
          />
        </label>
        <select
          aria-label="Scene transition"
          value={scene.transition || "Auto"}
          onChange={(e) => change((s) => (s.transition = e.target.value))}
        >
          {[
            "Auto",
            "Cut",
            "Match cut",
            "Dissolve intention",
            "Continuous action",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <Button title="Move scene up" onClick={() => index > 0 && move(-1)}>
          <ArrowUp size={13} />
        </Button>
        <Button
          title="Move scene down"
          onClick={() => index < count - 1 && move(1)}
        >
          <ArrowDown size={13} />
        </Button>
      </div>
      <select
        aria-label="Scene location"
        value={scene.locationId || ""}
        onChange={(e) => change((s) => (s.locationId = e.target.value))}
      >
        <option value="">Auto · location from context</option>
        {assets
          .filter((a) => a.kind === "location")
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      <div className="scene-cast">
        {assets
          .filter((a) => a.kind === "character")
          .map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={scene.characterIds?.includes(a.id) || false}
                onChange={(e) =>
                  change(
                    (s) =>
                      (s.characterIds = e.target.checked
                        ? [...(s.characterIds || []), a.id]
                        : (s.characterIds || []).filter((id) => id !== a.id)),
                  )
                }
              />
              {a.name}
            </label>
          ))}
      </div>
    </div>
  );
}
export function PreparedEditor({ prepared, draft, change, validation }) {
  return (
    <div className="prepared">
      <div className="validation-count">
        {validation.characters} / {validation.limit} characters
      </div>
      {[...validation.errors, ...validation.warnings].map((e, i) => (
        <p
          className={
            validation.errors.includes(e) ? "error" : "compatibility-note"
          }
          key={i}
        >
          {e.message}
        </p>
      ))}
      {prepared.sections.map((section) => (
        <section key={section.label}>
          <header>
            <h3>{section.label}</h3>
            <Button
              title={"Rebuild " + section.label}
              onClick={() =>
                change((d) => {
                  if (section.label === "Smart prompt") delete d.smartAccepted;
                  else delete d.sectionOverrides[section.label];
                })
              }
            >
              <RotateCcw size={13} />
            </Button>
          </header>
          <small>{section.source}</small>
          <textarea
            aria-label={section.label + " prepared text"}
            readOnly={section.label === "Scene controls"}
            rows={Math.min(12, Math.max(3, section.text.split("\n").length))}
            value={section.text}
            onChange={(e) =>
              change((d) => {
                d.sectionOverrides ??= {};
                if (section.label === "Smart prompt" && d.smartAccepted)
                  d.smartAccepted.prompt = e.target.value;
                else d.sectionOverrides[section.label] = e.target.value;
              })
            }
          />
        </section>
      ))}
      <button
        onClick={() =>
          change((d) => {
            d.preparations ??= [];
            d.preparations.push({
              id: uid(),
              at: Date.now(),
              source: "Local scripted preparation · no AI call",
              text: d.scenes
                .map(
                  (s, i) =>
                    `Scene ${i + 1}: ${s.camera}; ${s.movement}. Keep the stated action and exact dialogue.`,
                )
                .join("\n"),
            });
            d.automation.enhance = true;
          })
        }
      >
        <Check size={14} /> Prepare locally · 0 credits
      </button>
      <small className="muted">
        Reviewed preparation is a separate version. Your original writing stays
        intact.
      </small>
      {draft.preparations?.map((v, i) => (
        <details key={v.id}>
          <summary>
            Preparation {i + 1} · {new Date(v.at).toLocaleString()}
          </summary>
          <pre>{v.text}</pre>
        </details>
      ))}
    </div>
  );
}
export function EpisodePicker({ project, update, createDraft }) {
  return (
    <select
      className="episode-picker"
      aria-label="Episode"
      value={project.episodeId}
      onChange={(e) =>
        update((p) => {
          switchEpisode(p, e.target.value);
          if (!p.activeDraftId) {
            const d = createDraft(0);
            d.episodeId = p.episodeId;
            p.drafts.push(d);
            p.activeDraftId = d.id;
          }
        })
      }
    >
      {[
        { id: project.episodeId, name: project.episode },
        ...project.episodes.filter((e) => e.id !== project.episodeId),
      ].map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );
}
export function HistoryPanel({ project, update }) {
  const [rows, setRows] = useState([]),
    [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/projects/" + project.id + "/history")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [project.id]);
  return (
    <div className="history-panel">
      <p className="muted">
        Restore a revision as a new save, or recover its drafts as copies.
        Existing saved history remains available.
      </p>
      {error && <p className="error">{error}</p>}
      <select
        aria-label="Project revision"
        value={snapshot?.revision || ""}
        onChange={async (e) => {
          const body = await api(
            "/projects/" + project.id + "/history/" + e.target.value,
          );
          setSnapshot({ revision: +e.target.value, body });
        }}
      >
        <option value="">Choose a saved revision</option>
        {rows.map((r) => (
          <option key={r.revision} value={r.revision}>
            Revision {r.revision} · {new Date(r.at).toLocaleString()}
          </option>
        ))}
      </select>
      {snapshot && (
        <>
          <p>
            {snapshot.body.clips.length} clips · {snapshot.body.drafts.length}{" "}
            drafts
          </p>
          {snapshot.body.drafts.map((d) => (
            <details key={d.id}>
              <summary>{d.name}</summary>
              <pre>{d.scenes.map((s) => s.text).join("\n")}</pre>
              <button
                onClick={() =>
                  update((p) => {
                    const copy = {
                      ...structuredClone(d),
                      id: uid(),
                      name: d.name + " · restored",
                      closed: false,
                      episodeId: p.episodeId,
                    };
                    p.drafts.push(copy);
                    p.activeDraftId = copy.id;
                  })
                }
              >
                <Copy size={14} /> Restore as new tab
              </button>
            </details>
          ))}
          <button
            onClick={() =>
              update((p) => {
                const currentFolder = p.folder;
                Object.assign(p, structuredClone(snapshot.body), {
                  folder: currentFolder,
                });
              })
            }
          >
            <RotateCcw size={14} /> Restore complete revision
          </button>
        </>
      )}
    </div>
  );
}
export function ExportProfile({ project, update, onExport }) {
  const issues = timelineIssues(project.clips);
  return (
    <div>
      <div className="details-grid">
        {[
          ["aspect", ["16:9", "9:16", "1:1", "4:5"]],
          ["resolution", ["480p", "720p", "1080p"]],
          ["fps", [24, 25, 30, 60]],
        ].map(([key, values]) => (
          <label className="field" key={key}>
            <span>{{ aspect: "Aspect ratio", resolution: "Resolution", fps: "Frame rate" }[key]}</span>
            <select
              aria-label={{ aspect: "Aspect ratio", resolution: "Resolution", fps: "Frame rate" }[key]}
              value={project.settings.export[key]}
              onChange={(e) =>
                update(
                  (p) =>
                    (p.settings.export[key] =
                      key === "fps" ? +e.target.value : e.target.value),
                )
              }
            >
              {values.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {issues.map((i, k) => (
        <p className="error" key={k}>
          {i.message}
        </p>
      ))}
      {issues.some((i) => i.code === "overlap") && (
        <button
          onClick={() =>
            update((p) => {
              let end = 0;
              p.clips
                .sort((a, b) => a.start - b.start)
                .forEach((c) => {
                  c.start = Math.max(end, c.start);
                  end = c.start + c.duration;
                });
            })
          }
        >
          Resolve overlaps by moving later clips
        </button>
      )}
      <p className="muted">
        H.264 / AAC MP4. Includes footage framing, animated elements, selected takes,
        trims, audio tracks and fades. Timeline notes stay in the editor.
      </p>
      <button className="primary" disabled={!!issues.length} onClick={onExport}>
        <Download size={15} /> Render episode locally
      </button>
    </div>
  );
}
export function TakeMismatch({ clip, take, onApply }) {
  const remaining = Math.max(0, take.duration - clip.in);
  return (
    <div>
      <p>
        This take has {remaining.toFixed(2)}s after the current source-in point.
        The timeline slot is {clip.duration.toFixed(2)}s.
      </p>
      <p className="muted">
        Choose how to adjust this clip. Other clips and fixed-time timeline notes will
        stay where they are.
      </p>
      <button
        disabled={remaining <= 0}
        onClick={() => onApply({ activeTake: take.id, duration: remaining })}
      >
        Use remaining footage · leave a gap
      </button>
      <button
        onClick={() =>
          onApply({
            activeTake: take.id,
            in: 0,
            duration: Math.min(clip.duration, take.duration),
          })
        }
      >
        Start at source beginning · fit available footage
      </button>
    </div>
  );
}
export function SettingsExtras({
  project,
  update,
  hideConcurrency = false,
  hideHistory = false,
}) {
  const [key, setKey] = useState(""),
    [provider, setProvider] = useState("venice"),
    [message, setMessage] = useState("");
  return (
    <>
      <h3>Template sections</h3>
      {Object.entries(project.settings.templates).map(([name, text]) => (
        <label className="field" key={name}>
          <span>{name}</span>
          <textarea
            value={text}
            onChange={(e) =>
              update((p) => (p.settings.templates[name] = e.target.value))
            }
          />
        </label>
      ))}
      {!hideHistory && (
        <>
          <button
            onClick={() =>
              update((p) =>
                p.settings.templateVersions.push({
                  id: uid(),
                  at: Date.now(),
                  systemPrompt: p.settings.systemPrompt,
                  templates: structuredClone(p.settings.templates),
                  automation: structuredClone(p.settings.automation),
                }),
              )
            }
          >
            Save template version
          </button>
          <details>
            <summary>
              Template history · {project.settings.templateVersions.length}
            </summary>
            {project.settings.templateVersions.map((v, i) => (
              <div className="history-entry" key={v.id}>
                <span>
                  Version {i + 1} · {new Date(v.at).toLocaleString()}
                </span>
                <button
                  onClick={() =>
                    update((p) => {
                      p.settings.systemPrompt = v.systemPrompt;
                      p.settings.templates = structuredClone(v.templates);
                      p.settings.automation = structuredClone(v.automation);
                    })
                  }
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            ))}
          </details>
        </>
      )}
      <label className="field">
        <span>Reusable dialogue deliveries · one per line</span>
        <textarea
          value={project.settings.deliveryPresets.join("\n")}
          onChange={(e) =>
            update(
              (p) => (p.settings.deliveryPresets = e.target.value.split("\n")),
            )
          }
        />
      </label>
      {!hideConcurrency && (
        <label className="field">
          <span>Concurrent jobs</span>
          <input
            type="number"
            min="1"
            max="12"
            value={project.settings.concurrency}
            onChange={(e) =>
              update(
                (p) =>
                  (p.settings.concurrency = Math.max(
                    1,
                    Math.min(12, +e.target.value),
                  )),
              )
            }
          />
        </label>
      )}
    </>
  );
}
export function JobRecovery({ job, onAction }) {
  const [recoveredId, setRecoveredId] = useState("");
  if (job.state === "submission_uncertain")
    return (
      <div className="job-recovery">
        <p className="error">
          Submission uncertain. Automatic resubmission is blocked.
        </p>
        {isLiveJob(job) ? (
          <label>
            Provider queue ID
            <input
              aria-label="Recover Provider queue ID"
              value={recoveredId}
              onChange={(e) => setRecoveredId(e.target.value)}
            />
          </label>
        ) : (
          <small>Accepted test job: {job.recoveryId}</small>
        )}
        <button
          onClick={() =>
            onAction("/jobs/" + job.id + "/recover", {
              providerJobId: isLiveJob(job) ? recoveredId : job.recoveryId,
            })
          }
        >
          Recover existing job ID
        </button>
      </div>
    );
  if (["download_failed", "rate_limited", "unreachable"].includes(job.state))
    return (
      <div className="job-recovery">
        <small>
          {job.error || "Retry scheduled; the original job ID is retained."}
        </small>
        {job.state === "download_failed" && (
          <button onClick={() => onAction("/jobs/" + job.id + "/retry", {})}>
            Retry file transfer only
          </button>
        )}
      </div>
    );
  return null;
}
export function QuoteSummary({ draft, projectId, onQuote, errorOnly = false }) {
  const [quote, setQuote] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setQuote(null);
    onQuote?.(null);
    const timer = setTimeout(
      () =>
        api("/projects/" + projectId + "/quote", {
          settings: draft.settings,
          quantity: draft.quantity,
          referenceIds: draft.referenceIds,
        })
          .then((q) => {
            if (active) {
              setQuote(q);
              setError("");
              onQuote?.(q);
            }
          })
          .catch((e) => {
            if (active) {
              setQuote(null);
              onQuote?.(null);
              setError(e.message);
            }
          }),
      200,
    );
    const refresh = setInterval(() => {
      if (active) {
        setQuote(null);
        onQuote?.(null);
        api("/projects/" + projectId + "/quote", {
          settings: draft.settings,
          quantity: draft.quantity,
        })
          .then((q) => {
            if (active) {
              setQuote(q);
              onQuote?.(q);
              setError("");
            }
          })
          .catch((e) => {
            if (active) setError(e.message);
          });
      }
    }, 240000);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(refresh);
    };
  }, [
    projectId,
    JSON.stringify(draft.settings),
    draft.quantity,
    JSON.stringify(draft.referenceIds),
  ]);
  if (errorOnly)
    return error ? (
      <small className="quote-error">Estimate unavailable · {error}</small>
    ) : null;
  return (
    <small className="quote-summary" title={quote?.note || undefined}>
      {quote
        ? `${quote.quantity} × ${quote.amount} ${quote.unit} · ${quote.type === "exact" ? "exact" : "estimate"} · ${new Date(quote.quotedAt).toLocaleTimeString()}`
        : error
          ? "Estimate unavailable · " + error
          : "Refreshing estimate…"}
      {quote?.basis === "historical" && (
        <span> · Historical average; final charge may differ</span>
      )}
    </small>
  );
}

export function GenerationComparison({ jobs, onReuse }) {
  const generations = jobs.filter((j) => j.kind === "generation");
  const [chosen, setChosen] = useState(() =>
    generations.slice(0, 2).map((j) => j.id),
  );
  const selected = generations.filter((j) => chosen.includes(j.id));
  return (
    <div className="generation-comparison">
      <div className="comparison-picker">
        {generations.map((j) => (
          <label key={j.id}>
            <input
              type="checkbox"
              checked={chosen.includes(j.id)}
              disabled={!chosen.includes(j.id) && chosen.length >= 4}
              onChange={(e) =>
                setChosen(
                  e.target.checked
                    ? [...chosen, j.id]
                    : chosen.filter((id) => id !== j.id),
                )
              }
            />
            <span>
              {j.snapshot.draft.name} · {j.snapshot.model} ·{" "}
              {new Date(j.createdAt).toLocaleTimeString()}
            </span>
          </label>
        ))}
      </div>
      <p className="muted">
        {selected.length} takes ·{" "}
        {selected.some((j) => isLiveJob(j))
          ? "Prices recorded per take; final charges are in your provider’s billing"
          : "No charge"}
      </p>
      <div className="comparison-grid">
        {selected.map((j) => (
          <article key={j.id}>
            {j.media ? (
              <video
                controls
                preload="none"
                poster={j.media.thumbnail}
                src={j.media.url}
              />
            ) : (
              <div className="frame-empty">{j.state}</div>
            )}
            <h3>{j.snapshot.model}</h3>
            <small>
              {j.snapshot.price?.amount} {j.snapshot.price?.unit} ·{" "}
              {j.actualCharge ? "charged" : "quoted; final charge not reported"}
            </small>
            <small>
              {Object.entries(j.snapshot.draft.settings)
                .filter(([k]) => k !== "model")
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </small>
            <p>
              {tc(j.snapshot.start)}–{tc(j.snapshot.end)} · {j.state}
            </p>
            <Button title="Reuse comparison prompt" onClick={() => onReuse(j)}>
              <Copy size={14} />
            </Button>
            <details>
              <summary>Exact prompt & references</summary>
              <pre className="exact-prompt">{j.snapshot.compiled.text}</pre>
              {j.snapshot.compiled.references.map((r) => (
                <p key={r.id}>
                  {r.name} · v{r.version || 1} ·{" "}
                  {r.selectedVariant?.name || "Base appearance"}
                </p>
              ))}
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
