import {
  mediaPose,
  mediaAnimation,
  setMediaPose,
  toggleMediaKeyframe,
  mediaMotionPreset,
  mediaMotionPresets,
  mediaVisualKind,
} from "../shared/media-animation.mjs";
import React, { useEffect, useRef, useState } from "react";
import {
  Type,
  Square,
  Circle,
  ArrowUpRight,
  Diamond,
  ZoomIn,
  ZoomOut,
  MoveLeft,
  MoveRight,
  Trash2,
  Copy,
  X,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  RotateCcw,
} from "lucide-react";
import {
  defaultPose,
  elementFonts,
  elementKinds,
  newElement,
  elementsFor,
  elementPose,
  setElementPose,
  toggleElementKeyframe,
  createElementEditSession,
  elementKeyboardCommand,
  nudgedElementPose,
  resizeElementTime,
  elementsSVG,
} from "../shared/elements.mjs";
import "./elements.css";
const icons = {
  text: Type,
  rectangle: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function useElementsEditor({ project, update, time, onSeek, onOpen }) {
  const [target, setTarget] = useState(null),
    [transient, setTransient] = useState(null);
  const latest = useRef({ project, update });
  latest.current = { project, update };
  const session = useRef(null);
  if (!session.current)
    session.current = createElementEditSession({
      preview: setTransient,
      schedule: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id),
      commit: (id, type, patch) =>
        latest.current.update((p) => {
          const record = (type === "element" ? p.elements : p.clips)?.find(
            (e) => e.id === id,
          );
          if (record) Object.assign(record, patch);
        }),
    });
  useEffect(() => {
    session.current.cancel();
    setTarget(null);
  }, [project?.id, project?.episodeId]);
  useEffect(() => {
    const finish = (event) => {
      if (event.type === "blur" || event.key?.startsWith("Arrow"))
        session.current.finish();
    };
    window.addEventListener("keyup", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("keyup", finish);
      window.removeEventListener("blur", finish);
    };
  }, []);
  const items = project ? elementsFor(project) : [];
  const item =
    target?.type === "element"
      ? items.find((e) => e.id === target.id)
      : target?.type === "media"
        ? project?.clips.find((c) => c.id === target.id)
        : null;
  const selected =
    item && transient?.id === item.id ? { ...item, ...transient.patch } : item;
  function select(e) {
    if (target?.id !== e.id) session.current.finish();
    setTarget({ type: "element", id: e.id });
    onOpen();
    onSeek(Math.max(e.start, Math.min(time, e.start + e.duration - 0.001)));
  }
  function mutate(fn) {
    session.current.finish();
    update((p) => {
      p.elements ||= [];
      fn(p.elements, p);
    });
  }
  function patchRecord(patch) {
    if (!item) return;
    const current = session.current.value(item, target.type);
    session.current.finish();
    if (
      Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(current[key]) === JSON.stringify(value),
      )
    )
      return;
    update((p) => {
      const record = (target.type === "element" ? p.elements : p.clips)?.find(
        (e) => e.id === item.id,
      );
      if (record) Object.assign(record, patch);
    });
  }
  function previewPatch(patch) {
    if (item) session.current.patch(item, target.type, patch);
  }
  function previewPose(patch) {
    if (!item) return;
    const current = session.current.value(item, target.type);
    previewPatch(
      target.type === "element"
        ? setElementPose(current, patch, time)
        : { visual: setMediaPose(current, patch, time) },
    );
  }
  const editor = {
    project,
    items: items.map((e) =>
      transient?.id === e.id ? { ...e, ...transient.patch } : e,
    ),
    target,
    item: selected,
    time,
    transient,
    setTransient,
    previewPatch,
    previewPose,
    finishEdit: () => session.current.finish(),
    cancelEdit: () => session.current.cancel(),
    open() {
      session.current.finish();
      setTarget({ type: "element", id: null });
      onOpen();
    },
    close() {
      session.current.finish();
      setTarget(null);
      setTransient(null);
    },
    select,
    inspectMedia(c) {
      if (typeof c === "string")
        c = project?.clips.find((clip) => clip.id === c);
      if (!c) return;
      session.current.finish();
      setTarget({ type: "media", id: c.id });
      onOpen();
      onSeek(Math.max(c.start, Math.min(time, c.start + c.duration - 0.001)));
    },
    add(kind) {
      if ((project.elements?.length || 0) >= 100) return;
      const e = newElement(kind, time, project.episodeId);
      mutate((items) => items.push(e));
      select(e);
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-element-id="${e.id}"]`)
          ?.focus({ preventScroll: true }),
      );
    },
    patch: patchRecord,
    pose(patch) {
      if (!item) return;
      const current = session.current.value(item, target.type);
      patchRecord(
        target.type === "element"
          ? setElementPose(current, patch, time)
          : { visual: setMediaPose(current, patch, time) },
      );
    },
    remove(id = target?.id) {
      if (!items.some((e) => e.id === id)) return;
      session.current.cancel();
      mutate((items) => {
        const i = items.findIndex((e) => e.id === id);
        if (i >= 0) items.splice(i, 1);
      });
      setTarget({ type: "element", id: null });
      setTransient(null);
      requestAnimationFrame(() =>
        document
          .querySelector('.elements-inspector [aria-label="Add text"]')
          ?.focus({ preventScroll: true }),
      );
    },
    duplicate() {
      if (!item || target.type !== "element" || project.elements.length >= 100)
        return;
      const current = session.current.value(item, target.type);
      const copy = {
        ...structuredClone(current),
        id: crypto.randomUUID(),
        start: Math.min(86400 - item.duration, item.start + 0.2),
      };
      mutate((items) => items.push(copy));
      select(copy);
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-element-id="${copy.id}"]`)
          ?.focus({ preventScroll: true }),
      );
    },
    layer(dir) {
      if (!item || target?.type !== "element") return;
      mutate((items) => {
        const visible = elementsFor(project),
          at = visible.findIndex((e) => e.id === item.id),
          neighbor = visible[at + dir];
        if (!neighbor) return;
        const i = items.findIndex((e) => e.id === item.id),
          j = items.findIndex((e) => e.id === neighbor.id);
        [items[i], items[j]] = [items[j], items[i]];
      });
    },
    keyframe() {
      if (!item) return;
      const current = session.current.value(item, target.type);
      patchRecord(
        target.type === "media"
          ? { visual: toggleMediaKeyframe(current, time) }
          : toggleElementKeyframe(current, time),
      );
    },
    handleKeyDown(event, { onRemoveMedia } = {}) {
      if (!item) return false;
      const command = elementKeyboardCommand(event, {
        editable: !!event.target.closest?.(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
        ),
        owned: !!event.target.matches?.(
          ".element-hit,.media-hit,.element-time-block",
        ),
        media: target.type === "media",
        canRemoveMedia: typeof onRemoveMedia === "function",
      });
      if (!command) return false;
      event.preventDefault();
      event.stopPropagation();
      if (command === "close") {
        if (session.current.active) session.current.cancel();
        else editor.close();
      }
      if (command === "delete") {
        if (target.type === "media") {
          session.current.finish();
          onRemoveMedia(item);
        } else editor.remove();
      }
      if (command === "duplicate") editor.duplicate();
      if (command === "nudge") {
        const current = session.current.value(item, target.type);
        const pose =
          target.type === "media"
            ? mediaPose(current, time)
            : elementPose(current, time);
        const bounds = document
          .querySelector(".composition-stage")
          ?.getBoundingClientRect();
        previewPose(
          nudgedElementPose(
            pose,
            event.key,
            event.shiftKey,
            bounds?.width,
            bounds?.height,
          ),
        );
      }
      return true;
    },
    seek(at) {
      session.current.finish();
      onSeek(at);
    },
    commit(e) {
      session.current.finish();
      setTransient(null);
      update((p) => {
        const r = p.elements?.find((x) => x.id === e.id);
        if (r) Object.assign(r, e);
      });
    },
  };
  return editor;
}

