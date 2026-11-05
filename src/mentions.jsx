import { ComposerPopover } from "./composer-popover";
import { normalizeLookText } from "../shared/look-selection.mjs";
import React, { useLayoutEffect, useRef, useState } from "react";
import { Check, UserRound } from "lucide-react";
export function MentionInput({
  assets = [],
  onMention,
  value = "",
  onChange,
  autoGrow = false,
  ...props
}) {
  const input = useRef(null),
    [match, setMatch] = useState(null),
    [active, setActive] = useState(0);
  useLayoutEffect(() => {
    if (!autoGrow || !input.current) return;
    const el = input.current;
    const fit = () => {
      el.style.height = "0px";
      el.style.height = el.scrollHeight + "px";
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoGrow, value]);
  const inspect = (el) => {
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(/(?:^|\s)@([^@\n]{0,60})$/);
    setMatch(
      m
        ? {
            start: el.selectionStart - m[1].length - 1,
            end: el.selectionStart,
            query: m[1],
          }
        : null,
    );
    setActive(0);
  };
  const suggestions = match
    ? assets
        .filter(
          (a) =>
            a.kind !== "footage" &&
            normalizeLookText(a.name).includes(normalizeLookText(match.query.trim())),
        )
        .slice(0, 8)
    : [];
  const choose = (a) => {
    const text =
      value.slice(0, match.start) +
      "@[" +
      a.name +
      "]" +
      value.slice(match.end);
    onChange({ target: { value: text } });
    onMention?.(a);
    setMatch(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      const end = match.start + a.name.length + 3;
      input.current?.setSelectionRange(end, end);
    });
  };
  const recognized = assets.filter((a) => value.includes("@[" + a.name + "]"));
  return (
    <div className="mention-input">
      <textarea
        {...props}
        ref={input}
        value={value}
        onChange={(e) => {
          onChange(e);
          inspect(e.target);
        }}
        onClick={(e) => inspect(e.target)}
        onBlur={() => setMatch(null)}
        onKeyDown={(e) => {
          if (!match) return;
          if (e.key === "Escape") {
            setMatch(null);
            e.preventDefault();
          }
          if (
            suggestions.length &&
            ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)
          ) {
            e.preventDefault();
            if (e.key === "ArrowDown")
              setActive((active + 1) % suggestions.length);
            else if (e.key === "ArrowUp")
              setActive((active + suggestions.length - 1) % suggestions.length);
            else choose(suggestions[active] || suggestions[0]);
          }
        }}
      />
      {match && (
        <ComposerPopover anchor={input.current} role="listbox" label="Mention an asset" onClose={() => setMatch(null)} activeIndex={active}>
          {suggestions.length ? (
            suggestions.map((a, i) => (
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                key={a.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(a)}
              >
                {a.media ? (
                  <img src={a.media.thumbnail} alt="" />
                ) : (
                  <UserRound size={18} />
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
        </ComposerPopover>
      )}
      {!!recognized.length && (
        <div className="recognized-mentions">
          {recognized.map((a) => (
            <span key={a.id} title={a.kind + " reference recognized"}>
              {a.media ? (
                <img src={a.media.thumbnail} alt={a.name} />
              ) : (
                <UserRound size={12} />
              )}{" "}
              {a.name}
              <Check size={12} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
