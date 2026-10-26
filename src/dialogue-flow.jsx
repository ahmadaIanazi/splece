import {ProjectDialogue} from "./project-dialogue";
import { FaceAssignment } from "./face-assignment";
import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Mic2,
  ScanFace,
  Play,
  LoaderCircle,
  Pencil,
  RefreshCw,
} from "lucide-react";
import {
  dialogueDraft,
  dialogueScript,
  dialogueSignature,
  characterVoice,
  dialogueVoices,
} from "../shared/soundtrack-dialogue.mjs";
import { soundSource } from "../shared/soundtrack.mjs";
import { lipSyncInput, lipSyncSignature } from "../shared/lip-sync.mjs";
import { LipSyncControl, lipSyncActive } from "./lip-sync";
import { HoldGenerate } from "./composer-tools";
import { tc } from "./state";

export function DialogueFlow({
  project,
  sound,
  selectedIds,
  testMode,
  update,
  onSelectClip,
  onEdit,
  onPreviewPlay,
  timelinePlaying,
  clipIds,
}) {
  const speaking = project.clips.filter(
    (c) => (!clipIds || clipIds.includes(c.id)) && dialogueScript(project, c).length,
  );
  const selected = project.clips.filter((c) => selectedIds.includes(c.id));
  const clip = selected.length === 1 ? selected[0] : null;
  return (
    <section className="dialogue-flow" aria-label="On-screen dialogue">
      <ProjectDialogue {...{project,sound,testMode,update,onSelectClip,clipIds}}/>
      <div className="dialogue-clip-list" aria-label="Speaking clips">
        {speaking.map((c) => {
          const take = c.takes.find((t) => t.id === c.activeTake),
            job = sound.lip.jobs.find((j) => j.input.clipId === c.id);
          const creating = sound.runs.some(
            (r) =>
              ["queued", "processing"].includes(r.state) &&
              r.units.some(
                (u) =>
                  u.role === "dialogue" &&
                  u.sources.some((s) => s.clipId === c.id),
              ),
          );
          const latestVoice = [...(project.audioClips || [])]
            .reverse()
            .find(
              (a) =>
                a.soundtrack?.role === "dialogue" &&
                a.soundtrack.sources?.some((s) => s.clipId === c.id),
            );
          const hasVoice =
            latestVoice &&
            (latestVoice.soundtrack.scriptSignature == null ||
              latestVoice.soundtrack.scriptSignature ===
                dialogueSignature(project, c));
          return (
            <button
              key={c.id}
              aria-pressed={clip?.id === c.id}
              onClick={() => onSelectClip?.(c.id)}
              title={dialogueDraft(project, c)?.name || "Speaking clip"}
            >
              {take?.thumbnail ? (
                <img src={take.thumbnail} alt="" />
              ) : (
                <Mic2 size={16} />
              )}
              <span>
                {dialogueDraft(project, c)?.name || "Speaking clip"}
                <small>
                  {tc(c.start)} ·{" "}
                  {creating
                    ? "Creating voice"
                    : job?.media?.id === c.activeTake && hasVoice
                      ? "Applied"
                      : lipSyncActive(job || {})
                        ? "Matching lips"
                        : hasVoice
                          ? "Voice ready"
                          : "Needs voice"}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      {!clip ? (
        <p>
          Select one speaking clip above or on the timeline. Each clip keeps its
          own dialogue and takes.
        </p>
      ) : (
        <ClipDialogue
          key={project.id + clip.id}
          {...{
            project,
            clip,
            sound,
            testMode,
            update,
            onEdit,
            onPreviewPlay,
            timelinePlaying,
          }}
        />
      )}
    </section>
  );
}

function ClipDialogue({
  project,
  clip,
  sound,
  testMode,
  update,
  onEdit,
  onPreviewPlay,
  timelinePlaying,
}) {
  const [refresh, setRefresh] = useState(0),
    [regenerate, setRegenerate] = useState(false),
    [quote, setQuote] = useState(null),
    [error, setError] = useState("");
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const lines = dialogueScript(project, clip),
    signature = dialogueSignature(project, clip);
  const audio = [...(project.audioClips || [])]
    .reverse()
    .find(
      (a) =>
        a.soundtrack?.role === "dialogue" &&
        a.soundtrack.sources?.some((s) => s.clipId === clip.id) &&
        a.start <= clip.start + 0.04 &&
        a.start + a.duration >= clip.start + clip.duration - 0.04,
    );
  const fresh =
    audio &&
    (audio.soundtrack.scriptSignature == null ||
      audio.soundtrack.scriptSignature === signature);
  const readyVoice = fresh && !regenerate;
  const run = sound.runs.find((r) =>
    r.units.some(
      (u) =>
        u.role === "dialogue" && u.sources.some((s) => s.clipId === clip.id),
    ),
  );
  const unit = run?.units.find(
    (u) => u.role === "dialogue" && u.sources.some((s) => s.clipId === clip.id),
  );
  const generating = run && ["queued", "processing"].includes(run.state);
  let lipSignature = null;
  try {
    if (audio)
      lipSignature = lipSyncSignature(lipSyncInput(project, clip.id, audio.id));
  } catch {
    /* Incomplete face or voice setup is handled by the matching control. */
  }
  const job = sound.lip.jobs.find(
    (j) =>
      j.input.clipId === clip.id &&
      j.input.audioMediaId === audio?.mediaId &&
      (j.signature === lipSignature ||
        j.media?.id === clip.activeTake ||
        lipSyncActive(j)),
  );
  const applied = fresh && job?.media?.id === clip.activeTake;
  const missing = lines.some((l) => l.missing);
  const problem = !soundSource(clip)
    ? "Generate this clip’s picture first."
    : !lines.length
      ? "Add a spoken line and character in this clip’s prompt."
      : missing
        ? "Assign a character to every spoken line in the prompt."
        : clip.duration < 2 || clip.duration > 30
          ? "Use a speaking clip between 2 and 30 seconds."
          : null;
  const options = {
    roles: ["dialogue"],
    clipIds: [clip.id],
    reviewDialogue: true,
  };
  const key = JSON.stringify([
    clip.id,
    signature,
    soundSource(clip),
    testMode,
    refresh,
  ]);
  useEffect(() => {
    setQuote(null);
    setError("");
    if (readyVoice || problem || generating) return;
    let gone = false;
    const timer = setTimeout(
      () =>
        soundRef.current
          .estimate(options)
          .then((q) => {
            if (!gone) setQuote(q);
          })
          .catch((e) => {
            if (!gone) setError(e.message);
          }),
      350,
    );
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [key, readyVoice, problem, generating]);
  const stages = [
    ["Script", Pencil, !problem],
    ["Voice", Mic2, !!readyVoice],
    ["Match lips", ScanFace, !!job?.media],
    ["Compare", Play, applied],
  ];
  const current = problem ? 0 : !readyVoice ? 1 : !job?.media ? 2 : 3;
  async function createVoice() {
    if (
      !quote ||
      sound.submitting ||
      sound.active ||
      quote.mode !== (testMode ? "test" : "live")
    )
      return;
    const result = await sound.create({
      ...options,
      quoteId: quote.quoteId,
      executionMode: quote.mode,
    });
    if (result) {
      setRegenerate(false);
      setQuote(null);
    } else setRefresh((v) => v + 1);
  }
  const speakers = [...new Set(lines.map((l) => l.speaker))]
    .map((id) => project.assets.find((a) => a.id === id))
    .filter(Boolean);
  return (
    <>
      <ol className="dialogue-steps" aria-label="Dialogue progress">
        {stages.map(([name, Icon, done], i) => (
          <li
            key={name}
            data-state={done ? "done" : i === current ? "current" : "waiting"}
            aria-current={i === current ? "step" : undefined}
          >
            {done ? <Check size={15} /> : <Icon size={15} />}
            <span>{name}</span>
          </li>
        ))}
      </ol>
      <div className="dialogue-script">
        <div>
          <strong>Dialogue & voices</strong>
          <button
            className="icon"
            aria-label="Edit dialogue in prompt"
            onClick={onEdit}
          >
            <Pencil size={14} />
          </button>
        </div>
        {speakers.map((speaker) => (
          <details key={speaker.id}>
            <summary>
              {speaker.name} ·{characterVoice(project, speaker)} ·{" "}
              {speaker.voice?.language || "Auto language"}{" "}
              <ChevronRight size={13} />
            </summary>
            <label>
              Character voice
              <select
                aria-label={`${speaker.name} dialogue voice`}
                value={project.production?.voiceAssignments?.[speaker.id] || ""}
                disabled={!!generating || lipSyncActive(job || {})}
                onChange={(e) => {
                  const value = e.target.value;
                  update((p) => {
                    p.production ??= { schemaVersion: 1 };
                    p.production.voiceAssignments ??= {};
                    if (value)
                      p.production.voiceAssignments[speaker.id] = value;
                    else delete p.production.voiceAssignments[speaker.id];
                  });
                }}
              >
                <option value="">Auto · from character identity</option>
                {dialogueVoices.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <small>
              Reused for this character. Changing it marks their existing
              dialogue for review.
            </small>
          </details>
        ))}
      </div>
      <FaceAssignment
        {...{ project, clip, update }}
        audio={fresh ? audio : null}
        disabled={!!generating || sound.lip.jobs.some(lipSyncActive)}
      />
      {problem && <p role="status">{problem}</p>}
      {generating && (
        <div className="dialogue-progress" role="status">
          <LoaderCircle size={17} className="spin" />
          <span>
            <b>Creating voice</b>
            <small>{unit?.stage || "Queued"} · this clip only</small>
          </span>
        </div>
      )}
      {unit?.needsTiming && (
        <p role="alert">
          The voice is longer than this clip. Its complete recording is in
          Assets. Fit its pace, or shorten the line / extend the picture.
          <button disabled={generating} onClick={()=>sound.action(run,"fitTiming",{unitId:unit.id})}>Fit voice to clip · no credits</button>
        </p>
      )}
      {!fresh && audio && (
        <p className="soundtrack-changed-note">
          The script or voice changed. Create an updated performance; the
          existing sound stays in place.
        </p>
      )}
      {!problem && !readyVoice && !generating && (
        <div className="dialogue-next-action">
          <small>
            {testMode
              ? "Offline makes a local tone, not spoken dialogue."
              : "Create this character’s written lines. Review them before matching the lips."}
          </small>
          <HoldGenerate
            enabled={!testMode}
            label="voice"
            busy={sound.submitting}
            requestKey={quote?.quoteId}
            disabled={!quote || !!sound.active || sound.submitting}
            price={
              quote
                ? testMode
                  ? "$0"
                  : `≈ $${quote.estimate.amount.toFixed(3)}`
                : "…"
            }
            onGenerate={createVoice}
          />
          {regenerate && fresh && (
            <button onClick={() => setRegenerate(false)}>
              Keep existing voice
            </button>
          )}
        </div>
      )}
      {readyVoice && !generating && (
        <LipSyncControl
          {...{ project, testMode, update, onPreviewPlay, timelinePlaying }}
          selectedIds={[clip.id]}
          faceRequired
          lip={sound.lip}
          onRegenerateVoice={() => setRegenerate(true)}
        />
      )}
      {error && (
        <p role="alert">
          {error}
          <button
            className="icon"
            aria-label="Refresh voice estimate"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </p>
      )}
      {run?.state === "failed" && !generating && (
        <p role="alert">
          {unit?.error || run.error || "Voice creation needs attention."} Saved
          sections remain available below.
        </p>
      )}
      <small className="dialogue-scope-note">
        Only this clip is changed when you apply. Other clips, dialogue and the
        continuous sound layers stay in place.
      </small>
    </>
  );
}
