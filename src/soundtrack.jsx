import {
  ConnectProviderButton,
  useProviderConnection,
} from "./provider-connect";
import { useLipSync } from "./lip-sync";
import { DialogueFlow } from "./dialogue-flow";
import { SoundMix } from "./sound-mix";
import { LocalTools } from "./local-tools";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  ChevronRight,
  Sparkles,
  RefreshCw,
  LoaderCircle,
  X,
  Check,
  Wind,
  Mic2,
  Clapperboard,
  ScanLine,
  Layers,
  SlidersHorizontal,
  AlertCircle,
  Circle,
  Volume2,
  VolumeX,
  Headphones,
  Info,
  Plug,
} from "lucide-react";
import { api, tc, uid } from "./state";
import { HoldGenerate } from "./composer-tools";
import { money } from "../shared/costs.mjs";
import { Waveform } from "./audio";
import {
  applySoundtrackResults,
  activeSoundtrackRun,
  soundtrackReviewUnits,
  soundReceipts,
  soundUnitState,
  soundtrackDirtyClips,
  soundtrackChanges,
} from "../shared/soundtrack.mjs";
import {
  dialogueScript,
  characterVoice,
  dialogueVoices,
} from "../shared/soundtrack-dialogue.mjs";
import { soundFailure } from "../shared/soundtrack-retry.mjs";
import "./soundtrack.css";

const soundMoney = (value) =>
  value < 1
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }).format(value)
    : money(value);

