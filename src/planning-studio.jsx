import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ConnectProviderButton, ProviderAction } from "./provider-connect";
import {
  ArrowUp,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  Library,
  History,
  Sparkles,
  Clapperboard,
  Film,
  BookOpen,
  Layers,
  Check,
  X,
  ImagePlus,
  MessageCircle,
  LoaderCircle,
  Play,
} from "lucide-react";
import {
  storyPlan,
  beatDraft,
  attachProjectReference,
} from "../shared/authoring.mjs";
import { createStructureNode, isStructureClip } from "../shared/structure.mjs";
import {
  planningColumns,
  planningMessages,
  planningReferenceIds,
  recordPlanningMessage,
  PLANNING_MESSAGE_LIMIT,
  validatePlanningMessage,
} from "../shared/planning-conversation.mjs";
import { jobsForStory, jobProgress } from "../shared/job-progress.mjs";
import { setAssetProjectOnly } from "../shared/asset-scope.mjs";
import { makeDraft, api, tc } from "./state";
import { Modal } from "./components";
import { ReferenceDrawer } from "./structure-document";
import { StructureWorkflowHistory } from "./structure-workflow-ui";
import { usePreviewMedia } from "./preview-media";
import "./planning-studio.css";
const AssetGenerator = lazy(() =>
  import("./asset-generator").then((m) => ({ default: m.AssetGenerator })),
);
const iconFor = (n) =>
  isStructureClip(n)
    ? Film
    : n.kind === "act"
      ? Layers
      : n.kind === "chapter"
        ? BookOpen
        : Clapperboard;

