import React, { useLayoutEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";

// Store plain prompt text, render mentions as non-editable inline tokens. Local
// typing never rebuilds the editable DOM, so caret position and IME stay intact.
function textOf(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1 && node.nodeType !== 11) return "";
  if (node.dataset?.mention) return node.dataset.mention;
  if (node.nodeName === "BR") return "\n";
  return [...node.childNodes]
    .map((n, i) => {
      const block = ["DIV", "P"].includes(n.nodeName);
      return (
        (block && i && node.childNodes[i - 1]?.nodeName !== "BR" ? "\n" : "") +
        textOf(n)
      );
    })
    .join("");
}
function caretOffset(el) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !el.contains(selection.anchorNode)) return null;
  const r = selection.getRangeAt(0).cloneRange();
  r.selectNodeContents(el);
  r.setEnd(selection.anchorNode, selection.anchorOffset);
  return textOf(r.cloneContents());
}
function renderText(el, value, assets) {
  const fragment = document.createDocumentFragment();
  let at = 0;
  for (const m of value.matchAll(/@\[([^\]\n]+)\]/g)) {
    fragment.append(document.createTextNode(value.slice(at, m.index)));
    const asset = assets.find((a) => a.name === m[1]);
    if (!asset) fragment.append(document.createTextNode(m[0]));
    else {
      const token = document.createElement("span");
      token.className = "canvas-inline-asset";
      token.contentEditable = "false";
      token.dataset.mention = m[0];
      token.title = asset.kind + " reference · " + asset.name;
      if (asset.media?.thumbnail) {
        const img = document.createElement("img");
        img.src = asset.media.thumbnail;
        img.alt = "";
        token.append(img);
      }
      const name = document.createElement("span");
      name.textContent = asset.name;
      token.append(name);
      fragment.append(token);
    }
    at = m.index + m[0].length;
  }
  fragment.append(document.createTextNode(value.slice(at)));
  el.replaceChildren(fragment);
}
function placeCaret(el, offset) {
  let left = offset;
  const range = document.createRange();
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (node.nodeType === 3) {
      if (left <= node.length) {
        range.setStart(node, left);
        found = true;
      } else left -= node.length;
    } else if (node.dataset?.mention) {
      const size = node.dataset.mention.length;
      if (left <= size) {
        range.setStartAfter(node);
        found = true;
      } else left -= size;
    } else [...node.childNodes].forEach(visit);
  };
  visit(el);
  if (!found) {
    range.selectNodeContents(el);
    range.collapse(false);
  } else range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
