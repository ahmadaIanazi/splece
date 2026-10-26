import { faceChoice } from "../shared/face-assignment.mjs";
import { dialogueScript } from "../shared/soundtrack-dialogue.mjs";
import React, { useEffect, useRef, useState } from "react";
import { ScanFace, LoaderCircle, Check, RefreshCw } from "lucide-react";
import { api, uid } from "./state";
import { HoldGenerate } from "./composer-tools";
import { LipSyncCompare } from "./lip-sync-compare";
import {
  lipSyncInput,
  lipSyncSignature,
  applyLipSync,
  saveLipSyncAsset,
} from "../shared/lip-sync.mjs";
export const lipSyncActive = (job) =>
  ["queued", "processing", "submitting", "downloading"].includes(job.state);
export function useLipSync(project, update, flush) {
  const [jobs, setJobs] = useState([]),
    [error, setError] = useState("");
  const latest = useRef({ project, update, flush });
  latest.current = { project, update, flush };
  const scope = project ? `${project.id}/${project.episodeId}` : "";
  useEffect(() => {
    setJobs([]);
    setError("");
    if (!scope) return;
    const [id, episodeId] = scope.split("/");
    let gone = false,
      timer,
      previous = "";
    async function poll() {
      let active = false;
      try {
        const rows = (await api(`/projects/${id}/lip-sync`)).filter(
          (j) => j.episodeId === episodeId,
        );
        if (gone) return;
        const value = JSON.stringify(rows);
        if (value !== previous) {
          setJobs(rows);
          previous = value;
        }
        active = rows.some(lipSyncActive);
        for (const job of rows.filter(
          (j) => j.state === "ready" && !j.delivered,
        )) {
          if (gone) return;
          if (!latest.current.project.assets.some((a) => a.id === job.media.id))
            latest.current.update((p) => saveLipSyncAsset(p, job));
          await latest.current.flush();
          if (gone) return;
          await api(`/projects/${id}/lip-sync/${job.id}/ack`, {});
        }
      } catch (e) {
        if (!gone) setError(e.message);
      }
      if (!gone) timer = setTimeout(poll, active ? 1500 : 5000);
    }
    poll();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [scope]);
  return {
    jobs,
    error,
    async request(action, body) {
      const initial = latest.current.project,
        revision = await latest.current.flush();
      if (
        latest.current.project.id !== initial.id ||
        latest.current.project.episodeId !== initial.episodeId
      )
        throw Error("Active edit changed.");
      const result = await api(`/projects/${initial.id}/lip-sync${action}`, {
        ...body,
        revision,
      });
      if (result.state)
        setJobs((old) => [result, ...old.filter((j) => j.id !== result.id)]);
      return result;
    },
  };
}
export function LipSyncControl({
  project,
  selectedIds,
  lip,
  testMode,
  update,
  onPreviewPlay,
  timelinePlaying,
  onRegenerateVoice,
  faceRequired = false,
}) {
  const [quote, setQuote] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [recovery, setRecovery] = useState("");
  const audition = useRef(null);
  useEffect(() => {
    if (timelinePlaying) audition.current?.pause();
  }, [timelinePlaying]);
  const selected = project.clips.filter((c) => selectedIds.includes(c.id));
  const clip = selected.length === 1 ? selected[0] : null;
  const audio =
    clip &&
    [...project.audioClips]
      .reverse()
      .find(
        (a) =>
          a.soundtrack?.role === "dialogue" &&
          a.start <= clip.start + 0.04 &&
          a.start + a.duration >= clip.start + clip.duration - 0.04 &&
          a.soundtrack.sources?.some((s) => s.clipId === clip.id),
      );
  let input, problem;
  try {
    if (
      faceRequired &&
      clip &&
      dialogueScript(project, clip).some(
        (_, i) => !faceChoice(project, clip, i),
      )
    )
      throw Error("Choose a face for each spoken line above.");
    input = lipSyncInput(project, clip?.id, audio?.id);
  } catch (e) {
    problem = e.message;
  }
  const key = input ? lipSyncSignature(input) : "",
    ref = useRef(lip);
  ref.current = lip;
  useEffect(() => {
    setQuote(null);
    setError("");
    if (!key) return;
    let gone = false;
    const timer = setTimeout(
      () =>
        ref.current
          .request("/estimate", {
            clipId: input.clipId,
            audioId: input.audioId,
          })
          .then((v) => {
            if (!gone) setQuote(v);
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
  }, [key, testMode, refresh]);
  const job = lip.jobs.find(
      (j) =>
        j.input.clipId === clip?.id &&
        j.input.audioMediaId === audio?.mediaId &&
        (j.signature === key ||
          j.media?.id === clip?.activeTake ||
          lipSyncActive(j) ||
          ["failed", "submission_uncertain"].includes(j.state)),
    ),
    active = lip.jobs.some(lipSyncActive),
    applied = job?.media?.id === clip?.activeTake;
  const pendingPart = job?.parts?.find((p) => p.state !== "ready");
  const acceptedRequest = pendingPart?.providerJobId || job?.providerJobId;
  async function submit() {
    if (busy || active || !quote || quote.mode !== (testMode ? "test" : "live"))
      return;
    setBusy(true);
    setError("");
    try {
      await lip.request("", {
        clipId: input.clipId,
        audioId: input.audioId,
        quoteId: quote.id,
        requestId: uid(),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setRefresh((v) => v + 1);
    }
  }
  return (
    <section className="lip-sync-control" aria-label="Lip-sync">
      {!clip ? (
        <small>Select one speaking clip on the timeline.</small>
      ) : !audio ? (
        <small>
          Create its voice-over first, then return here. Its waveform must cover
          the clip.
        </small>
      ) : problem && !applied ? (
        <small>{problem}</small>
      ) : null}
      {audio && !job?.media && (
        <div className="dialogue-voice-audition">
          <strong>Listen to the voice</strong>
          <audio
            ref={audition}
            controls
            preload="metadata"
            src={`/api/media/${audio.mediaId}/audio`}
            aria-label="Voice-over audition"
            onPlay={onPreviewPlay}
          />
        </div>
      )}
      {audio && !active && onRegenerateVoice && (
        <button className="dialogue-subtle" onClick={onRegenerateVoice}>
          <RefreshCw size={13} /> Create another voice performance
        </button>
      )}
      {job && (
        <div className="lip-sync-result">
          <strong>
            {applied
              ? "Synced take selected"
              : job.state === "failed"
                ? "Needs attention"
                : job.stage || job.state}
          </strong>
          {lipSyncActive(job) && <LoaderCircle size={17} className="spin" />}
          {job.parts && (
            <div className="speaker-progress" aria-label="Lip matching by line">
              {job.parts.map((p) => (
                <span
                  key={p.index}
                  data-state={p.state}
                  title={`Line ${p.index + 1} · ${p.name} · ${p.state}`}
                >
                  {p.state === "ready" ? <Check size={12} /> : p.index + 1}
                </span>
              ))}
            </div>
          )}
          {job.media && (
            <>
              <LipSyncCompare
                key={job.id}
                job={job}
                onPlay={onPreviewPlay}
                timelinePlaying={timelinePlaying}
              />
              <button
                disabled={applied}
                onClick={() => {
                  try {
                    update((p) => applyLipSync(p, job));
                    setError("");
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                <Check size={15} />
                {applied ? "Applied · original kept" : "Apply new take & voice"}
              </button>
            </>
          )}
          {job.error && <p role="alert">{job.error}</p>}
          {["failed", "submission_uncertain"].includes(job.state) &&
            !job.terminal &&
            !/fal.ai \((400|401|402|403|404|422)\)/.test(job.error || "") && (
              <>
                <input
                  hidden={!!acceptedRequest}
                  aria-label="fal request ID"
                  placeholder="Existing fal request ID"
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                />
                <button
                  disabled={
                    !acceptedRequest &&
                    !recovery.trim() &&
                    job.executionMode !== "test"
                  }
                  onClick={async () => {
                    try {
                      await lip.request(`/${job.id}/recover`, {
                        providerJobId: recovery.trim(),
                      });
                      setError("");
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  <RefreshCw size={14} />
                  Continue saved pass
                </button>
              </>
            )}
        </div>
      )}
      {(error || lip.error) && (
        <p className="soundtrack-error" role="alert">
          {error || lip.error}
        </p>
      )}
      {input && !applied && !job?.media && (
        <>
          <small>
            {testMode
              ? "Offline copies picture locally; it does not change mouth movement or spend credits."
              : "The selected speaking ranges and face assignments are sent to Sync 3 via fal. Review before applying; the original is kept."}
          </small>
          {!active && (
            <HoldGenerate
              enabled={!testMode}
              label="lip match"
              busy={busy}
              requestKey={quote?.id}
              price={
                quote
                  ? testMode
                    ? "$0"
                    : `≈ $${quote.amount.toFixed(3)}`
                  : "…"
              }
              disabled={
                busy ||
                active ||
                !quote ||
                quote.mode !== (testMode ? "test" : "live")
              }
              onGenerate={submit}
            />
          )}
        </>
      )}
    </section>
  );
}
