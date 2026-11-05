import { ComposerPopover } from "./composer-popover";
import { ComposerLookPicker } from "./composer-look-picker";
import { selectedLook } from "../shared/look-selection.mjs";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  AudioLines,
  Camera,
  Check,
  ChevronDown,
  GripVertical,
  MessageCircle,
  Plus,
  Smile,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { CanvasWriting } from "./canvas-writing";
import { AssistantWritingHelp } from "./composer-assistant";
import {
  composerEvents,
  saveComposerEvents,
  moveComposerEvent,
} from "../shared/composer-sequence.mjs";
import { uid } from "./state";
import "./dialogue-stream.css";

const kinds = [
  {
    id: "speak",
    label: "Speak",
    Icon: MessageCircle,
    placeholder: "What do they say?",
  },
  { id: "action", label: "Action", Icon: Zap, placeholder: "What happens?" },
  {
    id: "emote",
    label: "Emote",
    Icon: Smile,
    placeholder: "How do they feel?",
  },
];
function Portrait({ asset }) {
  return (
    <span className="stream-avatar" aria-hidden="true">
      {asset?.media?.thumbnail ? (
        <img src={asset.media.thumbnail} alt="" />
      ) : asset ? (
        asset.name?.slice(0, 1)
      ) : (
        <Users size={16} />
      )}
    </span>
  );
}
function CharacterPicker({
  value,
  characters,
  onChange,
  onLook,
  label,
  allowScene = false,
  compact = false,
  onAdd,
}) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const actor = characters.find((asset) => asset.id === value);
  const choose = (id) => {
    onChange(id);
    setOpen(false);
    trigger.current?.focus();
    const asset = characters.find(a => a.id === id);
    if (asset) onLook?.(asset, trigger.current);
  };
  return (
    <div
      className={`stream-character-picker${compact ? " compact" : ""}`}
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="stream-character-name"
        ref={trigger}
        aria-label={label}
        title={compact ? label : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Portrait asset={actor} />
        <span>
          {actor?.name || (allowScene ? "The scene" : "Choose character")}
        </span>
        {compact && <ChevronDown size={12} aria-hidden="true" />}
      </button>
      {open && (
        <ComposerPopover anchor={trigger.current} onClose={() => setOpen(false)} label="Choose character">
          {allowScene && (
            <button type="button" onClick={() => choose("")}>
              The scene
            </button>
          )}
          {characters.map((asset) => (
            <button
              type="button"
              key={asset.id}
              aria-pressed={asset.id === value}
              onClick={() => choose(asset.id)}
            >
              <Portrait asset={asset} />
              <span>{asset.name}</span>
            </button>
          ))}
          {!characters.length && <span>No project characters yet.</span>}
          {onAdd && <button type="button" onClick={() => { setOpen(false); onAdd(); }}><Plus size={16} aria-hidden="true" />Add character or asset</button>}
        </ComposerPopover>
      )}
    </div>
  );
}
export function DialogueStream({
  draft,
  scene,
  assets,
  allAssets,
  presets = [],
  editDraft,
  onSelect,
  onAddShot,
  onAssets,
  onLibrary,
  onSound,
  soundMode = false,
  soundComposer,
  onMention,
  onDropAsset,
  onCursor,
  cameraOpen,
  onCamera,
  directionEditor,
  assistant,
}) {
  const [drafts, setDrafts] = useState({});
  const [lookTarget, setLookTarget] = useState(null);
  const [composeCollapsed, setComposeCollapsed] = useState(false);
  const openLook = (asset, anchor) => setLookTarget({ id: asset.id, anchor });
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(null);
  const input = useRef(null);
  const stream = useRef(null);
  const optionButtons = useRef(new Map());
  const finishEditing = (id) => {
    setSelected(null);
    requestAnimationFrame(() => optionButtons.current.get(id)?.focus());
  };
  const displayAssets = allAssets.map(asset => {
    if (asset.kind !== "character") return asset;
    const look = selectedLook(asset, draft, allAssets);
    return { ...asset, media: look?.media || asset.media };
  });
  const cast = displayAssets.filter(asset => asset.kind === "character" && assets.some(a => a.id === asset.id));
  const characters = [
    ...cast,
    ...displayAssets.filter(
      (asset) =>
        asset.kind === "character" &&
        !cast.some((item) => item.id === asset.id),
    ),
  ];
  const shotIndex = draft.scenes.findIndex((item) => item.id === scene?.id);
  const pending = drafts[scene?.id] || {};
  const kind = pending.kind || (cast.length ? "speak" : "action");
  const speaker = pending.speaker ?? cast[0]?.id ?? "";
  const activeCharacter = characters.find((asset) => asset.id === speaker);
  const currentKind = kinds.find((item) => item.id === kind);
  const events = scene ? composerEvents(scene) : [];
  const changeInput = (patch) =>
    setDrafts((previous) => ({
      ...previous,
      [scene.id]: { ...previous[scene.id], ...patch },
    }));
  useEffect(() => {
    setSelected(null);
    setDragging(null);
    setNotice("");
  }, [scene?.id]);
  const change = (fn) =>
    editDraft((next) => {
      const target = next.scenes.find((item) => item.id === scene.id);
      if (target) fn(target);
    });
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
  const selectCharacter = (id, eventId) => {
    if (eventId) updateEvent(eventId, { speaker: id });
    else changeInput({ speaker: id });
    const asset = characters.find((item) => item.id === id);
    if (asset) reference(asset);
  };
  const move = (id, delta) => {
    editEvents((list) => {
      const from = list.findIndex((item) => item.id === id);
      const to = from + delta;
      if (from >= 0 && to >= 0 && to < list.length) {
        const [event] = list.splice(from, 1);
        list.splice(to, 0, event);
      }
    });
    setNotice(`Moment moved ${delta < 0 ? "earlier" : "later"}.`);
    requestAnimationFrame(() => optionButtons.current.get(id)?.focus());
  };
  const drop = (event, targetId, together) => {
    const sourceId = event.dataTransfer.getData("application/x-composer-event");
    if (!sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    change((target) => moveComposerEvent(target, sourceId, targetId, together));
    setDragging(null);
    setNotice(together ? "Moments now play together." : "Moment moved.");
  };
  const submit = () => {
    if (!pending.text?.trim() || (kind === "speak" && !activeCharacter)) return;
    const id = uid();
    editEvents((list) =>
      list.push({
        id,
        kind,
        speaker: activeCharacter?.id || "",
        text: pending.text.trim(),
        delivery: activeCharacter?.delivery || "Auto",
        direction: "",
        relation: "next",
        pause: 1,
      }),
    );
    // Explicit shot cast restrictions must include the character just authored.
    if (activeCharacter)
      change((target) => {
        if (
          target.characterIds?.length &&
          !target.characterIds.includes(speaker)
        )
          target.characterIds.push(speaker);
      });
    changeInput({ text: "" });
    setSelected(null);
    setNotice(`${currentKind.label} added to shot ${shotIndex + 1}.`);
    requestAnimationFrame(() => {
      stream.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
      input.current?.focus({ preventScroll: true });
    });
  };
  if (!scene)
    return (
      <button type="button" onClick={onAddShot}>
        <Plus size={16} /> Add your first shot
      </button>
    );
  return (
    <section className={`dialogue-stream ${soundMode ? "is-sound-mode" : ""}`} aria-label={soundMode ? "Video sound composer" : "Dialogue stream composer"}>
      <div className="stream-topbar">
        {soundMode ? <strong className="stream-shots">Sound</strong> : <nav className="stream-shots" aria-label="Shot sequence">
          {draft.scenes.map((shot, index) => (
            <button
              type="button"
              key={shot.id}
              aria-pressed={shot.id === scene.id}
              onClick={() => onSelect(shot.id)}
            >
              Shot {index + 1}
              {shot.duration ? <small>{shot.duration}s</small> : null}
            </button>
          ))}
          <button
            type="button"
            aria-label="Add next shot"
            title="Add next shot"
            onClick={onAddShot}
          >
            <Plus size={16} />
          </button>
        </nav>}
        <button
          type="button"
          aria-label="Open prompt library"
          title="Prompt library"
          onClick={onLibrary}
        >
          <BookOpen size={16} />
        </button>
        {onSound && <button type="button" aria-label="Sound prompt composer" title="Sound prompt composer" aria-pressed={soundMode} onClick={onSound}><AudioLines size={16} /></button>}
      </div>
      {soundMode ? soundComposer : <>
      <div className="stream-scroll" data-scene-id={scene.id}>
        <details
          className="stream-scene"
          key={scene.id}
          open={!!scene.text && !events.length}
        >
          <summary>
            <Camera size={14} aria-hidden="true" />
            <span>Scene & direction</span>
            <small>{scene.text ? "Your scene is saved" : "Optional"}</small>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="stream-scene-body">
            <label className="stream-field-label">
              What’s happening around them?
            </label>
            <CanvasWriting
              assets={displayAssets}
              onMention={onMention}
              onLook={openLook}
              label={`Scene ${shotIndex + 1} description`}
              placeholder="A place, an opening action, a little atmosphere…"
              value={scene.text}
              onChange={(text) =>
                change((target) => {
                  target.text = text;
                })
              }
              onCursor={onCursor}
              onDropAsset={(id, range) => onDropAsset(id, scene.id, range)}
            />
            <AssistantWritingHelp assistant={assistant} scene={scene} />
            <button
              type="button"
              className="stream-direction-button"
              aria-label={`Shot ${shotIndex + 1} direction`}
              aria-expanded={cameraOpen}
              onClick={onCamera}
            >
              <Camera size={15} />{" "}
              {cameraOpen ? "Close camera settings" : "Camera, cast & timing"}
            </button>
            {cameraOpen && (
              <div className="stream-direction-editor">{directionEditor}</div>
            )}
            <div className="stream-shot-actions">
              <button
                type="button"
                disabled={!shotIndex}
                onClick={() =>
                  editDraft((next) => {
                    const i = next.scenes.findIndex(
                      (shot) => shot.id === scene.id,
                    );
                    next.scenes.splice(i - 1, 0, next.scenes.splice(i, 1)[0]);
                  })
                }
              >
                <ArrowUp size={14} /> Earlier shot
              </button>
              <button
                type="button"
                disabled={shotIndex === draft.scenes.length - 1}
                onClick={() =>
                  editDraft((next) => {
                    const i = next.scenes.findIndex(
                      (shot) => shot.id === scene.id,
                    );
                    next.scenes.splice(i + 1, 0, next.scenes.splice(i, 1)[0]);
                  })
                }
              >
                <ArrowDown size={14} /> Later shot
              </button>
              {draft.scenes.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const nextId =
                      draft.scenes[shotIndex ? shotIndex - 1 : 1].id;
                    editDraft((next) => {
                      next.scenes = next.scenes.filter(
                        (shot) => shot.id !== scene.id,
                      );
                    });
                    onSelect(nextId);
                  }}
                >
                  <Trash2 size={14} /> Delete shot
                </button>
              )}
            </div>
          </div>
        </details>
        <ol
          className="stream-events"
          aria-label={`Shot ${shotIndex + 1} moments`}
          ref={stream}
        >
          {events.map((event, index) => {
            const type = kinds.find((item) => item.id === event.kind);
            const actor = allAssets.find((asset) => asset.id === event.speaker);
            return (
              <li
                key={event.id}
                data-kind={event.kind}
                data-together={event.relation === "together"}
                data-selected={selected === event.id}
                data-dragging={dragging === event.id}
              >
                {dragging && dragging !== event.id && (
                  <div
                    className="stream-drop-before"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => drop(e, event.id, false)}
                  >
                    Move here
                  </div>
                )}
                {index > 0 && (
                  <div className="stream-relationship">
                    <button
                      type="button"
                      aria-pressed={event.relation === "together"}
                      aria-label={`Timing before moment ${index + 1}: ${event.relation === "together" ? "At the same time" : "Then"}`}
                      onClick={() =>
                        updateEvent(event.id, {
                          relation:
                            event.relation === "together" ? "next" : "together",
                        })
                      }
                    >
                      <ArrowDown size={11} aria-hidden="true" />
                      {event.relation === "together"
                        ? "At the same time"
                        : event.relation === "pause"
                          ? `${event.pause}s pause`
                          : "Then"}
                    </button>
                  </div>
                )}
                <article
                  className="stream-event"
                  onDragOver={(e) => {
                    if (
                      e.dataTransfer.types.includes(
                        "application/x-composer-event",
                      )
                    )
                      e.preventDefault();
                  }}
                  onDrop={(e) => drop(e, event.id, true)}
                >
                  <header>
                    <CharacterPicker
                      value={event.speaker || ""}
                      characters={characters}
                      onLook={openLook}
                      label={`Change character for moment ${index + 1}: ${actor?.name || "The scene"}`}
                      allowScene={event.kind !== "speak"}
                      onChange={(id) => selectCharacter(id, event.id)}
                    />
                    <div className="stream-message-controls">
                      <span className="stream-event-type">
                        <type.Icon size={13} aria-hidden="true" />
                        {type.label}
                      </span>
                      <button
                        type="button"
                        aria-label={`Edit moment ${index + 1} options`}
                        ref={(node) => {
                          if (node) optionButtons.current.set(event.id, node);
                          else optionButtons.current.delete(event.id);
                        }}
                        aria-expanded={selected === event.id}
                        onClick={() =>
                          setSelected(selected === event.id ? null : event.id)
                        }
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                  </header>
                  <CanvasWriting
                    assets={displayAssets}
                    onMention={reference}
                    onLook={openLook}
                    quotedMentions
                    autoDirection
                    label={`${type.label} text for moment ${index + 1}`}
                    value={event.text}
                    placeholder={type.placeholder}
                    onChange={(text) => updateEvent(event.id, { text })}
                    onDropAsset={(id, range) => {
                      const asset = allAssets.find((item) => item.id === id);
                      if (!asset || ["footage", "audio"].includes(asset.kind))
                        return;
                      const start = range?.start ?? event.text.length;
                      updateEvent(event.id, {
                        text:
                          event.text.slice(0, start) +
                          `@[${asset.name}] ` +
                          event.text.slice(range?.end ?? start),
                      });
                      reference(asset);
                    }}
                  />
                  {dragging && dragging !== event.id && (
                    <span className="stream-drop-together">
                      Drop to play together
                    </span>
                  )}
                  {selected === event.id && (
                    <div
                      className="stream-event-options"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          finishEditing(event.id);
                        }
                      }}
                    >
                      <div className="stream-option-row">
                        <label>
                          Type
                          <select
                            value={event.kind}
                            onChange={(e) =>
                              updateEvent(event.id, { kind: e.target.value })
                            }
                          >
                            {kinds.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          When
                          <select
                            aria-label={`Timing for moment ${index + 1}`}
                            value={event.relation}
                            disabled={!index}
                            onChange={(e) =>
                              updateEvent(event.id, {
                                relation: e.target.value,
                              })
                            }
                          >
                            <option value="next">Next</option>
                            <option value="together">Together</option>
                            <option value="pause">After a pause</option>
                          </select>
                        </label>
                        {event.relation === "pause" && (
                          <label>
                            Seconds
                            <input
                              type="number"
                              aria-label={`Pause before moment ${index + 1}`}
                              min="0.1"
                              max="30"
                              step="0.1"
                              value={event.pause}
                              onChange={(e) => {
                                if (Number.isFinite(e.target.valueAsNumber))
                                  updateEvent(event.id, {
                                    pause: e.target.valueAsNumber,
                                  });
                              }}
                            />
                          </label>
                        )}
                      </div>
                      {event.kind === "speak" && (
                        <label className="stream-delivery">
                          Delivery
                          <select
                            value={event.delivery || "Auto"}
                            onChange={(e) =>
                              updateEvent(event.id, {
                                delivery: e.target.value,
                              })
                            }
                          >
                            {[
                              ...new Set(
                                ["Auto", ...presets, event.delivery].filter(
                                  Boolean,
                                ),
                              ),
                            ].map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="stream-delivery">
                        A little direction
                        <input
                          placeholder="Optional · softly, with a smile…"
                          value={event.direction || ""}
                          onChange={(e) =>
                            updateEvent(event.id, { direction: e.target.value })
                          }
                        />
                      </label>
                      <div className="stream-reorder">
                        <button
                          type="button"
                          draggable
                          aria-label={`Drag moment ${index + 1}`}
                          title="Drag between moments to reorder, or onto a moment to play together"
                          onDragStart={(e) => {
                            setDragging(event.id);
                            e.dataTransfer.setData(
                              "application/x-composer-event",
                              event.id,
                            );
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => setDragging(null)}
                        >
                          <GripVertical size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move moment ${index + 1} earlier`}
                          disabled={!index}
                          onClick={() => move(event.id, -1)}
                        >
                          <ArrowUp size={15} />
                          Earlier
                        </button>
                        <button
                          type="button"
                          aria-label={`Move moment ${index + 1} later`}
                          disabled={index === events.length - 1}
                          onClick={() => move(event.id, 1)}
                        >
                          <ArrowDown size={15} />
                          Later
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete moment ${index + 1}`}
                          onClick={() => {
                            editEvents((list) =>
                              list.splice(
                                list.findIndex((item) => item.id === event.id),
                                1,
                              ),
                            );
                            setSelected(null);
                            setNotice(
                              "Moment removed. Use Undo to bring it back.",
                            );
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label="Done editing moment"
                          onClick={() => finishEditing(event.id)}
                        >
                          <Check size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
        {!events.length && !scene.text && (
          <div className="stream-empty">
            <MessageCircle size={26} strokeWidth={1.4} />
            <h3>{cast.length ? "Give your characters a moment." : "Describe what happens."}</h3>
            <p>
              Start with an action, a place, or a line of dialogue.
              <br />
              Your writing stays editable.
            </p>
          </div>
        )}
      </div>
      <form
        className={`stream-compose${composeCollapsed ? " is-collapsed" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="stream-compose-line">
          <CharacterPicker
            value={speaker}
            characters={characters}
            onLook={openLook}
            label={`Change character for new moment: ${activeCharacter?.name || "The scene"}`}
            allowScene={kind !== "speak"}
            compact
            onAdd={onAssets}
            onChange={(id) => selectCharacter(id)}
          />
          {composeCollapsed && <button type="button" className="stream-compose-resume" onClick={() => setComposeCollapsed(false)}>
            {pending.text?.trim() ? "Continue writing…" : "Add a moment"}
          </button>}
          <div className="stream-compose-writing" hidden={composeCollapsed} id={`moment-writing-${scene.id}`}>
            <CanvasWriting
              assets={displayAssets}
              onMention={reference}
              onLook={openLook}
              quotedMentions
              autoDirection
              label="New moment"
              inputRef={input}
              onSubmit={submit}
              placeholder={currentKind.placeholder}
              value={pending.text || ""}
              onChange={(text) => changeInput({ text })}
              onDropAsset={(id, range) => {
                const asset = allAssets.find((item) => item.id === id);
                if (!asset || ["footage", "audio"].includes(asset.kind)) return;
                const text = pending.text || "";
                const start = range?.start ?? text.length;
                changeInput({
                  text:
                    text.slice(0, start) +
                    `@[${asset.name}] ` +
                    text.slice(range?.end ?? start),
                });
                reference(asset);
              }}
            />
          </div>
          <button type="button" className="stream-compose-collapse"
            aria-label={composeCollapsed ? "Expand moment input" : "Collapse moment input"}
            title={composeCollapsed ? "Expand moment input" : "Collapse moment input"}
            aria-expanded={!composeCollapsed}
            aria-controls={`moment-writing-${scene.id} moment-actions-${scene.id}`}
            onClick={() => { setComposeCollapsed(!composeCollapsed); setLookTarget(null); }}>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="stream-compose-actions" hidden={composeCollapsed} id={`moment-actions-${scene.id}`}>
          <div role="group" aria-label="New moment type">
            {kinds.map(({ id, label, Icon }) => (
              <button
                type="button"
                key={id}
                aria-pressed={id === kind}
                onClick={() => changeInput({ kind: id })}
              >
                <Icon size={15} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="submit"
            className="stream-send"
            aria-label="Add moment"
            title="Add moment · Enter"
            disabled={
              !pending.text?.trim() || (kind === "speak" && !activeCharacter)
            }
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </div>
      </form>
      {lookTarget && <ComposerLookPicker asset={allAssets.find(a => a.id === lookTarget.id)} draft={draft} change={editDraft} allAssets={allAssets} anchor={lookTarget.anchor} onClose={() => setLookTarget(null)}/>}
      <span className="stream-status" role="status">
        {notice}
      </span>
      </>}
    </section>
  );
}
