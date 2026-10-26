import React, { useState } from "react";
import { Copy, ClipboardPaste, Check, X } from "lucide-react";
import {
  assetImagePrompt,
  assetMetadataPrompt,
  parseAssetMetadata,
  applyAssetMetadata,
  assetProfileWarnings,
} from "../shared/asset-exchange.mjs";
import { uid } from "./state";
export function AssetExchange({ asset, project, change }) {
  const key = `frame-asset-json-${project.id}-${asset.id}`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) || ""; } catch { return ""; } });
  const [open, setOpen] = useState(false),
    [review, setReview] = useState(null),
    [message, setMessage] = useState("");
  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied. Paste it into your image AI chat.`);
    } catch {
      setMessage("Clipboard unavailable. Select and copy the text below.");
      setText(value);
      setOpen(true);
    }
  }
  return (
    <section className="asset-exchange">
      <div className="asset-exchange-actions">
        <button
          type="button"
          onClick={() => copy(assetImagePrompt(asset, project), "Image prompt")}
        >
          <Copy size={14} /> Copy image prompt
        </button>
        <button
          type="button"
          onClick={() =>
            copy(assetMetadataPrompt(asset, project), "Profile request")
          }
        >
          <Copy size={14} /> Copy JSON request
        </button>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <ClipboardPaste size={14} /> Paste AI profile
        </button>
      </div>
      <small>
        Generate a reference here or upload one, then optionally request its profile JSON.
        Review any imported profile before applying it.
      </small>
      {open && (
        <div>
          <textarea
            aria-label="AI asset profile JSON"
            rows={6}
            value={text}
            placeholder="Paste the JSON response…"
            onChange={(e) => {
              setText(e.target.value);
              try { localStorage.setItem(key, e.target.value); } catch { /* Keep editing in memory when browser storage is full. */ }
              setReview(null);
            }}
          />
          <button
            type="button"
            onClick={() => {
              try {
                const patch = parseAssetMetadata(text, asset);
                setReview(patch);
                setMessage(
                  [
                    "Review proposed details below. Your images and saved asset are unchanged.",
                    ...assetProfileWarnings(patch, asset.kind),
                  ].join(" "),
                );
              } catch (e) {
                setReview(null);
                setMessage(e.message);
              }
            }}
          >
            Review profile
          </button>
          {review && (
            <div className="asset-profile-review">
              {Object.entries(review).map(([field, value]) => (
                <div key={field}>
                  <strong>{field}</strong>
                  <div className="asset-profile-diff">
                    <pre>{JSON.stringify(asset[field] ?? "", null, 2)}</pre>
                    <pre>{JSON.stringify(value, null, 2)}</pre>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="primary"
                onClick={() => {
                  change(applyAssetMetadata(asset, review, uid));
                  setReview(null);
                  setMessage(
                    "Profile applied to this draft. Save asset when ready.",
                  );
                }}
              >
                <Check size={14} /> Apply to asset draft
              </button>
              <button type="button" onClick={() => setReview(null)}>
                <X size={14} /> Discard proposal
              </button>
            </div>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
