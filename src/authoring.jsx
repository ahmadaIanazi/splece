export { PlanningStudio as StoryPlanner } from "./planning-studio";
import { StructureTimeline } from "./structure-timeline";
import { StructureAssistant } from "./structure-assistant";
import { StoryNextSteps } from "./structure-onboarding";
import { moveStructureTimelineItem } from "../shared/structure-timeline.mjs";
import "./structure-canvas.css";
import {
  StructureReferenceRail,
  StructureDevelopmentToolbar,
  StructureJobStatus,
  StructureWorkflowHistory,
} from "./structure-workflow-ui";
import { attachProjectReference } from "../shared/authoring.mjs";
import { StructureCardSettings, StructureRuler } from "./structure-controls";
import { setAssetProjectOnly } from "../shared/asset-scope.mjs";
import {
  StructureOutline,
  StructureItemHeading,
  ReferenceBadges,
  ReferenceDrawer,
  structureDragType,
  referenceDragType,
} from "./structure-document";
import {
  moveStructureItem,
  attachStructureReference,
} from "../shared/structure-document.mjs";
import "./structure-document.css";
import { shotDefaults } from "../shared/shot-direction.mjs";
import {
  normalizeStructurePlan,
  createStructureNode,
  isStructureClip,
  structureLabel,
  structureColor,
} from "../shared/structure.mjs";
import { JobProgress } from "./job-progress";
import { jobsForStory } from "../shared/job-progress.mjs";
import { storyReadiness } from "../shared/story-tree.mjs";
import { childKind, formatStoryTime } from "../shared/story-tree.mjs";
import { StorySetup } from "./story-setup";
import { storyTree, storyDepth, descendants } from "../shared/story-tree.mjs";
import { PanelHeading, usePanelPreference } from "./workspace";
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Layers,
  Film,
  Users,
  Copy,
  Plus,
  Trash2,
  ArrowLeft,
  Clapperboard,
  BookOpen,
  Sparkles,
  Check,
  Download,
  Code2,
  Images,
  MessageCircle,
  X,
  FolderPlus,
  History,
} from "lucide-react";
import { api, uid, tc, makeDraft, compile } from "./state";
import {
  storyPlan,
  storySignature,
  applyStory,
  addStoryRemarks,
  beatDraft,
  exportPrompt,
  importPrompt,
  promptContract,
  validateStory,
} from "../shared/authoring.mjs";
import { validatePreparation } from "../shared/studio.mjs";
async function copy(value, setMessage) {
  try {
    await navigator.clipboard.writeText(
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );
    setMessage("Copied.");
  } catch {
    setMessage("Clipboard unavailable. Select and copy the JSON below.");
  }
}
export function JsonComposer({
  project,
  draft,
  prepared,
  models,
  update,
  onOpen,
}) {
  const [message, setMessage] = useState(""),
    [preview, setPreview] = useState(null);
  const raw = project.jsonDrafts?.[draft.id] || "";
  const payload = exportPrompt(project, draft, prepared, models);
  const parse = () => {
    const d = importPrompt(JSON.parse(raw), project, models),
      model = models.find((m) => m.id === d.settings.model),
      compiled = compile(project, d, model);
    return {
      draft: d,
      compiled,
      validation: validatePreparation(project, d, compiled, model),
    };
  };
  return (
    <section className="json-composer">
      <header>
        <Code2 size={17} />
        <b>SCENE JSON</b>
      </header>
      <p className="muted">
        An editable contract for another AI or your own automation. Includes all
        assembled injections, timeline context and local reference IDs.
      </p>
      <div className="author-actions">
        <button
          title="Copy prompt JSON with all injections"
          onClick={() => copy(payload, setMessage)}
        >
          <Copy size={14} /> Copy prompt JSON
        </button>
        <button
          title="Copy JSON contract"
          onClick={() => copy(promptContract, setMessage)}
        >
          Copy contract
        </button>
        <button
          title="Download prompt JSON"
          onClick={() => {
            const a = document.createElement("a"),
              url = URL.createObjectURL(
                new Blob([JSON.stringify(payload, null, 2)], {
                  type: "application/json",
                }),
              );
            a.href = url;
            a.download = "scene-prompt.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={14} />
        </button>
      </div>
      <details>
        <summary>Exported JSON · all injections</summary>
        <textarea
          aria-label="Exported prompt JSON"
          readOnly
          rows={14}
          value={JSON.stringify(payload, null, 2)}
        />
      </details>
      <label className="field">
        <span>Paste scene JSON</span>
        <textarea
          aria-label="Paste scene JSON"
          rows={14}
          placeholder='{"schemaVersion":1,"kind":"frame.prompt","composer":{…}}'
          value={raw}
          onChange={(e) => {
            const v = e.target.value;
            update((p) => {
              p.jsonDrafts ??= {};
              p.jsonDrafts[draft.id] = v;
            });
            setPreview(null);
          }}
        />
      </label>
      <button
        onClick={() => {
          try {
            setPreview(parse());
            setMessage(
              "Validated. Review the assembled result before importing.",
            );
          } catch (e) {
            setPreview(null);
            setMessage(e.message);
          }
        }}
      >
        Validate & preview
      </button>
      {preview && (
        <div className="json-review">
          <b>
            {preview.draft.name} · {tc(preview.draft.start)}–
            {tc(preview.draft.start + preview.draft.settings.duration)}
          </b>
          <p>
            {preview.draft.scenes.length} scenes ·{" "}
            {preview.draft.referenceIds.length} references ·{" "}
            {preview.draft.settings.model}
          </p>
          <pre className="exact-prompt">{preview.compiled.text}</pre>
          {[...preview.validation.errors, ...preview.validation.warnings].map(
            (e, i) => (
              <p key={i} className="muted">
                {e.message}
              </p>
            ),
          )}
          <button
            className="primary"
            onClick={() => {
              try {
                const current = parse();
                update((p) => {
                  p.drafts.push(current.draft);
                  p.activeDraftId = current.draft.id;
                });
                onOpen(current.draft);
                setMessage("Imported as a new draft. No generation submitted.");
              } catch (e) {
                setMessage(e.message);
              }
            }}
          >
            <Plus size={14} /> Import as new prompt tab
          </button>
        </div>
      )}
      <p role="status">{message}</p>
      <p className="muted">
        Only composer fields are imported. Injections are recomputed from your
        local library and settings. Unknown IDs and unsupported settings are
        rejected. Existing drafts stay intact.
      </p>
    </section>
  );
}
const sectionIcons = {
  act: Layers,
  chapter: BookOpen,
  scene: Film,
  generation: Clapperboard,
};
export function StoryNavigator({ project, time, onSeek, onPlan }) {
  const plan = storyPlan(project);
  const [collapsed, setCollapsed] = usePanelPreference(
    "frame-editor-roadmap",
    Infinity,
  );
  const ordered = storyTree(plan.beats);
  const current = ordered
    .filter((b) => time >= b.start && time < b.start + b.duration)
    .at(-1);
  return (
    <aside
      className="story-navigator"
      data-collapsed={collapsed}
      aria-label="Episode roadmap"
    >
      <PanelHeading
        title="Roadmap"
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      <nav className="rail-links" aria-label="Jump to story section">
        {ordered.map((b, index) => {
          const Icon = sectionIcons[b.kind] || Film;
          return (
            <button
              key={b.id}
              className={
                "roadmap-link " + (current?.id === b.id ? "active" : "")
              }
              style={{
                "--depth": Math.min(8, storyDepth(plan.beats, b)),
                "--story-kind-color": structureColor(plan, b),
              }}
              aria-current={current?.id === b.id ? "location" : undefined}
              title={`${b.title} · ${structureLabel(plan, b)} · ${tc(b.start)}`}
              aria-label={`Jump to ${b.title} at ${tc(b.start)}`}
              onClick={() => onSeek(b)}
            >
              <Icon size={16} />
              <span className="rail-label">
                {b.title}
                <small>{tc(b.start)}</small>
              </span>
              <small className="rail-index" aria-hidden="true">
                {index + 1}
              </small>
            </button>
          );
        })}
        {!ordered.length && (
          <button
            className="roadmap-link"
            title="Plan your story"
            onClick={onPlan}
          >
            <BookOpen size={17} />
            <span className="rail-label">Plan your story</span>
          </button>
        )}
      </nav>
    </aside>
  );
}
function blankBeat(plan) {
  return {
    id: uid(),
    act: plan.beats.at(-1)?.act || "Act 1",
    title: "New scene",
    start: Math.max(0, ...plan.beats.map((b) => b.start + b.duration)),
    duration: 5,
    description: "",
    characterIds: [],
    locationId: "",
    ...shotDefaults,
    dialogue: [],
  };
}
export function LegacyStoryPlanner({
  models = [],
  project,
  update,
  flush,
  onOpen,
  time,
  defaultSettings,
  focusedBeatId,
  onAssets,
  workflow,
  assistant,
}) {
  const plan = storyPlan(project),
    [selected, setSelected] = useState(null),
    [drawer, setDrawer] = useState(null),
    [timingId, setTimingId] = useState(null),
    [currentSection, setCurrentSection] = useState("main-story"),
    [dropTarget, setDropTarget] = useState(null),
    [draggedId, setDraggedId] = useState(null),
    [videoJobs, setVideoJobs] = useState([]),
    [message, setMessage] = useState(""),
    [setupOpen, setSetupOpen] = useState(
      !plan.beats.length && !plan.setup?.complete,
    ),
    [historyOpen, setHistoryOpen] = useState(false),
    [selectingGroups, setSelectingGroups] = useState(false),
    [selectedGroups, setSelectedGroups] = useState([]);
  const jobs = workflow.jobs;
  const busy = workflow.busy;
  useEffect(() => {
    setSetupOpen(!storyPlan(project).beats.length && !storyPlan(project).setup?.complete);
    setSelectedGroups([]);
    setHistoryOpen(false);
  }, [project.id, project.episodeId]);
  const cardRefs = useRef({});
  const contentRef = useRef(null);
  const dragging = useRef(null);
  const adopting = useRef(new Map());
  useEffect(() => {
    const deselect = (event) => {
      if (
        event.target.closest?.(
          '.structure-time-map, .structure-canvas-tabs, .structure-assistant, .structure-document-item, .structure-tools, .structure-drawer, .structure-outline, .structure-reference-rail, .structure-development-toolbar, .structure-history, [role="dialog"], .modal',
        )
      )
        return;
      setSelected(null);
      setTimingId(null);
    };
    document.addEventListener("pointerdown", deselect, true);
    return () => document.removeEventListener("pointerdown", deselect, true);
  }, []);
  const [foldedCards, setFoldedCards] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("frame-story-card-folds-v1")) || {}
      );
    } catch {
      return {};
    }
  });
  const foldKey = (id) => `${project.id}:${project.episodeId}:${id}`;
  const foldCards = (ids, collapsed) =>
    setFoldedCards((previous) => {
      const next = { ...previous };
      for (const id of ids) next[foldKey(id)] = collapsed;
      try {
        localStorage.setItem("frame-story-card-folds-v1", JSON.stringify(next));
      } catch {}
      return next;
    });

  const navigate = (id) => {
    setSetupOpen(id === "main-story");
    const ancestors = [];
    let parent = plan.beats.find((b) => b.id === id)?.parentId;
    while (parent) {
      ancestors.push(parent);
      parent = plan.beats.find((b) => b.id === parent)?.parentId;
    }
    foldCards([id, ...ancestors], false);
    setSelected(id);
    requestAnimationFrame(() => {
      if(contentRef.current)contentRef.current.scrollTop=0;
      cardRefs.current[id]?.focus({preventScroll:true});
    });
  };
  useEffect(() => {
    if (focusedBeatId && plan.beats.some((b) => b.id === focusedBeatId))
      navigate(focusedBeatId);
  }, [project.id, project.episodeId]);
  const beat = plan.beats.find((b) => b.id === selected);
  const edit = (fn) =>
    update((p) => {
      p.storyPlans ??= {};
      p.storyPlans[p.episodeId] ??= structuredClone(storyPlan(p));
      fn(p.storyPlans[p.episodeId]);
      normalizeStructurePlan(p.storyPlans[p.episodeId]);
      for (const b of p.storyPlans[p.episodeId].beats)
        b.end = b.start + b.duration;
    });
  const editBeat = (fn) =>
    edit((p) => {
      const b = p.beats.find((b) => b.id === beat?.id);
      if (b) fn(b);
    });
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api("/projects/" + project.id + "/jobs")
        .then((value) => {
          if (alive) setVideoJobs(value);
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project.id]);
  const prepare = async (expandId, action = null) => {
    try {
      await workflow.prepare(expandId, action);
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    }
  };
  const openBeat = (b) => {
    let d = project.drafts.find(
      (d) =>
        d.storyBeatId === b.id &&
        d.episodeId === project.episodeId &&
        !d.closed,
    );
    if (!isStructureClip(b)) {
      setMessage("Create a clip inside this group first.");
      return;
    }
    if (!d) {
      d = beatDraft(project, b, {
        ...makeDraft(b.start),
        settings: structuredClone(defaultSettings),
      });
      update((p) => {
        p.drafts.push(d);
        p.activeDraftId = d.id;
      });
    }
    onOpen(d, b);
  };
  const characters = project.assets.filter((a) => a.kind === "character");
  const storyAssets = project.assets;
  const pending = jobs.some((job) => ["queued", "running"].includes(job.state));
  const proposedAssets = jobs.flatMap((job) => {
    if (
      project.appliedStoryJobs?.includes(job.id) ||
      ["applied", "undone"].includes(
        job.application?.state || job.application?.status,
      )
    )
      return [];
    return [
      ...(job.result?.proposal?.characters || []).map((asset) => ({
        ...asset,
        kind: "character",
      })),
      ...(job.result?.proposal?.assets || []),
    ];
  });
  const orderedNodes = storyTree(plan.beats);
  const visibleNodes = orderedNodes.filter((node) => {
    let parent = node.parentId;
    while (parent) {
      if (foldedCards[foldKey(parent)]) return false;
      parent = plan.beats.find((b) => b.id === parent)?.parentId;
    }
    return true;
  });
  const visibleKey = visibleNodes.map((b) => b.id).join(":");
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame;
    const track = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = root.getBoundingClientRect().top + 140;
        let active = "main-story";
        for (const id of ["main-story", ...visibleNodes.map((b) => b.id)]) {
          const el = cardRefs.current[id];
          if (el && el.getBoundingClientRect().top <= top) active = id;
        }
        setCurrentSection(active);
      });
    };
    root.addEventListener("scroll", track, { passive: true });
    track();
    return () => {
      root.removeEventListener("scroll", track);
      cancelAnimationFrame(frame);
    };
  }, [visibleKey, project.id, project.episodeId]);
  function addNode(type) {
    const parent =
      beat && !isStructureClip(beat) ? beat.id : beat?.parentId || "";
    const node = createStructureNode(plan, type, parent);
    edit((p) => p.beats.push(node));
    navigate(node.id);
  }
  async function resolveReference(id) {
    if (!id?.startsWith("shared:"))
      return project.assets.find((a) => a.id === id);
    const libraryId = id.slice(7);
    const existing = project.assets.find((a) => a.libraryId === libraryId);
    if (existing) return existing;
    const key = project.id + ":" + libraryId;
    if (!adopting.current.has(key)) {
      const promise = (async () => {
        await flush();
        return api(`/projects/${project.id}/library/adopt`, { libraryId });
      })();
      adopting.current.set(key, promise);
      promise.catch(() => adopting.current.delete(key));
    }
    return adopting.current.get(key);
  }
  async function attachReference(id, assetId) {
    try {
      const asset = await resolveReference(assetId);
      if (!asset) throw Error("This reference is no longer available.");
      update((p) => {
        const node = p.storyPlans?.[p.episodeId]?.beats.find(
          (b) => b.id === id,
        );
        if (!p.assets.some((a) => a.id === asset.id)) p.assets.push(asset);
        if (id === "main-story") {
          attachProjectReference(p, asset);
        } else if (node) attachStructureReference(node, asset);
      });
      setMessage(asset.name + " attached.");
    } catch (e) {
      setMessage(e.message);
      throw e;
    }
  }
  async function manageReference(assetId) {
    if (!assetId) return onAssets();
    const asset = await resolveReference(assetId);
    if (!asset) throw Error("This reference is no longer available.");
    update((p) => {
      if (!p.assets.some((a) => a.id === asset.id)) p.assets.push(asset);
    });
    onAssets(asset.id);
  }
  function changeReferenceScope(id, projectOnly) {
    update((p) => {
      const asset = p.assets.find((a) => a.id === id);
      if (asset) setAssetProjectOnly(asset, projectOnly);
    });
    setMessage(
      projectOnly
        ? "Reference kept in this project."
        : "Reference approved for the shared library.",
    );
  }
  function detachReference(id, assetId) {
    edit((p) => {
      const node = p.beats.find((b) => b.id === id);
      if (id === "main-story") {
        p.setup ??= {};
        for (const key of ["castIds", "heroIds", "assetIds"])
          p.setup[key] = (p.setup[key] || []).filter((v) => v !== assetId);
        return;
      }
      if (!node) return;
      node.characterIds = (node.characterIds || []).filter(
        (v) => v !== assetId,
      );
      node.assetIds = (node.assetIds || []).filter((v) => v !== assetId);
      if (node.locationId === assetId) node.locationId = "";
    });
    setMessage("Reference removed from this section.");
  }
  function moveNode(id, targetId, position) {
    try {
      edit((p) => moveStructureItem(p, id, targetId, position));
      foldCards([targetId], false);
      setMessage("Section moved. Clip timing is unchanged.");
    } catch (error) {
      setMessage(error.message);
    }
    dragging.current = null;
    setDraggedId(null);
  }
  function moveByKey(node, direction) {
    if (direction === "out") return moveNode(node.id, node.parentId, "after");
    const siblings = orderedNodes.filter(
      (b) => (b.parentId || "") === (node.parentId || ""),
    );
    const at = siblings.findIndex((b) => b.id === node.id);
    const target = siblings[at + (direction === "up" ? -1 : 1)];
    if (target)
      moveNode(node.id, target.id, direction === "up" ? "before" : "after");
  }
  function dragOver(e, node) {
    const reference = e.dataTransfer.types.includes(referenceDragType);
    if (!reference && !e.dataTransfer.types.includes(structureDragType)) return;
    if (!reference && descendants(plan.beats, dragging.current).has(node.id))
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = reference ? "copy" : "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const position = reference
      ? "reference"
      : !isStructureClip(node) && ratio > 0.25 && ratio < 0.75
        ? "inside"
        : ratio < 0.5
          ? "before"
          : "after";
    setDropTarget((old) =>
      old?.id === node.id && old.position === position
        ? old
        : { id: node.id, position },
    );
  }
  function dropOn(e, node) {
    e.preventDefault();
    e.stopPropagation();
    const assetId = e.dataTransfer.getData(referenceDragType);
    const id = e.dataTransfer.getData(structureDragType);
    if (assetId) attachReference(node.id, assetId).catch(() => {});
    else if (id && dropTarget?.id === node.id)
      moveNode(id, node.id, dropTarget.position);
    setDropTarget(null);
  }
  return (
    <main className="story-workspace" aria-label="Structure">
      <div
        className="story-layout structure-document-layout structure-canvas-layout"
        data-drawer-open={!!drawer}
        data-dragging={!!draggedId}
        data-setup-open={setupOpen}
        data-story-overview={!setupOpen && !beat}
        data-first-setup={setupOpen && !plan.beats.length}
      >
        <section
          className="story-content structure-document"
          ref={contentRef}
          aria-label="Structure document"
        >
          <nav className="structure-canvas-tabs" aria-label="Writing canvas">
            {!!plan.beats.length && <button aria-current={!setupOpen && !selected ? "page" : undefined} onClick={() => {setSelected(null);setSetupOpen(false);}}>Story overview</button>}
            <button aria-current={setupOpen ? 'page' : undefined} onClick={()=>{setSelected(null);setSetupOpen(true);}}>Story idea</button>
            {beat && <button aria-current={!setupOpen ? 'page' : undefined} onClick={()=>setSetupOpen(false)}>{structureLabel(plan,beat)} · {beat.title}</button>}
          </nav>
          {setupOpen ? (
            <StorySetup
              key={project.id + ":" + project.episodeId}
              projectId={project.id}
              project={project}
              assistant={assistant}
              models={models}
              update={update}
              plan={plan}
              characters={characters}
              assets={storyAssets}
              edit={edit}
              prepare={prepare}
              busy={busy || pending}
              onLibrary={() => {
                setSelected(null);
                setDrawer("assets");
              }}
              assistantPanel={<StructureAssistant project={project} nodeId={null} assistant={assistant} update={update} paused={busy || pending} onOpenAsset={manageReference}/>}
              onDone={() => setSetupOpen(false)}
            />
          ) : (
            <>
              <header className="story-canvas-heading">
                <span>WORKSPACE / STRUCTURE</span>
                <small>{plan.beats.length} sections</small>
                <div className="story-fold-tools">
                  <button
                    className="icon"
                    title="Collapse all groups"
                    aria-label="Collapse all groups"
                    onClick={() =>
                      foldCards(
                        plan.beats
                          .filter((b) => !isStructureClip(b))
                          .map((b) => b.id),
                        true,
                      )
                    }
                  >
                    <ChevronsDownUp size={16} />
                  </button>
                  <button
                    className="icon"
                    title="Expand all groups"
                    aria-label="Expand all groups"
                    onClick={() =>
                      foldCards(
                        plan.beats.map((b) => b.id),
                        false,
                      )
                    }
                  >
                    <ChevronsUpDown size={16} />
                  </button>
                </div>
              </header>
              <div
                ref={(element) => (cardRefs.current["main-story"] = element)}
              >
                {(!beat || !isStructureClip(beat)) && <StructureDevelopmentToolbar
                  plan={plan}
                  workflow={workflow}
                  selectedIds={selectedGroups.filter((id) =>
                    plan.beats.some((node) => node.id === id),
                  )}
                  selecting={selectingGroups}
                  setSelecting={setSelectingGroups}
                  clearSelection={() => setSelectedGroups([])}
                  onToggleSelection={(id) => setSelectedGroups((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])}
                  onSetup={() => setSetupOpen(true)}
                />}
              </div>
              {(message || workflow.message || workflow.error) && (
                <p
                  className={
                    workflow.error ? "error" : "structure-workflow-message"
                  }
                  role={workflow.error ? "alert" : "status"}
                >
                  {workflow.error || message || workflow.message}
                </p>
              )}
              {historyOpen && (
                <StructureWorkflowHistory
                  workflow={workflow}
                  project={project}
                  plan={plan}
                  onClose={() => {
                    setHistoryOpen(false);
                    document.querySelector('.structure-tools [aria-label="Activity & versions"]')?.focus();
                  }}
                />
              )}
              {!beat && !!plan.beats.length && <StoryNextSteps project={project} plan={plan} busy={busy} onOpenAsset={manageReference} onWorld={() => setDrawer("world")} onGroup={node => { setSelected(node.id); setSetupOpen(false); }}/>}
              {!plan.beats.length && (
                <div className="structure-blank-state">
                  <Sparkles size={25} />
                  <h2>{busy ? "Building your story…" : "Your story has room to grow."}</h2>
                  <p>
                    {busy ? "Your idea and cast are saved. The outline will appear here when it’s ready." : "Start with an outline, or add a group or clip from the tools beside the canvas."}
                  </p>
                  <button
                    className="primary"
                    disabled={busy || pending}
                    onClick={() => prepare(null, "outline")}
                  >
                    Create Outline
                  </button>
                  <button onClick={() => setSetupOpen(true)}>
                    Shape your idea
                  </button>
                </div>
              )}
              {visibleNodes.filter(n => n.id === selected).map((beat) => {
                const editBeat = (fn) =>
                  edit((p) => {
                    const b = p.beats.find((x) => x.id === beat.id);
                    if (b) fn(b);
                  });
                const state = storyReadiness(project, beat, videoJobs);
                const cardCollapsed = !!foldedCards[foldKey(beat.id)];
                return (
                  <article
                    key={beat.id}
                    tabIndex={-1}
                    ref={(el) => (cardRefs.current[beat.id] = el)}
                    style={{
                      "--story-kind-color": structureColor(plan, beat),
                      "--document-depth": Math.min(
                        5,
                        storyDepth(plan.beats, beat),
                      ),
                    }}
                    data-node-type={isStructureClip(beat) ? "clip" : "group"}
                    data-depth={storyDepth(plan.beats, beat)}
                    data-drop={
                      dropTarget?.id === beat.id
                        ? dropTarget.position
                        : undefined
                    }
                    className={
                      "story-beat story-canvas-card structure-document-item " +
                      (selected === beat.id ? "selected" : "")
                    }
                    onDragOver={(e) => dragOver(e, beat)}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget))
                        setDropTarget(null);
                    }}
                    onDrop={(e) => dropOn(e, beat)}
                  >
                    <StructureItemHeading
                      node={beat}
                      plan={plan}
                      selected={selected === beat.id}
                      folded={cardCollapsed}
                      select={() =>
                        setSelected(selected === beat.id ? null : beat.id)
                      }
                      toggle={() => foldCards([beat.id], !cardCollapsed)}
                      move={(direction) => moveByKey(beat, direction)}
                      startDrag={(e) => {
                        dragging.current = beat.id;
                        setDraggedId(beat.id);
                        e.dataTransfer.setData(structureDragType, beat.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      endDrag={() => {
                        dragging.current = null;
                        setDraggedId(null);
                        setDropTarget(null);
                      }}
                    />
                    {selected !== beat.id && (
                      <button
                        className="structure-prose"
                        aria-label={"Edit description of " + beat.title}
                        onClick={() => setSelected(beat.id)}
                      >
                        <span>{beat.description || "Add a few words…"}</span>
                        {beat.dialogue?.map((line, index) => (
                          <q key={index}>
                            <b>
                              {
                                characters.find((a) => a.id === line.speaker)
                                  ?.name
                              }
                            </b>{" "}
                            {line.text}
                          </q>
                        ))}
                      </button>
                    )}
                    <ReferenceBadges
                      node={beat}
                      assets={storyAssets}
                      onOpen={() => {
                        setSelected(beat.id);
                        setDrawer("assets");
                      }}
                    />
                    {dropTarget?.id === beat.id && (
                      <span className="structure-drop-label">
                        {dropTarget.position === "reference"
                          ? "Attach reference"
                          : dropTarget.position === "inside"
                            ? "Move into group"
                            : "Move " + dropTarget.position}
                      </span>
                    )}
                    {selected === beat.id && (
                      <div className="structure-selected-caption">
                        <span>
                          {structureLabel(plan, beat)} · {state}
                        </span>
                        <button
                          className="icon danger-quiet"
                          aria-label={"Remove " + beat.title}
                          title="Remove section and its contents"
                          onClick={() => {
                            edit((p) => {
                              p.beats = p.beats.filter(
                                (b) => !descendants(p.beats, beat.id).has(b.id),
                              );
                            });
                            setSelected(null);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                    {selected === beat.id && (
                      <div
                        id={"story-card-body-" + beat.id}
                        className="story-card-body"
                      >
                        {jobsForStory(
                          videoJobs,
                          beat.id,
                          project.episodeId,
                        ).map((j) => (
                          <JobProgress key={j.id} job={j} />
                        ))}
                        <label className="field">
                          <span>
                            {["act", "chapter"].includes(beat.kind)
                              ? "Story direction"
                              : "Action & direction"}
                          </span>
                          <textarea
                            aria-label="Planned scene description"
                            rows={5}
                            value={beat.description}
                            onChange={(e) =>
                              editBeat((b) => (b.description = e.target.value))
                            }
                          />
                        </label>
                        <StructureCardSettings
                          node={beat}
                          plan={plan}
                          editNode={editBeat}
                          move={moveNode}
                        />
                        {beat.dialogue.map((l, i) => (
                          <div className="story-dialogue" key={i}>
                            <select
                              aria-label={`Planned dialogue ${i + 1} speaker`}
                              value={l.speaker}
                              onChange={(e) =>
                                editBeat(
                                  (b) =>
                                    (b.dialogue[i].speaker = e.target.value),
                                )
                              }
                            >
                              {characters.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label={`Planned dialogue ${i + 1}`}
                              value={l.text}
                              placeholder="Exact spoken words"
                              onChange={(e) =>
                                editBeat(
                                  (b) => (b.dialogue[i].text = e.target.value),
                                )
                              }
                            />
                            <input
                              aria-label={`Planned delivery ${i + 1}`}
                              value={l.delivery}
                              placeholder="Softly"
                              onChange={(e) =>
                                editBeat(
                                  (b) =>
                                    (b.dialogue[i].delivery = e.target.value),
                                )
                              }
                            />
                            <button
                              title="Remove dialogue"
                              onClick={() =>
                                editBeat((b) => b.dialogue.splice(i, 1))
                              }
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                        {beat.kind === "generation" && (
                          <details>
                            <summary>
                              Story context used by AI refinement
                            </summary>
                            <p>
                              Overall story:{" "}
                              {plan.setup?.concept ||
                                plan.brief ||
                                plan.synopsis}
                            </p>
                            <p>
                              Parent scene:{" "}
                              {plan.beats.find((b) => b.id === beat.parentId)
                                ?.title || "Standalone clip"}
                            </p>
                            {(() => {
                              const ordered = storyTree(plan.beats).filter(
                                (b) => ["generation", "scene"].includes(b.kind),
                              );
                              const index = ordered.findIndex(
                                (b) => b.id === beat.id,
                              );
                              return (
                                <>
                                  <p>
                                    Before:{" "}
                                    {ordered
                                      .slice(Math.max(0, index - 2), index)
                                      .map((b) => b.title)
                                      .join(" → ") || "Story opening"}
                                  </p>
                                  <p>
                                    After:{" "}
                                    {ordered
                                      .slice(index + 1, index + 3)
                                      .map((b) => b.title)
                                      .join(" → ") || "Story ending"}
                                  </p>
                                </>
                              );
                            })()}
                            <p>
                              Includes saved assets, speaker voices, language
                              and exact existing dialogue. Completed development
                              updates these cards automatically; previous
                              versions stay saved.
                            </p>
                          </details>
                        )}
                        <div className="author-actions">
                          <button
                            className="text-action"
                            disabled={!characters.length}
                            onClick={() =>
                              editBeat((b) =>
                                b.dialogue.push({
                                  speaker: characters[0].id,
                                  text: "",
                                  delivery: "Auto",
                                  direction: "",
                                }),
                              )
                            }
                          >
                            <MessageCircle size={14} /> Add dialogue
                          </button>
                          <button
                            className={
                              beat.kind === "generation"
                                ? "accent-action"
                                : "primary"
                            }
                            disabled={
                              busy ||
                              jobs.some(
                                (job) =>
                                  job.originBeatId === beat?.id &&
                                  ["queued", "running"].includes(job.state),
                              )
                            }
                            onClick={() =>
                              prepare(
                                beat.id,
                                beat.kind === "generation"
                                  ? "enhance"
                                  : "children",
                              )
                            }
                          >
                            <Sparkles size={14} />{" "}
                            {beat.kind === "generation"
                              ? "Refine clip with AI"
                              : (beat.childNodeType ||
                                    (childKind(beat.kind) === "generation"
                                      ? "clip"
                                      : "group")) === "clip"
                                ? "Develop clips"
                                : "Develop nested groups"}
                          </button>
                          {beat.kind === "generation" && (
                            <button
                              className="primary"
                              disabled={beat.kind !== "generation"}
                              title={
                                beat.kind !== "generation"
                                  ? "Develop or add a clip first"
                                  : "Open this clip in the composer"
                              }
                              onClick={() => openBeat(beat)}
                            >
                              <Clapperboard size={14} /> Open in Editor
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <StructureJobStatus
                      jobs={jobs}
                      nodeId={beat.id}
                      project={project}
                    />
                  </article>
                );
              })}
              <div
                className="structure-root-drop"
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(structureDragType))
                    e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData(structureDragType);
                  if (id) moveNode(id, null, "inside");
                  setDropTarget(null);
                }}
              >
                Drop here to move to the top level
              </div>
              <details className="structure-json-exchange">
                <summary>Structure JSON · exchange with another AI</summary>
                <button
                  onClick={() =>
                    copy(
                      {
                        ...plan,
                        schemaVersion: 2,
                        instructions:
                          "Keep stable local IDs. beats use nodeType group or clip and parentId. Groups may contain groups or clips at any depth; clips cannot have children, cycles are invalid. kind is a legacy hint only. groupLabels names depths without changing structure. Preserve sibling order (the numeric order field), start, end and duration in seconds. Document order is independent of advisory timing. Clips use 5/10/15/20/25/30-second planning presets. Groups use generationMode compact/multiple and generationDuration. setup includes language, region, accent and dialogueStyle. characters contains new characters only; assets contains new location/prop/style definitions. Link beat.assetIds and locationId to library or new IDs. Include attributed dialogue in most scenes unless intentionally silent.",
                        beats: storyTree(plan.beats).map((b) => ({
                          ...b,
                          nodeType: isStructureClip(b) ? "clip" : "group",
                          kind: b.kind || "scene",
                          parentId: b.parentId || "",
                          end: b.start + b.duration,
                        })),
                        history: undefined,
                        characters: [],
                        assets: [],
                        library: project.assets.filter(
                          (a) => a.kind !== "footage",
                        ),
                      },
                      setMessage,
                    )
                  }
                >
                  <Copy size={14} /> Copy structure JSON
                </button>
                <textarea
                  aria-label="Paste story plan JSON"
                  rows={12}
                  value={project.storyImport || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    update((p) => (p.storyImport = value));
                  }}
                />
                <button
                  onClick={() => {
                    try {
                      const proposal = validateStory(
                        JSON.parse(project.storyImport),
                        project,
                      );
                      update((p) => {
                        p.storyManualPreview = {
                          proposal,
                          sourceSignature: storySignature(p),
                        };
                      });
                      setMessage("Story JSON validated. Review below.");
                    } catch (e) {
                      setMessage(e.message);
                    }
                  }}
                >
                  Validate story JSON
                </button>
                {project.storyManualPreview && (
                  <>
                    <pre className="exact-prompt">
                      {JSON.stringify(
                        project.storyManualPreview.proposal,
                        null,
                        2,
                      )}
                    </pre>
                    <button
                      onClick={() => {
                        try {
                          update((p) => {
                            applyStory(
                              p,
                              p.storyManualPreview.proposal,
                              p.storyManualPreview.sourceSignature,
                            );
                            delete p.storyManualPreview;
                          });
                          setMessage(
                            "Imported story applied. Previous plan saved.",
                          );
                        } catch (e) {
                          setMessage(e.message);
                        }
                      }}
                    >
                      Apply imported story plan
                    </button>
                  </>
                )}
              </details>
            </>
          )}
          {!setupOpen && <StructureAssistant project={project} nodeId={selected} assistant={assistant} update={update} paused={busy || pending} onOpenAsset={manageReference}/> }
        </section>
        <StructureTimeline models={models} project={project} plan={plan} selected={selected} onSelect={navigate} update={update} onAdd={addNode} onAttach={attachReference} onMove={(id,targetId,position)=>{try{update(p=>moveStructureTimelineItem(p,id,targetId,position));}catch(e){setMessage(e.message);}}}/>
        {drawer && (
          <aside
            className="structure-drawer"
            aria-label={
              drawer === "assets" ? "Assets & references" : drawer === "world" ? "Story world" : "Overview"
            }
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDrawer(null);
                document
                  .querySelector(
                    `.structure-tools [aria-label="${drawer === "assets" ? "Assets & references" : drawer === "world" ? "Story world" : "Overview"}"]`,
                  )
                  ?.focus();
              }
            }}
          >
            <header>
              <h2>
                {drawer === "assets" ? "Assets & references" : drawer === "world" ? "Story world" : "Overview"}
              </h2>
              <button
                className="icon"
                aria-label="Close tools panel"
                onClick={() => setDrawer(null)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="structure-drawer-content">
              {drawer === "world" && <StructureReferenceRail project={project} plan={plan} jobs={jobs} onReplace={workflow.replaceReference} onAssets={manageReference} onLibrary={()=>setDrawer('assets')} busy={busy}/>}
              {drawer === "assets" && (
                <ReferenceDrawer
                  project={project}
                  selected={
                    beat || {
                      id: "main-story",
                      title: "project cast & references",
                      characterIds: plan.setup?.castIds || [],
                      assetIds: plan.setup?.assetIds || [],
                    }
                  }
                  proposalAssets={proposedAssets}
                  onReview={() => {
                    setSetupOpen(false);
                    setDrawer(null);
                    setHistoryOpen(true);
                  }}
                  onScope={changeReferenceScope}
                  attach={attachReference}
                  detach={detachReference}
                  onSuggest={() => prepare(null, "assets")}
                  busy={busy || pending}
                  onAssets={manageReference}
                />
              )}
              {drawer === "overview" && (
                <>
                  {" "}
                  <details
                    className="story-intro"
                    tabIndex={-1}
                    ref={(el) => (cardRefs.current.overview = el)}
                    open
                  >
                    <summary>
                      <BookOpen size={16} /> Overview
                    </summary>
                    <label className="field">
                      <span>Episode title</span>
                      <input
                        value={plan.title}
                        onChange={(e) =>
                          edit((p) => (p.title = e.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Creative brief</span>
                      <textarea
                        aria-label="Creative brief"
                        rows={4}
                        placeholder="The film you want to create, its tone, plot, characters and approximate length…"
                        value={plan.brief}
                        onChange={(e) =>
                          edit((p) => (p.brief = e.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Plot / synopsis</span>
                      <textarea
                        aria-label="Story synopsis"
                        rows={3}
                        value={plan.synopsis}
                        onChange={(e) =>
                          edit((p) => (p.synopsis = e.target.value))
                        }
                      />
                    </label>
                    <label className="field"><span>Story connections · kept ideas</span><textarea aria-label="Kept story connections" rows={4} value={(plan.connectionNotes || []).join('\n')} onChange={e=>edit(p=>p.connectionNotes=e.target.value.split('\n').filter(Boolean))}/></label>
                    <div className="author-actions">
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          jobs.some(
                            (job) =>
                              job.originBeatId === beat?.id &&
                              ["queued", "running"].includes(job.state),
                          )
                        }
                        onClick={() => prepare(null, "outline")}
                      >
                        <Sparkles size={14} /> {plan.beats.length ? "Develop outline" : "Create outline"}
                      </button>
                    </div>
                  </details>
                </>
              )}
            </div>
          </aside>
        )}
        {(<nav className="structure-tools" aria-label="Structure tools">
            {[
              ["assets", "Assets & references", Images],
              ["world", "Story world", Users],
              ["overview", "Overview", BookOpen],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                className="icon"
                title={label}
                aria-label={label}
                aria-expanded={drawer === id}
                onClick={() => setDrawer(drawer === id ? null : id)}
              >
                <Icon size={19} />
              </button>
            ))}
            <button className="icon" title="Activity & versions" aria-label="Activity & versions" aria-expanded={historyOpen} onClick={()=>{setDrawer(null);setSetupOpen(false);setHistoryOpen(v=>!v);}}><History size={19}/></button>
            <span className="structure-tool-separator" />
            <button
              className="icon"
              title={
                beat && !isStructureClip(beat)
                  ? "Add group inside " + beat.title
                  : "Add group"
              }
              aria-label="Add group"
              onClick={() => addNode("group")}
            >
              <FolderPlus size={19} />
            </button>
            <button
              className="icon"
              title={
                beat && !isStructureClip(beat)
                  ? "Add clip inside " + beat.title
                  : "Add clip"
              }
              aria-label="Add clip"
              onClick={() => addNode("clip")}
            >
              <Clapperboard size={19} />
            </button>
          </nav>
        )}
      </div>
    </main>
  );
}
