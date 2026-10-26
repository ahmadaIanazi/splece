import React, { useEffect, useMemo, useRef, useState } from "react";
import { ProviderAction } from "./provider-connect";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  Clock3,
  History,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  Search,
  Sparkles,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { useSharedLibrary } from "./shared-library";
import { isStructureClip } from "../shared/structure.mjs";
import "./structure-workflow-ui.css";

const active = (job) => ["queued", "running"].includes(job.state);
const statusOf = (job, project) =>
  job.application?.status ||
  job.application?.state ||
  (typeof job.application === "string" ? job.application : null) ||
  (project.appliedStoryJobs?.includes(job.id) ? "applied" : job.state);
const kindName = (kind) =>
  ({
    character: "Characters",
    location: "Places",
    prop: "Props",
    style: "Style",
  })[kind] || "Other references";
const entityIcon = (kind) =>
  kind === "character" ? Users : kind === "location" ? MapPin : Package;

export function StructureReferenceRail({
  project,
  plan,
  jobs = [],
  onReplace,
  onAssets,
  onLibrary,
  busy,
}) {
  const library = useSharedLibrary(project);
  const [query, setQuery] = useState("");
  const [replacing, setReplacing] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef(null);
  const railHeading = useRef(null);
  const returnFocus = useRef(null);
  const replacementButtons = useRef(new Map());
  useEffect(() => {
    if (replacing) searchRef.current?.focus();
  }, [replacing]);
  const closePicker = () => {
    setReplacing(null);
    setQuery("");
    setError("");
    requestAnimationFrame(() => {
      if (replacementButtons.current.has(returnFocus.current)) replacementButtons.current.get(returnFocus.current).focus();
      else railHeading.current?.focus();
    });
  };
  const entities = useMemo(() => {
    const ids = new Set([
      ...(plan.setup?.castIds || []),
      ...(plan.setup?.assetIds || []),
      ...(plan.setup?.heroIds || []),
    ]);
    const count = new Map();
    for (const node of plan.beats) {
      const refs = new Set(
        [
          ...(node.characterIds || []),
          ...(node.assetIds || []),
          node.locationId,
          ...(node.dialogue || []).map((line) => line.speaker),
        ].filter(Boolean),
      );
      for (const id of refs) {
        ids.add(id);
        count.set(id, (count.get(id) || 0) + 1);
      }
    }
    const byId = new Map(
      project.assets
        .filter((asset) => ids.has(asset.id))
        .map((asset) => [
          asset.id,
          { ...asset, usage: count.get(asset.id) || 0 },
        ]),
    );
    for (const job of jobs) {
      if (
        statusOf(job, project) === "applied" ||
        statusOf(job, project) === "undone"
      )
        continue;
      const proposal = job.result?.proposal;
      for (const asset of [
        ...(proposal?.characters || []).map((asset) => ({
          ...asset,
          kind: "character",
        })),
        ...(proposal?.assets || []),
      ]) {
        if (
          !byId.has(asset.id) &&
          !project.assets.some((local) => local.id === asset.id)
        )
          byId.set(asset.id, { ...asset, proposed: true, usage: 0 });
      }
    }
    return [...byId.values()];
  }, [plan, project.assets, jobs, project.appliedStoryJobs]);
  const source = entities.find((entity) => entity.id === replacing);
  const localLibraries = new Set(
    project.assets.map((asset) => asset.libraryId).filter(Boolean),
  );
  const candidates = [
    ...project.assets,
    ...library.entries
      .filter((entry) => !localLibraries.has(entry.id))
      .map((entry) => ({
        ...entry.asset,
        id: `shared:${entry.id}`,
        origin: entry.originName,
      })),
  ].filter(
    (asset) =>
      source &&
      asset.id !== source.id &&
      asset.kind === source.kind &&
      `${asset.name} ${asset.description || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const replace = async (target) => {
    setError("");
    setWorking(true);
    try {
      await onReplace(source.id, target.id);
      closePicker();
    } catch (error) {
      setError(error.message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <aside className="structure-reference-rail" aria-label="Story references">
      <header>
        <div className="structure-rail-title">
          <Users size={15} aria-hidden="true" />
          <h2 ref={railHeading} tabIndex={-1}>Your story world</h2>
        </div>
        <button
          type="button"
          aria-label="Browse reference library"
          title="Browse reference library"
          onClick={onLibrary}
        >
          <Plus size={16} />
        </button>
      </header>
      <p className="structure-rail-intro">
        The people, places and things in this story.
      </p>
      {source ? (
        <div className="structure-reference-picker" aria-busy={working} onKeyDown={(event) => {
          if (event.key === "Escape" && !working) { event.stopPropagation(); closePicker(); }
        }}>
          <div className="structure-replace-heading">
            <button
              type="button"
              aria-label="Cancel replacement"
              disabled={working}
              onClick={closePicker}
            >
              <X size={14} />
            </button>
            <b>Replace {source.name}</b>
          </div>
          <p>
            Update linked references throughout this story
            {source.usage
              ? ` · ${source.usage} ${source.usage === 1 ? "section" : "sections"}`
              : ""}
            .
          </p>
          <label className="structure-rail-search">
            <Search size={13} />
            <input
              ref={searchRef}
              aria-label="Find replacement reference"
              placeholder={`Find a ${source.kind === "location" ? "place" : source.kind}…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="structure-replacement-options">
            {candidates.map((asset) => {
              const Icon = entityIcon(asset.kind);
              return (
                <button
                  type="button"
                  key={asset.id}
                  disabled={working || busy}
                  onClick={() => replace(asset)}
                >
                  {asset.media?.thumbnail ? (
                    <img src={asset.media.thumbnail} alt="" />
                  ) : (
                    <Icon size={18} />
                  )}
                  <span>
                    <b>{asset.name}</b>
                    <small>{asset.origin || "This project"}</small>
                  </span>
                  <ArrowLeftRight size={13} />
                </button>
              );
            })}
            {!candidates.length && (
              <p className="structure-rail-empty">
                No matching references. Add one from your library.
              </p>
            )}
          </div>
          {working && <p role="status">Updating references…</p>}
        </div>
      ) : (
        <div className="structure-entity-groups">
          {[...new Set(entities.map((entity) => entity.kind))].map((kind) => (
            <section key={kind}>
              <h3>
                {kindName(kind)}
                <span>
                  {entities.filter((entity) => entity.kind === kind).length}
                </span>
              </h3>
              {entities
                .filter((entity) => entity.kind === kind)
                .map((entity) => {
                  const Icon = entityIcon(kind);
                  return (
                    <article className="structure-entity" key={entity.id}>
                      <button
                        type="button"
                        className="structure-entity-open"
                        disabled={entity.proposed}
                        title={
                          entity.proposed
                            ? "Suggested by a saved development result"
                            : `Open ${entity.name}`
                        }
                        onClick={() => onAssets(entity.id)}
                      >
                        {entity.media?.thumbnail ? (
                          <img src={entity.media.thumbnail} alt="" />
                        ) : (
                          <span className="structure-entity-avatar">
                            <Icon size={19} />
                          </span>
                        )}
                        <span>
                          <b>{entity.name}</b>
                          <small>
                            {entity.proposed
                              ? "Suggested"
                              : entity.usage
                                ? `${entity.usage} ${entity.usage === 1 ? "section" : "sections"}`
                                : "Story reference"}
                          </small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="structure-entity-replace"
                        ref={(element) => {
                          if (element) replacementButtons.current.set(entity.id, element);
                          else replacementButtons.current.delete(entity.id);
                        }}
                        title={
                          entity.proposed
                            ? "Saved suggestion · available when this result is added to your story"
                            : `Replace ${entity.name} throughout this story`
                        }
                        aria-label={`Replace ${entity.name}`}
                        disabled={busy || entity.proposed}
                        onClick={() => {
                          returnFocus.current = entity.id;
                          setReplacing(entity.id);
                          setQuery("");
                          setError("");
                        }}
                      >
                        <ArrowLeftRight size={13} />
                        <span>
                          {entity.proposed ? "Saved suggestion" : "Replace"}
                        </span>
                      </button>
                    </article>
                  );
                })}
            </section>
          ))}
          {!entities.length && (
            <div className="structure-rail-empty">
              <Package size={26} strokeWidth={1.2} />
              <p>
                Your cast and references will gather here as the story takes
                shape.
              </p>
              <button type="button" onClick={onLibrary}>
                Bring in a reference
              </button>
            </div>
          )}
        </div>
      )}
      {(error || library.error) && (
        <p role="alert" className="error">
          {error || library.error}
        </p>
      )}
    </aside>
  );
}