export function useSoundtrack(project, update, flush) {
  const lip = useLipSync(project, update, flush);
  const [focus, setFocus] = useState(null);
  const [runs, setRuns] = useState([]),
    [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const latest = useRef({ project, update, flush });
  latest.current = { project, update, flush };
  const submittingRef = useRef(false);
  const scope = project ? `${project.id}/${project.episodeId}` : "";
  useEffect(() => {
    setRuns([]);
    setFocus(null);
    setError("");
    if (!scope) return;
    let disposed = false,
      timer,
      previous = "";
    const [projectId, episodeId] = scope.split("/");
    async function poll() {
      let active = false;
      try {
        const result = (await api(`/projects/${projectId}/soundtrack`)).filter(
          (r) => r.episodeId === episodeId,
        );
        if (disposed) return;
        const value = JSON.stringify(result);
        if (previous !== value) {
          previous = value;
          setRuns(result);
        }
        active = result.some((r) => ["queued", "processing"].includes(r.state));
        for (const run of result) {
          if (disposed) return;
          const ready = run.units.filter(
            (u) => u.state === "ready" && !u.delivered,
          );
          if (!ready.length) continue;
          const receipts = soundReceipts(latest.current.project);
          if (ready.some((u) => !receipts.has(u.id))) {
            latest.current.update((p) => applySoundtrackResults(p, run));
          }
          // Persist first, acknowledge second. Undo will not make polling reapply a result.
          await latest.current.flush();
          if (disposed) return;
          await api(`/projects/${projectId}/soundtrack/${run.id}/ack`, {});
        }
      } catch (e) {
        if (!disposed) setError(e.message);
      }
      if (!disposed) timer = setTimeout(poll, active ? 900 : 2500);
    }
    poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [scope]);
  async function create(options) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    const initial = latest.current.project;
    try {
      const revision = await latest.current.flush();
      if (
        latest.current.project.id !== initial.id ||
        latest.current.project.episodeId !== initial.episodeId
      )
        return;
      const run = await api(`/projects/${initial.id}/soundtrack`, {
        ...options,
        revision,
        requestId: uid(),
      });
      if (latest.current.project.id === initial.id)
        setRuns((old) => [run, ...old.filter((r) => r.id !== run.id)]);
      return run;
    } catch (e) {
      setError(e.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  async function action(run, type, body = {}) {
    try {
      const result = await api(
        `/projects/${run.projectId}/soundtrack/${run.id}/${type}`,
        body,
      );
      if (result.id && latest.current.project.id === run.projectId)
        setRuns((old) => old.map((r) => (r.id === result.id ? result : r)));
      setError("");
      return result;
    } catch (e) {
      setError(e.message);
    }
  }
  return {
    flush: () => latest.current.flush(),
    async estimate(options) {
      const initial = latest.current.project;
      await latest.current.flush();
      if (
        latest.current.project.id !== initial.id ||
        latest.current.project.episodeId !== initial.episodeId
      )
        throw Error("The active edit changed.");
      return api(`/projects/${initial.id}/soundtrack/estimate`, options);
    },
    async retryEstimate(run, body) {
      await latest.current.flush();
      if (
        latest.current.project.id !== run.projectId ||
        latest.current.project.episodeId !== run.episodeId
      )
        throw Error("The active edit changed.");
      return api(
        `/projects/${run.projectId}/soundtrack/${run.id}/retry-estimate`,
        body,
      );
    },
    lip,
    focus,
    setFocus,
    runs,
    error,
    submitting,
    create,
    action,
    active: runs.find((r) => ["queued", "processing"].includes(r.state)),
  };
}

export function SoundtrackPanel({
  project,
  sound,
  selectedIds,
  testMode,
  onClose,
  onMixer,
  update,
  embedded = false,
  selectedAudio,
  range,
  onSeek,
  onRange,
  onSelectClip,
  onPreviewPlay,
  timelinePlaying,
  onInspect,
  providerReady = true,
}) {
  const connection = useProviderConnection("fal", testMode ? "test" : "live");
  providerReady = providerReady && !connection.needsConnection;
  const [scope, setScope] = useState("all");
  const [localToolsOpen, setLocalToolsOpen] = useState(false);
  const [roles, setRoles] = useState(["effect"]);
  const [directions, setDirections] = useState({});
  const direction = directions[roles[0]] || "";
  const setDirection = (value) =>
    setDirections((old) => ({ ...old, [roles[0]]: value }));
  const [speechChoice, setSpeechChoice] = useState("lipsync");
  const [changedOnly, setChangedOnly] = useState(false);
  const [quote, setQuote] = useState(null),
    [quoteError, setQuoteError] = useState("");
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [targetRange, setTargetRange] = useState(null);
  const activeRange = targetRange || range;
  useEffect(() => {
    if (!range && !targetRange) setScope((s) => (s === "range" ? "all" : s));
  }, [range?.from, range?.to]);
  useEffect(() => {
    if (sound.focus?.role) setRoles([sound.focus.role]);
  }, [sound.focus]);
  const dirty = soundtrackDirtyClips(project, roles[0]);
  const targetIds = selectedIds;
  const scoped = project.clips.filter((c) =>
    scope === "range"
      ? activeRange &&
        c.start < activeRange.to &&
        c.start + c.duration > activeRange.from
      : scope === "all" || targetIds.includes(c.id),
  );
  const clips = scoped.filter((c) =>
    c.takes.some((t) => t.id === c.activeTake),
  );
  const options = {
    roles,
    clipIds: clips.map((c) => c.id),
    changedOnly,
    range: scope === "range" ? activeRange : undefined,
    direction,
  };
  const requestKey = JSON.stringify([
    project.id,
    project.episodeId,
    project.clips.map((c) => [
      c.id,
      c.start,
      c.duration,
      c.in,
      c.activeTake,
      c.draftId,
      c.sourceDraftId,
      c.storyBeatId,
    ]),
    project.drafts,
    project.assets.map((a) => [a.id, a.name, a.voice, a.gender]),
    project.production?.voiceAssignments,
    options,
    testMode,
    quoteRefresh,
  ]);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    let disposed = false;
    setQuote(null);
    setQuoteError("");
    if (
      localToolsOpen || !clips.length ||
      (!testMode && !providerReady) ||
      (roles[0] === "dialogue" && speechChoice !== "voiceover")
    )
      return;
    const timer = setTimeout(async () => {
      try {
        const value = await soundRef.current.estimate(options);
        if (!disposed) setQuote(value);
      } catch (e) {
        if (!disposed) setQuoteError(e.message);
      }
    }, 350);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [requestKey, speechChoice, providerReady, localToolsOpen]);
  const active = activeSoundtrackRun(sound.runs, project.episodeId, roles);
  const canSubmit =
    quote &&
    (testMode || providerReady) &&
    quote.mode === (testMode ? "test" : "live") &&
    !sound.submitting &&
    !active &&
    (roles[0] !== "dialogue" || speechChoice === "voiceover") &&
    clips.length &&
    roles.length;
  async function submit() {
    if (!canSubmit) return;
    if (
      await sound.create({
        ...options,
        quoteId: quote.quoteId,
        executionMode: quote.mode,
      })
    ) {
      if (!embedded) onClose();
      else setQuoteRefresh((v) => v + 1);
    } else setQuoteRefresh((v) => v + 1);
  }
  const lines = clips.flatMap((c) =>
    dialogueScript(project, c).filter(
      (l) =>
        scope !== "range" ||
        (activeRange &&
          c.start + l.start >= activeRange.from &&
          c.start + l.start < activeRange.to),
    ),
  );
  const speakers = [...new Set(lines.map((l) => l.speaker))]
    .map((id) => project.assets.find((a) => a.id === id))
    .filter(Boolean);
  const recent =
    sound.runs.find((r) => r.id === sound.focus?.runId) ||
    sound.runs.find((r) => r.units.some((u) => u.role === roles[0]));
  const title = {
    effect: "Sound effects",
    ambience: "Ambience",
    dialogue: "Dialogue",
  }[roles[0]];
  const reviewUnits = soundtrackReviewUnits(project, sound.runs).filter(
    (u) => u.role === roles[0],
  );
  const focusedUnit = recent?.units.find((u) => u.id === sound.focus?.unitId);
  const focusedParts = focusedUnit
    ? focusedUnit.parts?.length
      ? focusedUnit.parts
      : [
          {
            index: 0,
            start: 0,
            duration: focusedUnit.duration,
            state: focusedUnit.state,
          },
        ]
    : [];
  const focusedPart =
    focusedParts.find((p) => p.index === sound.focus?.index) ||
    focusedParts.find((p) => p.state !== "ready") ||
    focusedParts[0];
  const failedUnits = sound.runs.flatMap((run) =>
    run.units
      .filter((u) => u.role === roles[0] && u.state === "failed")
      .map((unit) => ({ run, unit })),
  );
  const needsConnection = !testMode && !providerReady;
  const canGenerate = roles[0] !== "dialogue" || speechChoice === "voiceover";
  const scopeText =
    scope === "range" && activeRange
      ? `${tc(activeRange.from)}–${tc(activeRange.to)}`
      : `${clips.length} ${clips.length === 1 ? "clip" : "clips"}`;
  function revealAttention() {
    const next =
      failedUnits[0] ||
      (reviewUnits[0] && {
        run: sound.runs.find((r) => r.id === reviewUnits[0].runId),
        unit: reviewUnits[0],
      });
    if (!next) return;
    sound.setFocus({
      role: next.unit.role,
      unitId: next.unit.id,
      runId: next.run?.id,
    });
    onSeek?.(soundUnitState(project, next.unit).start);
  }
  function prepareAgain(u) {
    setRoles([u.role]);
    const start = u.sources ? soundUnitState(project, u).start : u.start;
    const nextRange = { from: start, to: start + u.duration };
    setTargetRange(nextRange);
    onRange?.(nextRange);
    setScope("range");
    setChangedOnly(false);
    onSeek?.(start);
  }
  const ready = active?.units.filter((u) => u.state === "ready").length || 0;
  return (
    <section
      className={`soundtrack-panel soundtrack-simple ${embedded ? "soundtrack-docked" : ""}`}
      aria-label="Sound workspace"
    >
      <div className="soundtrack-panel-heading">
        <AudioLines size={20} aria-hidden="true" />
        <strong>Sound</strong>
        <button
          className="icon"
          aria-label="Close sound"
          title="Close sound"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="soundtrack-panel-content">
        <LocalTools project={project} update={update} flush={sound.flush} selectedIds={selectedIds} onSeek={onSeek} onToggle={setLocalToolsOpen}/>
        <div className="soundtrack-generation-tools" hidden={localToolsOpen}>
        <div className="soundtrack-roles" role="group" aria-label="Sound layer">
          {[
            ["effect", "Sound effects", Clapperboard],
            ["ambience", "Ambience", Wind],
            ["dialogue", "Dialogue", Mic2],
          ].map(([id, label, Icon]) => (
            <button
              key={id}
              aria-pressed={roles[0] === id}
              onClick={() => {
                setRoles([id]);
                sound.setFocus(null);
                setChangedOnly(false);
              }}
            >
              <Icon size={20} aria-hidden="true" />
              <strong>{label}</strong>
            </button>
          ))}
        </div>
        <p className="soundtrack-intent">
          {roles[0] === "effect"
            ? "Footsteps, movement, and little details."
            : roles[0] === "ambience"
              ? "A continuous atmosphere across your cuts."
              : "Give your characters a voice."}
        </p>
        <div
          className="soundtrack-scope"
          hidden={!canGenerate}
          role="group"
          aria-label="Soundtrack scope"
        >
          <button
            aria-pressed={scope === "all"}
            onClick={() => {
              setScope("all");
              setTargetRange(null);
            }}
          >
            <Layers size={14} aria-hidden="true" />
            Whole edit
          </button>
          {!!targetIds.length && (
            <button
              aria-pressed={scope === "selected"}
              onClick={() => setScope("selected")}
            >
              Selection · {targetIds.length}
            </button>
          )}
          <button
            disabled={!activeRange}
            aria-pressed={scope === "range"}
            title="Drag across the timeline ruler to highlight a section"
            onClick={() => setScope("range")}
          >
            <ScanLine size={14} aria-hidden="true" />
            Range
          </button>
        </div>
        {!clips.length && (
          <div className="soundtrack-empty" role="status">
            <AudioLines size={24} aria-hidden="true" />
            <strong>
              {scoped.length
                ? "Picture first, sound next"
                : "Choose some footage"}
            </strong>
            <span>
              {scoped.length
                ? "Add a take to your planned clips, then create their sound here."
                : "Add footage or choose a section of your edit."}
            </span>
          </div>
        )}
        {roles.includes("dialogue") && (
          <div className="soundtrack-cast">
            <div
              className="soundtrack-scope dialogue-modes"
              aria-label="Speech workflow"
            >
              <button
                aria-pressed={speechChoice === "original"}
                aria-label="Keep original performance"
                title="Keep original performance"
                onClick={() => setSpeechChoice("original")}
              >
                Original
              </button>
              <button
                aria-pressed={speechChoice === "voiceover"}
                aria-label="New voice-over"
                title="New voice-over"
                onClick={() => setSpeechChoice("voiceover")}
              >
                Voice-over
              </button>
              <button
                aria-pressed={speechChoice === "lipsync"}
                aria-label="On-screen dialogue"
                title="On-screen dialogue"
                onClick={() => setSpeechChoice("lipsync")}
              >
                On-screen
              </button>
            </div>
            <p
              className="soundtrack-changed-note"
              hidden={speechChoice === "lipsync"}
            >
              {speechChoice === "original"
                ? "Use the voices already in your clips."
                : "Create off-screen speech from your written lines. For visible speakers, choose On-screen."}
            </p>
            {speechChoice === "lipsync" && !needsConnection && (
              <DialogueFlow clipIds={clips.map(c=>c.id)}
                {...{
                  project,
                  sound,
                  selectedIds,
                  testMode,
                  update,
                  onSelectClip,
                  onPreviewPlay,
                  timelinePlaying,
                }}
                onEdit={onClose}
              />
            )}
            {speechChoice === "voiceover" &&
              speakers.map((a) => (
                <details key={a.id} className="soundtrack-speaker">
                  <summary>
                    {a.media?.thumbnail || a.references?.[0]?.thumbnail ? (
                      <img
                        src={a.media?.thumbnail || a.references[0].thumbnail}
                        alt=""
                      />
                    ) : (
                      <Volume2 size={18} />
                    )}
                    <span>
                      <b>{a.name}</b>
                      <small>
                        {[a.voice?.language, a.voice?.accent]
                          .filter(Boolean)
                          .join(" · ") || "Language detected from script"}
                      </small>
                    </span>
                    <span className="soundtrack-voice-name">
                      {characterVoice(project, a)}
                      {speakers.filter(
                        (other) =>
                          characterVoice(project, other) ===
                          characterVoice(project, a),
                      ).length > 1 && (
                        <small title="Another character uses this provider voice">
                          Shared voice
                        </small>
                      )}
                    </span>
                    <ChevronDown size={13} />
                  </summary>
                  <label>
                    Voice{" "}
                    <select
                      aria-label={`${a.name} voice`}
                      value={project.production?.voiceAssignments?.[a.id] || ""}
                      onChange={(e) => {
                        const voice = e.target.value;
                        update((p) => {
                          p.production ??= {
                            schemaVersion: 1,
                            audioPlans: [],
                            transitions: [],
                            effects: [],
                            dependencies: [],
                          };
                          p.production.voiceAssignments ??= {};
                          if (voice)
                            p.production.voiceAssignments[a.id] = voice;
                          else delete p.production.voiceAssignments[a.id];
                        });
                      }}
                    >
                      <option value="">Auto · from identity</option>
                      {dialogueVoices.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <small>
                    {[
                      a.voice?.tone,
                      a.voice?.timbre,
                      a.voice?.pitch,
                      a.voice?.pace,
                      a.voice?.description,
                      a.voice?.direction,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Natural delivery"}
                  </small>
                  {lines
                    .filter((l) => l.speaker === a.id)
                    .map((l, i) => (
                      <p key={i} dir="auto">
                        “{l.text}”
                      </p>
                    ))}
                </details>
              ))}
            {speechChoice === "voiceover" && !lines.length && (
              <small>
                No written dialogue in this selection. Add spoken lines and
                speakers in the clip prompt.
              </small>
            )}
            {speechChoice === "voiceover" && lines.some((l) => l.missing) && (
              <p className="soundtrack-error">
                Some lines need a character assigned in their clip prompt.
              </p>
            )}
            {speechChoice === "voiceover" && !!lines.length && (
              <small>
                Voice identity guides delivery; accent and timbre are
                approximate. For visible speech, use On-screen dialogue to
                create the voice and match lips in one flow.
              </small>
            )}
          </div>
        )}

        <details className="soundtrack-direction" hidden={!canGenerate}>
          <summary>
            <SlidersHorizontal size={15} aria-hidden="true" />
            Give it direction<span>optional</span>
          </summary>
          <textarea
            aria-label="Sound direction"
            value={direction}
            maxLength={2000}
            onChange={(e) => setDirection(e.target.value)}
            placeholder={
              roles[0] === "ambience"
                ? "Steady rooftop breeze, low distant city air…"
                : roles[0] === "effect"
                  ? "Dry footsteps, a metal latch click, match strike…"
                  : "Soft, warm delivery…"
            }
          />
        </details>
        {dirty.size > 0 && canGenerate && (
          <button
            className="soundtrack-changed-choice"
            aria-pressed={changedOnly}
            onClick={() => setChangedOnly((v) => !v)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>Changed sections only</span>
            <span className="soundtrack-choice-check">
              {changedOnly && <Check size={13} />}
            </span>
          </button>
        )}
        {selectedAudio && (
          <button
            className="soundtrack-selection-link"
            onClick={() =>
              onInspect ? onInspect(selectedAudio.id) : onMixer?.()
            }
          >
            <Headphones size={16} aria-hidden="true" />
            <span>
              Listen & adjust<small>{selectedAudio.name}</small>
            </span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        )}
        <details className="soundtrack-more">
          <summary>
            <SlidersHorizontal size={15} aria-hidden="true" />
            Mix layers
          </summary>
          <SoundMix project={project} update={update} />
          <button className="soundtrack-mixer-link" onClick={onMixer}>
            Open full mixer
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </details>
        {(failedUnits.length > 0 || reviewUnits.length > 0) && !focusedUnit && (
          <button className="soundtrack-attention" onClick={revealAttention}>
            <AlertCircle size={16} aria-hidden="true" />
            <span>
              {failedUnits.length + reviewUnits.length}{" "}
              {failedUnits.length + reviewUnits.length === 1
                ? "section needs"
                : "sections need"}{" "}
              attention
            </span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        )}
        {focusedUnit && (
          <div className="soundtrack-focused-section">
            <div className="soundtrack-plan-caption">
              <strong>Selected section</strong>
              <button
                className="icon"
                aria-label="Close selected sound section"
                onClick={() => sound.setFocus(null)}
              >
                <X size={14} />
              </button>
            </div>
            {reviewUnits.some((u) => u.id === focusedUnit.id) ? (
              <>
                <p>
                  {focusedUnit.needsTiming
                    ? "This recording is longer than its clip. The full recording is kept in Assets."
                    : "The picture changed. Your saved sound is safe in Assets."}
                </p>
                {focusedUnit.needsTiming && <button onClick={()=>sound.action(recent,"fitTiming",{unitId:focusedUnit.id})}>Fit voice to clip · no credits</button>}
                <button onClick={() => prepareAgain(focusedUnit)}>
                  <RefreshCw size={14} />
                  Update this section
                </button>
              </>
            ) : (
              <SoundSection
                key={`${recent.id}:${focusedUnit.id}:${focusedPart.index}`}
                project={project}
                run={recent}
                unit={focusedUnit}
                part={focusedPart}
                sound={sound}
                testMode={testMode}
                onSeek={onSeek}
                initiallyOpen={focusedUnit.state === "failed"}
              />
            )}
            {focusedUnit.state === "failed" &&
            focusedUnit.parts?.length &&
            focusedUnit.parts.every((p) => p.state === "ready") ? (
              <button
                disabled={!!active}
                onClick={() =>
                  sound.action(recent, "retry", { unitId: focusedUnit.id })
                }
              >
                <RefreshCw size={14} />
                Join saved sections
              </button>
            ) : null}
          </div>
        )}
        {(quoteError || sound.error) && !needsConnection && (
          <div className="soundtrack-error" role="alert">
            <AlertCircle size={15} />
            <span>{quoteError || sound.error}</span>
            {quoteError && (
              <button
                className="icon"
                aria-label="Refresh estimate"
                onClick={() => setQuoteRefresh((v) => v + 1)}
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        )}
        {needsConnection && (
          <div className="soundtrack-connect">
            <Plug size={20} aria-hidden="true" />
            <strong>Connect sound generation</strong>
            <p>One quick setup. Your edit stays right here.</p>
            <ConnectProviderButton
              provider="fal"
              feature="soundtrack"
              returnLabel="Back to soundtrack"
            />
          </div>
        )}
        <details className="soundtrack-estimate" hidden={!canGenerate}>
          <summary>
            <Info size={14} aria-hidden="true" />
            About this generation
          </summary>
          <p>
            {testMode
              ? "Offline creates sample tones on your computer. No uploads or credits."
              : roles[0] === "dialogue"
                ? "Your written lines and voice direction go to ElevenLabs via fal. Video is not sent for voice-over."
                : roles[0] === "ambience"
                  ? "A short environment description goes to ElevenLabs via fal. Video is not uploaded."
                  : quote?.estimate?.layers?.some(l=>l.role==="effect"&&l.model==="fal-ai/elevenlabs/sound-effects/v2") ? "Effects follow the scene descriptions through ElevenLabs via fal. Video is not uploaded on this path, reducing invented speech in talking scenes. Check contact timing in playback."
                  : "A silent preview copy and sound cues go to MMAudio via fal. Listen for unwanted voice-like sounds before keeping the mix."}
          </p>
          {!testMode && quote && (
            <p>
              {soundMoney(quote.estimate.amount)} estimated across{" "}
              {quote.estimate.requests} requests. Final cost may differ.
            </p>
          )}
          <p>
            Original audio is preserved. Each generated layer stays
            independently editable.
          </p>
        </details>
        </div>
      </div>
      <footer className="soundtrack-action-bar" hidden={!canGenerate || localToolsOpen}>
        <div className="soundtrack-action-meta">
          <span>
            {scopeText}
            {scoped.length > clips.length
              ? ` · ${scoped.length - clips.length} planned skipped`
              : ""}
          </span>
          <span>
            {testMode
              ? "Offline · no credits"
              : ""}
          </span>
        </div>
        {active ? (
          <div className="soundtrack-running" role="status">
            <LoaderCircle size={17} aria-hidden="true" />
            <span>
              <strong>Creating {title.toLowerCase()}</strong>
              <small>
                {ready}/{active.units.length} ready · follow the timeline
              </small>
            </span>
            <button onClick={() => sound.action(active, "cancel")}>Stop</button>
          </div>
        ) : (
          <div className="soundtrack-submit">
            {testMode ? (
              <button
                className="primary"
                disabled={!canSubmit}
                onClick={submit}
              >
                <Sparkles size={17} aria-hidden="true" />
                {sound.submitting
                  ? "Starting…"
                  : changedOnly
                    ? "Update sound"
                    : "Generate"}
              </button>
            ) : (
              <HoldGenerate
                label="soundtrack"
                enabled
                disabled={!canSubmit}
                busy={sound.submitting}
                price={
                  quote ? `${soundMoney(quote.estimate.amount)} estimate` : "…"
                }
                requestKey={quote?.quoteId}
                onGenerate={submit}
              />
            )}
          </div>
        )}
      </footer>
    </section>
  );
}

function SoundSection({
  project,
  run,
  unit,
  part,
  sound,
  testMode,
  onSeek,
  needsReview,
  initiallyOpen = false,
}) {
  const [open, setOpen] = useState(initiallyOpen),
    [quote, setQuote] = useState(null),
    [error, setError] = useState("");
  const [direction, setDirection] = useState(
    part.directionOverride ?? run.direction ?? "",
  );
  const [busy, setBusy] = useState(false),
    [recoveryId, setRecoveryId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef(uid());
  const ready = unit.state === "ready" || part.state === "ready";
  const failure = soundFailure({
    ...part,
    error: part.error || (part.state !== "queued" ? unit.error : ""),
  });
  const uncertain =
    ["submitting", "submission_uncertain"].includes(part.state) &&
    !part.providerJobId;
  const state = ready
    ? "ready"
    : part.error || failure.terminal
      ? "failed"
      : part.state;
  const start = soundUnitState(project, unit).start + part.start;
  const Status = ready
    ? Check
    : state === "failed"
      ? AlertCircle
      : state === "processing"
        ? LoaderCircle
        : Circle;
  const available =
    unit.state === "failed" &&
    !ready &&
    !activeSoundtrackRun(sound.runs, project.episodeId, [unit.role]);
  const key = JSON.stringify([
    open,
    direction,
    run.state,
    part,
    project.clips.map((c) => [
      c.id,
      c.start,
      c.duration,
      c.in,
      c.activeTake,
      c.draftId,
      c.sourceDraftId,
      c.storyBeatId,
    ]),
    project.drafts,
    project.assets,
    project.production?.voiceAssignments,
    testMode,
    refresh,
  ]);
  const latest = useRef(sound);
  latest.current = sound;
  useEffect(() => {
    setQuote(null);
    setError("");
    if (!open || !available || uncertain) return;
    let disposed = false;
    const timer = setTimeout(async () => {
      try {
        const q = await latest.current.retryEstimate(run, {
          unitId: unit.id,
          index: part.index,
          direction,
        });
        if (!disposed) {
          setQuote(q);
          requestId.current = uid();
        }
      } catch (e) {
        if (!disposed) setError(e.message);
      }
    }, 300);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [key, available, uncertain]);
  async function retry() {
    if (!quote || busy || !available) return;
    setBusy(true);
    const result = await sound.action(run, "retry", {
      unitId: unit.id,
      index: part.index,
      direction,
      quoteId: quote.quoteId,
      executionMode: quote.mode,
      requestId: requestId.current,
    });
    setBusy(false);
    if (result) {
      setOpen(false);
      setQuote(null);
    } else {
      setQuote(null);
      setError(
        "This retry was not started. Refresh the estimate to try again.",
      );
    }
  }
  return (
    <div
      className="soundtrack-section"
      data-state={state}
      data-focused={sound.focus?.unitId === unit.id}
    >
      <button
        className="soundtrack-section-location"
        onClick={() => onSeek?.(start)}
      >
        <Status size={15} />
        <span>
          {tc(start)} — {tc(start + part.duration)}
          <small>
            {ready
              ? needsReview
                ? "Saved · needs review"
                : "Ready · kept"
              : failure.code === "content_policy"
                ? "Content restricted by fal"
                : state === "failed"
                  ? part.providerJobId && !failure.terminal
                    ? "Needs retrieval"
                    : "Failed"
                  : unit.state === "failed"
                    ? "Not finished"
                    : unit.stage || "Queued"}
          </small>
        </span>
      </button>
      {available && !uncertain && (
        <button
          className="icon"
          aria-label={`Retry section ${part.index + 1}`}
          aria-expanded={open}
          title="Retry only this section; keep completed sound"
          onClick={() => setOpen((v) => !v)}
        >
          <RefreshCw size={15} />
        </button>
      )}
      {!ready && failure.code === "content_policy" && (
        <small className="soundtrack-section-error">
          fal flagged{" "}
          {failure.fields.includes("video_url") ? "the video" : "this content"}
          {failure.fields.includes("prompt") ? " and prompt" : ""}. Repeating
          the same input may be rejected again. Review the input or contact fal
          about a false positive.
        </small>
      )}
      {!ready && part.error && failure.code !== "content_policy" && (
        <small className="soundtrack-section-error">{part.error}</small>
      )}
      {open && available && (
        <div className="soundtrack-retry-editor">
          {unit.role !== "dialogue" && (
            <label>
              Sound direction
              <textarea
                aria-label={`Retry section ${part.index + 1} sound direction`}
                value={direction}
                disabled={quote && !quote.requiresSubmit}
                maxLength={2000}
                onChange={(e) => setDirection(e.target.value)}
                placeholder="Optional direction for this section only"
              />
            </label>
          )}
          {error ? (
            <small role="alert" className="soundtrack-error">
              {error}
              <button
                className="icon"
                aria-label="Refresh section estimate"
                onClick={() => setRefresh((n) => n + 1)}
              >
                <RefreshCw size={14} />
              </button>
            </small>
          ) : quote ? (
            <>
              <small>
                {quote.preserved} completed{" "}
                {quote.preserved === 1 ? "section stays" : "sections stay"}{" "}
                saved ·{" "}
                {quote.requiresSubmit
                  ? testMode
                    ? "Offline · 0 credits"
                    : `${soundMoney(quote.amount)} for this section`
                  : "Resume existing request · no new generation"}
              </small>
              {testMode || !quote.requiresSubmit ? (
                <button disabled={busy} onClick={retry}>
                  <RefreshCw size={14} />
                  {quote.requiresSubmit
                    ? part.state === "queued"
                      ? "Continue this section"
                      : "Retry this section"
                    : "Resume this section"}
                </button>
              ) : (
                <HoldGenerate
                  enabled
                  label="sound section"
                  disabled={busy}
                  busy={busy}
                  price={`${soundMoney(quote.amount)} estimate`}
                  requestKey={quote.quoteId}
                  onGenerate={retry}
                />
              )}
            </>
          ) : (
            <small>Checking this section…</small>
          )}
        </div>
      )}
      {available && uncertain && (
        <div className="soundtrack-recover">
          <label>
            Recover fal request ID
            <input
              value={recoveryId}
              onChange={(e) => setRecoveryId(e.target.value)}
            />
          </label>
          <button
            disabled={!recoveryId.trim()}
            onClick={() =>
              sound.action(run, "recover", {
                unitId: unit.id,
                index: part.index,
                requestId: recoveryId.trim(),
              })
            }
          >
            Recover request
          </button>
        </div>
      )}
    </div>
  );
}

export function SoundtrackTimeline({
  project,
  runs,
  zoom,
  viewport,
  expanded,
  onExpand,
  onOpen,
  onInspect,
  update,
}) {
  const audio = useMemo(
    () => project.audioClips.filter((a) => a.soundtrack),
    [project.audioClips],
  );
  const pending = runs.flatMap((r) =>
    ["queued", "processing"].includes(r.state) || r.state === "failed"
      ? r.units
          .filter((u) => u.state !== "ready")
          .flatMap((u) =>
            (u.parts?.length
              ? u.parts
              : [{ index: 0, start: 0, duration: u.duration, state: u.state }]
            ).map((part) => ({
              ...u,
              unitId: u.id,
              id: `${u.id}:${part.index}`,
              runId: r.id,
              index: part.index,
              start: u.start + part.start,
              duration: part.duration,
              state:
                u.state === "failed" && part.state !== "ready"
                  ? "failed"
                  : u.state === "ready"
                    ? "ready"
                    : part.state,
              progress:
                part.state === "ready"
                  ? 1
                  : u.parts?.length > 1
                    ? 0
                    : u.progress,
              error: part.state === "ready" ? null : part.error || u.error,
              runState: r.state,
            })),
          )
      : [],
  );
  const review = soundtrackReviewUnits(project, runs);
  if (!audio.length && !pending.length && !review.length) return null;
  const visible = (a) =>
    (a.start + a.duration) * zoom >= viewport.left - 100 &&
    a.start * zoom <= viewport.left + viewport.width + 100;
  return (
    <div
      className="soundtrack-timeline"
      data-expanded={expanded}
      aria-label="AI soundtrack timeline"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="soundtrack-label" style={{ left: viewport.left + 6 }}>
        <button
          aria-label={
            expanded ? "Collapse soundtrack layers" : "Expand soundtrack layers"
          }
          aria-expanded={expanded}
          onClick={onExpand}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Sparkles size={12} />
          Sound
        </button>
        <button
          aria-label={
            audio.every((a) => a.mute) ? "Unmute soundtrack" : "Mute soundtrack"
          }
          onClick={() =>
            update((p) => {
              const mute = !audio.every((a) => a.mute);
              p.audioClips
                .filter((a) => a.soundtrack)
                .forEach((a) => {
                  a.mute = mute;
                });
            })
          }
        >
          {audio.every((a) => a.mute) ? (
            <VolumeX size={12} />
          ) : (
            <Volume2 size={12} />
          )}
        </button>
      </div>
      {audio.filter(visible).map((a) => {
        const change = soundtrackChanges(project, a.soundtrack);
        return (
          <button
            key={a.id}
            className={`soundtrack-wave ${a.soundtrack.role} ${a.mute ? "muted" : ""}`}
            style={{
              left: a.start * zoom,
              width: Math.max(2, a.duration * zoom),
            }}
            onClick={() => onOpen({ role: a.soundtrack.role })}
            onDoubleClick={() => onInspect?.(a.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onInspect) {
                e.preventDefault();
                e.stopPropagation();
                onInspect(a.id);
              }
            }}
            aria-label={`${a.name}${change.changed.length || !change.movedTogether ? ", needs update" : ", ready"}`}
          >
            {!expanded && (
              <Waveform
                mediaId={a.mediaId}
                sourceIn={a.in}
                duration={a.duration}
                volume={a.mute ? 0 : a.volume}
              />
            )}
            {change.affected.map((s) => {
              const offset =
                s.start -
                (a.soundtrack.originStart ?? a.soundtrack.sources[0].start) -
                a.in;
              return (
                <span
                  key={s.clipId}
                  className="soundtrack-dirty"
                  title="Picture, script or voice changed · update sound"
                  style={{
                    left: Math.max(0, offset) * zoom,
                    width:
                      Math.max(
                        0,
                        Math.min(offset + s.duration, a.duration) -
                          Math.max(0, offset),
                      ) * zoom,
                  }}
                />
              );
            })}
          </button>
        );
      })}
      {review.map((u) => {
        const start = soundUnitState(project, u).start;
        if (!visible({ ...u, start })) return null;
        return (
          <button
            key={u.id}
            className={`soundtrack-progress ${u.role} needs-review`}
            style={{
              left: start * zoom,
              width: Math.max(80, u.duration * zoom),
            }}
            onClick={() =>
              onOpen({ role: u.role, unitId: u.id, runId: u.runId })
            }
            aria-label={`${u.role} saved in Assets, needs review`}
          >
            Saved · needs review
          </button>
        );
      })}
      {pending.map((u) => {
        const current = soundUnitState(project, u),
          start = current.start;
        if (!visible({ ...u, start })) return null;
        return (
          <button
            key={u.id}
            className={`soundtrack-progress ${u.role} ${u.state}`}
            style={{
              left: start * zoom,
              width: Math.max(20, u.duration * zoom),
            }}
            onClick={() =>
              onOpen({
                role: u.role,
                unitId: u.unitId,
                runId: u.runId,
                index: u.index,
              })
            }
            title={`${tc(start)}–${tc(start + u.duration)} · ${u.error || (u.role === "ambience" ? "Continuous ambience" : u.role === "dialogue" ? "Dialogue" : "Effects")}`}
            aria-label={`${u.role} ${u.state} ${tc(start)} to ${tc(start + u.duration)}`}
          >
            <span
              className="soundtrack-progress-fill"
              style={{ width: `${Math.round(u.progress * 100)}%` }}
            />
            <span>
              {u.state === "failed"
                ? "Needs attention"
                : u.state === "ready"
                  ? "Ready"
                  : ["processing", "downloading", "submitting"].includes(
                        u.state,
                      )
                    ? u.stage ||
                      `${u.role === "ambience" ? "Ambience" : u.role === "dialogue" ? "Dialogue" : "Effects"} ${Math.round(u.progress * 100)}%`
                    : "Queued"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