// Range edits remain local until release; keyboard repeats form one undo step.
function GestureRange({ editor, field, value, label, ...props }) {
  const control = useRef(null);
  useEffect(() => {
    if (control.current) control.current.value = value;
  }, [value]);
  return (
    <input
      {...props}
      aria-label={label}
      ref={control}
      type="range"
      defaultValue={value}
      onChange={(event) => editor.previewPose({ [field]: +event.target.value })}
      onPointerUp={() => editor.finishEdit()}
      onPointerCancel={() => {
        editor.cancelEdit();
        if (control.current) control.current.value = value;
      }}
      onBlur={() => editor.finishEdit()}
      onKeyUp={() => editor.finishEdit()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          editor.cancelEdit();
          if (control.current) control.current.value = value;
        }
      }}
    />
  );
}
function ElementColor({ editor, element }) {
  const picker = useRef(null),
    latest = useRef(editor);
  latest.current = editor;
  useEffect(() => {
    if (picker.current) picker.current.value = element.color;
  }, [element.color]);
  useEffect(() => {
    const control = picker.current;
    const commit = () => latest.current.finishEdit();
    control.addEventListener("change", commit);
    return () => control.removeEventListener("change", commit);
  }, []);
  return (
    <div className="element-color">
      <label htmlFor="element-color-picker">Color</label>
      <input
        ref={picker}
        id="element-color-picker"
        aria-label="Element color"
        type="color"
        defaultValue={element.color}
        onInput={(ev) => editor.previewPatch({ color: ev.target.value })}
        onBlur={() => editor.finishEdit()}
      />
      <input
        className="element-hex"
        aria-label="Color hex"
        key={element.id + element.color}
        defaultValue={element.color}
        maxLength={7}
        onBlur={(ev) => {
          if (/^#[0-9a-f]{6}$/i.test(ev.target.value))
            editor.patch({ color: ev.target.value });
          else ev.target.value = element.color;
        }}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === "Enter") ev.currentTarget.blur();
        }}
      />
    </div>
  );
}
function ElementText({ editor, value, onFinish, ...props }) {
  const [draft, setDraft] = useState(value),
    focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      {...props}
      value={draft}
      maxLength={2000}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        editor.previewPatch({ text: event.target.value.slice(0, 2000) });
      }}
      onBlur={() => {
        focused.current = false;
        editor.finishEdit();
        onFinish?.();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          editor.finishEdit();
          if (onFinish) onFinish();
          else event.currentTarget.blur();
        }
      }}
    />
  );
}
export function ElementsPreview({ editor, ratio, soloId }) {
  const host = useRef(null),
    drag = useRef(null),
    [textEdit, setTextEdit] = useState(null);
  const width = 1000,
    height = 1000 / ratio;
  const visible = editor.items.filter(
    (e) => (!soloId || e.id===soloId) && editor.time >= e.start && editor.time < e.start + e.duration,
  );
  const item = editor.item,
    mediaLabel =
      mediaVisualKind(item, editor.project) === "image" ? "image" : "footage",
    pose = item
      ? editor.target?.type === "element"
        ? elementPose(item, editor.time)
        : mediaPose(item, editor.time)
      : null;
  function begin(event, e, resize = false, media = false) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    editor.finishEdit();
    if (!media) editor.select(e);
    else editor.seek(editor.time);
    const box = host.current.getBoundingClientRect();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      box,
      original: e,
      pose: media ? mediaPose(e, editor.time) : elementPose(e, editor.time),
      resize,
      media,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const d = drag.current;
    if (!d) return;
    if (!d.next && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 3)
      return;
    const deltaX = event.clientX - d.x,
      deltaY = event.clientY - d.y;
    const angle = d.resize ? (-d.pose.rotation * Math.PI) / 180 : 0;
    const dx =
        (deltaX * Math.cos(angle) - deltaY * Math.sin(angle)) / d.box.width,
      dy = (deltaX * Math.sin(angle) + deltaY * Math.cos(angle)) / d.box.height;
    const patch = d.resize
      ? {
          w: clamp(d.pose.w + dx * 2, 0.02, 2),
          h: clamp(d.pose.h + dy * 2, 0.02, 2),
        }
      : { x: clamp(d.pose.x + dx, -1, 2), y: clamp(d.pose.y + dy, -1, 2) };
    if (d.resize && d.media && !event.shiftKey) {
      const raw =
        Math.abs(dx / d.pose.w) > Math.abs(dy / d.pose.h)
          ? patch.w / d.pose.w
          : patch.h / d.pose.h;
      const factor = clamp(
        raw,
        Math.max(0.02 / d.pose.w, 0.02 / d.pose.h),
        Math.min(2 / d.pose.w, 2 / d.pose.h),
      );
      patch.w = d.pose.w * factor;
      patch.h = d.pose.h * factor;
    }
    const next = d.media
      ? {
          visual: setMediaPose(d.original, patch, editor.time),
        }
      : setElementPose(d.original, patch, editor.time);
    d.next = next;
    editor.setTransient({ id: d.original.id, patch: next });
  }
  function end(event, cancel = false) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    editor.setTransient(null);
    if (!cancel && d.next) {
      if (d.media) editor.patch(d.next);
      else editor.commit(d.next);
    }
    event.stopPropagation();
  }
  return (
    <div
      ref={host}
      className="elements-preview"
      aria-label="Preview elements"
      onKeyDown={editor.handleKeyDown}
    >
      <div
        className="elements-art"
        dangerouslySetInnerHTML={{
          __html: elementsSVG(soloId ? editor.items.filter(e=>e.id===soloId) : editor.items, editor.time, width, height),
        }}
      />
      {visible.map((e) => {
        const p = elementPose(e, editor.time);
        return (
          <button
            key={e.id}
            data-element-id={e.id}
            aria-pressed={editor.target?.id === e.id}
            className="element-hit"
            aria-label={`Edit ${e.kind}: ${e.text || e.kind}`}
            style={{
              left: `${(p.x - p.w / 2) * 100}%`,
              top: `${(p.y - p.h / 2) * 100}%`,
              width: `${p.w * 100}%`,
              height: `${p.h * 100}%`,
              transform: `rotate(${p.rotation}deg)`,
            }}
            onFocus={(ev) => {
              if (ev.target === ev.currentTarget && editor.target?.id !== e.id)
                editor.select(e);
            }}
            onContextMenu={ev=>{if(ev.ctrlKey)ev.preventDefault();}}
            onPointerDown={(ev) => begin(ev, e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={(ev) => end(ev, true)}
            onClick={() => editor.select(e)}
            onDoubleClick={() => {
              editor.select(e);
              if (e.kind === "text") {
                setTextEdit(e.id);
              }
            }}
          />
        );
      })}
      {pose &&
        ((editor.target.type === "media" &&
          editor.time >= item.start &&
          editor.time < item.start + item.duration) ||
          visible.some((e) => e.id === item.id)) && (
          <div
            className={`element-selection ${editor.target.type === "media" ? "media-selection" : ""}`}
            style={{
              left: `${(pose.x - pose.w / 2) * 100}%`,
              top: `${(pose.y - pose.h / 2) * 100}%`,
              width: `${pose.w * 100}%`,
              height: `${pose.h * 100}%`,
              transform: `rotate(${pose.rotation}deg)`,
            }}
          >
            {editor.target.type === "media" && (
              <button
                className="media-hit"
                aria-label={`Move selected ${mediaLabel}`}
                onPointerDown={(ev) => begin(ev, item, false, true)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={(ev) => end(ev, true)}
              />
            )}
            <button
              hidden={editor.target.type === "media"}
              className="element-resize"
              aria-label="Resize selected element"
              onPointerDown={(ev) =>
                begin(ev, item, true, editor.target.type === "media")
              }
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={(ev) => end(ev, true)}
            />
          </div>
        )}
      {pose &&
        editor.target.type === "media" &&
        editor.time >= item.start &&
        editor.time < item.start + item.duration && (
          <>
            <button
              className="element-resize media-canvas-resize"
              aria-label={`Resize selected ${mediaLabel}`}
              title="Resize · hold Shift to change proportions"
              style={{
                left: `${clamp(pose.x + pose.w / 2, 0.03, 0.97) * 100}%`,
                top: `${clamp(pose.y + pose.h / 2, 0.03, 0.9) * 100}%`,
              }}
              onPointerDown={(ev) => begin(ev, item, true, true)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={(ev) => end(ev, true)}
            />
            <div
              className="media-canvas-controls"
              onPointerDown={() => editor.seek(editor.time)}
            >
              <label>
                Rotate
                <GestureRange
                  editor={editor}
                  label="Preview rotation"
                  field="rotation"
                  min="-180"
                  max="180"
                  value={pose.rotation}
                />
              </label>
              <label>
                Opacity
                <GestureRange
                  editor={editor}
                  label="Preview opacity"
                  field="opacity"
                  min="0"
                  max="1"
                  step=".01"
                  value={pose.opacity}
                />
              </label>
              <button
                aria-label={`Add or remove ${mediaLabel} keyframe`}
                aria-pressed={mediaAnimation(item).keyframes.some(
                  (k) => Math.abs(k.t - (editor.time - item.start)) < 0.025,
                )}
                title="Keyframe at playhead"
                onClick={() => editor.keyframe()}
              >
                <Diamond size={16} />
              </button>
            </div>
          </>
        )}
      {textEdit === item?.id && (
        <ElementText
          editor={editor}
          value={item.text}
          autoFocus
          aria-label="Edit text on preview"
          className="element-inline-text"
          dir="auto"
          style={{
            left: `${clamp(pose.x - pose.w / 2, 0, 0.7) * 100}%`,
            top: `${clamp(pose.y - pose.h / 2, 0, 0.7) * 100}%`,
          }}
          onFinish={() => setTextEdit(null)}
        />
      )}
    </div>
  );
}
function GestureNumber({ editor, label, value, onValue, ...props }) {
  const [draft, setDraft] = useState(String(value)),
    focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <input
      {...props}
      aria-label={label}
      type="number"
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(ev) => {
        setDraft(ev.target.value);
        const number = Number(ev.target.value);
        if (
          ev.target.value.trim() &&
          Number.isFinite(number) &&
          number >= Number(props.min ?? -Infinity) &&
          number <= Number(props.max ?? Infinity)
        )
          onValue(number);
      }}
      onBlur={() => {
        focused.current = false;
        editor.finishEdit();
        setDraft(String(value));
      }}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") ev.currentTarget.blur();
        if (ev.key === "Escape") {
          editor.cancelEdit();
          ev.currentTarget.blur();
        }
      }}
    />
  );
}
export function ElementsInspector({ editor, onRemoveMedia, onMediaSettings }) {
  if (!editor.target) return null;
  const e = editor.item,
    media = editor.target.type === "media";
  const image = media && mediaVisualKind(e, editor.project) === "image";
  const pose = e
    ? media
      ? mediaPose(e, editor.time)
      : elementPose(e, editor.time)
    : null;
  const layer = editor.items.findIndex((item) => item.id === e?.id);
  return (
    <aside
      className="elements-inspector"
      aria-label="Element inspector"
      onKeyDown={(ev) => {
        if (ev.key === "Escape" && !ev.defaultPrevented) {
          ev.stopPropagation();
          editor.close();
        }
      }}
    >
      <header>
        <SlidersHorizontal size={17} aria-hidden="true" />
        <strong>
          {media
            ? image
              ? "Image"
              : "Footage"
            : e
              ? {
                  text: "Text",
                  rectangle: "Rectangle",
                  ellipse: "Circle",
                  arrow: "Arrow",
                }[e.kind]
              : "Elements"}
        </strong>
        {e && !media && (
          <>
            <button
              aria-label="Duplicate element"
              title="Duplicate · ⌘/Ctrl D"
              onClick={() => editor.duplicate()}
            >
              <Copy size={16} />
            </button>
            <button
              className="element-delete"
              aria-label="Delete element"
              title="Delete element · Backspace"
              onClick={() => editor.remove()}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
        {e && media && !image && onMediaSettings && (
          <button
            aria-label="Clip settings"
            title="Speed & reverse"
            onClick={() => {
              editor.finishEdit();
              onMediaSettings(e);
            }}
          >
            <SlidersHorizontal size={16} />
          </button>
        )}
        {e && media && onRemoveMedia && (
          <button
            className="element-delete"
            aria-label="Delete clip"
            title="Delete clip"
            onClick={() => {
              editor.finishEdit();
              onRemoveMedia(e);
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
        <button
          aria-label="Close inspector"
          title="Close · Esc"
          onClick={() => editor.close()}
        >
          <X size={17} />
        </button>
      </header>
      {!media && !e && (
        <div className="element-tools" aria-label="Add an element">
          {elementKinds.map((kind) => {
            const Icon = icons[kind];
            return (
              <button
                key={kind}
                disabled={(editor.project.elements?.length || 0) >= 100}
                onClick={() => editor.add(kind)}
                aria-label={`Add ${kind}`}
              >
                <Icon size={19} aria-hidden="true" />
                <span>
                  {
                    {
                      text: "Text",
                      rectangle: "Box",
                      ellipse: "Circle",
                      arrow: "Arrow",
                    }[kind]
                  }
                </span>
              </button>
            );
          })}
        </div>
      )}
      {!e ? (
        <div className="element-empty">
          <Type size={28} aria-hidden="true" />
          <strong>Make it yours</strong>
          <p>
            Add text, a shape or an arrow.
            <br />
            Drag it into place on the preview.
          </p>
        </div>
      ) : (
        <>
          {media && (
            <div className="media-motion-presets" aria-label="Motion presets">
              {mediaMotionPresets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    editor.patch({ visual: mediaMotionPreset(e, p.id) });
                    editor.seek(e.start);
                  }}
                >
                  {React.createElement(
                    {
                      "zoom-in": ZoomIn,
                      "zoom-out": ZoomOut,
                      "pan-left": MoveLeft,
                      "pan-right": MoveRight,
                    }[p.id],
                    { size: 16, "aria-hidden": true },
                  )}
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {!media && e.kind === "text" && (
            <section className="element-section" aria-label="Text appearance">
              <label>
                Text
                <ElementText
                  editor={editor}
                  value={e.text}
                  aria-label="Element text"
                  dir="auto"
                />
              </label>
              <div className="element-pair">
                <label>
                  Font
                  <select
                    aria-label="Font"
                    value={e.font}
                    onChange={(ev) => editor.patch({ font: ev.target.value })}
                  >
                    {elementFonts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Size
                  <GestureNumber
                    editor={editor}
                    label="Text size"
                    min="1"
                    max="50"
                    step=".5"
                    value={+(e.fontSize * 100).toFixed(2)}
                    onValue={(n) => editor.previewPatch({ fontSize: n / 100 })}
                  />
                </label>
              </div>
              <div className="element-text-tools" aria-label="Text alignment">
                <button
                  aria-label="Bold text"
                  title="Bold"
                  aria-pressed={e.weight === 700}
                  onClick={() =>
                    editor.patch({ weight: e.weight === 700 ? 400 : 700 })
                  }
                >
                  <b>B</b>
                </button>
                {["left", "center", "right"].map((align) => (
                  <button
                    key={align}
                    aria-label={`Align ${align}`}
                    title={`Align ${align}`}
                    aria-pressed={e.align === align}
                    onClick={() => editor.patch({ align })}
                  >
                    {React.createElement(
                      {
                        left: AlignLeft,
                        center: AlignCenter,
                        right: AlignRight,
                      }[align],
                      { size: 16, "aria-hidden": true },
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}
          {!media && <ElementColor editor={editor} element={e} />}
          <section className="element-section" aria-label="Position and size">
            <div className="element-section-heading">
              <strong>Position & size</strong>
              <div>
                <button
                  aria-label="Center horizontally"
                  title="Center horizontally"
                  onClick={() => editor.pose({ x: 0.5 })}
                >
                  <AlignHorizontalJustifyCenter size={16} />
                </button>
                <button
                  aria-label="Center vertically"
                  title="Center vertically"
                  onClick={() => editor.pose({ y: 0.5 })}
                >
                  <AlignVerticalJustifyCenter size={16} />
                </button>
              </div>
            </div>
            {media && (
              <div className="element-fit" aria-label={image ? "Image fit" : "Footage fit"}>
                {["contain", "cover"].map((fit) => (
                  <button
                    key={fit}
                    aria-pressed={pose.fit === fit}
                    onClick={() =>
                      editor.patch({ visual: { ...e.visual, fit } })
                    }
                  >
                    {fit === "contain" ? "Fit" : "Fill"}
                  </button>
                ))}
              </div>
            )}
            <div className="element-pair">
              {["x", "y", "w", "h"].map((key) => (
                <label key={key}>
                  {
                    { x: "Horizontal", y: "Vertical", w: "Width", h: "Height" }[
                      key
                    ]
                  }{" "}
                  %
                  <GestureNumber
                    editor={editor}
                    label={
                      {
                        x: "Horizontal position (%)",
                        y: "Vertical position (%)",
                        w: "Width (%)",
                        h: "Height (%)",
                      }[key]
                    }
                    min={["w", "h"].includes(key) ? 2 : -100}
                    max="200"
                    step="1"
                    value={+(pose[key] * 100).toFixed(1)}
                    onValue={(v) => editor.previewPose({ [key]: v / 100 })}
                  />
                </label>
              ))}
            </div>
            <label>
              <span className="element-value-label">
                Rotation<output>{Math.round(pose.rotation)}°</output>
              </span>
              <GestureRange
                editor={editor}
                label="Element rotation"
                field="rotation"
                min="-180"
                max="180"
                value={pose.rotation}
              />
            </label>
            <label>
              <span className="element-value-label">
                Opacity<output>{Math.round(pose.opacity * 100)}%</output>
              </span>
              <GestureRange
                editor={editor}
                label="Element opacity"
                field="opacity"
                min="0"
                max="1"
                step=".01"
                value={pose.opacity}
              />
            </label>
          </section>
          <section className="element-section" aria-label="Animation">
            <strong>Motion</strong>
            <AnimationControls editor={editor} e={e} media={media} />
          </section>
          {!media && (
            <details className="element-timing">
              <summary>
                Timing & layers <span>{e.duration.toFixed(1)}s</span>
              </summary>
              <div className="element-pair">
                <label>
                  Start · seconds
                  <GestureNumber
                    editor={editor}
                    label="Element start"
                    min="0"
                    max={86400 - e.duration}
                    step=".1"
                    value={+e.start.toFixed(2)}
                    onValue={(n) => editor.previewPatch({ start: n })}
                  />
                </label>
                <label>
                  Duration
                  <GestureNumber
                    editor={editor}
                    label="Element duration"
                    min=".1"
                    max={86400 - e.start}
                    step=".1"
                    value={+e.duration.toFixed(2)}
                    onValue={(n) =>
                      editor.previewPatch(resizeElementTime(e, e.start, n))
                    }
                  />
                </label>
              </div>
              <div className="element-layer-actions">
                <button
                  aria-label="Move element backward"
                  disabled={layer <= 0}
                  onClick={() => editor.layer(-1)}
                >
                  <ChevronDown size={16} />
                  Backward
                </button>
                <button
                  aria-label="Move element forward"
                  disabled={layer >= editor.items.length - 1}
                  onClick={() => editor.layer(1)}
                >
                  <ChevronUp size={16} />
                  Forward
                </button>
              </div>
            </details>
          )}
          {media && (
            <button
              className="element-reset"
              onClick={() =>
                editor.patch({
                  visual: { ...defaultPose, w: 1, h: 1, fit: "contain" },
                })
              }
            >
              <RotateCcw size={14} />
              Reset framing & motion
            </button>
          )}
          <small className="element-shortcut-hint">
            Arrow keys to move · Shift for bigger steps
          </small>
        </>
      )}
    </aside>
  );
}
function AnimationControls({ editor, e, media = false }) {
  const animation = media ? mediaAnimation(e) : e;
  const active = animation.keyframes.some(
    (k) => Math.abs(k.t - (editor.time - e.start)) < 0.025,
  );
  return (
    <div className="media-animation-controls">
      <div className="element-animation">
        <button
          onClick={() => editor.keyframe()}
          aria-label="Toggle keyframe at playhead"
          aria-pressed={active}
        >
          <Diamond size={15} />
          {active ? "Remove keyframe" : "Add keyframe"}
        </button>
        <select
          aria-label="Animation easing"
          value={animation.easing}
          onChange={(ev) =>
            editor.patch(
              media
                ? { visual: { ...e.visual, easing: ev.target.value } }
                : { easing: ev.target.value },
            )
          }
        >
          <option value="smooth">Smooth</option>
          <option value="linear">Linear</option>
          <option value="hold">Hold</option>
        </select>
      </div>
      <div className="element-keyframes">
        {animation.keyframes.map((k) => (
          <button
            key={k.t}
            onClick={() =>
              editor.seek(e.start + Math.min(k.t, e.duration - 0.001))
            }
            aria-label={`Go to keyframe at ${k.t.toFixed(2)} seconds`}
            aria-pressed={Math.abs(k.t - (editor.time - e.start)) < 0.025}
          >
            <Diamond size={11} />
            {k.t.toFixed(1)}s
          </button>
        ))}
      </div>
      {!animation.keyframes.length ? (
        <small>
          Add a keyframe, move the playhead, then change position, size,
          rotation or opacity.
        </small>
      ) : (
        <button
          className="subtle"
          onClick={() =>
            editor.patch(
              media
                ? {
                    visual: {
                      ...mediaPose(e, editor.time),
                      easing: animation.easing,
                      keyframes: [],
                    },
                  }
                : { ...elementPose(e, editor.time), keyframes: [] },
            )
          }
        >
          Remove motion
        </button>
      )}
    </div>
  );
}
export function ElementsTimeline({ editor, zoom, focused, onFocusItem }) {
  const drag = useRef(null);
  function begin(ev, e, edge) {
    if (!edge && onFocusItem?.(ev,e.id)) return;
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    ev.currentTarget
      .closest(".element-time-block")
      ?.focus({ preventScroll: true });
    editor.finishEdit();
    editor.select(e);
    drag.current = { x: ev.clientX, e, edge };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }
  function move(ev) {
    const d = drag.current;
    if (!d) return;
    if (!d.next && Math.abs(ev.clientX - d.x) < 3) return;
    const delta = (ev.clientX - d.x) / zoom;
    let start = d.e.start,
      duration = d.e.duration;
    if (d.edge === "end") duration = Math.max(0.1, duration + delta);
    else if (d.edge === "start") {
      start = clamp(start + delta, 0, d.e.start + d.e.duration - 0.1);
      duration = d.e.start + d.e.duration - start;
    } else start = Math.max(0, start + delta);
    d.next = resizeElementTime(d.e, start, duration);
    editor.setTransient({ id: d.e.id, patch: d.next });
  }
  function end(ev, cancel = false) {
    const d = drag.current;
    drag.current = null;
    ev.stopPropagation();
    if (d?.next && !cancel) editor.commit(d.next);
    else editor.setTransient(null);
  }
  return (
    <section
      className="elements-timeline"
      aria-label="Elements timeline"
      onPointerDown={(ev) => ev.stopPropagation()}
      onKeyDown={editor.handleKeyDown}
    >
      <div className="elements-timeline-heading">
        <span>Elements</span>
        {elementKinds.map((kind) => {
          const Icon = icons[kind];
          return (
            <button
              key={kind}
              aria-label={`Add ${kind} to timeline`}
              disabled={(editor.project.elements?.length || 0) >= 100}
              onClick={() => editor.add(kind)}
            >
              <Icon size={14} />
              {focused && kind}
            </button>
          );
        })}
      </div>
      {!editor.items.length && focused && (
        <p>Add a title, a shape or an arrow at the playhead.</p>
      )}
      {focused &&
        editor.project.clips
          .filter(
            (c) =>
              c.visual?.keyframes?.length ||
              (editor.target?.type === "media" && editor.target.id === c.id),
          )
          .map((c) => (
            <div className="element-track" key={"media:" + c.id}>
              <div
                role="button"
                tabIndex={0}
                aria-label={`${mediaVisualKind(c, editor.project) === "image" ? "Image" : "Footage"} motion at ${c.start.toFixed(1)} seconds`}
                className={`element-time-block media-motion-block ${editor.target?.id === c.id ? "selected" : ""}`}
                style={{
                  left: c.start * zoom,
                  width: Math.max(12, c.duration * zoom),
                }}
                onFocus={(ev) => {
                  if (
                    ev.target === ev.currentTarget &&
                    editor.target?.id !== c.id
                  )
                    editor.inspectMedia(c);
                }}
                onClick={() => editor.inspectMedia(c)}
                onDoubleClick={() => editor.inspectMedia(c)}
                onKeyDown={(ev) => {
                  if (ev.target !== ev.currentTarget) return;
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    editor.inspectMedia(c);
                  }
                }}
              >
                <span>
                  {mediaVisualKind(c, editor.project) === "image"
                    ? "Image"
                    : "Footage"}{" "}
                  motion
                </span>
                {mediaAnimation(c).keyframes.map((k) => (
                  <button
                    className="media-timeline-key"
                    key={k.t}
                    aria-label={`${mediaVisualKind(c, editor.project) === "image" ? "Image" : "Footage"} keyframe at ${(c.start + k.t).toFixed(2)} seconds`}
                    style={{
                      left: clamp(
                        k.t * zoom,
                        5,
                        Math.max(5, c.duration * zoom - 14),
                      ),
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      editor.inspectMedia(c);
                      editor.seek(c.start + Math.min(k.t, c.duration - 0.001));
                    }}
                  >
                    <Diamond size={10} />
                  </button>
                ))}
              </div>
            </div>
          ))}
      {editor.items.map((e) => (
        <div className="element-track" key={e.id}>
          <div
            role="button"
            tabIndex={0}
            aria-label={`${e.kind} element at ${e.start.toFixed(1)} seconds`}
            className={`element-time-block ${editor.target?.id === e.id ? "selected" : ""}`}
            style={{
              left: e.start * zoom,
              width: Math.max(12, e.duration * zoom),
            }}
            onClick={() => editor.select(e)}
            onDoubleClick={() => editor.select(e)}
            onKeyDown={(ev) => {
              if (ev.target !== ev.currentTarget) return;
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                ev.stopPropagation();
                editor.select(e);
              }
            }}
            onFocus={(ev) => {
              if (ev.target === ev.currentTarget && editor.target?.id !== e.id)
                editor.select(e);
            }}
            onContextMenu={ev=>{if(ev.ctrlKey)ev.preventDefault();}}
            onPointerDown={(ev) => begin(ev, e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={(ev) => end(ev, true)}
          >
            <button
              className="element-trim start"
              aria-label={`Trim start of ${e.kind}`}
              onPointerDown={(ev) => begin(ev, e, "start")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={(ev) => end(ev, true)}
            />
            <span>{e.text || e.kind}</span>
            {e.keyframes.map((k) => (
              <button
                key={k.t}
                className="element-timeline-key"
                aria-label={`Element keyframe at ${(e.start + k.t).toFixed(2)} seconds`}
                style={{
                  left: clamp(
                    k.t * zoom,
                    10,
                    Math.max(10, e.duration * zoom - 22),
                  ),
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={(ev) => {
                  ev.stopPropagation();
                  editor.select(e);
                  editor.seek(e.start + Math.min(k.t, e.duration - 0.001));
                }}
              >
                <Diamond size={10} />
              </button>
            ))}
            <button
              className="element-trim end"
              aria-label={`Trim end of ${e.kind}`}
              onPointerDown={(ev) => begin(ev, e, "end")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={(ev) => end(ev, true)}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
