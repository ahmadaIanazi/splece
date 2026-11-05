import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clapperboard,
  Film,
  Folder,
  KeyRound,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import "./landing-demo.css";

const scenes = [
  {
    title: "The arrival",
    image: "coast.jpg",
    start: 0,
    prompt:
      "Wide shot. A lone traveler arrives at the edge of the coast. Silver mist, teal water, one orange raincoat.",
  },
  {
    title: "Keep wandering",
    image: "walk.jpg",
    start: 5,
    prompt:
      "Follow the traveler along a black sand shore. The clouds open. Let the landscape do the talking.",
  },
];
const asset = (name) => `/marketing/demo/${name}`;
const timecode = (seconds) =>
  `00:${Math.floor(seconds).toString().padStart(2, "0")}.${Math.floor((seconds % 1) * 10)}`;

// Public sandbox: static media and component state only. Never import the studio
// store, API client, provider adapters or local-service discovery here.
export function LandingDemo() {
  const video = useRef(null);
  const dialog = useRef(null);
  const generateButton = useRef(null);
  const holdTimer = useRef(null);
  const loadTimer = useRef(null);
  const phaseRef = useRef("idle");
  const [tab, setTab] = useState("Canvas");
  const [scene, setScene] = useState(0);
  const [prompts, setPrompts] = useState(scenes.map((item) => item.prompt));
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(10);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [holding, setHolding] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [hint, setHint] = useState("A little creative freedom. Try it.");

  const cancelHold = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
  };
  useEffect(() => {
    const stop = () => {
      if (document.hidden) {
        video.current?.pause();
        clearTimeout(holdTimer.current);
        setHolding(false);
      }
    };
    document.addEventListener("visibilitychange", stop);
    return () => {
      clearTimeout(holdTimer.current);
      clearTimeout(loadTimer.current);
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);

  const seek = (value) => {
    const next = Math.max(0, Math.min(duration, value));
    if (video.current?.readyState >= 1) video.current.currentTime = next;
    setTime(next);
    setScene(next >= 5 ? 1 : 0);
  };
  const chooseScene = (index) => {
    video.current?.pause();
    seek(scenes[index].start);
    setScene(index);
  };
  const togglePlay = async () => {
    if (!video.current || mediaError) return;
    if (!video.current.paused) return video.current.pause();
    if (video.current.ended) seek(0);
    try {
      await video.current.play();
    } catch {
      setHint("Playback couldn’t start. Try the play button again.");
    }
  };
  const generate = () => {
    if (phaseRef.current !== "idle") return;
    cancelHold();
    video.current?.pause();
    phaseRef.current = "loading";
    setPhase("loading");
    loadTimer.current = setTimeout(() => {
      phaseRef.current = "ready";
      setPhase("ready");
      dialog.current?.showModal();
    }, 1200);
  };
  const closeDialog = () => {
    phaseRef.current = "idle";
    setPhase("idle");
    generateButton.current?.focus({ preventScroll: true });
  };
  const startHold = (event) => {
    if (event.button !== 0 || phaseRef.current !== "idle") return;
    cancelHold();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHolding(true);
    holdTimer.current = setTimeout(generate, 650);
  };

  return (
    <div className="lp-demo" aria-label="Interactive Splece demo">
      <header className="lp-demo-bar">
        <div className="lp-demo-project">
          <img src="/splece.svg" width="26" height="26" alt="" />
          <strong>After the rain</strong>
          <span>A short film</span>
        </div>
        <span className="lp-demo-badge">
          <span /> Interactive demo
        </span>
      </header>
      <div className="lp-demo-body">
        <aside
          className="lp-demo-panel"
          aria-label="Explore the demo workspace"
        >
          <nav className="lp-demo-tabs" aria-label="Demo sections">
            {[
              ["Canvas", Clapperboard],
              ["Media Library", Folder],
              ["Takes", Layers],
            ].map(([name, Icon]) => (
              <button
                key={name}
                type="button"
                aria-pressed={tab === name}
                onClick={() => setTab(name)}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{name}</span>
              </button>
            ))}
          </nav>
          <div className="lp-demo-panel-content">
            {tab === "Canvas" && (
              <>
                <div className="lp-demo-section-label">
                  <span>SCENE {String(scene + 1).padStart(2, "0")}</span>
                  <span>5 seconds</span>
                </div>
                <h3>{scenes[scene].title}</h3>
                <label
                  className="lp-demo-prompt-label"
                  htmlFor="demo-direction"
                >
                  Your direction <span>Try changing it</span>
                </label>
                <textarea
                  id="demo-direction"
                  value={prompts[scene]}
                  maxLength={400}
                  onChange={(event) =>
                    setPrompts((current) =>
                      current.map((value, index) =>
                        index === scene ? event.target.value : value,
                      ),
                    )
                  }
                  spellCheck={false}
                />
                <div className="lp-demo-reference">
                  <img src={asset(scenes[scene].image)} alt="" />
                  <div>
                    <strong>A world to start from</strong>
                    <span>Reference frame · 16:9</span>
                  </div>
                </div>
              </>
            )}
            {tab === "Media Library" && (
              <>
                <div className="lp-demo-section-label">
                  YOUR CREATIVE INGREDIENTS
                </div>
                <h3>A world worth exploring.</h3>
                <div className="lp-demo-media">
                  {scenes.map((item, index) => (
                    <button
                      key={item.title}
                      type="button"
                      aria-pressed={scene === index}
                      onClick={() => chooseScene(index)}
                    >
                      <img
                        src={asset(item.image)}
                        alt={
                          index === 0
                            ? "Traveler overlooking a misty coastal waterfall"
                            : "Traveler walking a black sand beach"
                        }
                      />
                      <span>
                        {item.title}
                        <small>Demo footage · 5s</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === "Takes" && (
              <>
                <div className="lp-demo-section-label">ROOM TO TRY AGAIN</div>
                <h3>Find your favorite feeling.</h3>
                <p className="lp-demo-explainer">
                  Every take stays close. Explore these two demo shots.
                </p>
                <div className="lp-demo-media">
                  {scenes.map((item, index) => (
                    <button
                      key={item.title}
                      type="button"
                      aria-pressed={scene === index}
                      onClick={() => chooseScene(index)}
                    >
                      <img src={asset(item.image)} alt="" />
                      <span>
                        Take {index + 1}
                        <small>
                          {scene === index ? "Selected" : "Preview this take"}
                        </small>
                      </span>
                      {scene === index && (
                        <Check size={16} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="lp-demo-generate-area">
            <button
              type="button"
              ref={generateButton}
              className={`lp-demo-generate${holding ? " is-holding" : ""}`}
              aria-disabled={phase !== "idle"}
              onPointerDown={startHold}
              onPointerUp={cancelHold}
              onPointerCancel={cancelHold}
              onLostPointerCapture={cancelHold}
              onBlur={cancelHold}
              onContextMenu={(event) => event.preventDefault()}
              onClick={(event) => {
                if (event.detail === 0) generate();
                else if (phaseRef.current === "idle")
                  setHint(
                    "Hold a moment, or choose “Try with one click” below.",
                  );
              }}
            >
              <span className="lp-demo-hold-fill" aria-hidden="true" />
              <Sparkles size={17} aria-hidden="true" />
              <span>
                {phase === "loading" ? "Preparing demo…" : "Hold to Generate"}
              </span>
              <small>Demo</small>
            </button>
            <button
              className="lp-demo-click-alternative"
              type="button"
              disabled={phase !== "idle"}
              onClick={generate}
            >
              Try with one click <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
        </aside>
        <div className="lp-demo-viewer">
          <div className="lp-demo-viewer-top">
            <span>
              <Film size={14} aria-hidden="true" /> Preview
            </span>
            <span>16:9 · Demo film</span>
          </div>
          <div className="lp-demo-screen">
            <video
              ref={video}
              src={asset("after-the-rain.mp4")}
              poster={asset("coast.jpg")}
              muted
              playsInline
              preload="metadata"
              aria-label="After the rain, a silent demo film of a traveler on a coast"
              onLoadedMetadata={(event) => {
                const value = event.currentTarget.duration;
                if (Number.isFinite(value) && value > 0) setDuration(value);
              }}
              onTimeUpdate={(event) => {
                const value = event.currentTarget.currentTime;
                setTime(value);
                setScene(value >= 5 ? 1 : 0);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => setMediaError(true)}
            />
            {mediaError && (
              <p className="lp-demo-video-error">
                The demo video couldn’t load. You can still explore the canvas
                and generation demo.
              </p>
            )}
            {!playing && !mediaError && (
              <button
                className="lp-demo-screen-play"
                type="button"
                aria-label="Play demo film"
                onClick={togglePlay}
              >
                <Play size={25} fill="currentColor" aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="lp-demo-transport">
            <span className="lp-demo-time">
              {timecode(time)} <span>/ {timecode(duration)}</span>
            </span>
            <div>
              <button
                type="button"
                aria-label="Restart demo film"
                onClick={() => seek(0)}
                disabled={mediaError}
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lp-demo-play"
                aria-label={playing ? "Pause demo film" : "Play demo film"}
                onClick={togglePlay}
                disabled={mediaError}
              >
                {playing ? (
                  <Pause size={18} aria-hidden="true" />
                ) : (
                  <Play size={18} aria-hidden="true" />
                )}
              </button>
            </div>
            <span className="lp-demo-silent">Silent preview</span>
          </div>
        </div>
      </div>
      <div className="lp-demo-timeline">
        <div className="lp-demo-timeline-heading">
          <span>
            <Layers size={14} aria-hidden="true" /> Timeline
          </span>
          <span>Drag the playhead. Find your moment.</span>
        </div>
        <div className="lp-demo-tracks">
          <div className="lp-demo-ruler" aria-hidden="true">
            <span>00:00</span>
            <span>00:02</span>
            <span>00:04</span>
            <span>00:06</span>
            <span>00:08</span>
            <span>00:10</span>
          </div>
          <div className="lp-demo-clips" aria-hidden="true">
            {scenes.map((item) => (
              <div
                key={item.title}
                style={{ backgroundImage: `url('${asset(item.image)}')` }}
              >
                <span>{item.title}</span>
              </div>
            ))}
          </div>
          <div
            className="lp-demo-playhead"
            style={{ left: `${Math.min(100, (time / duration) * 100)}%` }}
            aria-hidden="true"
          >
            <i />
          </div>
          <input
            className="lp-demo-scrubber"
            type="range"
            min="0"
            max={duration}
            step="0.04"
            value={time}
            aria-label="Demo playhead"
            aria-valuetext={`${time.toFixed(1)} seconds of ${duration.toFixed(1)} seconds`}
            onPointerDown={() => video.current?.pause()}
            onKeyDown={() => video.current?.pause()}
            onChange={(event) => seek(Number(event.target.value))}
          />
        </div>
      </div>
      <footer className="lp-demo-footer">
        <span role="status">
          {phase === "loading"
            ? "Simulating generation. No provider connected, no credits used."
            : hint}
        </span>
        <span>Sample media · Nothing is uploaded</span>
      </footer>
      <dialog
        ref={dialog}
        className="lp-demo-dialog"
        aria-labelledby="demo-dialog-title"
        aria-describedby="demo-dialog-description"
        onClose={closeDialog}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll("button, a[href]");
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current.close();
        }}
      >
        <div className="lp-demo-dialog-card">
          <button
            className="lp-demo-dialog-close"
            type="button"
            aria-label="Close generation demo"
            autoFocus
            onClick={() => dialog.current.close()}
          >
            <X size={20} aria-hidden="true" />
          </button>
          <div className="lp-demo-key">
            <KeyRound size={28} aria-hidden="true" />
          </div>
          <span className="lp-eyebrow">YOUR IDEAS. YOUR MODELS.</span>
          <h2 id="demo-dialog-title">
            Just bring
            <br />
            <span>your API key.</span>
          </h2>
          <p id="demo-dialog-description">
            That was a demo. In Splece, connect your own AI provider and turn
            your direction into a new take.
          </p>
          <ol>
            <li>Download the free app.</li>
            <li>Connect your provider in Settings.</li>
            <li>Make something only you would.</li>
          </ol>
          <a
            className="lp-button lp-button-primary"
            href="#download"
            onClick={() => dialog.current.close()}
          >
            Get Splece — it’s free <ArrowRight size={17} aria-hidden="true" />
          </a>
          <p className="lp-demo-dialog-note">
            The editor is free. AI providers bill you separately.
            <br />
            No API keys are collected on this website.
          </p>
        </div>
      </dialog>
    </div>
  );
}
