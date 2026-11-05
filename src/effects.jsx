import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  Columns2,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { api, uid } from "./state";
import { HoldGenerate } from "./composer-tools";
import {
  effectDefinitions,
  prepareEffectIntent,
  effectActive,
  applyEffect,
  revertEffect,
  saveEffectAsset,
} from "../shared/effects.mjs";
import "./effects.css";
import { OpenResultProject } from "./result-project";
import { ReelEffects, EffectFootage } from "./reel-effects";
import { localEffectPresets } from "../shared/reel-effects.mjs";
import { MorphControls, MotionPreview } from "./morph-effects";
import { morphPresets } from "../shared/morph-effects.mjs";
import {
  effectContext,
  automaticEffectFrames,
  frameEffectReference,
} from "../shared/effect-context.mjs";

export function EffectsPanel({
  project,
  selectedIds,
  update,
  flush,
  testMode,
  onClose,
  onCompare,
  onConnections,
  onOpenProject,
  insertionContext,
  frameAttachment,
}) {
  const [jobs, setJobs] = useState([]),
    [scale, setScale] = useState(2),
    [assetId, setAssetId] = useState(""),
    [quote, setQuote] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState(false),
    [recovery, setRecovery] = useState(""),
    [effectId, setEffectId] = useState("ai-upscale"),
    [morph, setMorph] = useState({
      placement: "insert",
      start: "",
      end: "",
      startEdge: "last",
      endEdge: "first",
      preset: "smooth",
      vibe: "natural",
      duration: 2,
      resolution: "480p",
      aspect: "16:9",
      guidance: "",
    });
  const [localRecipe, setLocalRecipe] = useState(null);
  const [upscaleScope, setUpscaleScope] = useState("clip");
  const submissionKey = useRef(null);
  const [frameOverrides, setFrameOverrides] = useState({}),
    [uploadBusy, setUploadBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const latest = useRef({ project, flush, update });
  latest.current = { project, flush, update };
  const scope = project.id + "/" + project.episodeId;
  useEffect(() => {
    let gone = false,
      timer;
    setJobs([]);
    setQuote(null);
    setError("");
    setAssetId("");
    async function poll() {
      try {
        const rows = await api(`/projects/${project.id}/effects`);
        if (!gone)
          setJobs(rows.filter((j) => j.input.episodeId === project.episodeId));
      } catch (e) {
        if (!gone) setError(e.message);
      }
      if (!gone) timer = setTimeout(poll, 1800);
    }
    poll();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [scope]);
  const context = effectContext(project, insertionContext, selectedIds),
    clip = context.clip || null;
  const contextKey =
    insertionContext?.id || `${context.kind}:${context.clipId || context.at}`;
  useEffect(() => {
    setFrameOverrides({});
    setMorph((v) => ({
      ...v,
      range: insertionContext?.range || null,
      aspect: project.settings?.export?.aspect || "16:9",
      duration: 2,
    }));
    setQuote(null);
    setError("");
  }, [contextKey]);
  useEffect(() => {
    if (frameAttachment?.frame)
      setFrameOverrides((v) => ({
        ...v,
        [frameAttachment.boundary]: {
          mode: "manual",
          frame: frameAttachment.frame,
        },
      }));
  }, [frameAttachment?.id]);
  const isMorph = effectId === "ai-morph",
    definition = effectDefinitions.find((d) => d.id === effectId);
  const autoFrames = automaticEffectFrames(project, context, morph.range);
  const frames = Object.fromEntries(
    ["start", "end"].map((role) => [
      role,
      frameOverrides[role]?.mode === "manual"
        ? frameOverrides[role].frame
        : frameOverrides[role]?.mode === "none"
          ? null
          : autoFrames[role],
    ]),
  );
  const references = ["start", "end"].map((role) =>
    frameEffectReference(project, role, frames[role]),
  );
  const placement = clip ? (clip.activeTake ? "replace" : "fill") : "insert";
  const target = isMorph
    ? clip
      ? { kind: "clip", id: clip.id }
      : references[0].target || references[1].target
    : assetId
      ? { kind: "asset", id: assetId }
      : clip
        ? { kind: "clip", id: clip.id }
        : null;
  const morphValue = { ...morph, placement };
  const intent = isMorph
    ? {
        effectId,
        target,
        placement,
        settings: {
          preset: morph.preset,
          vibe: morph.vibe,
          duration: morph.duration,
          resolution: morph.resolution,
          aspect: morph.aspect,
          guidance: morph.guidance,
        },
        references,
        ...(placement === "insert"
          ? {
              insertion: {
                at: context.at,
                previousClipId: context.before?.id || null,
                nextClipId: context.after?.id || null,
              },
            }
          : {}),
        ...(placement === "replace" && morph.range
          ? { range: morph.range }
          : {}),
      }
    : { effectId, target, settings: { scale } };
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  async function uploadFrame(role, file) {
    if (uploadBusy) return;
    const projectId = project.id,
      requestContext = contextKey;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setError("Choose a JPG, PNG or WebP image.");
      return;
    }
    setUploadBusy(true);
    setError("");
    try {
      await latest.current.flush();
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${projectId}/import`, {
          method: "POST",
          body: form,
        }),
        media = await response.json();
      if (!response.ok)
        throw Error(media.error || "Could not import the frame.");
      if (media.kind !== "image")
        throw Error("Choose an image for this frame.");
      if (
        !alive.current ||
        latest.current.project.id !== projectId ||
        currentContext.current !== requestContext
      )
        return;
      latest.current.update((p) => {
        if (!p.assets.some((a) => a.media?.id === media.id))
          p.assets.push({
            id: media.id,
            kind: "footage",
            name: media.name || file.name,
            media,
            scope: "project",
          });
      });
      setFrameOverrides((v) => ({
        ...v,
        [role]: {
          mode: "manual",
          frame: {
            kind: "image",
            mediaId: media.id,
            takeId: media.id,
            time: 0,
          },
        },
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setUploadBusy(false);
    }
  }
  const allVideos = !isMorph && upscaleScope === "all";
  let input, problem;
  try {
    if (allVideos) {
      const intents = project.clips
        .filter(
          (c) =>
            c.activeTake &&
            (c.takes.find((t) => t.id === c.activeTake)?.kind || "video") ===
              "video",
        )
        .map((c) =>
          prepareEffectIntent(project, {
            effectId: "ai-upscale",
            target: { kind: "clip", id: c.id },
            settings: { scale },
          }),
        );
      if (!intents.length || intents.length > 50)
        throw Error("Choose an edit with 1–50 completed video clips.");
      input = {
        batch: true,
        intents,
        source: {
          duration: intents.reduce((n, i) => n + i.source.duration, 0),
        },
      };
    } else input = prepareEffectIntent(project, intent);
  } catch (e) {
    problem = e.message;
  }
  const inputKey = JSON.stringify(input),
    key = JSON.stringify(intent),
    ref = useRef(null);
  ref.current = { intent, input };
  useEffect(() => {
    setQuote(null);
    setError("");
  }, [inputKey, testMode, scope]);
  useEffect(() => {
    if (localRecipe || !detail || !input || quote) return;
    const timer = setTimeout(() => estimate(), 450);
    return () => clearTimeout(timer);
  }, [inputKey, detail, testMode, !!quote, localRecipe]);
  const media =
    !isMorph && assetId
      ? project.assets.find((a) => a.id === assetId)?.media
      : clip?.takes?.find((t) => t.id === clip.activeTake);
  const latestBatch = allVideos
    ? jobs.find((j) => j.batchId && j.input.effectId === effectId)?.batchId
    : null;
  const relevant = jobs.filter(
    (j) =>
      j.input.effectId === effectId &&
      (!isMorph || j.input.placement === placement) &&
      (allVideos
        ? !!j.batchId && j.batchId === latestBatch
        : !target ||
          (j.input.target.kind === target.kind &&
            j.input.target.id === target.id)),
  );
  async function request(action, body) {
    const initial = latest.current.project,
      revision = await latest.current.flush();
    if (
      latest.current.project.id !== initial.id ||
      latest.current.project.episodeId !== initial.episodeId
    )
      throw Error("Active edit changed.");
    const r = await api(`/projects/${initial.id}/effects${action}`, {
      ...body,
      revision,
    });
    if (r.jobs)
      setJobs((old) => [
        ...r.jobs,
        ...old.filter((j) => !r.jobs.some((n) => n.id === j.id)),
      ]);
    if (r.state) setJobs((old) => [r, ...old.filter((j) => j.id !== r.id)]);
    return r;
  }
  async function estimate() {
    setBusy(true);
    setError("");
    const requested = inputKey;
    try {
      const r = await request(
        allVideos ? "/batch/prepare" : "/prepare",
        ref.current.intent,
      );
      if (JSON.stringify(ref.current.input) === requested) setQuote(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!quote || busy) return;
    setBusy(true);
    setError("");
    try {
      if (submissionKey.current?.quoteId !== quote.id)
        submissionKey.current = { quoteId: quote.id, id: uid() };
      await request(allVideos ? "/batch" : "", {
        ...intent,
        quoteId: quote.id,
        confirmedAmount: quote.amount,
        requestId: submissionKey.current.id,
      });
      setQuote(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function edit(fn) {
    try {
      update(fn);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  const jobApplied = (j) =>
    j.input.target.kind === "clip"
      ? project.clips.find((c) => c.id === j.input.target.id)?.activeTake ===
        j.media?.id
      : project.assets.find((a) => a.id === j.input.target.id)?.media?.id ===
        j.media?.id;
  const applied =
    target?.kind === "clip"
      ? !!media?.effect
      : !!project.assets.find((a) => a.id === assetId)?.effectHistory?.length;
  if (localRecipe)
    return (
      <ReelEffects
        key={`${scope}/${localRecipe}`}
        project={project}
        selectedIds={selectedIds}
        recipe={localRecipe}
        onOpenProject={onOpenProject}
        update={update}
        flush={flush}
        onBack={() => setLocalRecipe(null)}
        onClose={onClose}
      />
    );
  return (
    <section className="effects-panel" aria-label="AI effects">
      <header>
        {detail && (
          <button
            className="icon"
            aria-label="All effects"
            onClick={() => setDetail(false)}
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <strong>{detail ? definition.name : "Effects"}</strong>
        <button
          className="icon"
          aria-label="Collapse effects"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      {!detail && (
        <div className="effect-target-summary">
          {media?.thumbnail && (
            <img src={media.thumbnail} alt="Selected clip" />
          )}
          <span>
            <strong>
              {media?.name ||
                (context.mode === "insert"
                  ? "Between clips"
                  : "Choose a clip or image")}
            </strong>
            <small>
              {media
                ? "Select an effect below. Review the result before applying."
                : "Select media in the timeline or Library to begin."}
            </small>
          </span>
        </div>
      )}
      {!detail ? (
        <div className="effects-catalog">
          <div className="effects-catalog-grid">
            <div className="effects-section-label">
              Create locally · no credits
            </div>
            {localEffectPresets.map((p) => (
              <button
                key={p.id}
                className={`effect-card ${p.id === "reel" ? "effect-featured" : ""}`}
                onClick={() => setLocalRecipe(p.id)}
              >
                <EffectFootage media={media} recipe={p.id} />
                <strong>{p.name}</strong>
                <small>{p.description}</small>
              </button>
            ))}
            <div className="effects-section-label">AI transformations</div>
            {[...effectDefinitions].reverse().map((d) => (
              <button
                key={d.id}
                className="effect-card"
                onClick={() => {
                  setEffectId(d.id);
                  setDetail(true);
                }}
              >
                <div className="effect-thumbnail">
                  {d.id === "ai-morph" ? (
                    <MotionPreview
                      preset={morphPresets[0]}
                      frames={frames}
                      media={media}
                    />
                  ) : (
                    <EffectFootage media={media} recipe="upscale" />
                  )}
                  <span>
                    {d.id === "ai-morph" ? "First → Last" : "2× / 4×"}
                  </span>
                </div>
                <strong>{d.name}</strong>
                <small>{d.category} · Images / video</small>
              </button>
            ))}
            <p>
              Prepare locally. Review before applying. Originals stay saved.
            </p>
          </div>
        </div>
      ) : (
        <div className="effect-detail">
          {isMorph ? (
            <MorphControls
              project={project}
              context={context}
              value={morphValue}
              onChange={setMorph}
              frames={frames}
              frameOverrides={frameOverrides}
              onFrameChange={setFrameOverrides}
              onUpload={uploadFrame}
              uploadBusy={uploadBusy}
            />
          ) : (
            <>
              <div
                className="effect-scope"
                role="group"
                aria-label="Upscale scope"
              >
                <button
                  aria-pressed={!allVideos}
                  onClick={() => setUpscaleScope("clip")}
                >
                  This clip
                </button>
                <button
                  aria-pressed={allVideos}
                  onClick={() => setUpscaleScope("all")}
                >
                  All videos
                </button>
              </div>
              {allVideos ? (
                <p>
                  {input?.intents?.length || 0} video clips in this edit. One
                  combined estimate; originals stay available.
                </p>
              ) : (
                <label>
                  Input
                  <select
                    aria-label="Effect input"
                    value={assetId}
                    onChange={(e) => setAssetId(e.target.value)}
                  >
                    <option value="">
                      Selected timeline clip
                      {clip ? ` · ${media?.name || "Take"}` : ""}
                    </option>
                    {project.assets
                      .filter(
                        (a) =>
                          a.media?.url &&
                          ["image", "video"].includes(a.media.kind),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {!allVideos && media && (
                <div className="effect-input">
                  {media.thumbnail && <img src={media.thumbnail} alt="" />}
                  <span>
                    <strong>{media.name || "Selected version"}</strong>
                    <small>
                      {media.kind || "video"} ·{" "}
                      {input?.source.duration?.toFixed(2)}s
                      {media.width ? ` · ${media.width} × ${media.height}` : ""}
                    </small>
                  </span>
                </div>
              )}
              <label>
                Enlargement
                <select
                  value={scale}
                  onChange={(e) => setScale(+e.target.value)}
                >
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
              <p className="effect-output-summary">
                {testMode
                  ? "Preview only · original resolution"
                  : media?.width && media?.height
                    ? `Output up to ${Math.min(4096, media.width * scale)} × ${Math.min(4096, media.height * scale)}`
                    : `${scale}× enlargement · up to 4096px per edge`}
                . Sound and clip timing stay intact.
              </p>
              <details className="effect-advanced">
                <summary>Processing details</summary>
                <p>
                  RealESRGAN via fal · Selected trim only. Video up to 30
                  seconds; output up to 4096px per edge. Originals remain
                  available.
                </p>
              </details>
            </>
          )}
          {problem && (
            <p role="status">
              {placement === "insert" &&
              relevant.some(
                (j) =>
                  j.input.insertion?.at === context.at &&
                  project.clips.some((c) => c.effectJobId === j.id),
              )
                ? "Transition inserted. Choose another + to add an effect."
                : problem}
            </p>
          )}
          <p className="effect-mode">
            {isMorph
              ? testMode
                ? "Offline motion guide · dissolves between your frames. This is not AI morphing; no credits spent."
                : "Wan 3.0 · two prepared frames are sent to fal. Presets guide the model; exact motion and endpoint matching can vary."
              : testMode
                ? "Offline check · copies the selected picture locally. Detail and resolution are unchanged. No credits spent."
                : "Online · selected picture is sent to fal. Review its estimate before processing and compare before applying."}
          </p>
          <div className="effect-generate">
            <small>
              {isMorph
                ? `Wan 3.0 · ${morph.duration}s · ${morph.resolution}`
                : allVideos
                  ? `${input?.intents?.length || 0} clips`
                  : `${scale}× enlargement`}
              {quote?.mode === "live" ? ` · ≈ $${quote.amount.toFixed(4)}` : ""}
            </small>
            <HoldGenerate
              enabled={!testMode}
              busy={busy}
              label={testMode ? "Offline preview" : definition.name}
              price={
                quote
                  ? quote.mode === "test"
                    ? "$0"
                    : `≈ $${quote.amount.toFixed(4)}`
                  : "…"
              }
              requestKey={(quote?.id || "") + key}
              disabled={
                busy ||
                !input ||
                !quote ||
                quote.mode !== (testMode ? "test" : "live") ||
                quote.expires < Date.now()
              }
              onGenerate={submit}
            />
            {quote?.mode === "live" && (
              <details>
                <summary>Cost estimate</summary>
                <small>{quote.note}</small>
              </details>
            )}
            {!quote && error && (
              <button onClick={estimate} disabled={busy || !input}>
                Retry estimate
              </button>
            )}
          </div>
          {applied && !allVideos && (
            <button onClick={() => edit((p) => revertEffect(p, target))}>
              <RefreshCw size={14} /> Return to original
            </button>
          )}
        </div>
      )}
      <div className="effect-results" aria-live="polite" hidden={!detail}>
        {allVideos && relevant.length > 0 && (
          <button
            disabled={
              relevant.some((j) => j.state !== "ready") ||
              relevant.every(
                (j) =>
                  project.clips.find((c) => c.id === j.input.target.id)
                    ?.activeTake === j.media?.id,
              )
            }
            onClick={() =>
              edit((p) => {
                for (const j of relevant) applyEffect(p, j);
              })
            }
          >
            Apply to all {relevant.length} clips
          </button>
        )}
        {relevant.map((j) => (
          <article key={j.id}>
            <div>
              <strong>
                {j.media?.name ||
                  (j.executionMode === "test"
                    ? "Offline check"
                    : definition.name)}
              </strong>
              {effectActive(j) && <LoaderCircle className="spin" size={15} />}
            </div>
            <small>
              {j.state === "ready"
                ? "Ready for review · original kept"
                : j.stage
                  ? `${j.stage} · ${j.state.replaceAll("_", " ")}`
                  : j.state}
            </small>
            <details className="effect-job-details">
              <summary>Processing details</summary>
              <ol>
                {j.stages.map((s) => (
                  <li key={s.id} data-state={s.state}>
                    {s.state === "ready" ? <Check size={12} /> : null}
                    {s.id === "prepare"
                      ? "Snapshot"
                      : s.id === "transform"
                        ? j.executionMode === "test"
                          ? "Local preview"
                          : "AI transform"
                        : "Save result"}{" "}
                    · {s.state.replaceAll("_", " ")}
                  </li>
                ))}
              </ol>
            </details>
            {j.state === "ready" && (
              <>
                <OpenResultProject projectId={project.id} resultId={j.id} kind="effects" flush={flush} onOpenProject={onOpenProject} />
                {j.input.effectId === "ai-morph" ? (
                  <div className="morph-result">
                    <video
                      controls
                      preload="metadata"
                      src={j.media.url}
                      aria-label="Transition result"
                    />
                    <small>
                      {j.executionMode === "test"
                        ? "Offline two-frame preview · no AI motion"
                        : "Review transition before applying"}
                    </small>
                    <div className="morph-endpoints">
                      {[0, 1].map((i) => (
                        <img
                          key={i}
                          src={`/api/projects/${project.id}/effects/${j.id}/frames/${i}`}
                          alt={i ? "Saved last frame" : "Saved first frame"}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <button onClick={() => onCompare(j)}>
                    <Columns2 size={14} /> Compare original / result
                  </button>
                )}
                <button
                  disabled={
                    jobApplied(j) ||
                    project.clips.some((c) => c.effectJobId === j.id)
                  }
                  onClick={() => edit((p) => applyEffect(p, j))}
                >
                  <Check size={14} />
                  {jobApplied(j) ||
                  project.clips.some((c) => c.effectJobId === j.id)
                    ? "Applied"
                    : j.input.placement === "insert"
                      ? "Insert transition"
                      : j.input.placement === "fill"
                        ? "Fill clip"
                        : j.input.effectId === "ai-morph"
                          ? "Replace selected clip"
                          : "Apply result"}
                </button>
                <button
                  disabled={project.assets.some((a) => a.id === j.media.id)}
                  onClick={() => edit((p) => saveEffectAsset(p, j))}
                >
                  Save to Assets
                </button>
              </>
            )}
            {j.error && <p role="alert">{j.error}</p>}
            {j.state === "needs_attention" &&
              !j.stages.some((s) => s.terminal) && (
                <>
                  {j.stages.some((s) => s.state === "submission_uncertain") && (
                    <input
                      aria-label="Existing fal request ID"
                      placeholder="Existing fal request ID"
                      value={recovery}
                      onChange={(e) => setRecovery(e.target.value)}
                    />
                  )}
                  <button
                    onClick={async () => {
                      try {
                        await request(`/${j.id}/recover`, {
                          providerJobId: recovery.trim(),
                          quoteId: quote?.id,
                          confirmedAmount: quote?.amount,
                        });
                        setError("");
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Continue saved pass
                  </button>
                </>
              )}
          </article>
        ))}
      </div>
      {error && (
        <div role="alert" className="effect-error">
          <p>{error}</p>
          {!testMode && (
            <button onClick={onConnections}>Check Connections</button>
          )}
        </div>
      )}
    </section>
  );
}
