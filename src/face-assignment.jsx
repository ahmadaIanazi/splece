import React, { useEffect, useRef, useState } from "react";
import { ScanFace, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  dialogueDraft,
  dialogueScript,
} from "../shared/soundtrack-dialogue.mjs";
import { soundSource } from "../shared/soundtrack.mjs";
import {
  assignFace,
  faceChoice,
  clearLineFace,
} from "../shared/face-assignment.mjs";

export function FaceAssignment({ project, clip, audio, update, disabled }) {
  const lines = dialogueScript(project, clip),
    source = soundSource(clip);
  const [selected, setSelected] = useState(null);
  const [scope, setScope] = useState("character");
  const index = selected != null && selected < lines.length ? selected : null;
  const line = index != null ? lines[index] : null;
  const [time, setTime] = useState(0),
    [loadedFrame, setLoadedFrame] = useState(null),
    [faces, setFaces] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const picker = useRef(null), manualBox = useRef(null), didDraw = useRef(false);
  const image = useRef(null),
    worker = useRef(null),
    ticket = useRef(0),
    timer = useRef(null),
    timeout = useRef(null);
  const chosen = line && faceChoice(project, clip, index, scope);
  const range =
    line &&
    (scope === "character"
      ? { start: 0, duration: clip.duration }
      : audio?.soundtrack?.lineTimings?.[index] || {
          start: line.start,
          duration: line.duration,
        });
  const min = range?.start || 0,
    max = range
      ? Math.min(clip.duration - 0.04, range.start + range.duration - 0.04)
      : 0;
  const frameKey = source ? `${source.mediaId}:${source.in}:${time}` : "";
  useEffect(() => {
    if (index != null) setTime((t) => Math.max(min, Math.min(max, t)));
  }, [index, min, max]);
  useEffect(() => {
    ticket.current++;
    setFaces([]);
    setBusy(false);
    setError("");
    clearTimeout(timer.current);
    clearTimeout(timeout.current);
  }, [frameKey, index]);
  useEffect(() => {
    if (index == null) {
      worker.current?.terminate();
      worker.current = null;
    }
    return () => {
      clearTimeout(timer.current);
      clearTimeout(timeout.current);
    };
  }, [index]);
  useEffect(
    () => () => {
      ticket.current++;
      worker.current?.terminate();
      clearTimeout(timer.current);
      clearTimeout(timeout.current);
    },
    [],
  );
  async function detect() {
    if (!image.current?.complete || !image.current.naturalWidth || disabled)
      return;
    const id = ++ticket.current;
    setBusy(true);
    setError("");
    try {
      const bitmap = await createImageBitmap(image.current);
      if (id !== ticket.current) {
        bitmap.close();
        return;
      }
      if (!worker.current) {
        worker.current = new Worker("/vision/face-worker.js");
        worker.current.onmessage = ({ data }) => {
          if (data.id !== ticket.current) return;
          clearTimeout(timeout.current);
          setBusy(false);
          setFaces(data.faces || []);
          setError(data.error || "");
        };
        worker.current.onerror = () => {
          clearTimeout(timeout.current);
          setBusy(false);
          setError("Detection is unavailable. Try another frame, or use a line override to select a face manually.");
          worker.current?.terminate();
          worker.current = null;
        };
      }
      worker.current.postMessage({ id, bitmap }, [bitmap]);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => {
        if (id === ticket.current) {
          worker.current?.terminate();
          worker.current = null;
          setBusy(false);
          setError(
            "Detection timed out. Try another frame, or use a line override.",
          );
        }
      }, 20000);
    } catch {
      if (id === ticket.current) {
        setBusy(false);
        setError("Could not scan this frame. Try another frame, or use a line override.");
      }
    }
  }
  useEffect(() => {
    if (index != null)
      picker.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [index]);
  function open(i, mode = "character") {
    setScope(mode);
    ticket.current++;
    setFaces([]);
    setError("");
    const r =
      mode === "character"
        ? { start: 0, duration: clip.duration }
        : audio?.soundtrack?.lineTimings?.[i] || lines[i];
    const saved = faceChoice(project, clip, i, mode);
    setTime(
      (saved &&
      saved.time >= r.start &&
      saved.time < r.start + r.duration - 0.04
        ? saved.time
        : null) ??
        Math.min(clip.duration - 0.04, r.start + Math.min(0.4, r.duration / 2)),
    );
    setSelected(i);
  }
  function choose(point, box) {
    if (disabled || !line || loadedFrame !== frameKey) return;
    try {
      update((p) =>
        assignFace(
          p,
          p.clips.find((c) => c.id === clip.id),
          index,
          { point, time, ...(box ? { box } : {}) },
          scope,
        ),
      );
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="face-assignment" aria-label="Assign faces to dialogue">
      <div className="face-lines" hidden={index != null}>
        <div className="clip-face-cast" aria-label="Clip character faces">
          {lines
            .filter(
              (l, i) => lines.findIndex((x) => x.speaker === l.speaker) === i,
            )
            .map((l) => {
              const i = lines.indexOf(l),
                saved =
                  project.production?.faceAssignments?.[clip.id]?.characters?.[
                    l.speaker
                  ];
              const fresh = faceChoice(project, clip, i, "character");
              return (
                <button
                  key={l.speaker}
                  disabled={disabled || l.missing || !source}
                  onClick={() => open(i)}
                >
                  <ScanFace size={15} />
                  <span>
                    {l.name}
                    <small>
                      {saved && fresh
                        ? "Face saved · all lines"
                        : "Assign once for this clip"}
                    </small>
                  </span>
                </button>
              );
            })}
        </div>
        {lines.map((l, i) => {
          const face = faceChoice(project, clip, i);
          return (
            <div className="face-line" key={i} data-selected={index === i}>
              <button
                className="face-line-open"
                disabled={disabled || !source}
                onClick={() => open(i, "line")}
                aria-label={`Choose face for line ${i + 1}`}
              >
                {face ? <Check size={15} /> : <ScanFace size={15} />}
                <span>
                  <b>{l.name}</b>
                  <small dir="auto">{l.text}</small>
                </span>
                <small>
                  {face?.scope === "character"
                    ? "Using clip face"
                    : face
                      ? "Line override"
                      : "Choose face"}
                </small>
              </button>
              {face?.scope === "line" && (
                <button
                  className="face-reset"
                  disabled={disabled}
                  onClick={() =>
                    update((p) =>
                      clearLineFace(
                        p,
                        p.clips.find((c) => c.id === clip.id),
                        i,
                      ),
                    )
                  }
                >
                  Use clip face
                </button>
              )}
              <select
                aria-label={`Speaker for line ${i + 1}`}
                value={l.speaker}
                disabled={disabled}
                onChange={(e) => {
                  const speaker = e.target.value;
                  update((p) => {
                    const draft = dialogueDraft(
                      p,
                      p.clips.find((c) => c.id === clip.id),
                    );
                    const raw = draft.scenes.flatMap((s) =>
                      (s.dialogue || []).filter((l) => l.text?.trim()),
                    );
                    raw[i].speaker = speaker;
                  });
                }}
              >
                <option value="">Who speaks?</option>
                {project.assets
                  .filter((a) => a.kind === "character")
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
          );
        })}
      </div>
      {line && source && (
        <div ref={picker} className="face-picker">
          <header>
            <span>
              Choose {line.name}’s face ·{" "}
              {scope === "character" ? "all lines" : `line ${index + 1}`}
            </span>
            <button
              className="icon"
              aria-label="Close face picker"
              onClick={() => setSelected(null)}
            >
              <X size={14} />
            </button>
          </header>
          <small>Choose a detected face, or drag a box around the speaker.</small>
          <button disabled={busy || disabled} onClick={detect}>Scan faces again</button>
          <div
            className="face-frame"
            onPointerDown={e=>{
              if(e.button!==0||e.target.closest("button"))return;
              const r=e.currentTarget.getBoundingClientRect();
              manualBox.current={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};
              didDraw.current=false;e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={e=>{
              const start=manualBox.current;manualBox.current=null;
              if(!start)return;
              const r=e.currentTarget.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
              const box={x:Math.min(x,start.x),y:Math.min(y,start.y),w:Math.abs(x-start.x),h:Math.abs(y-start.y)};
              if(box.w*r.width<10||box.h*r.height<10)return;
              didDraw.current=true;choose([box.x+box.w/2,box.y+box.h/2],box);
            }}
            onPointerCancel={()=>{manualBox.current=null;}}
            onClick={(e) => {
              if(didDraw.current){didDraw.current=false;return;}
              if (scope === "character") {
                setError(
                  "Choose one of the detected face boxes, or adjust the frame until the face is visible.",
                );
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              choose([
                (e.clientX - r.left) / r.width,
                (e.clientY - r.top) / r.height,
              ]);
            }}
          >
            <img
              key={frameKey}
              ref={image}
              src={`/api/media/${source.mediaId}/frame?time=${(source.in + time).toFixed(3)}`}
              alt={`Choose ${line.name} in this video frame`}
              draggable={false}
              onLoad={() => {
                setLoadedFrame(frameKey);
                clearTimeout(timer.current);
                timer.current = setTimeout(detect, 150);
              }}
              onError={() => {
                setLoadedFrame(null);
                setError(
                  "This frame could not be loaded. Choose another frame.",
                );
              }}
            />
            {faces.map((f, i) => (
              <button
                key={i}
                className="detected-face"
                aria-label={`Detected face ${i + 1}`}
                title={`Face ${i + 1}`}
                style={{
                  left: `${Math.max(0, f.x) * 100}%`,
                  top: `${Math.max(0, f.y) * 100}%`,
                  width: `${Math.min(f.w, 1 - Math.max(0, f.x)) * 100}%`,
                  height: `${Math.min(f.h, 1 - Math.max(0, f.y)) * 100}%`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  choose(
                    [
                      Math.max(0, Math.min(1, f.x + f.w / 2)),
                      Math.max(0, Math.min(1, f.y + f.h / 2)),
                    ],
                    f,
                  );
                }}
              />
            ))}
            {chosen && Math.abs(chosen.time - time) < 0.04 && (
              <span
                className="chosen-face"
                style={{
                  left: `${chosen.point[0] * 100}%`,
                  top: `${chosen.point[1] * 100}%`,
                }}
              >
                <Check size={15} />
              </span>
            )}
          </div>
          <div className="face-scrub">
            <button
              className="icon"
              aria-label="Previous speaker frame"
              onClick={() => setTime((t) => Math.max(min, t - 0.2))}
            >
              <ChevronLeft size={14} />
            </button>
            <input
              type="range"
              min={min}
              max={Math.max(min, max)}
              step="0.04"
              value={time}
              aria-label="Speaker reference frame"
              onChange={(e) => setTime(Number(e.target.value))}
            />
            <small>{time.toFixed(1)}s</small>
            <button
              className="icon"
              aria-label="Next speaker frame"
              onClick={() => setTime((t) => Math.min(max, t + 0.2))}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <small role="status">
            {busy
              ? "Finding faces locally…"
              : error ||
                `${faces.length} faces found · ${scope === "character" ? "choose a face to reuse throughout this clip." : "choose one, or click a missed face."}`}
          </small>
          {chosen && (
            <button
              className="face-done"
              onClick={() => {
                if (scope === "line" && index < lines.length - 1)
                  open(index + 1, "line");
                else setSelected(null);
              }}
            >
              <Check size={14} />
              {scope === "line" && index < lines.length - 1
                ? "Next line"
                : "Done"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
