import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  X,
  LoaderCircle,
  ScanFace,
  Download,
  Check,
  Play,
  Maximize2,
} from "lucide-react";
import { Modal } from "./components";
import { api, tc } from "./state";
import { useAddons } from "./addons";
import { GenerationDuration } from "./generation-duration";
import {
  localEffectPresets,
  cropAt,
  saveLocalResult,
} from "../shared/reel-effects.mjs";
import { trackReelFaces } from "./reel-face-tracking";
import "./reel-effects.css";
import { ReelDirection } from "./reel-direction";
import {
  directShot,
  portraitGeometry,
  subjectAt,
} from "../shared/reel-director.mjs";
import { boundedBox } from "../shared/subject-tracking.mjs";
import { OpenResultProject } from "./result-project";

export function EffectFootage({ media, recipe = "warm", start, end }) {
  const video = useRef(null),
    [playing, setPlaying] = useState(false);
  const preview =
    media?.id && media.kind !== "image"
      ? `/api/media/${media.id}/frame?time=0.1`
      : media?.thumbnail || "/templates/daily-story.jpg";
  const play = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPlaying(true);
  };
  const stop = () => {
    video.current?.pause();
    setPlaying(false);
  };
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (playing) el.play().catch(() => {});
    else el.pause();
    return () => el.pause();
  }, [playing]);
  return (
    <div
      className={`effect-footage footage-${recipe}`}
      onPointerEnter={play}
      onPointerLeave={stop}
    >
      {start || end ? (
        <div className="effect-endpoints">
          <img src={start || preview} alt="Starting footage" />
          <img src={end || preview} alt="Ending footage" />
        </div>
      ) : (
        <>
          <img
            src={preview}
            alt={media ? "Selected footage" : "Illustrative demo footage"}
          />
          <video
            ref={video}
            src={
              playing
                ? media?.kind === "image"
                  ? undefined
                  : media?.url || "/templates/daily-story.mp4"
                : undefined
            }
            poster={preview}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            className={playing ? "playing" : ""}
          />
          <div
            className="effect-look"
            style={{ backgroundImage: `url("${preview}")` }}
          />
        </>
      )}
      <span className="footage-label left">
        {start || end ? "From" : "Before"}
      </span>
      <span className="footage-label right">
        {start || end ? "To" : recipe === "reel" ? "9:16" : "Look"}
      </span>
      {!media && !start && !end && (
        <small className="footage-demo">Demo footage</small>
      )}
      {recipe === "reel" && <i className="footage-portrait" />}
    </div>
  );
}
export function ReelEffects({
  project,
  selectedIds = [],
  recipe,
  flush,
  update,
  onBack,
  onOpenProject,
  onClose,
}) {
  const preset = localEffectPresets.find((p) => p.id === recipe),
    isReel = recipe === "reel",
    { addons } = useAddons();
  const [duration, setDuration] = useState(30),
    [resolution, setResolution] = useState("480p"),
    [captions, setCaptions] = useState(true),
    [language, setLanguage] = useState("auto"),
    [highlights, setHighlights] = useState(true),
    [scope, setScope] = useState(
      selectedIds.some((id) =>
        project.clips.some((c) => c.id === id && c.activeTake),
      )
        ? "selected"
        : "all",
    );
  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false),
    [playingReel, setPlayingReel] = useState(false);
  const [job, setJob] = useState(null),
    [plan, setPlan] = useState([]),
    [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pollError, setPollError] = useState(""),
    [scan, setScan] = useState(""),
    [faceNote, setFaceNote] = useState(""),
    [setup, setSetup] = useState(false);
  const current = useRef({ project, job }),
    alive = useRef(true),
    initialized = useRef(false),
    scanned = useRef(new Set()),
    tracking = useRef(null),
    automatic = useRef(new Set()),
    shown = useRef(new Set()),
    requestKey = useRef(null);
  current.current = { project, job };
  const captionAddon = addons.find((a) => a.id === "captions"),
    captionsReady = captionAddon?.status === "ready" && captionAddon.enabled;
  const clips = project.clips.filter(
      (c) =>
        c.activeTake &&
        c.duration > 0.15 &&
        (scope === "all" || selectedIds.includes(c.id)),
    ),
    seconds = clips.reduce((n, c) => n + c.duration, 0),
    working = busy || ["queued", "running"].includes(job?.state);
  useEffect(() => {
    alive.current = true;
    let timer;
    async function poll() {
      try {
        const rows = await api(`/projects/${project.id}/reels`);
        if (!alive.current) return;
        setPollError("");
        const latest = current.current.job;
        const found = latest
          ? rows.find((j) => j.id === latest.id)
          : !initialized.current
            ? rows.find(
                (j) =>
                  j.episodeId === project.episodeId &&
                  j.options.recipe === recipe,
              )
            : null;
        initialized.current = true;
        if (found) {
          setJob(found);
          if (!latest) setPlan(found.plan || []);
        }
      } catch (e) {
        if (alive.current) setPollError(e.message);
      }
      if (alive.current) timer = setTimeout(poll, 1500);
    }
    poll();
    return () => {
      alive.current = false;
      clearTimeout(timer);
      tracking.current?.abort();
    };
  }, [project.id, project.episodeId, recipe]);
  useEffect(() => {
    if (job?.state === "quoted" && !plan.length) setPlan(job.plan);
  }, [job?.state, job?.id]);
  useEffect(() => {
    if (!job || job.state !== "quoted" || !plan.length) return;
    if (isReel && !shown.current.has(job.id)) {
      shown.current.add(job.id);
      setExpanded(true);
    }
    if (isReel && !job.reviewedAt && !scanned.current.has(job.id)) {
      scanned.current.add(job.id);
      followFaces();
    } else if (!isReel && !automatic.current.has(job.id)) {
      automatic.current.add(job.id);
      render(plan);
    }
  }, [job?.state, job?.id, plan.length]);
  useEffect(() => {
    if (
      job?.state !== "quoted" ||
      !isReel ||
      !plan.length ||
      scan ||
      tracking.current ||
      busy
    )
      return;
    const controller = new AbortController(),
      timer = setTimeout(() => {
        api(`/projects/${project.id}/reels/${job.id}/review`, { plan }, "PUT", {
          signal: controller.signal,
        }).catch((e) => {
          if (alive.current && !controller.signal.aborted) setError(e.message);
        });
      }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [plan, scan, busy, job?.id, job?.state]);
  useEffect(() => {
    requestKey.current = null;
  }, [
    duration,
    resolution,
    captions,
    language,
    highlights,
    scope,
    selectedIds.join(","),
  ]);
  async function start(reframe = false) {
    reframe = reframe === true;
    setBusy(true);
    setError("");
    try {
      const pid = project.id,
        revision = await flush();
      if (current.current.project.id !== pid) return;
      const value = await api(`/projects/${pid}/reels`, {
        recipe,
        duration: reframe ? ([15,30,60].find(v=>v>=clips.reduce((n,c)=>n+c.duration,0)) || 60) : duration,
        reframe,
        resolution,
        captions: isReel && captions,
        language,
        highlights,
        clipIds: clips.map((c) => c.id),
        revision,
        requestId: (requestKey.current ||= crypto.randomUUID()),
      });
      if (alive.current) {
        setPlan([]);
        setSelected(0);
        setJob(value);
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function followFaces(valuePlan = plan) {
    if (tracking.current) return;
    const controller = new AbortController();
    tracking.current = controller;
    setScan("Finding faces locally…");
    setFaceNote("");
    try {
      const value = await trackReelFaces(valuePlan, job.sources, {
        project,
        signal: controller.signal,
        onProgress: (m) => alive.current && setScan(m),
      });
      if (alive.current) {
        setPlan((currentPlan) =>
          currentPlan.map(
            (shot) =>
              value.plan.find((tracked) => tracked.id === shot.id) || shot,
          ),
        );
        setFaceNote(
          value.found
            ? "Subjects tracked locally. Check character choices and dialogue."
            : "No face found. Keeping the full frame; select a character to follow.",
        );
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted) setFaceNote(e.message);
    } finally {
      tracking.current = null;
      if (alive.current) setScan("");
    }
  }
  async function render(value = plan) {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/projects/${project.id}/reels/${job.id}/render`,
        { plan: value },
      );
      if (alive.current) setJob(result);
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function cancel() {
    setError("");
    try {
      setJob(await api(`/projects/${project.id}/reels/${job.id}/cancel`, {}));
    } catch (e) {
      setError(e.message);
    }
  }
  async function install() {
    setBusy(true);
    setError("");
    try {
      await (captionAddon?.status === "ready"
        ? api("/addons/captions", { enabled: true }, "PUT")
        : api("/addons/captions/install", {}));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const reset = () => {
    requestKey.current = null;
    tracking.current?.abort();
    setJob(null);
    setPlan([]);
    setSelected(0);
    setError("");
    setFaceNote("");
  };
  const shot = plan[selected],
    source = job?.sources.find((s) => s.id === shot?.sourceId),
    saved = project.assets.some((a) => a.media?.id === job?.media?.id),
    review = job?.state === "quoted";
  const changeShot = (patch) =>
    setPlan((old) =>
      old.map((s, i) => (i === selected ? { ...s, ...patch } : s)),
    );
  const selectSubject = (box, time) => {
    if (!shot || (shot.subjects?.length || 0) >= 6) return;
    const subject = {
      id: crypto.randomUUID(),
      name: "Selected character",
      characterId: "",
      kind: "selected",
      seed: { t: time, box: boundedBox(box) },
      points: [],
    };
    const next = {
      ...shot,
      subjects: [...(shot.subjects || []), subject],
      director: { ...shot.director, locked: false },
    };
    changeShot(next);
    setPicking(false);
    setPlayingReel(false);
    followFaces([next]);
  };
  const leave = async (action) => {
    if (busy) return;
    if (review && plan.length) {
      setBusy(true);
      setError("");
      try {
        await api(`/projects/${project.id}/reels/${job.id}/review`, { plan }, "PUT");
      } catch (e) {
        setError(e.message);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    action();
  };
  const content = (
    <section className="effects-panel reel-panel" aria-label={preset.name}>
      <header>
        <button className="icon" aria-label="All effects" disabled={busy} onClick={() => leave(onBack)}>
          <ChevronLeft size={16} />
        </button>
        <strong>{preset.name}</strong>
        {!expanded && (
          <button
            className="icon"
            aria-label="Expand effect review"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={15} />
          </button>
        )}
        <button
          className="icon"
          aria-label="Collapse effects"
          disabled={busy}
          onClick={() => leave(onClose)}
        >
          <X size={16} />
        </button>
      </header>
      {!job && (
        <>
          {isReel && clips.length > 0 && clips.every(c=>c.reelSource?.reframeMediaId) && <div className="reel-saved-framing"><p>Continue directing from the saved original footage.</p><button disabled={busy} onClick={()=>start(true)}>Edit saved framing</button></div>}
          <EffectFootage
            recipe={recipe}
            media={clips[0]?.takes?.find((t) => t.id === clips[0].activeTake)}
          />
          <p>
            {isReel
              ? "From your edit to a portrait video. Find highlights, follow faces and add captions—all on this computer."
              : preset.description +
                " Render a new copy locally, with your sound and timing."}
          </p>
          <label className="reel-field">
            Footage
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="selected">Selected clips</option>
              <option value="all">All finished clips</option>
            </select>
          </label>
          <small>
            {clips.length} clips · {tc(seconds)} available
          </small>
          <GenerationDuration
            value={duration}
            durations={[15, 30, 60]}
            label="Maximum result duration"
            onChange={setDuration}
          />
          <small>
            Up to {Math.min(duration, seconds).toFixed(1)} seconds
            {isReel ? " · 9:16 portrait" : " · original edit format"}
          </small>
          {isReel && (
            <>
              <label className="reel-check">
                <input
                  type="checkbox"
                  checked={highlights}
                  onChange={(e) => setHighlights(e.target.checked)}
                />
                Find highlights{" "}
                <small>
                  {captions
                    ? "Speech, sound & shot changes"
                    : "Sound & shot changes"}
                </small>
              </label>
              <label className="reel-check">
                <input
                  type="checkbox"
                  checked={captions}
                  onChange={(e) => setCaptions(e.target.checked)}
                />
                Add captions
              </label>
              {captions && (
                <>
                  <label className="reel-field">
                    Speech language
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      <option value="auto">Detect automatically</option>
                      <option value="en">English</option>
                      <option value="ar">Arabic</option>
                    </select>
                  </label>
                  {!captionsReady && (
                    <div className="reel-setup">
                      <strong>Local captions · one-time setup</strong>
                      <p>
                        {captionAddon?.status === "installing"
                          ? captionAddon.message
                          : "Download the speech add-on once. After setup, captions run on your computer."}
                      </p>
                      <small>{captionAddon?.download}</small>
                      <button
                        disabled={
                          busy ||
                          !captionAddon ||
                          captionAddon.status === "installing"
                        }
                        onClick={install}
                      >
                        {captionAddon?.status === "ready"
                          ? "Enable captions"
                          : "Set up captions"}
                      </button>
                      <button
                        aria-expanded={setup}
                        onClick={() => setSetup(!setup)}
                      >
                        Setup details
                      </button>
                      {setup && <p>{captionAddon?.requirements}</p>}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <label className="reel-field">
            Quality
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            >
              <option value="480p">Draft · 480p</option>
              <option value="1080p">Final · 1080p</option>
            </select>
          </label>
          <button
            className="primary reel-create"
            onClick={start}
            disabled={
              busy || !clips.length || (isReel && captions && !captionsReady)
            }
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Play size={15} />
            )}{" "}
            {isReel ? "Prepare my Reel" : "Create effect"}{" "}
            <small>Local · no credits</small>
          </button>
        </>
      )}
      {working && (
        <div className="reel-progress" role="status">
          <LoaderCircle className="spin" size={24} />
          <strong>{job?.message || "Preparing locally…"}</strong>
          <small>Your original edit stays saved.</small>
          {job && <button onClick={cancel}>Cancel</button>}
        </div>
      )}
      {review && isReel && (
        <>
          <div className="reel-review-heading">
            <strong>
              {plan.length} highlights ·{" "}
              {tc(plan.reduce((n, s) => n + s.to - s.from, 0))}
            </strong>
            <span>9:16</span>
          </div>
          <small>
            Suggested from speech, sound and cuts. Review the story before
            exporting.
          </small>
          <div className="reel-shots" aria-label="Highlights">
            {plan.map((s, i) => (
              <button
                key={s.id}
                aria-pressed={selected === i}
                onClick={() => {
                  setSelected(i);
                  setPicking(false);
                  setPlayingReel(false);
                }}
              >
                {i + 1}
                <small>{(s.to - s.from).toFixed(1)}s</small>
              </button>
            ))}
          </div>
          <button
            className="reel-sequence-play"
            disabled={!!scan || busy}
            aria-pressed={playingReel}
            onClick={() => {
              setPicking(false);
              setPlayingReel((v) => !v);
              if (!playingReel) setSelected(0);
            }}
          >
            <Play size={14} />
            {playingReel ? "Stop Reel preview" : "Preview complete Reel"}
          </button>
          {shot && source && (
            <div className="reel-review-body">
              <div className="reel-visual-review">
                <PortraitReview
                  key={shot.id}
                  source={source}
                  shot={shot}
                  disabled={!!scan || busy}
                  onChange={changeShot}
                  picking={picking}
                  onPick={selectSubject}
                  autoPlay={playingReel}
                  onEnd={() => {
                    if (playingReel && selected < plan.length - 1)
                      setSelected((i) => i + 1);
                    else setPlayingReel(false);
                  }}
                />
                <div className="reel-framing">
                  <button
                    disabled={!!scan || busy}
                    onClick={() => followFaces()}
                  >
                    <ScanFace size={14} />
                    Find subjects
                  </button>
                  <button
                    disabled={!!scan || busy}
                    onClick={() =>
                      changeShot(
                        directShot(
                          {
                            ...shot,
                            subjects: shot.subjects || [],
                            director: {
                              ...shot.director,
                              mode: "wide",
                              locked: false,
                            },
                          },
                          source,
                        ),
                      )
                    }
                  >
                    Keep full frame
                  </button>
                  {plan.length > 1 && (
                    <button
                      disabled={!!scan || busy}
                      onClick={() => {
                        setPlan((old) => old.filter((_, i) => i !== selected));
                        setSelected(0);
                      }}
                    >
                      Remove shot
                    </button>
                  )}
                </div>
                <small role="status">
                  {scan ||
                    faceNote ||
                    "Drag the portrait box or use the framing sliders."}
                </small>
              </div>
              <div className="reel-review-details">
                <ReelDirection
                  shot={shot}
                  source={source}
                  project={project}
                  disabled={!!scan || busy}
                  picking={picking}
                  onPick={() => {
                    setPlayingReel(false);
                    setPicking((v) => !v);
                  }}
                  onChange={changeShot}
                  onAnalyze={() => followFaces([shot])}
                />
                {job.options.captions && (
                  <details open className="reel-captions">
                    <summary>Captions · check the wording</summary>
                    {shot.captions.length ? (
                      shot.captions.map((c, i) => (
                        <label key={i}>
                          <span className="reel-caption-time">
                            <input
                              aria-label={`Caption ${i + 1} start seconds`}
                              type="number"
                              min={0}
                              max={Math.max(0, c.end - 0.05)}
                              step={0.05}
                              value={+c.start.toFixed(2)}
                              onChange={(e) =>
                                changeShot({
                                  captions: shot.captions.map((x, k) =>
                                    k === i
                                      ? {
                                          ...x,
                                          start: Math.max(
                                            0,
                                            Math.min(
                                              c.end - 0.05,
                                              Number(e.target.value),
                                            ),
                                          ),
                                        }
                                      : x,
                                  ),
                                })
                              }
                            />
                            <span>—</span>
                            <input
                              aria-label={`Caption ${i + 1} end seconds`}
                              type="number"
                              min={c.start + 0.05}
                              max={shot.to - shot.from}
                              step={0.05}
                              value={+c.end.toFixed(2)}
                              onChange={(e) =>
                                changeShot({
                                  captions: shot.captions.map((x, k) =>
                                    k === i
                                      ? {
                                          ...x,
                                          end: Math.min(
                                            shot.to - shot.from,
                                            Math.max(
                                              c.start + 0.05,
                                              Number(e.target.value),
                                            ),
                                          ),
                                        }
                                      : x,
                                  ),
                                })
                              }
                            />{" "}
                            s
                          </span>
                          <textarea
                            dir="auto"
                            aria-label={`Caption ${i + 1}`}
                            value={c.text}
                            maxLength={500}
                            onChange={(e) =>
                              changeShot({
                                captions: shot.captions.map((x, k) =>
                                  k === i ? { ...x, text: e.target.value } : x,
                                ),
                              })
                            }
                          />
                        </label>
                      ))
                    ) : (
                      <p>No speech detected in this shot.</p>
                    )}
                  </details>
                )}
              </div>
            </div>
          )}
          <button
            className="primary reel-create"
            disabled={!!scan || busy || !plan.length}
            onClick={() => render()}
          >
            {busy ? "Starting…" : "Create Reel"}
            <small>{job.options.resolution} · local</small>
          </button>
          <button disabled={busy || !!scan} onClick={reset}>
            Start again
          </button>
        </>
      )}
      {job?.state === "ready" && (
        <div className="reel-result">
          <video
            controls
            playsInline
            preload="metadata"
            src={job.media.url}
            poster={job.media.thumbnail}
          />
          <p>
            <Check size={14} /> Ready · {job.media.width} × {job.media.height} ·{" "}
            {tc(job.media.duration)}
          </p>
          <p>Your original edit is unchanged.</p>
          <OpenResultProject
            projectId={project.id}
            resultId={job.id}
            flush={flush}
            onOpenProject={onOpenProject}
            primary={isReel}
          />
          <div>
            <button
              className={isReel ? "" : "primary"}
              disabled={saved}
              onClick={() => {
                try {
                  update((p) => saveLocalResult(p, job));
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              {saved ? "Saved to Library" : "Save to Library"}
            </button>
            <a
              href={`${job.media.url}/original`}
              download={`${preset.name}.mp4`}
            >
              <Download size={14} />
              Download
            </a>
          </div>
          <small>
            Use the saved video in any clip, or share the downloaded file.
          </small>
          <button onClick={reset}>Make another</button>
        </div>
      )}
      {job && ["failed", "cancelled", "interrupted"].includes(job.state) && (
        <div role="status">
          <p>{job.message || "Cancelled. Your original edit is unchanged."}</p>
          <button onClick={reset}>Try again</button>
        </div>
      )}
      {(error || pollError) && <p role="alert">{error || pollError}</p>}
    </section>
  );
  return expanded
    ? createPortal(
        <Modal
          title={review ? "Review your Reel" : preset.name}
          onClose={() => setExpanded(false)}
          wide
          className="reel-modal"
        >
          {content}
        </Modal>,
        document.body,
      )
    : content;
}
function PortraitReview({
  source,
  shot,
  disabled,
  onChange,
  picking,
  onPick,
  autoPlay,
  onEnd,
}) {
  const video = useRef(null),
    [time, setTime] = useState(0),
    [portrait, setPortrait] = useState(false);
  const endCallback = useRef(onEnd),
    ended = useRef(false),
    selectionStart = useRef(null);
  endCallback.current = onEnd;
  useEffect(() => {
    const media = video.current;
    let frame = null;
    const videoFrames = typeof media.requestVideoFrameCallback === "function";
    const cancel = () => {
      if (frame === null) return;
      if (videoFrames) media.cancelVideoFrameCallback(frame);
      else cancelAnimationFrame(frame);
      frame = null;
    };
    const sync = (mediaTime = media.currentTime) => {
      setTime(
        Math.max(0, Math.min(shot.to - shot.from, mediaTime - shot.from)),
      );
      if (mediaTime >= shot.to - 0.015) {
        media.pause();
        if (!ended.current) {
          ended.current = true;
          endCallback.current?.();
        }
      }
    };
    const tick = (_, metadata) => {
      frame = null;
      sync(metadata?.mediaTime ?? media.currentTime);
      if (!media.paused && !media.ended) schedule();
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = videoFrames
        ? media.requestVideoFrameCallback(tick)
        : requestAnimationFrame(tick);
    };
    const seek = () => sync();
    const finish = () => sync(shot.to);
    const pause = () => {
      cancel();
      sync();
    };
    const reset = () => {
      ended.current = false;
      media.currentTime = shot.from;
      setTime(0);
    };
    media.addEventListener("play", schedule);
    media.addEventListener("pause", pause);
    media.addEventListener("seeked", seek);
    media.addEventListener("ended", finish);
    media.addEventListener("loadedmetadata", reset);
    if (media.readyState >= 1) reset();
    if (!media.paused) schedule();
    return () => {
      cancel();
      media.removeEventListener("play", schedule);
      media.removeEventListener("pause", pause);
      media.removeEventListener("seeked", seek);
      media.removeEventListener("ended", finish);
      media.removeEventListener("loadedmetadata", reset);
    };
  }, [source.preview, shot.from, shot.to]);
  useEffect(() => {
    const media = video.current;
    const play = () => {
      if (autoPlay) media.play().catch(() => {});
    };
    if (autoPlay) {
      ended.current = false;
      play();
      media.addEventListener("canplay", play);
    } else media.pause();
    return () => media.removeEventListener("canplay", play);
  }, [autoPlay, source.preview, shot.id]);
  useEffect(() => {
    if (picking) video.current?.pause();
  }, [picking]);
  const point = cropAt(shot.crop, time),
    geometry = portraitGeometry(source),
    zoom = point.zoom ?? 1;
  const cw = Math.min(1, geometry.cw / zoom),
    ch = Math.min(1, geometry.ch / zoom);
  const left = Math.max(0, Math.min(1 - cw, point.x - cw / 2)),
    top = Math.max(0, Math.min(1 - ch, point.y - ch / 2));
  const manual = (x, y) =>
    onChange({
      subjects: shot.subjects || [],
      director: { ...shot.director, locked: true },
      crop: [
        {
          t: 0,
          x: Math.max(0, Math.min(1, x)),
          y: Math.max(0, Math.min(1, y)),
          zoom,
        },
      ],
    });
  const drag = (e) => {
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    manual((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const showPortrait = !picking && (portrait || autoPlay);
  const caption = shot.captions.find((c) => c.start <= time && c.end > time);
  return (
    <div className="reel-preview">
      <div
        className="reel-crop-stage"
        style={{
          aspectRatio: showPortrait
            ? "9/16"
            : `${source.width}/${source.height}`,
          maxHeight: showPortrait ? "420px" : undefined,
          marginInline: "auto",
          width: showPortrait ? "min(100%, 236px)" : "100%",
        }}
      >
        <video
          ref={video}
          playsInline
          preload="metadata"
          src={source.preview}
          style={
            showPortrait
              ? {
                  position: "absolute",
                  width: `${(zoom / geometry.cw) * 100}%`,
                  height: `${(zoom / geometry.ch) * 100}%`,
                  maxWidth: "none",
                  left: "50%",
                  top: "50%",
                  transform: `translate(${-100 * (left + cw / 2)}%,${-100 * (top + ch / 2)}%)`,
                }
              : undefined
          }
        />
        {!showPortrait &&
          (shot.subjects || []).map((subject) => {
            const box = subjectAt(subject, time);
            return (
              box && (
                <div
                  key={subject.id}
                  className="reel-subject-box"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                  }}
                >
                  <span>{subject.name}</span>
                </div>
              )
            );
          })}
        {showPortrait && caption && (
          <p className="reel-portrait-caption" dir="auto">
            {caption.text}
          </p>
        )}
        <div
          style={{ display: showPortrait ? "none" : undefined }}
          className="reel-crop-drag"
          onPointerDown={(e) => {
            if (disabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            if (picking) {
              const r = e.currentTarget.getBoundingClientRect();
              selectionStart.current = {
                x: (e.clientX - r.left) / r.width,
                y: (e.clientY - r.top) / r.height,
              };
            } else drag(e);
          }}
          onPointerUp={(e) => {
            if (!picking || !selectionStart.current || disabled) return;
            const r = e.currentTarget.getBoundingClientRect(),
              start = selectionStart.current;
            const x = (e.clientX - r.left) / r.width,
              y = (e.clientY - r.top) / r.height;
            const w = Math.abs(x - start.x),
              h = Math.abs(y - start.y);
            const box =
              w < 0.025 || h < 0.025
                ? { x: x - 0.08, y: y - 0.12, w: 0.16, h: 0.24 }
                : { x: Math.min(x, start.x), y: Math.min(y, start.y), w, h };
            selectionStart.current = null;
            onPick(box, time);
          }}
          onPointerMove={(e) => {
            if (!picking && e.currentTarget.hasPointerCapture(e.pointerId))
              drag(e);
          }}
        >
          <div
            className="reel-crop-box"
            style={{
              left: `${left * 100}%`,
              top: `${top * 100}%`,
              width: `${cw * 100}%`,
              height: `${ch * 100}%`,
            }}
          >
            <span>{picking ? "Select character" : zoom < .99 ? "Wide · full context" : "9:16"}</span>
            {caption && <p dir="auto">{caption.text}</p>}
          </div>
        </div>
      </div>
      <button
        disabled={picking || autoPlay}
        aria-pressed={showPortrait}
        onClick={() => setPortrait((v) => !v)}
      >
        {showPortrait ? "Show framing view" : "Show portrait preview"}
      </button>
      <div className="reel-playback">
        <button
          aria-label="Play highlight"
          onClick={() => {
            const media = video.current;
            if (!media.paused) media.pause();
            else {
              if (media.currentTime >= shot.to - 0.04) {
                media.currentTime = shot.from;
                ended.current = false;
              }
              media.play().catch(() => {});
            }
          }}
        >
          <Play size={14} />
          Preview shot
        </button>
        <input
          aria-label="Preview position"
          type="range"
          min={0}
          max={shot.to - shot.from - 0.04}
          step={0.04}
          value={time}
          onChange={(e) => {
            video.current.currentTime = shot.from + Number(e.target.value);
            setTime(Number(e.target.value));
          }}
        />
      </div>
      {picking && (
        <button
          disabled={disabled}
          onClick={() => onPick({ x: 0.4, y: 0.35, w: 0.2, h: 0.3 }, time)}
        >
          Select subject at center
        </button>
      )}
      <details>
        <summary>Adjust framing</summary>
        <label>
          Horizontal
          <input
            disabled={disabled}
            aria-label="Horizontal portrait framing"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={point.x}
            onChange={(e) => manual(Number(e.target.value), point.y)}
          />
        </label>
        <label>
          Vertical
          <input
            disabled={disabled}
            aria-label="Vertical portrait framing"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={point.y}
            onChange={(e) => manual(point.x, Number(e.target.value))}
          />
        </label>
        <label>
          Zoom
          <input
            aria-label="Portrait zoom"
            disabled={disabled}
            type="range"
            min={Math.max(0.05, geometry.fit)}
            max={1.3}
            step={0.01}
            value={zoom}
            onChange={(e) =>
              onChange({
                subjects: shot.subjects || [],
                director: { ...shot.director, locked: true },
                crop: [
                  {
                    t: 0,
                    x: point.x,
                    y: point.y,
                    zoom: Number(e.target.value),
                  },
                ],
              })
            }
          />
        </label>
        <small>Manual adjustments lock this framing for the shot.</small>
      </details>
    </div>
  );
}