export function StructureDevelopmentToolbar({
  plan,
  selectedIds,
  selecting,
  setSelecting,
  clearSelection,
  onToggleSelection,
  workflow,
  onSetup,
}) {
  const [error, setError] = useState("");
  const groups = plan.beats.filter((node) => !isStructureClip(node));
  const eligible = groups.filter(
    (group) => !plan.beats.some((node) => node.parentId === group.id),
  );
  const pending = workflow.jobs.filter(active).length;
  const buildingOutline = !plan.beats.length && workflow.busy;
  const [submitting, setSubmitting] = useState(false);
  const inProgress = workflow.busy || submitting;
  const selectedEligible = eligible.filter((group) => selectedIds.includes(group.id));
  const count = selecting ? selectedEligible.length : eligible.length;
  return (
    <div className="structure-development-toolbar">
      <div>
        <h1>{plan.title || "Your story"}</h1>
        <span>
          {plan.beats.filter(isStructureClip).length} clips · {groups.length}{" "}
          {groups.length === 1 ? "group" : "groups"}
          {pending ? ` · ${pending} developing` : ""}
        </span>
      </div>
      <div className="structure-development-actions">
        <button type="button" onClick={onSetup} title="Edit story foundation">
          Your brief
        </button>
        <button
          type="button"
          aria-pressed={selecting}
          onClick={() => {
            setSelecting(!selecting);
            if (selecting) clearSelection();
          }}
        >
          {selecting ? "Done selecting" : "Select groups"}
        </button>
        
        <ProviderAction provider="deepseek" feature="clip planning" returnLabel="Back to my story">
        <button
          type="button"
          className="primary"
          disabled={inProgress || !count}
          aria-busy={inProgress}
          onClick={async () => {
            setError("");
            setSubmitting(true);
            try {
              await workflow.develop(selecting ? selectedEligible.map((group) => group.id) : []);
            } catch (error) {
              setError(error.message);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {inProgress ? <LoaderCircle size={16} className="structure-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          {inProgress ? (buildingOutline ? "Creating outline…" : "Developing clips…") : selecting
            ? `Develop ${count || "selected"} ${count === 1 ? "group" : "groups"}`
            : eligible.length ? "Develop all clips" : groups.length ? "All groups developed" : "Develop clips"}
        </button>
        </ProviderAction>
      </div>
      {selecting && (
        <fieldset className="structure-group-picker">
          <legend>Choose groups to develop</legend>
          <p>Pick any unfinished groups. Existing clips stay as they are.</p>
          <div>
            {eligible.map((group) => (
              <label key={group.id}>
                <input type="checkbox" checked={selectedIds.includes(group.id)} onChange={() => onToggleSelection(group.id)} disabled={inProgress} />
                <span>{group.title || "Untitled group"}</span>
              </label>
            ))}
          </div>
          {!eligible.length && <p>Every group already has clips. Add a new group to keep developing.</p>}
          <span role="status">{count} {count === 1 ? "group" : "groups"} selected</span>
          {!!selectedIds.length && <button type="button" onClick={clearSelection}>Clear selection</button>}
        </fieldset>
      )}
      {pending > 0 && !buildingOutline && <p className="structure-development-note" role="status">Developing {pending} {pending === 1 ? "group" : "groups"}. Results update here automatically; you can keep working.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function StructureJobStatus({ jobs, nodeId, project }) {
  const relevant = jobs.filter((job) => job.originBeatId === nodeId);
  const pending = relevant.filter(active);
  const latest = [...relevant].sort(
    (a, b) => Number(b.createdAt) - Number(a.createdAt),
  )[0];
  const failed = latest?.state === "failed" ? [latest] : [];
  const conflict =
    latest && statusOf(latest, project) === "conflict" ? [latest] : [];
  if (!pending.length && !failed.length && !conflict.length) return null;
  return (
    <div
      className={`structure-card-activity${failed.length || conflict.length ? " attention" : ""}`}
      role="status"
    >
      {pending.length ? (
        <>
          <LoaderCircle size={14} className="structure-spin" />
          Developing clips here. You can keep working.
        </>
      ) : (
        <>
          <AlertTriangle size={14} />
          {conflict.length
            ? "Saved result needs attention"
            : "Development needs attention"}{" "}
          · open Activity & versions
        </>
      )}
    </div>
  );
}

export function StructureWorkflowHistory({ workflow, project, plan, onClose }) {
  const panelRef = useRef(null);
  useEffect(() => {
    panelRef.current?.querySelector("button")?.focus({ preventScroll: true });
    panelRef.current?.scrollIntoView({ block: "start" });
  }, []);
  const [tab, setTab] = useState("activity");
  const [confirmation, setConfirmation] = useState(null);
  const warningRef = useRef(null);
  useEffect(() => {
    if (confirmation) {
      warningRef.current?.focus({ preventScroll: true });
      warningRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [confirmation]);
  const [working, setWorking] = useState(null);
  const [error, setError] = useState("");
  const restore = async (id, confirmed = false) => {
    setWorking(id);
    setError("");
    try {
      const result = await workflow.restore(id, { confirmed });
      if (result?.needsConfirmation)
        setConfirmation({ id, impact: result.impact });
      else setConfirmation(null);
    } catch (error) {
      setError(error.message);
    } finally {
      setWorking(null);
    }
  };
  const recover = async (id) => {
    setWorking(id);
    setError("");
    try {
      await workflow.recover(id);
    } catch (error) {
      setError(error.message);
    } finally {
      setWorking(null);
    }
  };
  return (
    <section
      className="structure-history"
      ref={panelRef}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
      aria-label="Structure activity and versions"
    >
      <header>
        <div role="group" aria-label="History view">
          <button
            type="button"
            aria-pressed={tab === "activity"}
            onClick={() => setTab("activity")}
          >
            <Clock3 size={14} />
            Activity <small>{workflow.jobs.length}</small>
          </button>
          <button
            type="button"
            aria-pressed={tab === "versions"}
            onClick={() => setTab("versions")}
          >
            <History size={14} />
            Versions <small>{workflow.versions.length}</small>
          </button>
        </div>
        <button
          type="button"
          aria-label="Close activity and versions"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      {confirmation && (
        <div className="structure-restore-warning" role="alert" ref={warningRef} tabIndex={-1}>
          <AlertTriangle size={20} />
          <div>
            <h3>Restore this structure version?</h3>
            <p>
              {confirmation.impact.message ||
                "Some sections are linked to work in the Editor. Restoring changes those relationships."}
            </p>
            {confirmation.impact.clips?.length > 0 && (
              <p>
                Editor clips:{" "}
                {confirmation.impact.clips
                  .map((clip) => clip.title || clip.id)
                  .join(", ")}
              </p>
            )}
            {confirmation.impact.drafts?.length > 0 && (
              <p>
                Editable prompts:{" "}
                {confirmation.impact.drafts
                  .map((draft) => draft.title || draft.id)
                  .join(", ")}
              </p>
            )}
            <p>
              Existing footage, timeline placements and submitted generation
              versions are preserved. Some links to this structure may be
              detached.
            </p>
            <div>
              <button
                type="button"
                disabled={!!working}
                onClick={() => setConfirmation(null)}
              >
                Keep current version
              </button>
              <button
                type="button"
                disabled={!!working}
                onClick={() => restore(confirmation.id, true)}
              >
                Restore structure version
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="structure-history-list">
        {tab === "activity"
          ? [...workflow.jobs]
              .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
              .map((job) => {
                const status = statusOf(job, project);
                const parent = plan.beats.find(
                  (node) => node.id === job.originBeatId,
                );
                const result = job.result?.proposal;
                return (
                  <details className="structure-run" key={job.id}>
                    <summary>
                      <span className={`structure-run-state ${status}`}>
                        {active(job) ? (
                          <LoaderCircle size={14} className="structure-spin" />
                        ) : status === "applied" ? (
                          <Check size={14} />
                        ) : (
                          <History size={14} />
                        )}
                      </span>
                      <span>
                        <b>
                          {parent?.title ||
                            {
                              conversation: "Planning conversation",
                              outline: "Create outline",
                              characters: "Develop characters",
                              assets: "Discover references",
                              children: "Develop clips",
                              enhance: "Refine clip",
                            }[job.action] ||
                            "Structure development"}
                        </b>
                        <small>
                          {{
                            applied: "Updated in your story",
                            conflict: "Saved · needs attention",
                            undone: "Undone · result kept",
                            queued: "Queued · safe to leave",
                            running: "Developing · safe to leave",
                            failed: "Needs attention",
                            done: "Result saved",
                            completed: "Result saved",
                            ready: "Result saved",
                          }[status] || status}
                        </small>
                      </span>
                      <ChevronDown size={14} />
                    </summary>
                    <div className="structure-run-detail">
                      {(job.application?.message || job.error) && (
                        <p>{job.application?.message || job.error}</p>
                      )}
                      {result && (
                        <>
                          <p>
                            {result.beats?.length || 0} sections ·{" "}
                            {(result.characters?.length || 0) +
                              (result.assets?.length || 0)}{" "}
                            suggested references
                          </p>
                          <div className="structure-run-preview">
                            {(result.beats || [])
                              .filter(
                                (node) =>
                                  !job.originBeatId ||
                                  node.parentId === job.originBeatId,
                              )
                              .map((node) => (
                                <article key={node.id}>
                                  <b>{node.title}</b>
                                  <p>{node.description}</p>
                                </article>
                              ))}
                          </div>
                        </>
                      )}
                      {((job.state === "ready" && status !== "applied") ||
                        (job.state === "failed" && job.result)) && (
                        <button
                          type="button"
                          disabled={working === job.id}
                          onClick={() => recover(job.id)}
                        >
                          Recover saved result · no AI credits
                        </button>
                      )}
                      {status === "conflict" && (
                        <p className="structure-setup-note">
                          This result is retained because the story changed
                          while it was developing. Your current writing is
                          preserved.
                        </p>
                      )}
                    </div>
                  </details>
                );
              })
          : workflow.versions.map((version) => (
              <article className="structure-version" key={version.id}>
                <History size={15} />
                <div>
                  <b>{version.title || "Structure version"}</b>
                  <small>
                    {new Date(version.at).toLocaleString()} ·{" "}
                    {version.beatCount}{" "}
                    {version.beatCount === 1 ? "section" : "sections"}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={!!working || workflow.busy}
                  onClick={() => restore(version.id)}
                >
                  Restore
                </button>
              </article>
            ))}
        {!(tab === "activity"
          ? workflow.jobs.length
          : workflow.versions.length) && (
          <p className="structure-history-empty">
            {tab === "activity"
              ? "Your development runs will stay here, including saved results that need attention."
              : "Structure versions appear here as you develop your story."}
          </p>
        )}
      </div>
      <footer>
        <span>Completed results stay with this project.</span>
        <button type="button" onClick={() => workflow.undo()}>
          <Undo2 size={13} />
          Undo last edit
        </button>
      </footer>
    </section>
  );
}
