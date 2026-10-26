import { AssetUnderstanding } from "./asset-understanding";
import { ProviderAction } from "./provider-connect";
import { assetImageDraftSignature } from "../shared/asset-edit.mjs";
import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  ArrowRight,
  Check,
  ImagePlus,
  Palette,
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
  assetLooks,
  assetFramings,
  applyGeneratedImage,
} from "../shared/asset-generation.mjs";
import { variationPresets } from "../shared/asset-intelligence.mjs";
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
  initialPresetId,
  initialSourceMediaId,
  initialRatio,
}) {
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
  const [open, setOpen] = useState(embedded || (!asset.name && !asset.media)),
    [name, setName] = useState(asset.name || saved.name || ""),
    [description, setDescription] = useState(
      initialDirection ??
        (asset.media
          ? saved.mode === "vary"
            ? saved.description || ""
            : ""
          : (saved.description ?? asset.description ?? "")),
    ),
    [mode, setMode] = useState(
      initialSourceMediaId || asset.media || saved.sourceMediaId
        ? "vary"
        : "create",
    ),
    [uploaded, setUploaded] = useState(saved.uploaded || []),
    [visualBrief, setVisualBrief] = useState(
      saved.visualBrief || asset.visualBrief || {},
    ),
    [briefOpen, setBriefOpen] = useState(false),
    [modelOpen, setModelOpen] = useState(false),
    [suggestedBrief, setSuggestedBrief] = useState(null),
    [suggesting, setSuggesting] = useState(false),
    [source, setSource] = useState(
      initialSourceMediaId ||
        (saved.mode === "vary" && saved.sourceMediaId) ||
        asset.media?.id ||
        "",
    ),
    [look, setLook] = useState(saved.look || "auto"),
    [framing, setFraming] = useState(
      saved.framing || assetFramings[asset.kind][0][0],
    ),
    [ratio, setRatio] = useState(
      initialRatio ||
        saved.ratio ||
        (asset.kind === "location" ? "16:9" : "1:1"),
    ),
    [provider, setProvider] = useState(saved.provider || "venice"),
    [preferredModel, setPreferredModel] = useState(
      saved.modelId || "venice-grok-quality",
    ),
    [count, setCount] = useState(1),
    [presetIds, setPresetIds] = useState(
      initialPresetId ? [initialPresetId] : [],
    ),
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
  const presets = variationPresets(asset.kind),
    model =
      imageModels.find(
        (item) => item.id === preferredModel && item.mode === mode,
      ) ||
      imageModels.find(
        (item) => item.provider === provider && item.mode === mode,
      );
  const input = {
    assetId: asset.id,
    name,
    description:
      description.trim() ||
      (mode === "vary"
        ? "Preserve this reference and create the selected look."
        : ""),
    kind: asset.kind,
    visualBrief,
    mode,
    modelId: model.id,
    framing,
    look,
    ratio,
    sourceMediaId: mode === "vary" ? source : "",
    count,
    presetIds,
  };
  const signature = JSON.stringify({ input, settings: project.settings }),
    current = useRef(signature);
  current.current = signature;
  useEffect(() => {
    setQuote(null);
    saveLocalDraft(localStorage, recoveryKey, {
      ...input,
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
        onReferenceAdded?.(appendCharacterImage(asset, media));
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
  const shown = batchIds.length
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
  const togglePreset = (id) =>
    setPresetIds((old) =>
      old.includes(id)
        ? old.filter((item) => item !== id)
        : count === 1
          ? [id]
          : [...old, id].slice(-count),
    );
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
            <div
              className="imagine-reference-drop"
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
              {mode === "vary" && sourceImage ? (
                <>
                  <img
                    src={
                      sourceImage.thumbnail ||
                      `/api/media/${sourceImage.id}/original`
                    }
                    alt="Image reference"
                  />
                  <span>
                    <b>Keep this identity</b>
                    <small>Describe what should change below</small>
                  </span>
                  <button
                    type="button"
                    aria-label="Remove image reference"
                    onClick={() => {
                      setMode("create");
                      setSource("");
                    }}
                  >
                    <X size={15} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => uploadInput.current?.click()}
                >
                  <Upload size={19} />
                  <span>
                    <b>Add a photo · optional</b>
                    <small>Drop an image or choose a file</small>
                  </span>
                </button>
              )}
              {mode === "vary" && sourceImage && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => uploadInput.current?.click()}
                  aria-label="Choose another reference"
                >
                  <ImagePlus size={16} />
                </button>
              )}
            </div>
            {sourceImage && onReferenceAdded && (
              <AssetUnderstanding
                asset={asset}
                project={project}
                selectedMediaId={sourceImage.id}
                change={onReferenceAdded}
              />
            )}
            {uploaded.some((m) => m.id === source) && (
              <button
                className="imagine-use-upload"
                type="button"
                onClick={() => change(appendCharacterImage(asset, sourceImage))}
              >
                <Check size={14} />
                View uploaded photo
              </button>
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
            <label className="imagine-direction">
              <span>
                {mode === "vary" ? "What should change?" : "Describe your idea"}
              </span>
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
            </label>
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
              <ProviderAction provider="deepseek" feature="asset suggestions" returnLabel="Back to my asset">
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
            <details className="imagine-options imagine-quick-looks">
              <summary>Explore variations</summary>
              <div>
                {presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    title={preset.prompt}
                    aria-pressed={presetIds.includes(preset.id)}
                    onClick={() => togglePreset(preset.id)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </details>
            <div className="imagine-style">
              <label>Style</label>
              <div>
                {assetLooks.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={look === item.id}
                    onClick={() => setLook(item.id)}
                  >
                    <Palette size={13} />
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
            <details className="imagine-options">
              <summary>
                <ChevronDown size={13} />
                Framing & shape <span>{ratio}</span>
              </summary>
              <div className="imagine-pill-options" aria-label="Image framing">
                {assetFramings[asset.kind].map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={framing === id}
                    onClick={() => setFraming(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                className="imagine-pill-options"
                aria-label="Image aspect ratio"
              >
                {["1:1", "16:9", "9:16"].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={ratio === value}
                    onClick={() => setRatio(value)}
                  >
                    <i style={{ aspectRatio: value.replace(":", "/") }} />
                    {value}
                  </button>
                ))}
              </div>
            </details>
          </div>
          <div className="imagine-generation-footer">
            <div className="imagine-output-controls">
              <div>
                <span>Variations</span>
                <div>
                  {[1, 4].map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={count === value}
                      onClick={() => {
                        setCount(value);
                        setPresetIds((ids) => ids.slice(0, value));
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
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
                        {item.provider === "fal" ? "fal.ai" : "Venice"} ·{" "}
                        {mode === "vary"
                          ? "Edit a reference"
                          : "Create from words"}
                      </small>
                      <span>
                        {item.price
                          ? `~$${item.price.toFixed(2)} / image`
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
            <ProviderAction provider={model.provider} feature="image generation" returnLabel="Back to my asset">
            {quote ? (
              <div className="imagine-confirm">
                <span>
                  {quote.executionMode === "test"
                    ? "Offline mode · no AI request"
                    : `${count} image${count === 1 ? "" : "s"} · estimated $${quote.price.amount.toFixed(3)}`}
                </span>
                <HoldGenerate
                  enabled
                  disabled={busy}
                  busy={busy}
                  requestKey={quote.id}
                  label={count === 1 ? "asset image" : "4 asset images"}
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
                Get estimate · {count === 1 ? "1 image" : "4 variations"}
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
          {shown.length ? (
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
              <p>Describe it, choose a look, then create.</p>
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
