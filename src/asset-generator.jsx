import { useAIRouting } from "./ai-providers";
import { qualityResolution } from "../shared/generation-quality.mjs";
import { AssetUnderstanding } from "./asset-understanding";
import { ProviderAction } from "./provider-connect";
import { assetImageDraftSignature } from "../shared/asset-edit.mjs";
import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  ArrowRight,
  Check,
  ImagePlus,
  Layers,
  RefreshCw,
  LoaderCircle,
  ChevronDown,
  Upload,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { visualBriefFields } from "../shared/asset-brief.mjs";
import { appendCharacterImage } from "./character";
import { saveLocalDraft } from "../shared/local-draft.mjs";
import { api } from "./state";
import { HoldGenerate } from "./composer-tools";
import {
  imageModels,
  applyGeneratedImage,
} from "../shared/asset-generation.mjs";
import { assetCreativeContext } from "../shared/asset-intelligence.mjs";
import { lookDetails, editCharacterLook } from "../shared/character-looks.mjs";
import { useSharedLibrary } from "./shared-library";
import "./asset-generator.css";
const active = (job) =>
  ["queued", "submitting", "processing", "saving"].includes(job.state);

export function AssetGenerator({
  asset,
  project,
  change,
  onStarted,
  onReferenceAdded,
  embedded = false,
  initialDirection,
  initialSourceMediaId,
  initialReference,
  onAdopt,
}) {
  const { state: aiRouting } = useAIRouting();
  const imageRoute = aiRouting?.routes.image;
  const recoveryKey = `splece-image-idea-${project.id}-${asset.id}`;
  const [saved] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(recoveryKey));
      return value?.kind === asset.kind &&
        value.assetSignature === assetImageDraftSignature(asset)
        ? value
        : {};
    } catch {
      return {};
    }
  });
  const initialSource =
    initialReference?.id ||
    initialSourceMediaId ||
    (saved.mode === "vary" && saved.sourceMediaId) ||
    asset.media?.id ||
    "";
  const initialBrief =
    initialSource && initialSource !== asset.media?.id
      ? asset.variants?.find((v) => v.media?.id === initialSource)
          ?.visualBrief || {}
      : asset.visualBrief || {};
  const [open, setOpen] = useState(embedded || (!asset.name && !asset.media)),
    [name, setName] = useState(asset.name || saved.name || ""),
    [description, setDescription] = useState(
      initialDirection ??
        (asset.media
          ? saved.mode === "vary"
            ? (saved.description ===
              "Preserve this reference and create the selected look."
                ? ""
                : saved.description) || ""
            : ""
          : (saved.description ?? asset.description ?? "")),
    ),
    [mode, setMode] = useState(
      initialReference ||
        initialSourceMediaId ||
        asset.media ||
        saved.sourceMediaId
        ? "vary"
        : "create",
    ),
    [uploaded, setUploaded] = useState(
      initialReference ? [initialReference] : saved.uploaded || [],
    ),
    [libraryOpen, setLibraryOpen] = useState(false),
    [referenceDetails, setReferenceDetails] = useState({}),
    [showResults, setShowResults] = useState(false),
    [suggestionNotice, setSuggestionNotice] = useState(""),
    [visualBrief, setVisualBrief] = useState(
      (saved.sourceMediaId || "") === initialSource
        ? saved.visualBrief || initialBrief
        : initialBrief,
    ),
    [briefOpen, setBriefOpen] = useState(false),
    [modelOpen, setModelOpen] = useState(false),
    [suggestedBrief, setSuggestedBrief] = useState(null),
    [suggesting, setSuggesting] = useState(false),
    [source, setSource] = useState(
      initialReference?.id ||
        initialSourceMediaId ||
        (saved.mode === "vary" && saved.sourceMediaId) ||
        asset.media?.id ||
        "",
    ),
    [provider, setProvider] = useState(saved.provider || "venice"),
    [preferredModel, setPreferredModel] = useState(
      saved.modelId || "venice-grok",
    ),
    [count, setCount] = useState(1),
    [quote, setQuote] = useState(null),
    [jobs, setJobs] = useState([]),
    [batchIds, setBatchIds] = useState([]),
    [submittedSignature, setSubmittedSignature] = useState(null),
    [selected, setSelected] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const uploadInput = useRef(null);
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const images = [
    asset.media,
    ...uploaded,
    ...(asset.mediaList || []),
    ...(asset.variants || []).map((variant) => variant.media),
  ]
    .filter((media) => media?.kind === "image")
    .filter(
      (media, index, list) =>
        list.findIndex((other) => other.id === media.id) === index,
    );
  const attachedBrief =
    (source !== asset.media?.id
      ? asset.variants?.find((v) => v.media?.id === source)?.visualBrief
      : asset.visualBrief) || {};
  const attachedBriefKey = JSON.stringify([source, attachedBrief]);
  const priorAttachedBrief = useRef(attachedBriefKey);
  useEffect(() => {
    if (priorAttachedBrief.current !== attachedBriefKey) {
      priorAttachedBrief.current = attachedBriefKey;
      setVisualBrief(attachedBrief);
    }
  }, [attachedBriefKey]);
  const routeInitialized = useRef(false);
  useEffect(() => {
    if (!imageRoute) return;
    if (!routeInitialized.current) {
      routeInitialized.current = true;
      if (
        saved.modelId &&
        imageModels.some((item) => item.id === saved.modelId)
      )
        return;
    }
    setProvider(imageRoute.provider);
    if (imageRoute.model) setPreferredModel(imageRoute.model);
    else
      setPreferredModel(
        imageModels.find(m => m.provider === imageRoute.provider && m.mode === mode)?.id || "venice-grok",
      );
  }, [imageRoute?.provider, imageRoute?.model]);
  const sharedLibrary = useSharedLibrary(project);
  const model =
    imageModels.find(
      (item) => item.id === preferredModel && item.mode === mode,
    ) ||
    imageModels.find(
      (item) => item.provider === provider && item.mode === mode,
    );
  const [quality, setQuality] = useState("draft");
  const refreshQualityQuote = useRef(false);
  useEffect(() => {
    if (refreshQualityQuote.current) {
      refreshQualityQuote.current = false;
      review();
    }
  }, [quality]);
  const qualityOptions = Object.fromEntries(
    ["draft", "final"].map((q) => [
      q,
      qualityResolution(project.settings.generationPresets, model, q),
    ]),
  );
  const input = {
    resolution: qualityOptions[quality],
    assetId: asset.id,
    name,
    description:
      description.trim() ||
      (mode === "vary"
        ? "Preserve this reference and create the selected look."
        : ""),
    ...(asset.kind === "character"
      ? { characterProfile: asset.characterProfile || {} }
      : {}),
    kind: asset.kind,
    visualBrief,
    mode,
    modelId: model.id,
    framing: "auto",
    look: "auto",
    ratio: "1:1",
    sourceMediaId: mode === "vary" ? source : "",
    count,
    candidates: true,
  };
  const signature = JSON.stringify({ input, settings: project.settings }),
    current = useRef(signature);
  current.current = signature;
  useEffect(() => {
    setQuote(null);
  }, [imageRoute?.enabled]);
  useEffect(() => {
    setQuote(null);
    saveLocalDraft(localStorage, recoveryKey, {
      ...input,
      description,
      provider,
      uploaded,
      assetSignature: assetImageDraftSignature(asset),
    });
  }, [signature]);
  useEffect(() => {
    if (!open) return;
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
          const matching = rows.filter((job) => job.input.assetId === asset.id);
          setJobs(matching);
          timer = setTimeout(poll, matching.some(active) ? 2000 : 10000);
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
  }, [open, project.id, asset.id, jobs.some(active)]);
  async function work(fn) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const upload = (file) =>
    work(async () => {
      if (!file) return;
      if (
        !/\.(png|jpe?g|webp)$/i.test(file.name) ||
        file.size > 24 * 1024 * 1024
      )
        throw Error("Choose a JPG, PNG or WebP under 24 MB.");
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${project.id}/import`, {
        method: "POST",
        body: form,
      });
      const media = await response.json();
      if (!response.ok || media.kind !== "image")
        throw Error(media.error || "Choose an image.");
      if (alive.current) {
        setUploaded((old) => [...old, media]);
        setSource(media.id);
        setMode("vary");
        setSelected(null);
        setBatchIds([]);
        setShowResults(false);
      }
    });
  const suggestDetails = () =>
    work(async () => {
      const captured = current.current;
      setSuggesting(true);
      let result;
      try {
        result = await api(`/projects/${project.id}/assets/brief`, {
          ...input,
          hasReference: mode === "vary",
        });
      } finally {
        if (alive.current) setSuggesting(false);
      }
      if (result.state !== "ready")
        throw Error(result.error || "Could not suggest details.");
      if (alive.current && captured === current.current) {
        setSuggestedBrief(result.result);
        setBriefOpen(true);
        if (result.executionMode === "test")
          setError(
            "Offline mode: no AI suggestions requested. Edit the details below.",
          );
      }
    });
  const sourceImage = images.find((media) => media.id === source);
  const attached = [
    asset.media,
    ...(asset.mediaList || []),
    ...(asset.variants || []).map((v) => v.media),
  ].some((m) => m?.id === source);
  const referenceAsset =
    referenceDetails[source] ||
    (sourceImage ? appendCharacterImage(asset, sourceImage) : asset);
  const chooseReference = (media) => {
    setUploaded((old) =>
      old.some((m) => m.id === media.id) ? old : [...old, media],
    );
    setSource(media.id);
    setMode("vary");
    setShowResults(false);
    setLibraryOpen(false);
  };
  const useReference = () => {
    if (!sourceImage) return;
    let next = appendCharacterImage(asset, sourceImage);
    if (referenceDetails[source]) {
      next = editCharacterLook(
        next,
        source,
        lookDetails(referenceDetails[source], source),
      );
      next.libraryTags = [
        ...new Set([
          ...(next.libraryTags || []),
          ...(referenceDetails[source].libraryTags || []),
        ]),
      ].slice(0, 30);
      for (const group of asset.kind === "character"
        ? ["characterProfile", "voice"]
        : [])
        next[group] = { ...referenceDetails[source][group], ...asset[group] };
    }
    change(next);
  };
  const suggestVariation = () =>
    work(async () => {
      const captured = current.current;
      setSuggestionNotice("");
      const result = await api(`/projects/${project.id}/assets/brief`, {
        ...input,
        purpose: "variation",
        context: assetCreativeContext(referenceDetails[source] || asset),
      });
      if (!alive.current || current.current !== captured) return;
      if (result.state !== "ready")
        throw Error(result.error || "Could not suggest a variation.");
      if (result.executionMode === "test") {
        setSuggestionNotice(
          "Offline preview · no AI call or changes to your description.",
        );
        return;
      }
      setDescription(result.result.prompt);
      setSuggestedBrief(null);
      setSuggestionNotice(
        "Suggested from your story and existing looks · edit anything before generating.",
      );
    });

  const review = () =>
    work(async () => {
      const sig = signature;
      const next = await api(
        `/projects/${project.id}/images/batch/quote`,
        input,
      );
      if (alive.current && current.current === sig)
        setQuote({ ...next, clientSignature: sig });
    });
  const generate = () =>
    work(async () => {
      if (
        !quote ||
        quote.clientSignature !== current.current ||
        (quote.expiresAt && quote.expiresAt < Date.now())
      ) {
        setQuote(null);
        throw Error("Refresh the estimate before generating.");
      }
      await onStarted?.(quote.quotes?.[0]?.input || input);
      if (!alive.current || quote.clientSignature !== current.current) return;
      const batch = await api(`/projects/${project.id}/images/batch`, {
        quoteId: quote.id,
      });
      if (alive.current) {
        const next = batch.jobs || [];
        setShowResults(true);
        setBatchIds(next.map((job) => job.id));
        setSubmittedSignature(quote.clientSignature);
        setJobs((old) => [
          ...next,
          ...old.filter((job) => !next.some((item) => item.id === job.id)),
        ]);
        setSelected(next[0]?.id || null);
        setQuote(null);
      }
    });
  const shown = !showResults
    ? []
    : batchIds.length
      ? batchIds.map((id) => jobs.find((job) => job.id === id)).filter(Boolean)
      : jobs.slice(0, 4);
  const chosen = jobs.find((job) => job.id === selected) || shown[0],
    ready = shown.filter((job) => job.state === "ready");
  const freshResults = submittedSignature === signature;
  const retrieve = () =>
    work(async () => {
      if (!chosen?.canRetrieve) return;
      const recovered = await api(
        `/projects/${project.id}/images/${chosen.id}/retrieve`,
        {},
      );
      if (alive.current)
        setJobs((old) =>
          old.map((job) => (job.id === recovered.id ? recovered : job)),
        );
    });
  const attach = (all = false, asMain = false) => {
    try {
      let next = asset;
      const outputs = all
        ? ready
        : [chosen].filter((job) => job?.state === "ready");
      for (const job of outputs)
        next = applyGeneratedImage(next, job, {
          variant: !!next.media && !asMain,
        });
      change(next);
      if (!embedded) setOpen(false);
    } catch (e) {
      setError(e.message);
    }
  };
  if (!open)
    return (
      <button
        type="button"
        className="asset-generate-entry"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={20} />
        <span>
          <b>{asset.media ? "Explore a new look" : "Generate an image"}</b>
          <small>
            {asset.media
              ? "Preserve the original reference"
              : "Start with a few words"}
          </small>
        </span>
        <ArrowRight size={16} />
      </button>
    );
  return (
    <section
      className={`asset-imagine ${embedded ? "is-embedded" : ""}`}
      aria-label="Generate asset image"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        upload(e.dataTransfer.files?.[0]);
      }}
    >
      {!embedded && (
        <header>
          <b>Create an image</b>
          <button
            type="button"
            aria-label="Close image generator"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </header>
      )}
      <div className="imagine-workspace">
        <div className="imagine-controls">
          <div className="imagine-control-scroll">
            <input
              ref={uploadInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="imagine-reference-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => uploadInput.current?.click()}
              >
                <Upload size={14} /> Upload reference
              </button>
              {mode === "vary" && (
                <button
                  type="button"
                  aria-label="Remove image reference"
                  onClick={() => {
                    setSource("");
                    setMode("create");
                  }}
                >
                  <X size={14} />
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                aria-expanded={libraryOpen}
                onClick={() => setLibraryOpen(!libraryOpen)}
              >
                <ImagePlus size={14} /> Library
              </button>
            </div>
            {libraryOpen && (
              <div
                className="imagine-library"
                aria-label="Choose library reference"
              >
                {project.assets
                  .filter((a) => a.id !== asset.id && a.media?.kind === "image")
                  .map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => chooseReference(a.media)}
                    >
                      <img src={`/api/media/${a.media.id}/original`} alt="" />
                      <span>{a.name}</span>
                    </button>
                  ))}
                {onAdopt &&
                  sharedLibrary.entries
                    .filter((e) => e.asset.media?.kind === "image")
                    .map((entry) => (
                      <button
                        type="button"
                        key={entry.id}
                        disabled={busy}
                        onClick={() =>
                          work(async () => {
                            const adopted = await onAdopt({ entry });
                            if (alive.current && adopted?.media)
                              chooseReference(adopted.media);
                          })
                        }
                      >
                        <img src={entry.asset.media.thumbnail} alt="" />
                        <span>{entry.asset.name} · Shared</span>
                      </button>
                    ))}
                {!project.assets.some(
                  (a) => a.id !== asset.id && a.media?.kind === "image",
                ) &&
                  !(
                    onAdopt &&
                    sharedLibrary.entries.some(
                      (e) => e.asset.media?.kind === "image",
                    )
                  ) && <p>No image references yet. Upload one to begin.</p>}
                {sharedLibrary.error && (
                  <p role="alert">{sharedLibrary.error}</p>
                )}
              </div>
            )}
            {images.length > 0 && (
              <div
                className="imagine-source-strip"
                aria-label="Source reference"
              >
                {images.map((media) => (
                  <button
                    type="button"
                    key={media.id}
                    aria-label={`Use ${media.name || "reference"}`}
                    aria-pressed={source === media.id}
                    onClick={() => {
                      setSource(media.id);
                      setMode("vary");
                      setShowResults(false);
                    }}
                  >
                    <img
                      alt=""
                      src={media.thumbnail || `/api/media/${media.id}/original`}
                    />
                  </button>
                ))}
              </div>
            )}
            {!embedded && (
              <label className="imagine-name">
                <span>Name · optional</span>
                <input
                  aria-label="Image asset name"
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={`Your ${asset.kind === "location" ? "place" : asset.kind}`}
                />
              </label>
            )}
            <div className="imagine-direction">
              <div className="imagine-direction-heading">
                <span>
                  {mode === "vary"
                    ? "What should change?"
                    : "Describe your idea"}
                </span>{" "}
                <ProviderAction
                  provider="deepseek"
                  feature="look suggestions"
                  returnLabel="Back to my asset"
                >
                  <button
                    type="button"
                    className="imagine-suggest-variation"
                    disabled={
                      busy ||
                      (!asset.media &&
                        !asset.description?.trim() &&
                        !description.trim() &&
                        !source)
                    }
                    onClick={suggestVariation}
                  >
                    <Sparkles size={14} />
                    {busy ? "Working…" : "Suggest variation"}
                  </button>
                </ProviderAction>
              </div>
              <textarea
                aria-label="Describe asset image"
                rows={4}
                value={description}
                maxLength={4000}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setSuggestedBrief(null);
                }}
                placeholder={
                  mode === "vary"
                    ? "Keep the same identity. Change the light, outfit or style…"
                    : asset.kind === "character"
                      ? "A curious traveller, silver curls, a green jacket…"
                      : asset.kind === "location"
                        ? "A quiet desert observatory at dawn…"
                        : asset.kind === "prop"
                          ? "A weathered brass compass with a blue glass face…"
                          : "Soft light, muted color, tactile materials…"
                }
              />
            </div>
            {suggestionNotice && (
              <p className="imagine-suggestion-note" role="status">
                {suggestionNotice}
              </p>
            )}
            <details
              className="imagine-options imagine-brief"
              open={briefOpen}
              onToggle={(e) => setBriefOpen(e.currentTarget.open)}
            >
              <summary>
                Visual details{" "}
                <span>
                  {Object.keys(visualBrief).length
                    ? "Personalized"
                    : "Optional"}
                </span>
              </summary>
              <ProviderAction
                provider="deepseek"
                feature="asset suggestions"
                returnLabel="Back to my asset"
              >
                <button
                  type="button"
                  disabled={busy || !input.description.trim()}
                  onClick={suggestDetails}
                >
                  {suggesting ? (
                    <LoaderCircle size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}{" "}
                  {suggesting ? "Suggesting details…" : "Suggest details"}
                </button>
              </ProviderAction>
              {suggestedBrief && (
                <div className="imagine-brief-suggestion">
                  <p>Suggested details · your original writing stays intact</p>
                  {Object.entries(suggestedBrief).map(([key, value]) => (
                    <p key={key}>
                      <b>
                        {
                          visualBriefFields[asset.kind]?.find(
                            ([id]) => id === key,
                          )?.[1]
                        }
                      </b>{" "}
                      {value}
                    </p>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setVisualBrief((old) => ({ ...old, ...suggestedBrief }));
                      setSuggestedBrief(null);
                    }}
                  >
                    Use these details
                  </button>
                  <button type="button" onClick={() => setSuggestedBrief(null)}>
                    Dismiss
                  </button>
                </div>
              )}
              {(visualBriefFields[asset.kind] || []).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <textarea
                    rows={2}
                    aria-label={label}
                    maxLength={600}
                    value={visualBrief[key] || ""}
                    onChange={(e) =>
                      setVisualBrief((old) => ({
                        ...old,
                        [key]: e.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </details>
          </div>
          <div className="imagine-generation-footer">
            <div className="imagine-output-controls">
              <small>
                Square image · style follows your words and reference
              </small>
              <button
                className="imagine-model-button"
                type="button"
                aria-expanded={modelOpen}
                onClick={() => setModelOpen(!modelOpen)}
              >
                <SlidersHorizontal size={14} />
                {model.name}
                <ChevronDown size={12} />
              </button>
            </div>
            {modelOpen && (
              <div className="imagine-model-options" aria-label="Image models">
                <label className="imagine-candidate-count">
                  Images to choose from{" "}
                  <select
                    aria-label="Number of images"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "image" : "images"}
                      </option>
                    ))}
                  </select>
                </label>
                <small>
                  Each image uses the same description and selected model.
                </small>
                {imageModels
                  .filter((item) => item.mode === mode)
                  .map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={model.id === item.id}
                      onClick={() => {
                        setProvider(item.provider);
                        setPreferredModel(item.id);
                        setModelOpen(false);
                      }}
                    >
                      <b>{item.name}</b>
                      <small>
                        {item.provider === "fal" ? "fal.ai" : item.provider === "xai" ? "xAI" : "Venice"} ·{" "}
                        {mode === "vary"
                          ? "Edit a reference"
                          : "Create from words"}
                      </small>
                      <span>
                        {item.price
                          ? `~$${item.price.toFixed(2)} / image${item.inputPrice ? " + input images" : ""}`
                          : "Estimate before generation"}
                      </span>
                    </button>
                  ))}
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <ProviderAction
              lane="image"
              provider={model.provider}
              feature="image generation"
              returnLabel="Back to my asset"
            >
              {quote ? (
                <div className="imagine-confirm">
                  <span>
                    {quote.executionMode === "test"
                      ? "Offline mode · no AI request"
                      : `${count} image${count === 1 ? "" : "s"} · estimated $${quote.price.amount.toFixed(3)}`}
                  </span>
                  <HoldGenerate
                    quality={quality}
                    qualityOptions={qualityOptions}
                    onQualityChange={(value) => {
                      if (value !== quality) {
                        refreshQualityQuote.current = true;
                        setQuote(null);
                        setQuality(value);
                      }
                    }}
                    enabled
                    disabled={busy}
                    busy={busy}
                    requestKey={quote.id}
                    label={
                      count === 1 ? "asset image" : `${count} asset images`
                    }
                    price={
                      quote.executionMode === "test"
                        ? "$0 · Offline"
                        : `~$${quote.price.amount.toFixed(3)}`
                    }
                    onGenerate={generate}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="imagine-create"
                  disabled={
                    busy ||
                    !input.description.trim() ||
                    (mode === "vary" && !source) ||
                    jobs.some(active)
                  }
                  onClick={review}
                >
                  {busy ? <LoaderCircle size={16} /> : <Sparkles size={16} />}
                  Generate{count > 1 ? ` ${count} images` : ""}
                </button>
              )}
            </ProviderAction>
          </div>
        </div>
        <div className="imagine-results">
          <div className="imagine-results-heading">
            <b>
              {shown.length
                ? freshResults
                  ? "Choose your look"
                  : "Previous results"
                : "A new possibility"}
            </b>
            <small>
              {ready.length > 0
                ? `${ready.length} ready`
                : mode === "vary"
                  ? "Guided by your reference"
                  : "Your images will appear here"}
            </small>
          </div>
          {sourceImage && mode === "vary" && (
            <AssetUnderstanding
              key={source}
              asset={attached ? asset : referenceAsset}
              project={project}
              selectedMediaId={source}
              change={(next) => {
                if (attached && onReferenceAdded) onReferenceAdded(next);
                else setReferenceDetails((old) => ({ ...old, [source]: next }));
              }}
            />
          )}
          {!shown.length && sourceImage && mode === "vary" ? (
            <div className="imagine-reference-preview">
              <img
                src={`/api/media/${sourceImage.id}/original`}
                alt="Selected reference preview"
              />
              <div>
                <span>
                  {attached
                    ? "Existing look"
                    : "Reference preview · not added as a look yet"}
                </span>
                <button type="button" disabled={busy} onClick={useReference}>
                  <Check size={15} /> {[asset.media,...(asset.mediaList || []),...(asset.variants || []).map(v=>v.media)].some(m=>m?.id===sourceImage?.id) ? "Use existing reference" : "Add this image"}
                </button>
              </div>
            </div>
          ) : shown.length ? (
            <div
              className={`imagine-result-grid ${shown.length === 1 ? "single" : ""}`}
            >
              {shown.map((job) => (
                <button
                  type="button"
                  key={job.id}
                  className={`imagine-result-card ${job.state}`}
                  aria-label={`${job.input.variationName || job.input.name || "Image"} · ${job.state}`}
                  aria-pressed={chosen?.id === job.id}
                  onClick={() => setSelected(job.id)}
                >
                  {job.state === "ready" ? (
                    <>
                      <img
                        src={`/api/media/${job.media.id}/original`}
                        alt={job.input.variationName || job.input.description}
                      />
                      <span>
                        <b>{job.input.variationName || "Your image"}</b>
                        {job.executionMode === "test" && (
                          <small>Offline sample</small>
                        )}
                      </span>
                      {chosen?.id === job.id && (
                        <Check className="imagine-selection-check" size={17} />
                      )}
                    </>
                  ) : (
                    <div className="imagine-result-status">
                      {active(job) ? (
                        <LoaderCircle size={26} />
                      ) : (
                        <RefreshCw size={24} />
                      )}
                      <b>{job.input.variationName || "New look"}</b>
                      <small>
                        {active(job)
                          ? job.state
                          : job.error || "Could not create this image"}
                      </small>
                      {active(job) && <progress aria-label="Image progress" />}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="imagine-results-empty">
              <ImagePlus size={42} strokeWidth={1.1} />
              <b>
                {asset.kind === "character"
                  ? "Meet your next character"
                  : asset.kind === "location"
                    ? "Imagine a place"
                    : asset.kind === "prop"
                      ? "Make the details yours"
                      : "Find your visual language"}
              </b>
              <p>Write your idea, or add a reference to use or transform.</p>
            </div>
          )}
          {chosen?.canRetrieve &&
            ["failed", "submission_uncertain"].includes(chosen.state) && (
              <div className="imagine-result-actions">
                <button type="button" disabled={busy} onClick={retrieve}>
                  <RefreshCw size={15} />
                  Retrieve existing result
                </button>
              </div>
            )}
          {ready.length > 0 && (
            <div className="imagine-result-actions">
              <button
                type="button"
                disabled={chosen?.state !== "ready"}
                onClick={() => attach()}
              >
                <Check size={15} />
                {asset.media ? "Save selected look" : "Use selected image"}
              </button>
              {asset.media && (
                <button
                  type="button"
                  disabled={chosen?.state !== "ready"}
                  onClick={() => attach(false, true)}
                >
                  <Check size={15} />
                  Use as main reference
                </button>
              )}
              {ready.length > 1 && (
                <button type="button" onClick={() => attach(true)}>
                  <Layers size={15} />
                  Save all {ready.length} looks
                </button>
              )}
            </div>
          )}
          {!!jobs.length && (
            <details className="imagine-history-details">
              <summary>
                Previous generations <span>{jobs.length}</span>
              </summary>
              <div className="imagine-history">
                {jobs.map((job) => (
                  <button
                    type="button"
                    key={job.id}
                    title={job.error || job.input.variationName || job.state}
                    aria-label={`View saved generation ${job.input.variationName || job.input.name || ""} ${job.state}`}
                    onClick={() => {
                      setShowResults(true);
                      setBatchIds([job.id]);
                      setSubmittedSignature(null);
                      setSelected(job.id);
                    }}
                  >
                    {job.media ? (
                      <img src={job.media.thumbnail} alt="" />
                    ) : active(job) ? (
                      <LoaderCircle size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
