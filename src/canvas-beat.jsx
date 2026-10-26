import React from "react";
import { Camera, ChevronDown, ArrowDown, X, Trash2 } from "lucide-react";
import { CanvasWriting } from "./canvas-writing";
import { ShotDirection } from "./composer-tools";
import { AssistantWritingHelp } from "./composer-assistant";
import {
  composerEvents,
  saveComposerEvents,
} from "../shared/composer-sequence.mjs";
import "./canvas-beat.css";

// Keep the original writing canvas. Only the in-field actor, mentions and
// relationship control extend its existing dialogue rows.
export function CanvasBeat({
  scene,
  index,
  count,
  assets,
  allAssets,
  presets = [],
  change,
  remove,
  move,
  onMention,
  onFocus,
  onDropAsset,
  onCursor,
  cameraOpen,
  onCamera,
  assistant,
}) {
  const events = composerEvents(scene);
  const editEvents = (fn) =>
    change((target) => {
      const list = composerEvents(target);
      fn(list);
      saveComposerEvents(target, list);
    });
  const updateEvent = (id, patch) =>
    editEvents((list) => {
      const event = list.find((item) => item.id === id);
      if (event) Object.assign(event, patch);
    });
  const reference = (asset) => {
    onMention(asset);
    if (asset.kind === "character")
      change((target) => {
        if (
          target.characterIds?.length &&
          !target.characterIds.includes(asset.id)
        )
          target.characterIds.push(asset.id);
      });
  };
  const candidates = [
    ...assets,
    ...allAssets.filter(
      (asset) => !assets.some((item) => item.id === asset.id),
    ),
  ];
  return (
    <article
      className="canvas-beat"
      data-scene-id={scene.id}
      onFocusCapture={onFocus}
      onClick={onFocus}
    >
      <div className="canvas-beat-heading">
        <span className="canvas-shot-label">Shot {index + 1}</span>
        {count > 1 && (
          <button
            type="button"
            className="canvas-remove-shot"
            aria-label={`Remove shot ${index + 1}`}
            title="Remove shot · Undo available"
            onClick={(e) => {
              e.stopPropagation();
              remove();
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {cameraOpen && (
        <ShotDirection
          scene={scene}
          index={index}
          count={count}
          assets={assets}
          change={change}
          move={move}
        />
      )}
      <div className="canvas-shot-writing">
        <button
          type="button"
          className="canvas-camera-trigger"
          aria-label={`Shot ${index + 1} direction`}
          aria-expanded={cameraOpen}
          onClick={onCamera}
        >
          <Camera size={16} />
          <span>
            {scene.cameraDirection ? "Custom" : scene.camera || "Auto"}
          </span>
          <ChevronDown size={10} />
        </button>
        <div className="canvas-shot-prose">
          <CanvasWriting
            assets={allAssets}
            onMention={reference}
            label={`Scene ${index + 1} description`}
            placeholder={
              index
                ? "What happens next?"
                : "What happens in this clip? Write freely…"
            }
            value={scene.text}
            onChange={(text) =>
              change((target) => {
                target.text = text;
              })
            }
            onCursor={onCursor}
            onDropAsset={(id, range) => onDropAsset(id, scene.id, range)}
            quotedMentions
          />
          <AssistantWritingHelp assistant={assistant} scene={scene} />
        </div>
      </div>
      {events.map((event, eventIndex) => {
        const actor = allAssets.find((asset) => asset.id === event.speaker);
        const choices = candidates.filter(asset => asset.kind === "character");
        const when =
          event.relation === "together"
            ? "At the same time"
            : event.relation === "pause"
              ? `Then · ${event.pause}s pause`
              : "Then";
        return (
          <React.Fragment key={event.id}>
            {eventIndex > 0 && (
              <div className="canvas-moment-link">
                <span aria-hidden="true">•</span>
                <button
                  type="button"
                  aria-label={`Timing before entry ${eventIndex + 1}: ${when}`}
                  aria-pressed={event.relation === "together"}
                  title="Switch between Then and At the same time"
                  onClick={() =>
                    updateEvent(event.id, {
                      relation:
                        event.relation === "together" ? "next" : "together",
                    })
                  }
                >
                  <ArrowDown size={11} aria-hidden="true" />
                  {when}
                  <ChevronDown size={10} aria-hidden="true" />
                </button>
              </div>
            )}
            <div
              className="canvas-dialogue canvas-moment"
              data-moment-id={event.id}
            >
              <div className="canvas-dialogue-heading">
                <select
                  aria-label={`Entry ${eventIndex + 1} type`}
                  value={event.kind}
                  onChange={(e) => {
                    const kind = e.target.value;
                    updateEvent(event.id, {
                      kind,
                      ...(kind === "speak" && actor?.kind !== "character"
                        ? { speaker: "" }
                        : {}),
                    });
                  }}
                >
                  <option value="speak">Dialogue</option>
                  <option value="action">Action</option>
                  <option value="emote">Emotion</option>
                </select>
                <select
                  aria-label={`Character or reference for entry ${eventIndex + 1}`}
                  value={event.speaker || ""}
                  onChange={(e) => {
                    const asset = allAssets.find(
                      (item) => item.id === e.target.value,
                    );
                    updateEvent(event.id, {
                      speaker: e.target.value,
                      delivery: asset?.delivery || "Auto",
                    });
                    if (asset) reference(asset);
                  }}
                >
                  <option value="">
                    {event.kind === "speak" ? "Choose character" : "The scene"}
                  </option>
                  {event.speaker &&
                    !choices.some((asset) => asset.id === event.speaker) && (
                      <option value={event.speaker}>
                        {actor?.name || "Missing character"}
                      </option>
                    )}
                  {choices.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
                {event.kind === "speak" && (
                  <select
                    aria-label={`Delivery for entry ${eventIndex + 1}`}
                    value={event.delivery || "Auto"}
                    onChange={(e) =>
                      updateEvent(event.id, { delivery: e.target.value })
                    }
                  >
                    {[
                      ...new Set(
                        ["Auto", ...presets, event.delivery].filter(Boolean),
                      ),
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  aria-label={`Remove entry ${eventIndex + 1}`}
                  onClick={() =>
                    editEvents((list) =>
                      list.splice(
                        list.findIndex((item) => item.id === event.id),
                        1,
                      ),
                    )
                  }
                >
                  <X size={13} />
                </button>
              </div>
              <CanvasWriting
                assets={allAssets}
                onMention={reference}
                quotedMentions
                label={`${event.kind === "speak" ? "Dialogue" : event.kind === "action" ? "Action" : "Emotion"} text for entry ${eventIndex + 1}`}
                placeholder={
                  event.kind === "speak"
                    ? "Exact spoken words…"
                    : "What happens? Use @ to reference an asset…"
                }
                value={event.text}
                onChange={(text) => updateEvent(event.id, { text })}
                onDropAsset={(id, range) => {
                  const asset = allAssets.find((item) => item.id === id);
                  if (!asset || ["footage", "audio"].includes(asset.kind))
                    return;
                  const start = range?.start ?? event.text.length;
                  const end = range?.end ?? start;
                  updateEvent(event.id, {
                    text:
                      event.text.slice(0, start) +
                      `@[${asset.name}] ` +
                      event.text.slice(end),
                  });
                  reference(asset);
                }}
              />
              <details
                className="dialogue-direction"
                open={event.direction ? true : undefined}
              >
                <summary>
                  {event.kind === "speak" ? "Delivery direction" : "Direction"}
                </summary>
                <input
                  aria-label={`Direction for entry ${eventIndex + 1}`}
                  placeholder="How is this delivered?"
                  value={event.direction || ""}
                  onChange={(e) =>
                    updateEvent(event.id, { direction: e.target.value })
                  }
                />
              </details>
            </div>
          </React.Fragment>
        );
      })}
    </article>
  );
}
