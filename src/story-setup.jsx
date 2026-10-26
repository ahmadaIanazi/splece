import {
  CanvasReferences,
  canvasImage,
  canvasBindingImage,
} from "./canvas-references.jsx";
import { reconcileGraph, fallbackEntities } from "../shared/scene-graph.mjs";
import { useSceneWorkers } from "./director-scene-workers.jsx";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  ChevronDown,
  Download,
  FlipHorizontal2,
  Globe2,
  Images,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  Mic,
  MicOff,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import {
  deskFormats,
  durationText,
  normalizeDesk,
  deskSetupPatch,
  deskPrompt,
  deskRecipeCard,
  restoreDeskSetup,
  deskNudges,
  shotPlan,
  factFields,
  palettes,
  mergeSetupDecision,
  setupAssistantContext,
} from "../shared/director-desk.mjs";

import {
  Fader,
  SunArc,
  PaletteWheel,
  CameraRig,
} from "./director-controls.jsx";
import { Storyboard } from "./director-preview.jsx";
import { useDeskAssistant } from "./director-assistant.jsx";
import "./director-desk.css";
import { LookExplorer } from "./director-look.jsx";
import { directedControls, sceneForDesk } from "../shared/scene-sketch.mjs";

const download = (name, text, type = "text/plain") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function StorySetup({
  project,
  projectId,
  plan,
  assets = [],
  edit,
  prepare,
  busy,
  onLibrary,
  onDone,
  assistantPanel,
  assistant,
  update,
  models = [],
}) {
  const s = { concept: "", castIds: [], assetIds: [], ...plan.setup };
  const saved = normalizeDesk(s.directorDesk, s),
    [preview, setPreview] = useState({});
  const d = { ...saved, ...preview };
  const seconds = s.targetDuration ?? d.suggestedDuration;
  const [error, setError] = useState(""),
    [flipped, setFlipped] = useState(false),
    [active, setActive] = useState("look"),
    [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const [editingFact, setEditingFact] = useState(null),
    [rtl, setRtl] = useState(() =>
      /^[^\p{L}]*[\u0600-\u06ff]/u.test(s.concept),
    ),
    [listening, setListening] = useState(false),
    [castOpen, setCastOpen] = useState(false),
    [feedback, setFeedback] = useState("");
  const undoStack = useRef([]),
    [undoCount, setUndoCount] = useState(0),
    speech = useRef(null),
    latest = useRef(),
    rtlManual = useRef(false);
  latest.current = { s, d, saved, edit, seconds };
  useEffect(() => {
    if (!rtlManual.current)
      setRtl(/^[^\p{L}]*[\u0600-\u06ff]/u.test(s.concept));
  }, [s.concept]);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const fn = () => {
      setReduced(mq.matches);
    };
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  useEffect(() => {
    return () => {
      speech.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(""), 4000);
    return () => clearTimeout(t);
  }, [feedback]);
  const change = (patch) =>
    edit((next) => {
      next.setup = { ...next.setup, ...patch };
    });
  const remember = () => {
    undoStack.current = [
      ...undoStack.current.slice(-29),
      structuredClone(latest.current.s),
    ];
    setUndoCount(undoStack.current.length);
  };
  const commit = (patch, record = true, protect = true) => {
    const current = latest.current.saved;
    if (
      patch.scene &&
      ["subject", "setting", "count"].some(
        (k) => patch.scene[k] !== current.scene?.[k],
      )
    ) {
      const candidates = fallbackEntities(patch.scene);
      const roles = new Set(
        ["subject", "count"].some((k) => patch.scene[k] !== current.scene?.[k])
          ? ["subject"]
          : [],
      );
      if (patch.scene.setting !== current.scene?.setting)
        roles.add("environment");
      patch = {
        ...patch,
        sceneGraph: reconcileGraph(current.sceneGraph, [
          ...current.sceneGraph.nodes.filter((n) => !roles.has(n.role)),
          ...candidates.filter((n) => roles.has(n.role)),
        ]),
      };
    }
    const next = normalizeDesk(
      {
        ...current,
        ...latest.current.d,
        ...patch,
        manualControls: patch.manualControls || [
          ...new Set([
            ...current.manualControls,
            ...(protect
              ? directedControls.filter((k) => Object.hasOwn(patch, k))
              : []),
            ...(Object.hasOwn(patch, "palette") ? ["customColors"] : []),
          ]),
        ],
        ...(Object.hasOwn(patch, "palette") &&
        !Object.hasOwn(patch, "customColors")
          ? { customColors: [] }
          : {}),
      },
      latest.current.s,
    );
    setPreview({});
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    if (record) remember();
    change(deskSetupPatch(next, latest.current.s));
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setPreview({});
    edit((next) => {
      next.setup = restoreDeskSetup(next.setup, prev);
    });
    setUndoCount(undoStack.current.length);
    setFeedback("Last desk change undone");
  };
  const facts = useDeskAssistant({
    project,
    assistant,
    update,
    paused: busy || castOpen,
    onFacts: (result) => {
      if (
        !latest.current.saved.autoDirection ||
        assistant?.status?.enabled !== true
      )
        return;
      const context = setupAssistantContext(project);
      const next = mergeSetupDecision(latest.current.saved, result, context);
      if (JSON.stringify(next) === JSON.stringify(latest.current.saved)) return;
      update(
        (p) => {
          const setup = p.storyPlans[p.episodeId].setup;
          const current = normalizeDesk(setup.directorDesk, setup);
          Object.assign(
            setup,
            deskSetupPatch(
              mergeSetupDecision(current, result, setupAssistantContext(p)),
              setup,
            ),
          );
        },
        false,
        false,
        "assistant",
      );
    },
  });

  const workers = useSceneWorkers({
    project,
    assistant,
    update,
    paused: busy || castOpen || facts.working || !facts.fresh,
  });

  const setFact = (key, value) =>
    commit({
      facts: { ...d.facts, [key]: value },
      manualFacts: [...new Set([...d.manualFacts, key])],
    });
  const dictate = () => {
    if (listening) {
      speech.current?.stop();
      return;
    }
    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError(
        "Dictation is unavailable in this browser. You can use your device’s keyboard dictation.",
      );
      return;
    }
    try {
      const rec = new Recognition();
      speech.current = rec;
      rec.lang = /arabic|عربي/i.test(d.facts.language) ? "ar-SA" : "en-US";
      rec.interimResults = false;
      rec.onresult = (e) => {
        const words = Array.from(e.results)
          .filter((r) => r.isFinal)
          .map((r) => r[0].transcript)
          .join(" ");
        change({
          concept: [latest.current.s.concept, words].filter(Boolean).join(" "),
        });
      };
      rec.onerror = (e) => {
        setError(`Dictation stopped (${e.error}). Your writing is saved.`);
        setListening(false);
      };
      rec.onend = () => setListening(false);
      rec.start();
      setListening(true);
    } catch (e) {
      setError(e.message);
    }
  };
  const selectedIds = [...s.castIds, ...s.assetIds],
    references = assets.filter((a) => selectedIds.includes(a.id));
  const pinAsset = (id, x = 50, y = 50) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) {
      setError("Add this reference to your project from the Library first.");
      return;
    }
    remember();
    const nextPins = [...d.pins.filter((p) => p.id !== id), { id, x, y }];
    change({
      ...deskSetupPatch({ ...d, pins: nextPins }, s),
      [asset.kind === "character" ? "castIds" : "assetIds"]: [
        ...new Set([
          ...(asset.kind === "character" ? s.castIds : s.assetIds),
          id,
        ]),
      ],
    });
  };
  const model = models.find((m) => m.id === d.modelId),
    shots = shotPlan(seconds, model),
    assembled = deskPrompt(
      { ...s, targetDuration: seconds, directorDesk: d },
      assets,
      { model },
    );
  const create = async () => {
    setError("");
    try {
      change({
        ...deskSetupPatch(d, s),
        targetDuration: seconds,
        complete: true,
      });
      const result = await prepare(null, "outline");
      if (result === false) {
        change({ complete: false });
        setError(
          "The outline could not start. Your idea and desk settings are saved. Try again.",
        );
        return;
      }
      onDone?.();
    } catch (e) {
      change({ complete: false });
      setError(e.message);
    }
  };
  const copyRecipe = () => {
    download(
      "splece-recipe.svg",
      deskRecipeCard({ ...s, targetDuration: seconds, directorDesk: d }),
      "image/svg+xml",
    );
    setFeedback("Recipe saved · settings only, no writing or private media");
  };
  const controls = (label, key, ends) => (
    <Fader
      label={label}
      value={d[key]}
      max={key === "turn" ? 360 : 100}
      unit={key === "turn" ? "°" : "%"}
      ends={ends}
      onPreview={(v) => setPreview((p) => ({ ...p, [key]: v }))}
      onCommit={(v) => commit({ [key]: v })}
    />
  );
  const panelProps = {
    desk: { ...d, previewScene: sceneForDesk(d, s.concept) },
    onPreview: (patch) => setPreview((p) => ({ ...p, ...patch })),
    onCommit: commit,
  };
  return (
    <section
      className="director-desk canvas-desk"
      dir={rtl ? "rtl" : "ltr"}
      aria-label="Creative canvas"
      aria-busy={busy}
      data-reduced-motion={reduced}
    >
      <header className="desk-heading">
        <div>
          <span className="desk-eyebrow">YOUR NEXT IDEA</span>
          <h1>Make a little world.</h1>
        </div>
        <div className="desk-heading-actions">
          <button
            type="button"
            className="desk-icon"
            aria-label="Undo canvas change"
            disabled={!undoCount}
            onClick={undo}
          >
            <RotateCcw size={17} />
          </button>
          <button
            type="button"
            className="desk-quiet"
            onClick={() => {
              change({ complete: true });
              onDone?.();
            }}
          >
            {plan.beats.length ? "Back to story" : "Start blank"}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={create}
          >
            {busy ? (
              <LoaderCircle size={16} className="structure-spin" />
            ) : (
              <ArrowRight size={16} />
            )}{" "}
            {busy
              ? "Developing…"
              : plan.beats.length
                ? "Update outline"
                : "Create outline"}
          </button>
        </div>
      </header>
      <div className="canvas-workbench">
        <main className="canvas-main">
          <Storyboard
            desk={d}
            concept={s.concept}
            updating={facts.working}
            workers={workers}
            onPreview={setPreview}
            onCommit={commit}
            imageReferences={Object.fromEntries(
              Object.entries(d.referenceBindings)
                .map(([id, assetId]) => [id, canvasBindingImage(d, assets, id)])
                .filter(([, url]) => url),
            )}
            sceneImage={canvasBindingImage(d, assets, "$scene")}
          />
          <section className="desk-idea canvas-writing">
            <div className="desk-section-label">
              <label htmlFor="desk-idea">Describe it. See it take shape.</label>
              <div className="canvas-writing-actions">
                <button
                  type="button"
                  role="switch"
                  className="canvas-auto-switch"
                  aria-label="Auto direction"
                  aria-checked={d.autoDirection && !!assistant?.status?.enabled}
                  onClick={() => {
                    const enabled = !(
                      d.autoDirection && assistant?.status?.enabled
                    );
                    commit({ autoDirection: enabled });
                    if (enabled && !assistant?.status?.enabled)
                      assistant?.configure({
                        enabled: true,
                        writingSuggestions: true,
                      });
                  }}
                >
                  <Sparkles size={14} />
                  <span>
                    {d.autoDirection && assistant?.status?.enabled
                      ? "Following"
                      : "Paused"}
                  </span>
                  <i />
                </button>
                <button
                  type="button"
                  aria-label={listening ? "Stop dictation" : "Dictate idea"}
                  title="Browser dictation may use your device’s speech service"
                  onClick={dictate}
                >
                  {listening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              </div>
            </div>
            <textarea
              id="desk-idea"
              dir="auto"
              value={s.concept}
              onChange={(e) => change({ concept: e.target.value })}
              rows={4}
              placeholder="A floating hostel in Bali. Neon-pastel nights. A zombie selling ice cream. Nothing is too strange…"
            />
            {facts.notice && (
              <div className="desk-idea-status" role="status">
                <span>{facts.notice}</span>
                <button
                  type="button"
                  onClick={facts.check}
                  disabled={busy || !d.autoDirection}
                >
                  Try again
                </button>
              </div>
            )}
          </section>
          <div className="canvas-bottom-controls">
            <section
              className="canvas-format-picker"
              aria-label="Format suggestions"
            >
              <header>
                <small>
                  {d.formatManual ? "Your format" : "Suggested format"}
                </small>
                {d.formatManual && (
                  <button
                    type="button"
                    onClick={() =>
                      commit(
                        {
                          formatManual: false,
                          formatLabel: d.formatIdeas[0]?.label || d.formatLabel,
                        },
                        true,
                        false,
                      )
                    }
                  >
                    Auto
                  </button>
                )}
              </header>
              <div className="canvas-format-list">
                {(d.formatIdeas.length
                  ? d.formatIdeas
                  : deskFormats.map((f) => ({
                      label: f.label,
                      aspect: f.id === "social" ? "9:16" : "16:9",
                      duration: f.duration,
                    }))
                ).map((f) => (
                  <button
                    type="button"
                    key={f.label}
                    aria-pressed={d.formatLabel === f.label}
                    onClick={() =>
                      commit({
                        formatLabel: f.label,
                        formatManual: true,
                        ...(!d.aspectManual ? { aspect: f.aspect } : {}),
                        ...(!d.durationManual
                          ? { suggestedDuration: f.duration }
                          : {}),
                      })
                    }
                  >
                    <span>{f.label}</span>
                    <small>
                      {f.aspect} · {durationText(f.duration)}
                    </small>
                  </button>
                ))}
              </div>
              <input
                aria-label="Your own format"
                placeholder="Or invent your own…"
                value={d.formatManual ? d.formatLabel : ""}
                onChange={(e) =>
                  commit({ formatLabel: e.target.value, formatManual: true })
                }
              />
            </section>
            <div className="canvas-length-aspect">
              <label>
                Length{" "}
                <span className="canvas-length-input">
                  <input
                    type="number"
                    aria-label="Planned duration in seconds"
                    min="1"
                    max="7200"
                    value={seconds}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 1 && v <= 7200) {
                        remember();
                        change({
                          targetDuration: v,
                          durationSkipped: false,
                          directorDesk: normalizeDesk(
                            {
                              ...d,
                              durationManual: true,
                              suggestedDuration: v,
                            },
                            s,
                          ),
                        });
                      }
                    }}
                  />
                  <small>sec</small>
                </span>
              </label>
              <button
                type="button"
                aria-pressed={!d.durationManual}
                onClick={() =>
                  commit(
                    {
                      durationManual: false,
                      suggestedDuration: d.formatIdeas[0]?.duration || 30,
                    },
                    true,
                    false,
                  )
                }
              >
                Auto length
              </button>
              <small>
                ≈ {shots.count} short {shots.count === 1 ? "shot" : "shots"}
              </small>
              <div className="canvas-ratios" aria-label="Canvas aspect ratio">
                {["16:9", "9:16", "1:1"].map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={d.aspect === r}
                    aria-label={`Canvas ${r}`}
                    onClick={() => commit({ aspect: r, aspectManual: true })}
                  >
                    <i style={{ aspectRatio: r.replace(":", "/") }} />
                    {r}
                  </button>
                ))}
              </div>
              {d.aspectManual && (
                <button
                  type="button"
                  onClick={() =>
                    commit(
                      {
                        aspectManual: false,
                        aspect: d.formatIdeas[0]?.aspect || "16:9",
                      },
                      true,
                      false,
                    )
                  }
                >
                  Auto aspect
                </button>
              )}
            </div>
          </div>
          <footer className="canvas-quiet-footer">
            <small>
              {assistant?.status?.mode === "live"
                ? "Online · sketches use Assistant credits"
                : "Offline · no credits"}{" "}
              · No video generation
            </small>
            <button
              type="button"
              aria-pressed={rtl}
              onClick={() => {
                rtlManual.current = true;
                setRtl((v) => !v);
              }}
            >
              العربية · RTL
            </button>
          </footer>
        </main>
        <aside className="canvas-recipe" aria-label="Your recipe">
          <header>
            <h2>Your recipe</h2>
            <button
              type="button"
              aria-label="Flip to assembled prompt"
              aria-pressed={flipped}
              onClick={() => setFlipped((v) => !v)}
            >
              <FlipHorizontal2 size={17} />
            </button>
          </header>
          {flipped ? (
            <div className="canvas-prompt">
              <p dir="auto">{s.concept}</p>
              <p className="desk-assembled" dir="auto">
                {assembled}
              </p>
              <button type="button" onClick={copyRecipe}>
                <Download size={14} /> Save recipe
              </button>
            </div>
          ) : (
            <>
              <div className="canvas-treatment">
                <div className="canvas-swatches">
                  {(d.customColors.length
                    ? d.customColors
                    : palettes.find((p) => p.id === d.palette).colors
                  ).map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                </div>
                <strong>
                  {d.lookText ||
                    d.scene?.style ||
                    "A world shaped by your words"}
                </strong>
                <small>
                  {d.light} ·{" "}
                  {d.energy > 65
                    ? "Lively"
                    : d.energy < 35
                      ? "Calm"
                      : "Balanced"}
                </small>
              </div>
              <div
                className="desk-facts canvas-captured"
                aria-label="Captured details"
              >
                {Object.entries(d.facts)
                  .filter(([, v]) => v)
                  .map(([key, value]) => (
                    <button
                      key={key}
                      type="button"
                      aria-expanded={editingFact === key}
                      onClick={() =>
                        setEditingFact(editingFact === key ? null : key)
                      }
                    >
                      <small>{factFields[key]}</small>
                      <span>{value}</span>
                      {d.manualFacts.includes(key) && <LockKeyhole size={11} />}
                    </button>
                  ))}
              </div>
              {editingFact && (
                <label className="canvas-edit-fact">
                  {factFields[editingFact]}
                  <input
                    autoFocus
                    value={d.facts[editingFact]}
                    dir="auto"
                    onChange={(e) => setFact(editingFact, e.target.value)}
                    onKeyDown={(e) => {
                      if (["Enter", "Escape"].includes(e.key))
                        setEditingFact(null);
                    }}
                  />
                  <button type="button" onClick={() => setEditingFact(null)}>
                    Done
                  </button>
                </label>
              )}
              <CanvasReferences
                mode={workers.mode}
                desk={d}
                concept={s.concept}
                project={project}
                update={update}
                flush={assistant?.flush}
                commit={commit}
                onOpenChange={setCastOpen}
              />
              <button
                type="button"
                className="canvas-library-link"
                onClick={onLibrary}
              >
                <Images size={15} /> Add from Library
              </button>
              {!!references.length && (
                <div className="canvas-attached">
                  {references.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      title={a.name}
                      aria-label={`Use reference ${a.name}`}
                      onClick={() => pinAsset(a.id)}
                    >
                      {canvasImage(a) ? (
                        <img src={canvasImage(a)} alt="" />
                      ) : (
                        <Images size={16} />
                      )}
                      <span>{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <details className="canvas-adjustments">
                <summary>
                  <SlidersHorizontal size={16} /> Adjust the feel{" "}
                  <ChevronDown size={14} />
                </summary>
                <nav
                  className="desk-control-tabs"
                  aria-label="Canvas adjustments"
                >
                  {[
                    ["look", "Look", Palette],
                    ["light", "Light", Sun],
                    ["camera", "Camera", Camera],
                    ["world", "World", Globe2],
                  ].map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active === id}
                      onClick={() => setActive(id)}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </nav>
                {active === "look" && (
                  <>
                    <LookExplorer
                      desk={d}
                      concept={s.concept}
                      onCommit={(patch) => commit(patch, true, false)}
                    />
                    <PaletteWheel desk={d} onCommit={commit} />
                    {controls("Vividness", "saturation", ["Pastel", "Vivid"])}
                    {controls("Realism", "realism", ["Illustrated", "Real"])}
                  </>
                )}
                {active === "light" && (
                  <>
                    <SunArc {...panelProps} />
                    <div className="canvas-light-presets">
                      {[
                        "daylight",
                        "golden",
                        "studio",
                        "rim",
                        "neon",
                        "silhouette",
                      ].map((light) => (
                        <button
                          type="button"
                          key={light}
                          aria-pressed={d.light === light}
                          onClick={() => commit({ light })}
                        >
                          {light[0].toUpperCase() + light.slice(1)}
                        </button>
                      ))}
                    </div>
                    {controls("Softness", "softness", ["Crisp", "Soft"])}
                  </>
                )}
                {active === "camera" && (
                  <>
                    <CameraRig {...panelProps} />
                    {controls("Camera orbit", "orbit", ["Left", "Right"])}
                    {controls("Camera angle", "angle", ["Above", "Below"])}
                  </>
                )}
                {active === "world" && (
                  <>
                    {[
                      "region",
                      "language",
                      "accent",
                      "wardrobe",
                      "audience",
                    ].map((key) => (
                      <label key={key}>
                        {factFields[key]}
                        <input
                          value={d.facts[key]}
                          onChange={(e) => setFact(key, e.target.value)}
                          dir="auto"
                        />
                      </label>
                    ))}
                    {controls("Dialogue", "dialogue", ["Silent", "Talkative"])}
                  </>
                )}
                {!!d.manualControls.length && (
                  <button
                    type="button"
                    onClick={() => {
                      const context = setupAssistantContext(project),
                        receipt = project.setupAssistantReview;
                      const unlocked = normalizeDesk({
                        ...d,
                        manualControls: [],
                        manualScene: [],
                      });
                      commit(
                        receipt?.fingerprint === JSON.stringify(context) &&
                          receipt.decision
                          ? mergeSetupDecision(
                              unlocked,
                              receipt.decision,
                              context,
                            )
                          : unlocked,
                        true,
                        false,
                      );
                    }}
                  >
                    <LockKeyhole size={13} /> Release my direction choices
                  </button>
                )}
              </details>
              {deskNudges(d).map((n) => (
                <div key={n.id} className="desk-nudge">
                  <Lightbulb size={15} />
                  <span>{n.text}</span>
                  <button type="button" onClick={() => commit(n.patch)}>
                    {n.action}
                  </button>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
      {error && (
        <div className="desk-error" role="alert">
          {error}
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {feedback && (
        <div className="desk-feedback" role="status">
          {feedback}
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => setFeedback("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </section>
  );
}
