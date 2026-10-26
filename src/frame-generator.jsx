import { frameOpeningReference } from "../shared/image-story.mjs";
import { ProviderAction } from "./provider-connect";
import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  Check,
  LoaderCircle,
  ImagePlus,
  RefreshCw,
} from "lucide-react";
import { api } from "./state";
import { HoldGenerate } from "./composer-tools";
import { imageModels } from "../shared/asset-generation.mjs";
import { saveLocalDraft } from "../shared/local-draft.mjs";
import "./frame-generator.css";
const isActive = (job) =>
  ["queued", "submitting", "processing", "saving"].includes(job.state);

export function FrameGenerator({ project, draft, boundary, onUse, flush }) {
  const assetId = `frame:${draft.id}:${boundary}`;
  const recoveryKey = `splece-frame-idea:${project.id}:${assetId}`;
  const [saved] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(recoveryKey)) || {};
    } catch {
      return {};
    }
  });
  const [description, setDescription] = useState(saved.description || "");
  const [provider, setProvider] = useState(saved.provider || "venice");
  const [sourceId, setSourceId] = useState(saved.sourceId || "");
  const [quote, setQuote] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showResult, setShowResult] = useState(true);
  const lock = useRef(false),
    alive = useRef(true);
  const sourceFrames = Object.values(draft.frameOverrides || {})
    .map((override) => override?.frame)
    .filter((frame) => frame?.kind === "image" || frame?.mediaId)
    .map((frame) => ({
      id: frame.mediaId || frame.takeId,
      name: "Current frame",
    }));
  const images = [
    ...sourceFrames,
    ...project.assets
      .filter((asset) => draft.referenceIds?.includes(asset.id))
      .flatMap((asset) =>
        [asset.media, ...(asset.mediaList || [])].filter(
          (media) => media?.kind === "image",
        ),
      ),
    ...jobs.filter((job) => job.state === "ready").map((job) => job.media),
  ].filter(
    (media, index, list) =>
      media && list.findIndex((other) => other?.id === media.id) === index,
  );
  const source = images.find((media) => media.id === sourceId);
  const referenceKeys = new Set();
  if (source) referenceKeys.add(`${source.id}:0`);
  const start = frameOpeningReference(project,draft);
  if (boundary === 'end' && start?.takeId) referenceKeys.add(`${start.takeId}:${Math.max(0,Number(start.time)||0)}`);
  for (const asset of project.assets.filter((item) =>
    draft.referenceIds?.includes(item.id),
  )) {
    const variant = asset.variants?.find(
      (item) => item.id === draft.referenceOptions?.[asset.id]?.variantId,
    );
    const media = variant?.media || asset.media;
    if (media?.kind === "image") referenceKeys.add(`${media.id}:0`);
  }
  const referenceCount = referenceKeys.size;
  const effectiveProvider = referenceCount > 1 ? "fal" : provider;
  const mode = referenceCount ? "vary" : "create";
  const model = imageModels.find(
    (item) => item.provider === effectiveProvider && item.mode === mode,
  );
  const input = {
    assetId,
    kind: "frame",
    draftId: draft.id,
    boundary,
    description: description.trim() || "Use the clip action and continuity.",
    mode,
    modelId: model.id,
    sourceMediaId: source?.id || "",
    framing: "scene",
    look: "auto",
    ratio: draft.settings.aspect || "16:9",
  };
  const signature = JSON.stringify({
    input,
    context: [
      draft.scenes,
      draft.referenceIds,
      draft.referenceOptions,
      draft.general,
      draft.notes,
      draft.frameOverrides,
      project.settings,
      project.assets.filter((asset) => draft.referenceIds?.includes(asset.id)),
    ],
  });
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setQuote(null);
    saveLocalDraft(localStorage, recoveryKey, {
      description,
      provider,
      sourceId,
    });
  }, [signature, recoveryKey]);
  useEffect(() => {
    let cancelled = false,
      timer;
    const poll = async () => {
      if (document.hidden) {
        timer = setTimeout(poll, 5000);
        return;
      }
      try {
        const rows = await api(`/projects/${project.id}/images`);
        if (!cancelled) {
          const matching = rows.filter((job) => job.input.assetId === assetId);
          setJobs(matching);
          timer = setTimeout(poll, matching.some(isActive) ? 2000 : 10000);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          timer = setTimeout(poll, 5000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project.id, assetId]);
  const work = async (callback) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await callback();
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const review = () =>
    work(async () => {
      const requested = signature;
      await flush?.();
      if (!alive.current || currentSignature.current !== requested) return;
      const next = await api(`/projects/${project.id}/images/quote`, input);
      if (alive.current && currentSignature.current === requested) {
        setQuote({ ...next, clientSignature: requested });
        setShowResult(false);
      }
    });
  const generate = () =>
    work(async () => {
      if (
        !quote ||
        quote.expiresAt < Date.now() ||
        quote.clientSignature !== currentSignature.current
      ) {
        setQuote(null);
        throw Error("Refresh the estimate before generating.");
      }
      const job = await api(`/projects/${project.id}/images`, {
        quoteId: quote.id,
      });
      if (alive.current) {
        setJobs((old) => [job, ...old.filter((other) => other.id !== job.id)]);
        setSelectedId(job.id);
        setShowResult(true);
        setQuote(null);
      }
    });
  const chosen = jobs.find((job) => job.id === selectedId) || jobs[0];
  return (
    <section
      className="frame-generator"
      aria-label={`Generate ${boundary} frame`}
    >
      {showResult && chosen && (
        <div className="frame-generator-result">
          {chosen.state === "ready" ? (
            <>
              <div className="frame-generator-preview">
                <img
                  src={`/api/media/${chosen.media.id}/original`}
                  alt={`Generated ${boundary} frame`}
                />
                {chosen.executionMode === "test" && (
                  <small>Offline sample · not AI generated</small>
                )}
              </div>
              <button
                type="button"
                className="frame-generator-use"
                onClick={() => onUse(chosen.media)}
              >
                <Check size={15} />
                Use {boundary} frame
              </button>
            </>
          ) : (
            <div className="frame-generator-status" role="status">
              {isActive(chosen) ? (
                <>
                  <LoaderCircle size={23} className="spin" />
                  <span>
                    {chosen.state === "queued"
                      ? "Queued"
                      : chosen.state === "saving"
                        ? "Saving your frame"
                        : "Creating your frame"}
                  </span>
                  <progress aria-label="Frame generation progress" />
                </>
              ) : (
                <>
                  <ImagePlus size={25} />
                  <span>
                    {chosen.error || "This frame could not be created."}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {jobs.length > 1 && jobs.some((job) => job.state === "ready") && (
        <div className="frame-generator-history" aria-label="Generated frames">
          {jobs
            .filter((job) => job.state === "ready")
            .map((job) => (
              <button
                type="button"
                key={job.id}
                aria-pressed={chosen?.id === job.id}
                aria-label={`Frame from ${new Date(job.createdAt).toLocaleString()}`}
                onClick={() => {
                  setSelectedId(job.id);
                  setShowResult(true);
                }}
              >
                <img
                  alt=""
                  src={`/api/media/${job.media.id}/original`}
                  loading="lazy"
                />
              </button>
            ))}
        </div>
      )}
      <label className="frame-generator-idea">
        <span>
          {boundary === "end"
            ? "Where does this shot end?"
            : "How does this shot begin?"}
        </span>
        <textarea
          rows={3}
          value={description}
          maxLength={3000}
          placeholder={
            boundary === "end"
              ? "She reaches the balcony. The city glows below…"
              : "A quiet street just before sunrise…"
          }
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <span className="frame-generator-context">
        <Sparkles size={12} /> Uses clip action
        {referenceCount
          ? ` · ${referenceCount} reference${referenceCount === 1 ? "" : "s"}`
          : ""}
      </span>
      {!!images.length && (
        <details className="frame-generator-source">
          <summary>
            {source ? "Vary this image" : "Start from an image"}
          </summary>
          <div className="frame-generator-history">
            <button
              type="button"
              aria-label="Create from clip context"
              aria-pressed={!source}
              onClick={() => setSourceId("")}
            >
              <Sparkles size={20} />
            </button>
            {images.map((media) => (
              <button
                type="button"
                key={media.id}
                aria-label={`Use ${media.name || "image"} as starting image`}
                aria-pressed={sourceId === media.id}
                onClick={() => setSourceId(media.id)}
              >
                <img
                  alt=""
                  src={`/api/media/${media.id}/original`}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </details>
      )}
      <div className="frame-generator-provider" aria-label="Image provider">
        {["venice", "fal"].map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={effectiveProvider === item}
            disabled={item === "venice" && referenceCount > 1}
            title={
              item === "venice" && referenceCount > 1
                ? "Venice supports one image; fal.ai preserves multiple references"
                : undefined
            }
            onClick={() => setProvider(item)}
          >
            {item === "fal" ? "fal.ai" : "Venice"}
          </button>
        ))}
        <small>{model.name}</small>
      </div>
      {referenceCount > 4 && (
        <p className="frame-generator-error" role="alert">
          Choose up to four references in the clip before creating a frame.
        </p>
      )}
      {error && (
        <p className="frame-generator-error" role="alert">
          {error}
        </p>
      )}
      <ProviderAction provider={effectiveProvider} feature={`${boundary} frame generation`} returnLabel="Back to my frame">
      {quote ? (
        <div className="frame-generator-confirm">
          <small>
            {quote.executionMode === "test"
              ? "Offline mode · no AI request"
              : `Estimated $${quote.price.amount.toFixed(3)}`}
          </small>
          <HoldGenerate
            enabled
            disabled={busy}
            busy={busy}
            price={
              quote.executionMode === "test"
                ? "$0 · Offline"
                : `~$${quote.price.amount.toFixed(3)}`
            }
            requestKey={quote.id}
            label={`${boundary} frame`}
            onGenerate={generate}
          />
        </div>
      ) : (
        <button
          type="button"
          className="frame-generator-review"
          disabled={busy || jobs.some(isActive) || referenceCount > 4}
          onClick={review}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : chosen ? (
            <RefreshCw size={15} />
          ) : (
            <ArrowRight size={15} />
          )}
          {chosen ? "Create another frame" : "Create frame"}
        </button>
      )}
      </ProviderAction>
    </section>
  );
}
