import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./composer-popover.css";

// Render outside scroll/overflow containers; keep the panel inside the viewport.
export function ComposerPopover({
  anchor,
  children,
  onClose,
  label,
  className = "",
  role = "dialog",
  activeIndex,
}) {
  const panel = useRef(null);
  const [position, setPosition] = useState({ visibility: "hidden" });
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor?.isConnected) {
        onClose?.();
        return;
      }
      let bounds = anchor.getBoundingClientRect();
      const selection = window.getSelection();
      if (role === "listbox" && anchor.isContentEditable && selection?.rangeCount && anchor.contains(selection.anchorNode)) {
        const caret = selection.getRangeAt(0).getBoundingClientRect();
        if (caret.height) bounds = caret;
      }
      const box = {
        left: bounds.left,
        top: Math.max(12, Math.min(bounds.top, window.innerHeight - 24)),
        bottom: Math.max(12, Math.min(bounds.bottom, window.innerHeight - 24)),
      };
      const width = Math.min(320, window.innerWidth - 24);
      const below = window.innerHeight - box.bottom - 12;
      const above = box.top - 12;
      const upward = below < 240 && above > below;
      const height = Math.min(320, Math.max(100, upward ? above : below));
      setPosition({
        position: "fixed",
        width,
        maxHeight: height,
        left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
        top: upward ? undefined : Math.max(12, box.bottom + 6),
        bottom: upward
          ? Math.max(12, window.innerHeight - box.top + 6)
          : undefined,
      });
    };
    const outside = (e) => {
      if (!panel.current?.contains(e.target) && !anchor?.contains(e.target))
        onClose?.();
    };
    const escape = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        anchor?.focus();
      }
    };
    place();
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [anchor, onClose, role]);
  useLayoutEffect(() => {
    if (role === "dialog") panel.current?.querySelector("button")?.focus();
  }, [anchor, role]);
  useLayoutEffect(() => {
    panel.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  return createPortal(
    <div
      ref={panel}
      style={position}
      className={`composer-popover ${className}`}
      role={role}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose?.();
          anchor?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