export function CanvasWriting({
  value = "",
  onChange,
  assets,
  onMention,
  label,
  placeholder,
  onCursor,
  onDropAsset,
  quotedMentions = false,
  inputRef,
  onSubmit,
  autoDirection = false,
}) {
  const ref = useRef(null),
    composing = useRef(false);
  const [match, setMatch] = useState(null),
    [active, setActive] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || composing.current) return;
    if (textOf(el) !== value || el.dataset.initialized !== "true") {
      const focused = document.activeElement === el,
        offset = focused ? caretOffset(el)?.length : null;
      renderText(el, value, assets);
      el.dataset.initialized = "true";
      if (focused && offset != null)
        placeCaret(el, Math.min(value.length, offset));
    }
  }, [value, assets]);
  const inspect = () => {
    const before = caretOffset(ref.current);
    if (before == null) return;
    const range = window.getSelection().getRangeAt(0);
    const prefix = range.cloneRange();
    prefix.selectNodeContents(ref.current);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = textOf(prefix.cloneContents()).length;
    prefix.setEnd(range.endContainer, range.endOffset);
    onCursor?.({ start, end: textOf(prefix.cloneContents()).length });
    const m = before.match(quotedMentions
      ? /(?:^|[\s("'“])@([^@\n\[\]]{0,50})$/
      : /(?:^|\s)@([^@\n\[\]]{0,50})$/);
    setMatch(
      m
        ? {
            start: before.length - m[1].length - 1,
            end: before.length,
            query: m[1],
          }
        : null,
    );
    setActive(0);
  };
  const commit = () => {
    onChange(textOf(ref.current));
    if (!composing.current) inspect();
  };
  const candidates = match
    ? assets
        .filter(
          (a) =>
            !["footage", "audio"].includes(a.kind) &&
            a.name.toLowerCase().includes(match.query.toLowerCase()),
        )
        .slice(0, 7)
    : [];
  const choose = (a) => {
    const text = textOf(ref.current),
      next =
        text.slice(0, match.start) + `@[${a.name}] ` + text.slice(match.end),
      offset = match.start + a.name.length + 4;
    renderText(ref.current, next, assets);
    ref.current.focus();
    placeCaret(ref.current, offset);
    onChange(next);
    onMention(a);
    setMatch(null);
    onCursor?.({ start: offset, end: offset });
  };
  const insertPlain = (text) => {
    const el = ref.current,
      sel = window.getSelection();
    if (!sel?.rangeCount || !el.contains(sel.anchorNode)) {
      el.focus();
      placeCaret(el, textOf(el).length);
    }
    const r = window.getSelection().getRangeAt(0);
    r.deleteContents();
    const n = document.createTextNode(text);
    r.insertNode(n);
    r.setStartAfter(n);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    commit();
  };
  return (
    <div className="canvas-writing-input">
      <div
        ref={node => {
          ref.current = node;
          if (inputRef) inputRef.current = node;
        }}
        dir={autoDirection ? "auto" : undefined}
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-placeholder={placeholder}
        className="canvas-prose"
        onInput={commit}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => {
          composing.current = false;
          commit();
        }}
        onClick={inspect}
        onKeyUp={(e) => {
          if (match && ["ArrowDown", "ArrowUp", "Escape"].includes(e.key))
            return;
          inspect();
        }}
        onBlur={() => {
          setMatch(null);
          // Recognize pasted mention tokens after editing, without interrupting
          // typing or composition with a DOM rewrite.
          if (!composing.current)
            renderText(ref.current, textOf(ref.current), assets);
        }}
        onPaste={(e) => {
          e.preventDefault();
          insertPlain(e.clipboardData.getData("text/plain"));
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("asset");
          if (id) {
            e.preventDefault();
            e.stopPropagation();
            // Insert at the visual drop position, measured in persisted plain text.
            const caret = document.caretPositionFromPoint?.(
              e.clientX,
              e.clientY,
            );
            const range = caret
              ? document.createRange()
              : document.caretRangeFromPoint?.(e.clientX, e.clientY);
            if (caret) range.setStart(caret.offsetNode, caret.offset);
            let position;
            if (range && ref.current.contains(range.startContainer)) {
              const prefix = document.createRange();
              prefix.selectNodeContents(ref.current);
              const token =
                range.startContainer.parentElement?.closest("[data-mention]");
              if (token) prefix.setEndBefore(token);
              else prefix.setEnd(range.startContainer, range.startOffset);
              const offset = textOf(prefix.cloneContents()).length;
              position = { start: offset, end: offset };
            }
            onDropAsset(id, position);
          }
        }}
        onKeyDown={(e) => {
          if (
            match &&
            candidates.length &&
            ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)
          ) {
            e.preventDefault();
            if (e.key === "ArrowDown")
              setActive((active + 1) % candidates.length);
            else if (e.key === "ArrowUp")
              setActive((active + candidates.length - 1) % candidates.length);
            else choose(candidates[active] || candidates[0]);
            return;
          }
          if (e.key === "Escape" && match) {
            e.preventDefault();
            e.stopPropagation();
            setMatch(null);
            return;
          }
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (onSubmit && !e.shiftKey) onSubmit();
            else insertPlain("\n");
          }
        }}
      />
      {match && (
        <div
          className="mention-menu"
          role="listbox"
          aria-label="Mention an asset"
        >
          {candidates.length ? (
            candidates.map((a, i) => (
              <button
                key={a.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(a)}
              >
                {a.media?.thumbnail ? (
                  <img src={a.media.thumbnail} alt="" />
                ) : (
                  <UserRound size={16} />
                )}
                <span>
                  {a.name}
                  <small>{a.kind}</small>
                </span>
              </button>
            ))
          ) : (
            <small>No matching assets</small>
          )}
        </div>
      )}
    </div>
  );
}
