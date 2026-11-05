import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  LoaderCircle,
  Package,
  Search,
  Check,
  ChevronDown,
} from "lucide-react";
import { api, tc } from "./state";
import { AddonSettings, useAddons } from "./addons";
import { localToolAddons } from "../shared/addons.mjs";
import { applyLocalResult } from "../shared/local-tools.mjs";

const tools = [
  ["sound", "Build from my sounds"],
  ["levels", "Check loudness"],
  ["describe", "Describe audio"],
  ["rank", "Find matching sounds"],
  ["beats", "Find beats & onsets"],
  ["cuts", "Find shot boundaries"],
  ["captions", "Create captions"],
];
export function LocalTools({
  project,
  update,
  flush,
  selectedIds = [],
  onSeek,
  onToggle,
}) {
  const { addons, error: addonError } = useAddons();
  const [action, setAction] = useState("sound"),
    [scope, setScope] = useState("all"),
    [query, setQuery] = useState(""),
    [assetId, setAssetId] = useState("");
  const [language, setLanguage] = useState("auto"),
    [vocabulary, setVocabulary] = useState(""),
    [captionEdits, setCaptionEdits] = useState({});
  const [jobs, setJobs] = useState([]),
    [error, setError] = useState(""),
    [pollError, setPollError] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [message, setMessage] = useState("");
  const current = useRef({ project, update });
  const reviewQueue = useRef(Promise.resolve());
  current.current = { project, update };
  const context = `${project.id}/${project.episodeId}`;
  useEffect(() => {
    setJobs([]);
    setError("");
    setPollError("");
    setMessage("");
    setAssetId("");
    setCaptionEdits({});
    setLanguage("auto");
    setVocabulary(project.assets.filter((a) => a.kind === "character").map((a) => a.name).join(", ").slice(0, 500));
    let alive = true,
      timer;
    const poll = async () => {
      try {
        const value = await api(`/projects/${project.id}/local-tools`);
        if (alive) {
          setJobs(value.filter((j) => j.episodeId === project.episodeId));
          setPollError("");
        }
      } catch (e) {
        if (alive) setPollError(e.message);
      }
      if (alive) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [context]);
  const addon = addons.find((a) => a.id === localToolAddons[action]);
  const needsAddon =
    !!localToolAddons[action] && !(addon?.enabled && addon.status === "ready");
  const audio = project.assets.filter(
    (a) => a.kind === "audio" && a.media?.audio,
  );
  const semantic = addons.some(
    (a) => a.id === "earshot" && a.enabled && a.status === "ready",
  );
  const active = jobs.find((j) => ["queued", "running"].includes(j.state));
  async function analyze() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const revision = await flush();
      if (
        `${current.current.project.id}/${current.current.project.episodeId}` !==
        context
      )
        return;
      const job = await api(`/projects/${project.id}/local-tools`, {
        revision,
        action,
        language: action === "captions" ? language : undefined,
        vocabulary: action === "captions" ? vocabulary : undefined,
        semantic: action === "sound" && semantic,
        query,
        assetId: action === "sound" ? assetId || undefined : undefined,
        clipIds: scope === "selection" ? selectedIds : undefined,
      });
      if (
        `${current.current.project.id}/${current.current.project.episodeId}` ===
        context
      )
        setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveCaptionReview(job) {
    const edits = (job.result.captions || []).filter((c) => captionEdits[c.id] !== undefined)
      .map((c) => ({ id: c.id, text: captionEdits[c.id] }));
    if (!edits.length) return job;
    const pending = reviewQueue.current.catch(() => {}).then(() =>
      api(`/projects/${project.id}/local-tools/${job.id}/review`, { edits }));
    reviewQueue.current = pending;
    const saved = await pending;
    if (`${current.current.project.id}/${current.current.project.episodeId}` !== context)
      throw Error("The project changed. Reopen its saved review to continue.");
    setJobs((old) => old.map((j) => j.id === saved.id ? saved : j));
    return saved;
  }
  async function apply(job) {
    setBusy(true);
    try {
      if (job.action === "captions") job = await saveCaptionReview(job);
      // Validate before entering the React state update, where errors would hit the panel boundary.
      applyLocalResult(structuredClone(current.current.project), job);
      current.current.update((p) => applyLocalResult(p, job));
      setMessage("Added to the timeline. Undo restores your previous edit.");
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const latest = jobs.find((j) => j.action === action);
  const applied =
    latest &&
    [
      ...(latest.result?.sounds || []),
      ...(latest.result?.captions || []),
    ].every((s) =>
      [...project.audioClips, ...(project.elements || [])].some(
        (e) => e.id === s.id,
      ),
    );
  useEffect(() => {
    if (!applied) setMessage((old) => old.startsWith("Added to the timeline") ? "" : old);
  }, [applied, latest?.id]);
  return (
    <details
      className="local-tools"
      onToggle={(e) => onToggle?.(e.currentTarget.open)}
    >
      <summary>Local tools & sound search</summary>
      <p>
        Work on this computer. No credits or uploads. Add larger engines only
        when you need them.
      </p>
      <label>
        Tool
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setMessage("");
          }}
        >
          {tools.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
              {localToolAddons[id] ? " · add-on" : " · included"}
            </option>
          ))}
        </select>
      </label>
      <div
        className="local-tools-actions"
        role="group"
        aria-label="Local analysis scope"
      >
        <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
          Whole edit
        </button>
        <button
          disabled={!selectedIds.length}
          aria-pressed={scope === "selection"}
          onClick={() => setScope("selection")}
        >
          Selected clips
        </button>
      </div>
      {action === "captions" && (
        <>
          <label>Spoken language
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="auto">Detect from audio</option>
              <option value="ar">Arabic · العربية</option>
              <option value="en">English</option>
            </select>
          </label>
          <details>
            <summary>Help with names & terms</summary>
            <label>Names as they should be spelled
              <input value={vocabulary} maxLength={500} dir="auto"
                onChange={(e) => setVocabulary(e.target.value)} />
            </label>
            <p>Optional spelling hints, not a script. The recording remains the source.</p>
          </details>
        </>
      )}
      {["sound", "rank"].includes(action) && (
        <label>
          Sound description · optional
          <input
            value={query}
            maxLength={2000}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="For example: birds in a quiet classroom"
          />
        </label>
      )}
      {action === "sound" && (
        <>
          <label>
            Sound
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
            >
              <option value="">
                {semantic
                  ? "Match by sound · Earshot"
                  : "Match from scene descriptions & tags"}
              </option>
              {audio.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            Uses recordings in this project’s Library.{" "}
            {semantic
              ? "Earshot checks the sound itself and finds a usable excerpt. "
              : ""}
            A sound you choose here always wins. Review the suggested placement
            before adding it.
          </p>
        </>
      )}
      {(error || pollError || addonError) && <p role="alert">{error || pollError || addonError}</p>}
      {message && <p role="status">{message}</p>}
      <div className="local-tools-actions">
        {needsAddon ? (
          <button onClick={() => setSettings(true)}>
            <Download size={15} aria-hidden="true" />
            Add {addon?.name || "local capability"}
          </button>
        ) : (
          <button
            className="primary"
            disabled={
              busy ||
              !!active ||
              !project.clips.length ||
              (scope === "selection" && !selectedIds.length)
            }
            onClick={analyze}
          >
            {busy || active ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : null}
            {action === "sound" ? "Prepare sound" : "Analyze"}
          </button>
        )}
        <button aria-expanded={settings} onClick={() => setSettings(!settings)}>
          <Package size={15} aria-hidden="true" />
          Add-ons
        </button>
      </div>
      {settings && <AddonSettings />}
      {active && (
        <div role="status">
          <p>{active.message}</p>
          <button
            onClick={async () => {
              try {
                await api(
                  `/projects/${project.id}/local-tools/${active.id}/cancel`,
                  {},
                );
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Cancel analysis
          </button>
        </div>
      )}
      {latest?.error && (
        <p role="alert">{latest.error} You can run the tool again.</p>
      )}
      {latest?.state === "ready" && (
        <div
          className="local-tools-results"
          aria-label="Local analysis results"
        >
          {latest.result.note && <p>{latest.result.note}</p>}
          {latest.result.items.filter((item) => action !== "captions" || !item.result?.segments?.length).map((item, i) => (
            <div className="local-result" key={`${latest.id}-${i}`}>
              <strong>{item.name || `Clip ${i + 1}`}</strong>
              {item.message && <p>{item.message}</p>}
              {item.result?.summary && <p>{item.result.summary}</p>}
              {action === "captions" && item.result?.segments?.length === 0 && (
                <p>No speech detected in this clip.</p>
              )}
              {action === "cuts" && item.result?.cuts?.length === 0 && (
                <p>No shot boundary detected inside this clip.</p>
              )}
              {action === "levels" && item.result && (
                <p>
                  {item.result.loudness == null
                    ? "Silence or no measurable level"
                    : `${item.result.loudness.toFixed(1)} LUFS · ${item.result.peak?.toFixed(1)} dBTP peak`}
                </p>
              )}
              {item.result?.tempo > 0 && (
                <p>Estimated tempo · {Math.round(item.result.tempo)} BPM</p>
              )}
              {action === "beats" && item.result?.beats?.length === 0 && (
                <p>No beat pattern detected in this clip.</p>
              )}
              {(item.result?.cuts || item.result?.beats || [])
                .slice(0, 80)
                .map((time, k) => (
                  <button
                    key={k}
                    onClick={() => onSeek?.((item.start || 0) + time)}
                    aria-label={`Go to ${tc((item.start || 0) + time)}`}
                  >
                    {tc((item.start || 0) + time)}
                  </button>
                ))}
              {item.result?.onsets && (
                <details>
                  <summary>Sound onsets · {item.result.onsets.length}</summary>
                  {item.result.onsets.slice(0, 80).map((time, k) => (
                    <button
                      key={k}
                      onClick={() => onSeek?.((item.start || 0) + time)}
                    >
                      {tc((item.start || 0) + time)}
                    </button>
                  ))}
                </details>
              )}
              {item.result?.ranking?.map((candidate) => (
                <div key={candidate.id}>
                  <p>
                    {candidate.name} · {candidate.verdict}
                  </p>
                  <button
                    onClick={() => {
                      setAssetId(candidate.id);
                      setAction("sound");
                    }}
                  >
                    Use this sound
                  </button>
                </div>
              ))}
              {action !== "captions" && item.result?.segments?.map((s, k) => (
                <p key={k} dir="auto">
                  {s.text}
                </p>
              ))}
            </div>
          ))}
          {action === "captions" && !!latest.result.captions?.length && (
            <div className="local-result">
              <strong>Review captions</strong>
              {latest.result.captions.map((caption, i) => (
                <label className="local-caption" key={caption.id}>
                  <button type="button" onClick={() => onSeek?.(caption.start)}
                    aria-label={`Preview caption ${i + 1} at ${tc(caption.start)}`}>
                    {tc(caption.start)} – {tc(caption.start + caption.duration)}
                  </button>
                  <textarea rows={2} dir="auto" maxLength={2000}
                    aria-label={`Caption ${i + 1}`}
                    disabled={applied}
                    value={captionEdits[caption.id] ?? caption.text}
                    onChange={(e) => setCaptionEdits((old) => ({ ...old, [caption.id]: e.target.value }))}
                    onBlur={() => saveCaptionReview(latest).catch((e) => setError(e.message))} />
                </label>
              ))}
              <p>Text edits save when you leave a field. Added captions can be edited in the preview.</p>
            </div>
          )}
          {!!latest.result.sounds?.length && (
            <div className="local-result">
              <strong>Listen before adding</strong>
              {latest.result.sounds.map((s) => (
                <div key={s.id}>
                  <small>
                    {s.name} · {tc(s.start)}
                  </small>
                  <audio
                    controls
                    preload="none"
                    src={`/api/media/${s.mediaId}/audio`}
                  />
                </div>
              ))}
            </div>
          )}
          {(latest.result.sounds?.length > 0 ||
            latest.result.captions?.length > 0) && (
            <button
              className="primary"
              disabled={applied || busy}
              onClick={() => apply(latest)}
            >
              <Check size={15} aria-hidden="true" />
              {applied ? "Added to timeline" : "Add to timeline"}
            </button>
          )}
        </div>
      )}
      <OpenSoundSearch
        project={project}
        update={update}
        enabled={addons.some((a) => a.id === "openverse" && a.enabled)}
        onSetup={() => setSettings(true)}
      />
    </details>
  );
}

function OpenSoundSearch({ project, update, enabled, onSetup }) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [imported, setImported] = useState([]);
  const current = useRef(project.id);
  current.current = project.id;
  useEffect(() => {
    setImported([]);
  }, [project.id]);
  async function search(e) {
    e.preventDefault();
    setBusy("search");
    setError("");
    try {
      setResults(
        (await api(`/openverse/audio?q=${encodeURIComponent(query)}`)).results,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function add(record) {
    setBusy(record.id);
    setError("");
    try {
      const asset = await api(`/projects/${project.id}/openverse/import`, {
        recordId: record.id,
      });
      if (current.current !== project.id) return;
      update((p) => {
        if (!p.assets.some((a) => a.id === asset.id)) p.assets.push(asset);
      });
      setImported((old) => [...old, record.id]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <details>
      <summary>Find recordings online</summary>
      <p>
        Made with{" "}
        <a href="https://openverse.org/" target="_blank" rel="noreferrer">
          Openverse
        </a>
        . No account needed for standard searches. Recordings retain their
        source and license in your Library.
      </p>
      {!enabled ? (
        <button onClick={onSetup}>Enable open sound search</button>
      ) : (
        <>
          <form onSubmit={search}>
            <label>
              Search sounds
              <input
                value={query}
                maxLength={200}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Birds, rainfall, footsteps…"
              />
            </label>
            <button disabled={!!busy || !query.trim()}>
              <Search size={15} aria-hidden="true" />
              {busy === "search" ? "Searching…" : "Search"}
            </button>
          </form>
          {error && (
            <p role="alert">
              {error}{" "}
              <a
                href="https://docs.openverse.org/api/guides/quickstart.html"
                target="_blank"
                rel="noreferrer"
              >
                API setup guide
              </a>
            </p>
          )}
          {results.map((record) => (
            <div className="local-result" key={record.id}>
              <strong>{record.title}</strong>
              <p>{record.attribution}</p>
              <a href={record.source} target="_blank" rel="noreferrer">
                Preview at source
              </a>
              {" · "}
              <a href={record.licenseUrl} target="_blank" rel="noreferrer">
                License
              </a>
              <button
                disabled={!!busy || imported.includes(record.id)}
                onClick={() => add(record)}
              >
                {busy === record.id
                  ? "Importing…"
                  : imported.includes(record.id)
                    ? "Added to Library"
                    : "Add to Library"}
              </button>
            </div>
          ))}
        </>
      )}
    </details>
  );
}
