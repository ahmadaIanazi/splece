import React, { useEffect, useRef, useState } from "react";
import { ProviderAction } from "./provider-connect";
import { Sparkles, LoaderCircle, X, Undo2 } from "lucide-react";
import { api } from "./state";
import { HoldGenerate } from "./composer-tools";
import {
  fillAssetDetails,
  assetCreativeContext,
} from "../shared/asset-intelligence.mjs";

export function AssetUnderstanding({
  asset,
  project,
  change,
  selectedMediaId,
  onVariation,
}) {
  const [quote, setQuote] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [undo, setUndo] = useState(null),
    [suggestions, setSuggestions] = useState([]);
  const alive = useRef(true),
    lock = useRef(false);
  const mediaId = selectedMediaId || asset.media?.id || "";
  const look =
    mediaId === asset.media?.id
      ? null
      : asset.variants?.find((v) => v.media?.id === mediaId);
  const input = {
    assetId: asset.id,
    mediaId,
    kind: asset.kind,
    name: asset.name || "",
    description:
      look?.description ||
      (mediaId === asset.media?.id ? asset.variant || asset.description : "") ||
      "",
    fillDetails: true,
    context: assetCreativeContext(asset),
  };
  const signature = JSON.stringify([
    input,
    asset.variant,
    asset.visualBrief,
    look?.visualBrief,
  ]);
  const current = useRef(signature);
  current.current = signature;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setQuote(null);
    setNotice("");
    setUndo(null);
    setSuggestions([]);
  }, [mediaId, asset.id]);
  useEffect(() => {
    setQuote(null);
  }, [signature]);
  async function work(fn) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function apply(result, requested, executionMode) {
    if (!alive.current) return;
    if (current.current !== requested)
      throw Error(
        "The reference or writing changed. Update description again to use the latest version.",
      );
    // Test results are a transport simulation, never a replacement for real prose.
    if (executionMode === "test") {
      setNotice("Preview complete · no AI call or description changes.");
      setQuote(null);
      return;
    }
    const next = fillAssetDetails(asset, result, mediaId);
    setSuggestions(result.variations || []);
    change(next);
    setUndo({ before: asset, after: next });
    setNotice("Details and search tags updated · you can undo");
    setQuote(null);
  }
  const review = () =>
    work(async () => {
      const requested = signature;
      const next = await api(
        `/projects/${project.id}/assets/understand/quote`,
        input,
      );
      if (!alive.current || current.current !== requested) return;
      if (next.cached && next.state === "ready" && next.result)
        apply(next.result, requested, next.executionMode);
      else if (next.state === "processing")
        throw Error(
          "This image is already being described. Try again shortly.",
        );
      else setQuote({ ...next, clientSignature: requested });
    });
  const analyze = () =>
    work(async () => {
      if (!quote || quote.clientSignature !== current.current)
        throw Error("The reference changed. Update description again.");
      const job = await api(`/projects/${project.id}/assets/understand`, {
        quoteId: quote.id,
      });
      if (job.state !== "ready")
        throw Error(
          job.error ||
            "Could not describe this image. Your writing is unchanged.",
        );
      apply(job.result, quote.clientSignature, job.executionMode);
    });
  const canUndo =
    undo &&
    [
      "description",
      "variant",
      "visualBrief",
      "descriptionMediaId",
      "name",
      "mainLookName",
      "libraryTags",
      "characterProfile",
      "voice",
      "lookTags",
      "lookKeywords",
      "variants",
    ].every(
      (key) => JSON.stringify(asset[key]) === JSON.stringify(undo.after[key]),
    );
  return (
    <section className="asset-understanding">
      <ProviderAction
        provider="deepseek"
        feature="image descriptions"
        returnLabel="Back to my asset"
      >
        <button
          type="button"
          className="asset-understand-trigger"
          disabled={busy || !mediaId}
          onClick={review}
          title={
            mediaId
              ? "Describe this image, add search tags and fill missing story details"
              : "Add an image first"
          }
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Sparkles size={15} />
          )}
          <span>{busy ? "Analyzing image…" : "Analyze & fill details"}</span>
          <small>AI</small>
        </button>
      </ProviderAction>
      {quote && (
        <div className="asset-understand-panel">
          <header>
            <span>Analyze this image</span>
            <button
              type="button"
              aria-label="Close description estimate"
              onClick={() => setQuote(null)}
            >
              <X size={13} />
            </button>
          </header>
          <p>
            {quote.executionMode === "test"
              ? "Offline mode · no credits or changes to your writing."
              : "Fill visual details and search tags from the image. Suggest missing character and voice details from your story. Your existing voice choices stay. You can undo."}
          </p>
          <ProviderAction
            provider="deepseek"
            feature="image descriptions"
            returnLabel="Back to my asset"
          >
            <HoldGenerate
              enabled
              disabled={busy}
              busy={busy}
              requestKey={quote.id}
              action="update"
              label="description"
              price={
                quote.executionMode === "test"
                  ? "$0 · Offline"
                  : quote.estimate?.amount == null
                    ? "Rate unavailable"
                    : `~$${Number(quote.estimate.amount).toFixed(4)}`
              }
              onGenerate={analyze}
            />
          </ProviderAction>
        </div>
      )}
      {notice &&
        undo &&
        Object.keys(undo.after.voice || {}).some(
          (key) => !undo.before.voice?.[key] && undo.after.voice[key],
        ) && (
          <p className="asset-voice-suggestion-note">
            Voice details were suggested from your story. Edit them in Voice.
          </p>
        )}
      {notice && (
        <p role="status">
          {notice}{" "}
          {canUndo && (
            <button
              type="button"
              className="text-action"
              onClick={() => {
                const next = { ...asset };
                for (const key of [
                  "description",
                  "variant",
                  "visualBrief",
                  "descriptionMediaId",
                  "name",
                  "mainLookName",
                  "libraryTags",
                  "characterProfile",
                  "voice",
                  "lookTags",
                  "lookKeywords",
                  "variants",
                ]) {
                  if (undo.before[key] === undefined) delete next[key];
                  else next[key] = structuredClone(undo.before[key]);
                }
                change(next);
                setUndo(null);
                setNotice("Previous description restored");
              }}
            >
              <Undo2 size={13} />
              Undo
            </button>
          )}
        </p>
      )}
      {!!suggestions.length && onVariation && (
        <div className="asset-suggested-looks">
          <small>Try another look</small>
          {suggestions.map((choice, index) => (
            <button
              type="button"
              key={index}
              onClick={() => onVariation(choice)}
            >
              {choice.name}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
