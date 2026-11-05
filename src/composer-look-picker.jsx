import React from "react";
import { Check, LockKeyhole, Sparkles, UserRound } from "lucide-react";
import {
  selectableLooks,
  selectedLook,
  chooseLook,
  isManualLook,
} from "../shared/look-selection.mjs";
import { ComposerPopover } from "./composer-popover";

export function LookChoices({ asset, draft, change, onChoose, allAssets = [] }) {
  const looks = selectableLooks(asset);
  const manual = isManualLook(draft, asset.id);
  const selected = selectedLook(
    asset,
    manual
      ? {
          ...draft,
          referenceOptions: {
            ...draft.referenceOptions,
            [asset.id]: { variantId: "auto" },
          },
        }
      : draft,
    allAssets,
  );
  const id = manual
    ? draft.referenceOptions?.[asset.id]?.variantId || "none"
    : "auto";
  const choose = (value) => {
    change((d) => chooseLook(d, asset.id, value));
    onChoose?.();
  };
  return (
    <div className="composer-look-choices">
      <header>
        <strong>{asset.name} · Look</strong>
        <small>Applies to this clip’s shots</small>
      </header>
      <button
        type="button"
        aria-pressed={id === "auto"}
        onClick={() => choose("auto")}
      >
        <Sparkles size={20} />
        <span>
          Auto
          <small>
            {selected?.name || asset.mainLookName || "Main look"} · follows your
            scene
          </small>
        </span>
        {id === "auto" && <Check size={16} />}
      </button>
      {looks.map((look) => (
        <button
          type="button"
          key={look.id}
          aria-pressed={id === look.id}
          onClick={() => choose(look.id)}
        >
          {look.media?.thumbnail || look.media?.url ? (
            <img src={look.media.thumbnail || look.media.url} alt="" />
          ) : (
            <UserRound size={20} />
          )}
          <span>
            {look.name || "Untitled look"}
            <small>{look.description || "No description yet"}</small>
          </span>
          {id === look.id && <LockKeyhole size={16} />}
        </button>
      ))}
      {!looks.length && <p>Add an image to this character in the Library.</p>}
      <footer>
        Choosing a look locks it. Auto lets the assistant choose again.
      </footer>
    </div>
  );
}
export function ComposerLookPicker({ asset, draft, change, anchor, onClose, allAssets }) {
  if (!asset || !anchor) return null;
  return (
    <ComposerPopover
      anchor={anchor}
      onClose={onClose}
      label={`Choose look for ${asset.name}`}
    >
      <LookChoices
        asset={asset}
        draft={draft}
        change={change}
        allAssets={allAssets}
        onChoose={() => {
          onClose();
          anchor.focus();
        }}
      />
    </ComposerPopover>
  );
}
