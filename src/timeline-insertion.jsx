import React, { useEffect, useRef, useState } from "react";
import { Plus, Clapperboard, Layers, Archive } from "lucide-react";
import { tc } from "./state";

export function TimelineInsertions({
  clips,
  zoom,
  viewport,
  onInsert,
  onPool,
}) {
  const root = useRef(null);
  const [hover, setHover] = useState(null),
    [menu, setMenu] = useState(null);
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  const cuts = [...new Set([0, ...ordered.map((c) => c.start + c.duration)])];
  const signature = cuts.join(",");
  useEffect(() => {
    const lane = root.current?.parentElement;
    if (!lane) return;
    const move = (e) => {
      const x = e.clientX - lane.getBoundingClientRect().left;
      const cut = cuts.find((at) => Math.abs(at * zoom - x) <= 12);
      setHover(cut ?? null);
    };
    const leave = () => setHover(null);
    lane.addEventListener("pointermove", move);
    lane.addEventListener("pointerleave", leave);
    return () => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerleave", leave);
    };
  }, [signature, zoom]);
  useEffect(() => {
    setMenu(null);
  }, [signature]);
  useEffect(() => {
    if (menu === null) return;
    const close = (e) => {
      if (
        e.type === "keydown"
          ? e.key === "Escape"
          : !root.current?.contains(e.target)
      )
        setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);
  return (
    <div
      ref={root}
      className="timeline-insertions"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="timeline-append"
        style={{
          left:
            (ordered.length
              ? Math.max(...ordered.map((c) => c.start + c.duration))
              : 0) *
              zoom +
            16,
        }}
        aria-label="Add next clip prompt"
        title="New clip · project default duration"
        onClick={() =>
          onInsert(
            "clip",
            ordered.length
              ? Math.max(...ordered.map((c) => c.start + c.duration))
              : 0,
          )
        }
      >
        <Plus size={19} />
      </button>
      {cuts
        .filter(
          (at) =>
            at * zoom >= viewport.left - 12 &&
            at * zoom <= viewport.left + viewport.width + 12,
        )
        .map((at) => (
          <div
            key={at}
            className={`timeline-cut ${hover === at || menu === at ? "revealed" : ""}`}
            style={{ left: at * zoom }}
          >
            <span className="timeline-cut-line" />
            <button
              className="timeline-cut-plus"
              style={at === 0 ? { left: 0 } : undefined}
              aria-label={`Insert at ${tc(at)}`}
              title="Add at this cut"
              aria-expanded={menu === at}
              onClick={() => setMenu(menu === at ? null : at)}
            >
              <Plus size={15} />
            </button>
            {menu === at && (
              <div
                className={`timeline-cut-menu ${at * zoom - viewport.left > viewport.width - 190 ? "align-end" : ""}`}
              >
                <small>Insert at {tc(at)}</small>
                <button
                  onClick={() => {
                    setMenu(null);
                    onInsert("clip", at);
                  }}
                >
                  <Clapperboard size={15} />
                  Add clip
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    onInsert("group", at);
                  }}
                >
                  <Layers size={15} />
                  Add group
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    onPool(at);
                  }}
                >
                  <Archive size={15} />
                  From generation pool
                </button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
