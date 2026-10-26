import { DialogueStream } from "./dialogue-stream";
import { ProviderAction } from "./provider-connect";
import { hasComposerWriting } from "../shared/composer-sequence.mjs";
import { FrameGenerator } from "./frame-generator";
import { boundaryPreview } from "./frame-controls";
import { RecoveryBoundary } from "./recovery-boundary";
import { ClipContinuityEditor } from "./clip-continuity";
import { shotDefaults } from "../shared/shot-direction.mjs";
import {
  ComposerAssets,
  ModelBrowser,
  ShotDirection,
  HoldGenerate,
  InjectionSwitches,
  Toggle,
} from "./composer-tools";
import { modelTitle } from "../shared/composer-presentation.mjs";
import React, { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import {
  Images,
  Sparkles,
  SquareCode,
  ArrowLeft,
  Plus,
  X,
  SlidersHorizontal,
  ChevronDown,
  FileText,
  Clock3,
  MoveHorizontal,
  Star,
  ChevronUp,
  Check,
} from "lucide-react";
import { MentionInput } from "./mentions";
import { PromptHeading } from "./prompt-navigation";
import { usePromptOptimizer, OptimizerStatus } from "./prompt-optimizer";
import { JsonComposer } from "./authoring";
import { FrameControls, PreparedEditor, QuoteSummary } from "./advanced";
import { automationLabels } from "./components";
import { api, uid, tc } from "./state";
import {
  insertComposerReference,
  supportedComposerDuration,
} from "../shared/composer-writing.mjs";

function Tool({ icon: Glyph, label, children, ...props }) {
  return (
    <button type="button" title={label} aria-label={label} {...props}>
      <Glyph size={16} />
      {children}
    </button>
  );
}
function Prose(props) {
  return <MentionInput autoGrow {...props} />;
}

function Companion({ anchor, title, onClose, children }) {
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(380, window.innerWidth - 24),
        fits = window.innerWidth - r.right > width + 24;
      setPosition({
        left: fits ? r.right + 12 : Math.max(12, r.left),
        top: Math.max(12, r.top),
        width: fits ? width : Math.min(width, r.width),
        height: Math.max(
          220,
          Math.min(r.height, window.innerHeight - r.top - 16),
        ),
      });
    };
    place();
    const ro = new ResizeObserver(place);
    if (anchor.current) ro.observe(anchor.current);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);
  return createPortal(
    <aside
      className="composer-companion"
      aria-label={title}
      style={position || { visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <b>{title}</b>
        <Tool icon={X} label={`Close ${title}`} onClick={onClose} />
      </header>
      <div className="companion-body">{children}</div>
    </aside>,
    document.body,
  );
}

const LazyPromptLibrary = lazy(() => import("./prompt-library").then(m => ({ default: m.PromptLibrary })));

export function CreativeComposer({
  project: p,
  draft,
  models,
  model,
  prepared,
  validation,
  effective,
  editDraft,
  update,
  flush,
  view,
  setView,
  time,
  plannedLength,
  onDuration,
  onSelect,
  onVariant,
  onRename,
  onClose,
  onNode,
  openAssets,
  compatibleModels,
  changeModel,
  saveVideoDefaults,
  videoDefaults,
  videoMode,
  quote,
  setQuote,
  catalogTick,
  submitting,
  visible = true,
  generate,
  holdToGenerate = true,
  modelFavorites = [],
  onFavoriteModel,
  assistant,
}) {
  const root = useRef(null),
    canvas = useRef(null),
    cursor = useRef(null);
  const frameUploadInput = useRef(null), frameUploadTarget = useRef(null), frameUploadLock = useRef(false), composerAlive = useRef(true), currentFrameDraft = useRef(null);
  currentFrameDraft.current = { draftId: draft.id, projectId: p.id };
  useEffect(() => {
    composerAlive.current = true;
    return () => { composerAlive.current = false; };
  }, []);
  const [frameUploading, setFrameUploading] = useState(false);
  async function importBoundaryImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const target = frameUploadTarget.current;
    frameUploadTarget.current = null;
    if (!file || !target || frameUploadLock.current) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setLibraryError("Choose a JPG, PNG or WebP image.");
      return;
    }
    const stillCurrent = () => composerAlive.current && currentFrameDraft.current?.draftId === target.draftId && currentFrameDraft.current?.projectId === target.projectId;
    frameUploadLock.current = true;
    setFrameUploading(true);
    setLibraryError("");
    try {
      await flush?.();
      if (!stillCurrent()) return;
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${target.projectId}/import`, { method: "POST", body: form });
      const media = await response.json();
      if (!response.ok) throw Error(media.error || "Could not import this image.");
      if (media.kind !== "image") throw Error("Choose an image for this frame.");
      if (stillCurrent()) target.onUse(media);
    } catch (error) {
      if (stillCurrent()) setLibraryError(error.message);
    } finally {
      frameUploadLock.current = false;
      if (composerAlive.current) setFrameUploading(false);
    }
  }
  const [activeScene, setActiveScene] = useState(draft.scenes[0]?.id),
    [camera, setCamera] = useState(null),
    [settingsOpen, setSettingsOpen] = useState(false),
    [query, setQuery] = useState(""),
    [reviewTab, setReviewTab] = useState("text"),
    [tuningTab, setTuningTab] = useState("context"),
    [libraryError, setLibraryError] = useState("");
  const reverse = ["prepared", "json"].includes(view),
    panel = [
      "references",
      "recipes",
      "context",
      "start",
      "end",
      "models",
    ].includes(view)
      ? view
      : null;
  const optimizer = usePromptOptimizer({ project: p, draft, model, executionMode: videoMode, flush });
  const attached = p.assets.filter((a) => draft.referenceIds.includes(a.id));
  const currentScene =
    draft.scenes.find((s) => s.id === activeScene) || draft.scenes[0];
  const durations = [
      ...new Set((model?.durations || []).map(Number).filter((n) => n > 0)),
    ].sort((a, b) => a - b),
    max = durations.at(-1) || draft.settings.duration || 10;
  const imageCount =
    prepared.references?.reduce(
      (n, r) => n + (r.selectedMediaList?.length || (r.selectedMedia ? 1 : 0)),
      0,
    ) || 0;
  const quoteCurrent =
    quote && JSON.stringify(quote.settings) === JSON.stringify(draft.settings);
  const unavailable = !compatibleModels.some(
    (m) => m.id === draft.settings.model,
  );
  const empty = !draft.scenes.some(hasComposerWriting);
  const blocked =
    submitting ||
    optimizer.busy ||
    (draft.optimizeOnGenerate && optimizer.disabled) ||
    unavailable ||
    empty ||
    !!validation.errors.length ||
    (videoMode === "venice" &&
      (!quoteCurrent || Date.now() - quote.quotedAt > 300000));
  const price =
    videoMode === "demo"
      ? "0 credits"
      : quoteCurrent
        ? `${(quote.amount * (draft.quantity || 1)).toFixed(2)} USD`
        : "Estimating…";
  const problem = validation.errors.length
    ? `${validation.errors.length} issue${validation.errors.length === 1 ? "" : "s"} to review`
    : unavailable
      ? "Choose a compatible model"
      : empty
        ? "Add a moment to begin"
        : null;
  const closePanel = () => setView("compose");
  const togglePanel = (next) => {
    setSettingsOpen(false);
    setCamera(null);
    setView(view === next ? "compose" : next);
  };
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const remember = (e) => {
      const beat = e.target.closest("[data-scene-id]");
      if (beat) {
        setActiveScene(beat.dataset.sceneId);
        if (e.target.matches('textarea[aria-label$="description"]'))
          cursor.current = {
            sceneId: beat.dataset.sceneId,
            start: e.target.selectionStart,
            end: e.target.selectionEnd,
          };
      }
    };
    el.addEventListener("keyup", remember);
    el.addEventListener("mouseup", remember);
    el.addEventListener("input", remember);
    return () => {
      el.removeEventListener("keyup", remember);
      el.removeEventListener("mouseup", remember);
      el.removeEventListener("input", remember);
    };
  }, []);
  const attach = (a) =>
    editDraft((d) => {
      if (!d.referenceIds.includes(a.id)) d.referenceIds.push(a.id);
    });
  const adoptSharedAsset = async (libraryId, sceneId = currentScene?.id) => {
    await flush();
    const asset = await api(`/projects/${p.id}/library/adopt`, { libraryId });
    update((n) => {
      if (!n.assets.some((a) => a.id === asset.id)) n.assets.push(asset);
      const d = n.drafts.find((d) => d.id === draft.id);
      if (sceneId) insertComposerReference(d, sceneId, asset);
      else if (!d.referenceIds.includes(asset.id))
        d.referenceIds.push(asset.id);
    });
  };
  const insertAsset = (id, sceneId = currentScene?.id, range) => {
    const asset = p.assets.find((a) => a.id === id);
    if (!asset) return;
    if (!sceneId) {
      attach(asset);
      return;
    }
    const insertion =
      range || (cursor.current?.sceneId === sceneId ? cursor.current : null);
    editDraft((d) => insertComposerReference(d, sceneId, asset, insertion));
    cursor.current = null;
  };
  function addShot() {
    const id = uid();
    editDraft((d) => {
      const i = d.scenes.findIndex((s) => s.id === currentScene?.id);
      d.scenes.splice(i < 0 ? d.scenes.length : i + 1, 0, {
        id,
        text: "",
        ...shotDefaults,
        dialogue: [],
      });
    });
    setActiveScene(id);
    requestAnimationFrame(() => root.current?.querySelector('[aria-label="New moment"]')?.focus());
  }
  return (
    <div
      className={`creative-composer dialogue-first ${reverse ? "is-reversed" : ""}`}
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && (settingsOpen || panel || reverse)) {
          e.stopPropagation();
          setSettingsOpen(false);
          closePanel();
        }
      }}
    >
      <input ref={frameUploadInput} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden aria-label="Upload continuity frame" onChange={importBoundaryImage} />
      <PromptHeading
        project={p}
        draft={draft}
        onSelect={onSelect}
        onVariant={onVariant}
        onRename={onRename}
        onClose={onClose}
        onNode={onNode}
        onContext={() => togglePanel("context")}
        contextOpen={panel === "context"}
        tools={
          <Tool
            icon={reverse ? ArrowLeft : SquareCode}
            label={reverse ? "Back to writing" : "Under the hood"}
            aria-pressed={reverse}
            onClick={() => {
              setSettingsOpen(false);
              setCamera(null);
              setView(reverse ? "compose" : "prepared");
            }}
          />
        }
      />
      {libraryError && (
        <p role="alert" className="error">
          {libraryError}
        </p>
      )}
      <div className="creative-work" hidden={reverse}>
        <div
          className={`creative-writing ${optimizer.busy ? "is-optimizing" : ""}`}
          aria-busy={optimizer.busy}
          inert={optimizer.busy ? true : undefined}
          ref={canvas}
          aria-label="Clip writing canvas"
          onDragOver={(e) => {
            if (
              e.dataTransfer.types.some((type) =>
                ["asset", "library-asset"].includes(type),
              )
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const libraryId = e.dataTransfer.getData("library-asset");
            if (libraryId) {
              e.preventDefault();
              e.stopPropagation();
              setLibraryError("");
              adoptSharedAsset(libraryId).catch((error) =>
                setLibraryError(error.message),
              );
              return;
            }
            const id = e.dataTransfer.getData("asset");
            if (id) {
              e.preventDefault();
              e.stopPropagation();
              insertAsset(id);
            }
          }}
        >
          {draft.repair && (
            <div className="canvas-repair">
              <b>
                Repair {tc(draft.repair.from)}–{tc(draft.repair.to)}
              </b>
              <Prose
                aria-label="Repair instructions"
                placeholder="What needs fixing?"
                value={draft.repairInstructions || ""}
                onChange={(e) =>
                  editDraft((d) => (d.repairInstructions = e.target.value))
                }
              />
            </div>
          )}
          <DialogueStream
            key={draft.id}
            draft={draft}
            scene={currentScene}
            assets={attached}
            allAssets={p.assets}
            presets={p.settings.deliveryPresets}
            editDraft={editDraft}
            onSelect={(id) => { setActiveScene(id); setCamera(null); }}
            onAddShot={addShot}
            onAssets={() => togglePanel("references")}
            onLibrary={() => togglePanel("recipes")}
            onMention={attach}
            onDropAsset={insertAsset}
            onCursor={(range) => { cursor.current = { sceneId: currentScene?.id, ...range }; }}
            cameraOpen={camera === currentScene?.id}
            onCamera={() => { setCamera(camera === currentScene?.id ? null : currentScene?.id); }}
            assistant={assistant}
            directionEditor={currentScene && <ShotDirection
              key={currentScene.id}
              scene={currentScene}
              index={draft.scenes.findIndex(scene => scene.id === currentScene.id)}
              count={draft.scenes.length}
              assets={attached}
              change={fn => editDraft(next => fn(next.scenes.find(scene => scene.id === currentScene.id)))}
              move={delta => editDraft(next => { const from = next.scenes.findIndex(scene => scene.id === currentScene.id); next.scenes.splice(from + delta, 0, next.scenes.splice(from, 1)[0]); })}
            />}
          />
          {draft.smartAccepted && (
            <button
              className="canvas-reviewed"
              onClick={() => setView("prepared")}
            >
              <Check size={13} />
              Reviewed AI prompt is active
            </button>
          )}
        </div>

      </div>
      {!reverse && draft.optimizeOnGenerate && <OptimizerStatus optimizer={optimizer} draft={draft} modelName={modelTitle(model)} change={editDraft} />}
      {reverse && (
        <div className="creative-review">
          <nav aria-label="Under the hood views">
            <button
              aria-pressed={view !== "json" && reviewTab === "text"}
              onClick={() => {
                setReviewTab("text");
                setView("prepared");
              }}
            >
              Final prompt
            </button>
            <button
              aria-pressed={view !== "json" && reviewTab === "sources"}
              onClick={() => {
                setReviewTab("sources");
                setView("prepared");
              }}
            >
              Injections
            </button>
            <button
              aria-pressed={view === "json"}
              onClick={() => setView("json")}
            >
              JSON
            </button>
          </nav>
          <div className="creative-review-scroll">
            {view === "json" ? (
              <JsonComposer
                project={p}
                draft={draft}
                prepared={prepared}
                models={models}
                update={update}
                onOpen={(d) => {
                  onSelect(d);
                  setView("compose");
                }}
              />
            ) : reviewTab === "sources" ? (
              <PreparedEditor
                prepared={prepared}
                draft={draft}
                change={editDraft}
                validation={validation}
              />
            ) : (
              <>
                <div className="review-caption">
                  <span>
                    {prepared.text.length.toLocaleString()} /{" "}
                    {model?.promptLimit?.toLocaleString() || "—"} characters ·{" "}
                    {imageCount} images
                  </span>
                  <button
                    onClick={() => {
                      setReviewTab("sources");
                    }}
                  >
                    Edit injections
                  </button>
                </div>
                {[...validation.errors, ...validation.warnings].map((v, i) => (
                  <p
                    className={
                      validation.errors.includes(v) ? "error" : "muted"
                    }
                    key={i}
                  >
                    {v.message}
                  </p>
                ))}
                <textarea
                  className="composer-final-text"
                  aria-label="Exact outgoing video prompt"
                  readOnly
                  value={prepared.text}
                />
                {prepared.bindings?.length > 0 && (
                  <div className="canvas-bindings">
                    {prepared.bindings.map((b) => (
                      <div key={b.tag}>
                        {b.media[0]?.thumbnail && (
                          <img src={b.media[0].thumbnail} alt="" />
                        )}
                        <span>
                          <b>
                            {b.tag} · {b.name}
                          </b>
                          <small>
                            {b.role} · {b.media.length} image(s)
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="muted">
                  This is the assembled video prompt. Planning context is only
                  included when its injection is enabled.
                </p>
              </>
            )}
          </div>
        </div>
      )}
      {!reverse && (
        <details className="stream-clip-settings">
        <summary><Clock3 size={14} /> Clip length & frames <span>{draft.settings.duration}s</span><ChevronDown size={14} /></summary>
        <div className="creative-timing">
          <div className="creative-time-heading">
            {["start", "end"].map((key, i) => {
              const candidate =
                prepared.boundaries?.[key] ||
                prepared[
                  key === "start"
                    ? "continuityReference"
                    : "continuityEndReference"
                ];
              const f = boundaryPreview(candidate) ? candidate : null;
              return (
                <React.Fragment key={key}>
                  {i === 1 && (
                    <button
                      className="creative-duration"
                      aria-label="Timeline placement and duration"
                      onClick={() => {
                        closePanel();
                        setSettingsOpen(!settingsOpen);
                      }}
                    >
                      {draft.settings.duration}s
                      {plannedLength != null &&
                        plannedLength !== draft.settings.duration && (
                          <small> · plan {plannedLength}s</small>
                        )}
                    </button>
                  )}
                  <button
                    className={`creative-frame ${key}`}
                    data-frame-boundary={key}
                    aria-label={`${f ? "Change" : "Add"} ${key} frame`}
                    aria-expanded={panel === key}
                    onClick={() => togglePanel(key)}
                  >
                    {f ? (
                      <img
                        alt=""
                        src={boundaryPreview(f)}
                      />
                    ) : (
                      <Plus size={20} />
                    )}
                    <span>{key === "start" ? "Start frame" : "End frame"}</span>
                    {f && <ChevronDown size={11} />}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          <div
            className="creative-ruler"
            style={{
              "--trim": `${Math.min(100, (100 * draft.settings.duration) / max)}%`,
            }}
          >
            <div className="creative-ruler-band" />
            <div className="creative-ruler-ticks" />
            {[0, ...durations]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((v) => (
                <span
                  key={v}
                  className="creative-ruler-label"
                  style={{ left: `${(100 * v) / max}%` }}
                >
                  {v}
                  {v === max ? "s" : ""}
                </span>
              ))}
            <i />
            <input
              type="range"
              aria-label="Clip generation duration"
              onKeyDown={(e) => {
                if (
                  ![
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                  ].includes(e.key)
                )
                  return;
                e.preventDefault();
                const i = durations.indexOf(draft.settings.duration);
                const next =
                  e.key === "Home"
                    ? durations[0]
                    : e.key === "End"
                      ? durations.at(-1)
                      : durations[
                          Math.max(
                            0,
                            Math.min(
                              durations.length - 1,
                              i +
                                (["ArrowLeft", "ArrowDown"].includes(e.key)
                                  ? -1
                                  : 1),
                            ),
                          )
                        ];
                if (next != null && next !== draft.settings.duration)
                  onDuration(next);
              }}
              aria-valuetext={`${draft.settings.duration} seconds`}
              min={0}
              max={max}
              step="0.1"
              value={draft.settings.duration}
              disabled={durations.length < 2 || !!draft.repair}
              onChange={(e) => {
                const n = supportedComposerDuration(+e.target.value, durations);
                if (n !== null && n !== draft.settings.duration) onDuration(n);
              }}
            />
          </div>
        </div>
        </details>
      )}
      <footer className="creative-footer">
        {problem && (
          <button
            className={`composer-readiness ${empty && !validation.errors.length ? "quiet" : ""}`}
            onClick={() => {
              setView("prepared");
              setReviewTab("text");
            }}
          >
            {problem}
            <SquareCode size={12} />
          </button>
        )}
        <div className="creative-generate-row">
          <button
            className="creative-specs"
            aria-label="Generation settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              setView("compose");
              setSettingsOpen(!settingsOpen);
            }}
          >
            <SlidersHorizontal size={15} />
            <span>
              {modelTitle(model)}
              <small>
                {[
                  draft.settings.resolution,
                  draft.settings.aspect,
                  `${draft.quantity || 1} take${draft.quantity > 1 ? "s" : ""}`,
                  model?.audioConfigurable
                    ? draft.settings.audio
                      ? "Audio on"
                      : "Audio off"
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <ChevronUp size={12} />
          </button>
          <button type="button" className="model-adaptation-toggle" role="switch" aria-label="Optimize prompt for video model" aria-checked={!!draft.optimizeOnGenerate}
            disabled={submitting || optimizer.busy} title={`Adapt the submitted copy for ${modelTitle(model)} · your writing stays unchanged`}
            onClick={()=>editDraft(d=>{d.optimizeOnGenerate = !d.optimizeOnGenerate;})}>
            <Sparkles size={15}/><span>Optimize</span><i/>
          </button>
          <ProviderAction provider={model?.providerId || model?.provider || "venice"} mode={videoMode} feature="video generation" returnLabel="Back to my prompt">
          <HoldGenerate
            enabled={holdToGenerate}
            disabled={blocked}
            busy={submitting}
            price={price}
            onGenerate={e => generate(e, draft.optimizeOnGenerate ? optimizer.prepare : null)}
            requestKey={JSON.stringify([draft, price, videoMode])}
          />
          </ProviderAction>
        </div>
        <span className="composer-quote-status">
          <QuoteSummary
            errorOnly
            key={catalogTick}
            draft={draft}
            projectId={p.id}
            onQuote={setQuote}
          />
        </span>
      </footer>
      {(panel || settingsOpen) && visible && (
        <Companion
          key={panel || "settings"}
          anchor={root}
          title={
            {
              recipes: "Prompt library",
              references: "Assets & references",
              models: "Choose a model",
              smart: "Shape the scene",
              context: "Fine-tune prompt",
              start: "Start frame",
              end: "End frame",
            }[panel] || "Generation setup"
          }
          onClose={() => {
            closePanel();
            setSettingsOpen(false);
          }}
        >
          {panel === "recipes" && <RecoveryBoundary onClose={closePanel}><Suspense fallback={<p>Opening prompt library…</p>}><LazyPromptLibrary project={p} draft={draft} change={update} onApplied={closePanel} /></Suspense></RecoveryBoundary>}
          {settingsOpen && !panel && (
            <div className="compact-generation-setup">
              <button
                className="model-picker-trigger"
                onClick={() => togglePanel("models")}
              >
                <span>
                  <b>{modelTitle(model)}</b>
                  <small>{model?.provider || "Local simulator"}</small>
                </span>
                <ChevronDown size={15} />
              </button>
              <div className="setup-options">
                {[
                  ["aspect", model?.aspects],
                  ["resolution", model?.resolutions],
                ].map(([key, values]) => (
                  <section key={key}>
                    <h4>{key === "aspect" ? "Frame shape" : "Resolution"}</h4>
                    <div className="shot-choice-grid">
                      {values?.length ? (
                        values.map((v) => (
                          <button
                            key={v}
                            aria-pressed={draft.settings[key] === v}
                            onClick={() =>
                              editDraft((d) => (d.settings[key] = v))
                            }
                          >
                            {v}
                          </button>
                        ))
                      ) : (
                        <small>Provider default</small>
                      )}
                    </div>
                  </section>
                ))}
              </div>
              <div className="setup-takes">
                <span>Takes</span>
                <div>
                  <button
                    aria-label="Fewer takes"
                    disabled={(draft.quantity || 1) <= 1}
                    onClick={() =>
                      editDraft(
                        (d) =>
                          (d.quantity = Math.max(1, (d.quantity || 1) - 1)),
                      )
                    }
                  >
                    −
                  </button>
                  <output aria-label="Generation quantity">
                    {draft.quantity || 1}
                  </output>
                  <button
                    aria-label="More takes"
                    disabled={draft.quantity >= 12}
                    onClick={() =>
                      editDraft(
                        (d) =>
                          (d.quantity = Math.min(12, (d.quantity || 1) + 1)),
                      )
                    }
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <small>Separate versions</small>
              </div>
              {model?.audioConfigurable && (
                <Toggle
                  label="Generate audio"
                  checked={!!draft.settings.audio}
                  onChange={(value) =>
                    editDraft((d) => (d.settings.audio = value))
                  }
                />
              )}
              <label className="creative-placement">
                <Clock3 size={13} />
                <span>Starts at</span>
                <input
                  aria-label="Generation start seconds"
                  type="number"
                  disabled={!!draft.repair || !!draft.targetId}
                  min="0"
                  step="0.1"
                  value={draft.start}
                  onChange={(e) =>
                    editDraft((d) => (d.start = Math.max(0, +e.target.value)))
                  }
                />
                <Tool
                  icon={MoveHorizontal}
                  label="Use playhead as generation start"
                  disabled={!!draft.repair || !!draft.targetId}
                  onClick={() => editDraft((d) => (d.start = time))}
                />
              </label>
              {draft.targetId && (
                <small className="companion-hint">
                  Linked to its timeline slot · drag the slot to move it.
                </small>
              )}
              <div className="setup-summary">
                <span title="Final submitted text length">
                  <FileText size={13} />
                  {prepared.text.length.toLocaleString()} /{" "}
                  {model?.promptLimit?.toLocaleString() || "—"}
                </span>
                <span title="Submitted image references">
                  <Images size={13} />
                  {imageCount}
                </span>
                <span>
                  {price}
                  {videoMode !== "demo" && " · est."}
                </span>
              </div>
              <button
                className="save-model-default"
                onClick={saveVideoDefaults}
              >
                <Star size={14} />
                Save model & settings as default
              </button>
              {(draft.settingsNotice ||
                prepared.omittedAutomaticFrames?.length > 0 ||
                plannedLength != null) && (
                <details className="setup-details">
                  <summary>Setup details</summary>
                  {draft.settingsNotice && (
                    <p>Adjusted: {draft.settingsNotice}</p>
                  )}
                  {!!prepared.omittedAutomaticFrames?.length && (
                    <p>
                      Automatic {prepared.omittedAutomaticFrames.join(" / ")}{" "}
                      frame omitted for this model. References are kept.
                    </p>
                  )}
                  {plannedLength != null && (
                    <p>
                      Timeline slot: {plannedLength}s · generation:{" "}
                      {draft.settings.duration}s. Use the ruler to change
                      generation duration.
                    </p>
                  )}
                </details>
              )}
            </div>
          )}
          {panel === "references" && (
            <ComposerAssets
              project={p}
              draft={draft}
              prepared={prepared}
              change={editDraft}
              insert={insertAsset}
              adopt={adoptSharedAsset}
              openLibrary={() => {
                closePanel();
                openAssets();
              }}
            />
          )}
          {panel === "models" && (
            <ModelBrowser
              models={models}
              draft={draft}
              prepared={prepared}
              current={model}
              favoriteId={videoDefaults[videoMode]?.model}
              favorites={modelFavorites}
              onFavorite={onFavoriteModel}
              onSelect={(id) => {
                changeModel(id);
                closePanel();
                setSettingsOpen(true);
              }}
            />
          )}
          {panel === "context" && (
            <>
              <nav className="provider-filters" aria-label="Fine-tuning views">
                <button
                  aria-pressed={tuningTab === "context"}
                  onClick={() => setTuningTab("context")}
                >
                  Context & direction
                </button>
                <button
                  aria-pressed={tuningTab === "injections"}
                  onClick={() => setTuningTab("injections")}
                >
                  Injections
                </button>
              </nav>
              {tuningTab === "context" ? (
                <>
                  <ClipContinuityEditor project={p} draft={draft} onChange={value => editDraft(d => { d.continuity = value; })} />
                  <section className="composer-background-context">
                    <h3>Background & continuity</h3>
                    {!!p.settings.visualReferences?.length && <label className="project-look-toggle"><input type="checkbox" checked={draft.useProjectVisuals !== false} onChange={e=>editDraft(d=>d.useProjectVisuals=e.target.checked)}/>Use project palette, lighting & style references ({p.settings.visualReferences.length})</label>}
                    <p className="companion-hint">
                      Story context injected into this clip. Enable Story
                      continuity in the Injections tab to include it.
                    </p>
                    <textarea
                      aria-label="Director continuity notes"
                      value={draft.contextNotes || ""}
                      onChange={(e) =>
                        editDraft((d) => (d.contextNotes = e.target.value))
                      }
                    />
                    <pre className="context-source">
                      {
                        prepared.sections.find(
                          (s) => s.label === "Story context",
                        )?.text
                      }
                    </pre>
                  </section>{" "}
                  <label className="field">
                    <span>Visual direction</span>
                    <Prose
                      assets={p.assets}
                      onMention={attach}
                      aria-label="General direction"
                      placeholder="Mood, style and visual language…"
                      value={draft.general}
                      onChange={(e) =>
                        editDraft((d) => (d.general = e.target.value))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>General notes</span>
                    <Prose
                      assets={p.assets}
                      onMention={attach}
                      aria-label="General notes"
                      placeholder="Anything else to preserve…"
                      value={draft.notes}
                      onChange={(e) =>
                        editDraft((d) => (d.notes = e.target.value))
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <p className="companion-hint">
                    Choose what enters the final prompt. Reset an override to
                    follow your project defaults.
                  </p>
                  <InjectionSwitches
                    draft={draft}
                    effective={effective}
                    change={editDraft}
                    labels={automationLabels}
                  />
                </>
              )}
            </>
          )}
          {["start", "end"].includes(panel) && (
            <>
              <FrameControls
                only={panel}
                uploadBusy={frameUploading}
                onUpload={(boundary, onUse) => {
                  if (frameUploadLock.current) return;
                  frameUploadTarget.current = { draftId: draft.id, projectId: p.id, boundary, onUse };
                  frameUploadInput.current?.click();
                }}
                renderGenerate={(boundary, { onUse }) => <FrameGenerator key={`${draft.id}:${boundary}`} project={p} draft={draft} boundary={boundary} onUse={onUse} flush={flush} />}
                time={time}
                prepared={prepared}
                draft={draft}
                project={p}
                change={editDraft}
                model={model}
              />

            </>
          )}
        </Companion>
      )}
    </div>
  );
}