function PlanningPlayback({ media, projectId }) {
  const { current } = usePreviewMedia({
    current: media,
    enabled: true,
    scope: projectId,
    playing: false,
  });
  return current?.url ? (
    <video
      className="planning-footage"
      controls
      preload="metadata"
      poster={media.thumbnail}
      src={current.url}
      aria-label="Clip take preview"
    />
  ) : (
    <p role="status">Preparing preview…</p>
  );
}
export function PlanningStudio({
  project,
  update,
  flush,
  workflow,
  onOpen,
  onCompose,
  composer,
  onAssets,
  onJobs,
  defaultSettings,
  jobs = [],
}) {
  const plan = storyPlan(project),
    columns = planningColumns(plan),
    references = planningReferenceIds(plan);
  const messages = planningMessages(project),
    session = project.planningSessions?.[project.episodeId];
  const initialMessage = () => session?.draft ?? (!messages.length && !plan.beats.length ? plan.setup?.concept || plan.brief || "" : "");
  const [text, setText] = useState(initialMessage),
    [selected, setSelected] = useState(null),
    [collapsed, setCollapsed] = useState(false),
    [panel, setPanel] = useState(null),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [zoom, setZoom] = useState(1),
    [previewId, setPreviewId] = useState(null);
  const board = useRef(null),
    chatEnd = useRef(null),
    input = useRef(null),
    lock = useRef(false),
    pan = useRef(null);
  const busy = sending || workflow.busy,
    focus = plan.beats.find((b) => b.id === selected);
  const assets = project.assets.filter((a) => references.has(a.id));
  const imageAsset = project.assets.find((a) => a.id === panel?.assetId);
  const failed = workflow.jobs.filter(
    (j) =>
      ["failed", "interrupted"].includes(j.state) ||
      j.application?.state === "conflict",
  );
  useEffect(() => {
    setText(initialMessage());
    setSelected(null);
    setPanel(null);
    setError("");
  }, [project.id, project.episodeId]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [messages.length, busy]);
  async function run(fn) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  }
  async function send(event) {
    event?.preventDefault();
    const value = text.trim();
    if (!value || busy || lock.current) return;
    if (workflow.needsConnection) { workflow.connect(); return; }
    try { validatePlanningMessage(text); } catch (e) { setError(e.message); return; }
    lock.current = true;
    setSending(true);
    setError("");
    const pending = session?.pendingSubmission;
    const id =
      pending?.text === value && pending?.focusId === selected
        ? pending.id
        : crypto.randomUUID();
    try {
      update((p) => {
        if (p.id !== project.id || p.episodeId !== project.episodeId) return;
        recordPlanningMessage(p, {
          id,
          role: "user",
          text: value,
          at: Date.now(),
        });
        p.planningSessions[p.episodeId].pendingSubmission = {
          id,
          text: value,
          focusId: selected,
        };
      });
      await flush();
      await workflow.chat(value, id, selected);
      setText("");
      update((p) => {
        if (
          p.id === project.id &&
          p.episodeId === project.episodeId &&
          p.planningSessions?.[p.episodeId]
        ) {
          p.planningSessions[p.episodeId].draft = "";
          delete p.planningSessions[p.episodeId].pendingSubmission;
        }
      });
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setSending(false);
    }
  }
  function openClip(node) {
    let draft = project.drafts.find(
      (d) =>
        d.storyBeatId === node.id &&
        d.episodeId === project.episodeId &&
        !d.closed,
    );
    if (!draft) {
      draft = beatDraft(project, node, {
        ...makeDraft(node.start),
        settings: structuredClone(defaultSettings),
      });
      update((p) => {
        p.drafts.push(draft);
        p.activeDraftId = draft.id;
      });
    }
    setSelected(node.id);
    (onCompose || onOpen)(draft);
  }
  function addScene() {
    update((p) => {
      p.storyPlans ??= {};
      const next = structuredClone(storyPlan(p));
      const n = createStructureNode(next, "group");
      n.kind = "scene";
      n.childNodeType = "clip";
      n.start = Math.max(0, ...next.beats.map((b) => b.start + b.duration));
      n.end = n.start + n.duration;
      n.title = `Scene ${next.beats.filter((b) => !b.parentId).length + 1}`;
      next.beats.push(n);
      p.storyPlans[p.episodeId] = next;
      setSelected(n.id);
    });
  }
  async function attach(asset) {
    await flush();
    let local = asset;
    if (asset._libraryId)
      local = await api(`/projects/${project.id}/library/adopt`, {
        libraryId: asset._libraryId,
      });
    update((p) => {
      if (p.id !== project.id || p.episodeId !== project.episodeId)
        throw Error("Project changed. Choose the reference again.");
      if (!p.assets.some((a) => a.id === local.id)) p.assets.push(local);
      attachProjectReference(p, local);
    });
    await flush();
    setPanel(null);
  }
  const supportsImage = (a) =>
    ["character", "location", "prop", "style"].includes(a.kind);
  function reviewReference(a) {
    if (supportsImage(a)) setPanel({ assetId: a.id });
    else onAssets(a.id);
  }
  const useSuggestion = (s) => {
    setText(s);
    input.current?.focus();
  };
  const referenceFaces = (ids) => (
    <div className="planning-faces">
      {[...new Set(ids)]
        .map((id) => project.assets.find((a) => a.id === id))
        .filter(Boolean)
        .slice(0, 5)
        .map((a) => (
          <button
            key={a.id}
            title={a.name}
            aria-label={`Review ${a.name}`}
            onClick={(e) => {
              e.stopPropagation();
              reviewReference(a);
            }}
          >
            {a.media?.kind === "image" ? (
              <img
                loading="lazy"
                src={a.media.thumbnail || a.media.url}
                alt={a.name}
              />
            ) : (
              <span>{a.name?.slice(0, 1)}</span>
            )}
          </button>
        ))}
    </div>
  );
  function card(node, root = false) {
    const clip = isStructureClip(node),
      Icon = iconFor(node);
    const mediaClip = project.clips.find(
      (c) => (c.storyBeatId || c.structureNodeId) === node.id,
    );
    const take = mediaClip?.takes?.find((t) => t.id === mediaClip.activeTake);
    const attempts = jobsForStory(jobs, node.id, project.episodeId);
    const job = attempts.find((j) => !jobProgress(j).terminal);
    const failedAttempt = attempts.find((j) =>
      [
        "failed",
        "interrupted",
        "download_failed",
        "submission_uncertain",
      ].includes(j.state),
    );
    const ready = attempts.find((j) => j.state === "ready" && j.media);
    const media = take || ready?.media;
    const children = plan.beats.filter((b) => b.parentId === node.id);
    return (
      <article
        key={node.id}
        className={`planning-card ${root ? "planning-scene-card" : ""} ${clip ? "clip-card" : ""} ${selected === node.id ? "is-selected" : ""}`}
        style={{ "--depth": Math.min(node.boardDepth || 0, 5) }}
        onClick={() => setSelected(node.id)}
      >
        <button
          className="planning-card-title"
          onClick={() => setSelected(node.id)}
          aria-pressed={selected === node.id}
        >
          <Icon size={17} />
          <span>{node.title}</span>
          <small>{Math.round(node.duration * 10) / 10}s</small>
        </button>
        <p dir="auto">
          {node.description ||
            "Describe this part in the chat. We’ll build from here."}
        </p>
        {node.dialogue?.length > 0 && (
          <blockquote dir="auto">
            {node.dialogue.map((l) => l.text).join(" · ")}
          </blockquote>
        )}
        {referenceFaces(
          [...(node.characterIds || []), node.locationId].filter(Boolean),
        )}
        {media?.url && (
          <div onClick={(e) => e.stopPropagation()}>
            {previewId === node.id ? (
              <PlanningPlayback media={media} projectId={project.id} />
            ) : (
              <button
                className="planning-poster"
                aria-label={`Play ${node.title}`}
                onClick={() => setPreviewId(node.id)}
              >
                <img loading="lazy" src={media.thumbnail} alt="" />
                <Play size={24} />
              </button>
            )}
          </div>
        )}
        {job && (
          <span className="planning-job" role="status">
            <LoaderCircle size={12} />
            {jobProgress(job).label}
          </span>
        )}
        {failedAttempt && !job && (
          <button
            className="planning-recovery"
            onClick={(e) => {
              e.stopPropagation();
              onJobs?.();
            }}
          >
            This take needs attention · Review
          </button>
        )}
        <footer>
          <span>
            {tc(node.start)} <span aria-hidden="true">—</span>{" "}
            {tc(node.start + node.duration)}
          </span>
          {clip ? (
            <button
              className="planning-create"
              onClick={(e) => {
                e.stopPropagation();
                openClip(node);
              }}
            >
              <Film size={14} />
              {job ? "Generating…" : media ? "Review take" : "Create clip"}
            </button>
          ) : children.length ? (
            <span>
              {children.length}{" "}
              {children.every(isStructureClip) ? "clips" : "sections"}
            </span>
          ) : (
            <ProviderAction provider="deepseek" feature="clip planning" returnLabel="Back to my story">
            <button
              className="planning-create"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                run(() => workflow.develop([node.id]));
              }}
            >
              <Sparkles size={14} />
              Prepare clips
            </button>
            </ProviderAction>
          )}
        </footer>
      </article>
    );
  }
  return (
    <main className={`planning-studio ${collapsed ? "setup-collapsed" : ""}`}>
      <aside className="planning-setup" aria-label="Setup and planning chat">
        <header>
          <div>
            <span className="planning-eyebrow">YOUR STORY</span>
            <h2>Setup</h2>
          </div>
          <div>
            <button
              title="Media library"
              aria-label="Media library"
              onClick={() => setPanel("library")}
            >
              <Library size={18} />
            </button>
            <button
              title="Activity and versions"
              aria-label="Activity and versions"
              onClick={() => setPanel("history")}
            >
              <History size={18} />
            </button>
            <button
              title="Collapse setup"
              aria-label="Collapse setup"
              onClick={() => setCollapsed(true)}
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        </header>
        <div className="planning-conversation">
          {(plan.setup?.concept || plan.brief) && (
            <details className="planning-recipe">
              <summary>The idea & direction</summary>
              <p dir="auto">{plan.setup?.concept || plan.brief}</p>
              {plan.setup?.directionBrief && <p>{plan.setup.directionBrief}</p>}
              <small>
                {[plan.setup?.format, plan.setup?.language, plan.setup?.region]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </details>
          )}
          {!!assets.length && (
            <section
              className="planning-references"
              aria-label="Story references"
            >
              <div className="planning-section-label">
                Your references{" "}
                <button
                  onClick={() => setPanel("library")}
                  aria-label="Choose references"
                >
                  <Plus size={15} />
                </button>
              </div>
              {assets.map((a) => (
                <div className="planning-reference" key={a.id}>
                  <button
                    className="reference-avatar"
                    aria-label={`Review ${a.name}`}
                    onClick={() => reviewReference(a)}
                  >
                    {a.media?.kind === "image" ? (
                      <img src={a.media.thumbnail || a.media.url} alt="" />
                    ) : (
                      <ImagePlus size={20} />
                    )}
                  </button>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {a.kind} ·{" "}
                      {a.media
                        ? "Reference ready"
                        : supportsImage(a)
                          ? "Image needed"
                          : "Choose media"}
                    </small>
                  </div>
                  <button
                    className="reference-action"
                    onClick={() => reviewReference(a)}
                  >
                    {a.media ? <Check size={16} /> : <Sparkles size={16} />}
                    <span>
                      {a.media
                        ? "Review"
                        : supportsImage(a)
                          ? "Create"
                          : "Choose"}
                    </span>
                  </button>
                </div>
              ))}
            </section>
          )}
          {!messages.length && (
            <div className="planning-welcome">
              <Sparkles size={23} />
              <h3>
                {plan.beats.length
                  ? "Keep shaping your story."
                  : "Start with a small idea."}
              </h3>
              <p>
                {plan.beats.length
                  ? "Your scenes and Editor work are here. Tell me what you want to change."
                  : "Tell me what you imagine. We’ll find the characters, shape the scenes, then make one clip at a time."}
              </p>
            </div>
          )}
          <div
            className="planning-messages"
            role="log"
            aria-label="Planning conversation"
          >
            {messages.map((m) => (
              <div key={m.id} className={`planning-message ${m.role}`}>
                <small>{m.role === "user" ? "You" : "Splece"}</small>
                <p dir="auto">{m.text}</p>
              </div>
            ))}
          </div>
          {busy && (
            <div className="planning-thinking" role="status">
              <LoaderCircle size={15} />
              Shaping your plan…
            </div>
          )}
          {!!failed.length && (
            <button
              className="planning-recovery"
              onClick={() => setPanel("history")}
            >
              Some changes need attention · Review activity
            </button>
          )}
          {(error || workflow.error) && (
            <p role="alert" className="error">
              {error || workflow.error}
            </p>
          )}
          <div ref={chatEnd} />
        </div>
        <form className="planning-chat-input" onSubmit={send}>
          {focus && (
            <div className="planning-focus">
              Talking about <strong>{focus.title}</strong>
              <button
                type="button"
                aria-label="Talk about the whole story"
                onClick={() => setSelected(null)}
              >
                <X size={13} />
              </button>
            </div>
          )}
          {!!session?.suggestions?.length && !busy && (
            <div className="planning-suggestions">
              {session.suggestions.map((s) => (
                <button key={s} type="button" onClick={() => useSuggestion(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            dir="auto"
            aria-label="Message your planning assistant"
            aria-invalid={text.length > PLANNING_MESSAGE_LIMIT || undefined}
            aria-describedby={text.length > PLANNING_MESSAGE_LIMIT ? "planning-message-length" : undefined}
            placeholder={
              focus
                ? `What should change in ${focus.title}?`
                : "Describe your story, or ask for an idea…"
            }
            disabled={sending}
            value={text}
            onChange={(e) => {
              const value = e.target.value;
              setText(value);
              update((p) => {
                p.planningSessions ??= {};
                const session = (p.planningSessions[p.episodeId] ??= {
                  messages: [],
                });
                session.draft = value;
              }, false);
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
          />
          {text.length > PLANNING_MESSAGE_LIMIT && (
            <p id="planning-message-length" className="error" role="alert">
              Keep this message under 20,000 characters. Your full draft is still here—send it in parts.
            </p>
          )}
          <div>
            <button
              type="button"
              aria-label="Add a reference"
              title="Add a reference"
              onClick={() => setPanel("library")}
            >
              <Plus size={19} />
            </button>
            <small>
              {busy
                ? workflow.jobs.some(j => j.state === "running" && j.progress?.phase === "format-repair")
                  ? "Checking the response format…"
                  : "Changes are saved as they arrive"
                : text.length > PLANNING_MESSAGE_LIMIT * .8
                  ? `${text.length.toLocaleString()} / ${PLANNING_MESSAGE_LIMIT.toLocaleString()}`
                  : "Plan here. Generate when you’re ready."}
            </small>
            {workflow.needsConnection ? <ConnectProviderButton provider="deepseek" feature="story planning" returnLabel="Back to my story" /> : <button
              className="planning-send"
              type="submit"
              aria-label="Send message"
              disabled={!text.trim() || busy}
            >
              {busy ? <LoaderCircle size={19} /> : <ArrowUp size={19} />}
            </button>}
          </div>
        </form>
      </aside>
      <section
        className="planning-board-area"
        aria-label="Scene planning board"
      >
        <header className="planning-board-heading">
          <div>
            {collapsed && (
              <button
                aria-label="Open setup and chat"
                onClick={() => setCollapsed(false)}
              >
                <MessageCircle size={18} />
                <ChevronRight size={15} />
              </button>
            )}
            <span className="planning-eyebrow">
              {composer ? "CLIP STUDIO" : "YOUR OUTLINE"}
            </span>
            <h2>
              {composer
                ? focus?.title || "Create clip"
                : plan.title || "A story taking shape"}
            </h2>
          </div>
          <div>
            {!composer && (
              <>
                <button
                  aria-label="Zoom out"
                  disabled={zoom <= 0.75}
                  onClick={() => setZoom((z) => Math.max(0.75, z - 0.1))}
                >
                  <Minus size={16} />
                </button>
                <button
                  aria-label="Zoom in"
                  disabled={zoom >= 1.5}
                  onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
                >
                  <Plus size={16} />
                </button>
                <button onClick={addScene}>
                  <Plus size={16} />
                  Scene
                </button>
              </>
            )}
          </div>
        </header>
        {composer ? (
          <div className="planning-clip-composer">{composer}</div>
        ) : (
          <div
            className="planning-board"
            ref={board}
            style={{ "--card-width": `${330 * zoom}px` }}
            onPointerDown={(e) => {
              if (
                e.target.closest("button,article,input,textarea") ||
                e.button !== 0
              )
                return;
              pan.current = { x: e.clientX, left: board.current.scrollLeft };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (pan.current)
                board.current.scrollLeft =
                  pan.current.left + pan.current.x - e.clientX;
            }}
            onPointerUp={() => (pan.current = null)}
            onPointerCancel={() => (pan.current = null)}
          >
            {!columns.length ? (
              <div className="planning-empty">
                <div className="planning-ghosts">
                  <span />
                  <span />
                  <span />
                </div>
                <h3>Your scenes will take shape here.</h3>
                <p>
                  Start the conversation on the left.
                  <br />
                  Your first scene will arrive with clips ready to shape.
                </p>
                <button onClick={() => input.current?.focus()}>
                  <ArrowLeft size={16} />
                  Write your idea
                </button>
              </div>
            ) : (
              <div className="planning-columns">
                {columns.map((column, i) => (
                  <section
                    className="planning-column"
                    key={column.root.id}
                    aria-label={column.root.title}
                  >
                    <div className="planning-ruler">
                      <span>{tc(column.root.start)}</span>
                      <small>{i + 1}</small>
                      <span>
                        {tc(column.root.start + column.root.duration)}
                      </span>
                    </div>
                    {column.nodes.map((node, j) => card(node, j === 0))}
                  </section>
                ))}
                <button
                  className="planning-add-scene"
                  onClick={addScene}
                  aria-label="Add a scene"
                >
                  <Plus size={24} />
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      {panel === "history" && (
        <Modal title="Activity & versions" wide onClose={() => setPanel(null)}>
          <StructureWorkflowHistory
            workflow={workflow}
            project={project}
            plan={plan}
            onClose={() => setPanel(null)}
          />
        </Modal>
      )}
      {panel === "library" && (
        <Modal
          title="Choose story references"
          wide
          onClose={() => setPanel(null)}
        >
          <ReferenceDrawer
            project={project}
            onProjectAttach={attach}
            onAssets={(id) => {
              setPanel(null);
              onAssets(id);
            }}
            busy={busy}
            onSuggest={() => {
              setPanel(null);
              useSuggestion(
                "Suggest the characters and places this story needs.",
              );
            }}
            onScope={(id, only) =>
              update((p) => {
                const a = p.assets.find((a) => a.id === id);
                if (a) setAssetProjectOnly(a, only);
              })
            }
          />
        </Modal>
      )}
      {imageAsset && (
        <Modal title={imageAsset.name} wide onClose={() => setPanel(null)}>
          <Suspense fallback={<p role="status">Opening image studio…</p>}>
            <AssetGenerator
              key={imageAsset.id}
              asset={imageAsset}
              project={project}
              embedded
              onStarted={flush}
              change={(next) => {
                update((p) => {
                  const i = p.assets.findIndex((a) => a.id === next.id);
                  if (i >= 0)
                    p.assets[i] = {
                      ...next,
                      referenceStatus: next.media
                        ? "approved"
                        : next.referenceStatus,
                    };
                });
                setPanel(null);
              }}
            />
          </Suspense>
          <button
            onClick={() => {
              setPanel(null);
              onAssets(imageAsset.id);
            }}
          >
            Choose from the library
          </button>
        </Modal>
      )}
    </main>
  );
}
