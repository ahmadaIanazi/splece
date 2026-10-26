import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Workflow,
  Film,
  WandSparkles,
  BookOpen,
  Brain,
  AudioLines,
  Image,
  ArrowRight,
  ArrowLeft,
  X,
  Play,
  Plus,
  Minus,
  LockKeyhole,
  SlidersHorizontal,
  RotateCcw,
  Trash2,
  Check,
  FlaskConical,
  Cable,
  Layers,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  workflows,
  workflowNodes,
  validateWorkflowSettings,
} from "../shared/workflows.mjs";
import { api } from "./state";
import "./workflow-canvas.css";
const flowIcons = {
  video: Film,
  writing: WandSparkles,
  story: BookOpen,
  assistant: Brain,
  sound: AudioLines,
  image: Image,
};
const typeNames = {
  input: "Context",
  local: "Local assembly",
  protected: "App requirement",
  provider: "AI request",
  external: "External tool",
  output: "Saved result",
};
const typeIcons = {
  input: Layers,
  local: SlidersHorizontal,
  protected: LockKeyhole,
  provider: Cable,
  external: Image,
  output: Check,
};
export function WorkflowSettings({
  project,
  settings,
  change,
  scope,
  onNavigate,
  onSave,
  dirty,
  models = [],
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="workflow-entry">
        <Workflow size={32} />
        <h2>See how Splece works</h2>
        <p>
          Follow the path from your idea to a finished take. Inspect the
          instructions, add your own layers and test the assembled result.
        </p>
        <button onClick={() => setOpen(true)}>
          <Workflow size={16} />
          Open Workflow Canvas
          <ArrowRight size={15} />
        </button>
        <small>Local tests · no credits · original writing preserved</small>
      </div>
      {open &&
        createPortal(
          <WorkflowCanvas
            {...{
              project,
              settings,
              change,
              scope,
              onNavigate,
              onSave,
              dirty,
              models,
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
function WorkflowCanvas({
  project,
  settings,
  change,
  scope,
  onNavigate,
  onSave,
  dirty,
  models,
  onClose,
}) {
  const [flowId, setFlow] = useState("video"),
    [selected, setSelected] = useState("references"),
    [zoom, setZoom] = useState(1),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [view, setView] = useState("layer"),
    [sample, setSample] = useState(project.id === "global"),
    [draftId, setDraftId] = useState(
      project.activeDraftId || project.drafts?.[0]?.id || "",
    ),
    [reset, setReset] = useState(false);
  const [sampleText, setSampleText] = useState(
    "A cyclist stops at a quiet garden gate at dawn. Leaves rustle in a soft breeze. One continuous, still shot. No dialogue.",
  );
  const dialog = useRef(null),
    scroller = useRef(null),
    drag = useRef(null),
    request = useRef(0);
  const flow = workflows.find((w) => w.id === flowId);
  const saved = useMemo(
    () => validateWorkflowSettings(settings.workflows),
    [settings.workflows],
  );
  const nodes = useMemo(
    () => workflowNodes(settings, flowId),
    [settings.workflows, flowId],
  );
  const canAdd = (saved.flows[flowId]?.layers?.length || 0) < 12;
  const node = nodes.find((n) => n.id === selected) || nodes[0],
    Icon = typeIcons[node.kind];
  const currentDraft = project.drafts?.find((d) => d.id === draftId);
  const model = models.find((m) => m.id === currentDraft?.settings?.model);
  const sourceSignature = JSON.stringify([
    saved,
    flowId,
    draftId,
    sample,
    sampleText,
    currentDraft,
    project.settings,
    project.assets?.map((a) => [a.id, a.version, a.description]),
    project.clips?.map((c) => [c.id, c.start, c.duration, c.activeTake]),
    project.remarks,
    project.directionRanges,
  ]);
  const stale = !!result && result.sourceSignature !== sourceSignature;
  const trace = result?.nodes.find((n) => n.id === node.id);
  useEffect(() => {
    const previous = document.activeElement,
      root = document.getElementById("root"),
      wasInert = root?.inert;
    if (root) root.inert = true;
    dialog.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const items = [
          ...dialog.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      request.current++;
      document.removeEventListener("keydown", key, true);
      if (root) root.inert = wasInert;
      previous?.focus?.();
    };
  }, []);
  function edit(fn) {
    setError("");
    setReset(false);
    try {
      const next = structuredClone(saved);
      next.flows[flowId] ||= { nodes: {}, layers: [] };
      fn(next.flows[flowId]);
      const validated = validateWorkflowSettings(next);
      change((p) => {
        p.settings.workflows = validated;
      });
    } catch (e) {
      setError(e.message);
    }
  }
  function patch(values) {
    edit((f) => {
      if (node.custom) {
        Object.assign(
          f.layers.find((l) => l.id === node.id),
          values,
        );
      } else
        f.nodes[node.id] = {
          text: node.text,
          enabled: node.enabled,
          ...values,
        };
    });
  }
  function addLayer() {
    const id = "layer-" + crypto.randomUUID();
    const after = node.editable
      ? node.after || node.id
      : flow.nodes.find((n) => n.editable).id;
    edit((f) =>
      f.layers.push({
        id,
        title: "My direction",
        text: "",
        after,
        enabled: true,
      }),
    );
    setSelected(id);
    setView("layer");
  }
  async function testFlow() {
    const ticket = ++request.current,
      signature = sourceSignature;
    setBusy(true);
    setError("");
    try {
      const value = await api("/workflows/preview", {
        projectId: project.id === "global" ? undefined : project.id,
        settings: { ...settings, workflows: saved },
        flowId,
        draftId,
        executionMode: "test",
        ...(sample ? { sample: sampleText } : {}),
        model,
      });
      if (ticket !== request.current) return;
      setResult({ ...value, sourceSignature: signature });
      setView("output");
    } catch (e) {
      if (ticket === request.current) setError(e.message);
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }
  function navigate(tab) {
    onClose();
    onNavigate(tab);
  }
  function chooseFlow(id) {
    request.current++;
    setBusy(false);
    setFlow(id);
    setSelected(
      workflows.find((w) => w.id === id).nodes.find((n) => n.editable).id,
    );
    setReset(false);
    setError("");
    setResult(null);
    setView("layer");
  }
  return (
    <div className="workflow-backdrop">
      <section
        className="workflow-canvas"
        role="dialog"
        aria-modal="true"
        aria-label="Workflow Canvas"
        tabIndex={-1}
        ref={dialog}
        style={{ "--flow-color": flow.color }}
      >
        <header className="workflow-header">
          <button
            className="workflow-icon"
            title="Close Workflow Canvas"
            aria-label="Close Workflow Canvas"
            onClick={onClose}
          >
            <ArrowLeft size={19} />
          </button>
          <Workflow size={21} />
          <div>
            <h1>Workflow Canvas</h1>
            <small>
              {scope === "global" ? "Global defaults" : "This project"} ·{" "}
              {project.name}
            </small>
          </div>
          <span className="workflow-test-badge">
            <FlaskConical size={13} />
            Local preview · $0
          </span>
          {scope === "global" && (
            <button
              disabled={!dirty}
              onClick={async () => {
                try {
                  await onSave();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <Check size={15} />
              {dirty ? "Save defaults" : "Defaults saved"}
            </button>
          )}
          <button
            className="workflow-icon"
            aria-label="Close canvas"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="workflow-layout">
          <nav className="workflow-nav" aria-label="Workflows">
            <small>WORKFLOWS</small>
            {workflows.map((w) => {
              const W = flowIcons[w.id];
              return (
                <button
                  key={w.id}
                  title={w.title}
                  aria-label={w.title}
                  aria-current={flowId === w.id ? "page" : undefined}
                  style={{ "--item-color": w.color }}
                  onClick={() => chooseFlow(w.id)}
                >
                  <W size={18} />
                  <span>{w.title}</span>
                  {saved.flows[w.id] && <i title="Customized" />}
                </button>
              );
            })}
            <p>
              Solid connections assemble context. AI nodes use the app’s
              existing provider connections.
            </p>
          </nav>
          <main className="workflow-main">
            <div className="workflow-flow-heading">
              <div>
                <h2>{flow.title}</h2>
                <p>{flow.description}</p>
              </div>
              <button
                className="workflow-run"
                disabled={busy}
                onClick={testFlow}
              >
                <Play size={15} />
                {busy ? "Inspecting…" : "Preview flow"}
              </button>
            </div>
            <div className="workflow-inputs">
              <label>
                Input
                <select
                  aria-label="Workflow test input"
                  value={sample ? "sample" : draftId}
                  onChange={(e) => {
                    setSample(e.target.value === "sample");
                    if (e.target.value !== "sample") setDraftId(e.target.value);
                  }}
                >
                  {project.drafts?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name || "Untitled clip"}
                    </option>
                  ))}
                  <option value="sample">Try a sample</option>
                </select>
              </label>
              <span>
                Saved project snapshot · test never changes your clips
              </span>
            </div>
            {sample && (
              <textarea
                className="workflow-sample"
                aria-label="Sample writing"
                value={sampleText}
                maxLength={4000}
                onChange={(e) => setSampleText(e.target.value)}
              />
            )}
            <div
              className="workflow-surface"
              ref={scroller}
              onPointerDown={(e) => {
                if (
                  e.button !== 0 ||
                  e.target.closest("button,input,select,textarea")
                )
                  return;
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  left: e.currentTarget.scrollLeft,
                  top: e.currentTarget.scrollTop,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                e.currentTarget.scrollLeft =
                  drag.current.left - e.clientX + drag.current.x;
                e.currentTarget.scrollTop =
                  drag.current.top - e.clientY + drag.current.y;
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <div className="workflow-track" style={{ zoom }}>
                {nodes.map((n, i) => {
                  const N = typeIcons[n.kind],
                    status =
                      !stale && result?.workflowId === flowId
                        ? result.nodes.find((t) => t.id === n.id)?.state
                        : null;
                  return (
                    <React.Fragment key={n.id}>
                      {i > 0 && (
                        <div className="workflow-connection">
                          <span />
                          <ArrowRight size={16} />
                        </div>
                      )}
                      <div className="workflow-node-wrap">
                        <button
                          className={`workflow-node ${node.id === n.id ? "selected" : ""} ${n.enabled === false ? "bypassed" : ""}`}
                          aria-pressed={node.id === n.id}
                          onClick={() => {
                            setSelected(n.id);
                            setReset(false);
                          }}
                        >
                          <span className="workflow-node-type">
                            <N size={16} />
                            {typeNames[n.kind]}
                          </span>
                          <strong>{n.title}</strong>
                          <span>{n.detail}</span>
                          <small>
                            {status === "not-called" ? (
                              "Not called · Offline"
                            ) : status === "bypassed" ? (
                              "Bypassed"
                            ) : status === "inspected" ? (
                              <>
                                <Check size={12} />
                                Inspected
                              </>
                            ) : n.custom ? (
                              "Custom layer"
                            ) : n.editable ? (
                              "Editable guidance"
                            ) : n.kind === "protected" ? (
                              <>
                                <LockKeyhole size={11} />
                                Always enforced
                              </>
                            ) : (
                              "Built in"
                            )}
                          </small>
                        </button>
                        {n.editable && !n.custom && (
                          <button
                            className="workflow-add"
                            disabled={!canAdd}
                            aria-label={"Add layer after " + n.title}
                            title="Add prompt layer"
                            onClick={() => {
                              const id = "layer-" + crypto.randomUUID();
                              edit((f) =>
                                f.layers.push({
                                  id,
                                  title: "My direction",
                                  text: "",
                                  after: n.id,
                                  enabled: true,
                                }),
                              );
                              setSelected(id);
                              setView("layer");
                            }}
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
              <div className="workflow-canvas-caption">
                Drag the canvas to explore · select a step to inspect it
              </div>
            </div>
            <footer className="workflow-canvas-footer">
              <span>
                {result
                  ? stale
                    ? "Changed since test · run again"
                    : `Inspected ${result.nodes.length} steps · no provider calls`
                  : "Built-in requirements stay protected. Your guidance is layered on top."}
              </span>
              <div>
                <button
                  aria-label="Zoom out workflow"
                  onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
                >
                  <Minus size={15} />
                </button>
                <button
                  aria-label="Reset workflow zoom"
                  onClick={() => {
                    setZoom(1);
                    scroller.current?.scrollTo({ left: 0 });
                  }}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  aria-label="Zoom in workflow"
                  onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
                >
                  <Plus size={15} />
                </button>
              </div>
            </footer>
            {error && (
              <div className="workflow-error" role="alert">
                {error}
              </div>
            )}
            {!!result?.warnings?.length && (
              <div className="workflow-error">{result.warnings.join(" ")}</div>
            )}
          </main>
          <aside
            className="workflow-inspector"
            aria-label="Workflow step details"
          >
            <div className="workflow-inspector-heading">
              <Icon size={20} />
              <small>{typeNames[node.kind]}</small>
            </div>
            <h2>{node.title}</h2>
            <p>{node.detail}</p>
            <div className="workflow-inspector-tabs">
              <button
                aria-pressed={view === "layer"}
                onClick={() => setView("layer")}
              >
                Layer
              </button>
              <button
                aria-pressed={view === "output"}
                onClick={() => setView("output")}
              >
                Preview output{result && !stale ? " ✓" : ""}
              </button>
            </div>
            {view === "output" ? (
              <div className="workflow-output">
                {!trace ? (
                  <>
                    <FlaskConical size={24} />
                    <p>
                      Preview the flow to see this step’s assembled text and
                      requirements.
                    </p>
                    <button onClick={testFlow} disabled={busy}>
                      <Play size={14} />
                      Preview flow
                    </button>
                  </>
                ) : (
                  <>
                    {stale && (
                      <p className="workflow-error">
                        This result is out of date. Preview again after your
                        changes.
                      </p>
                    )}
                    <small>
                      {trace.state === "not-called"
                        ? "No AI call made"
                        : "Local inspection"}{" "}
                      · {new Date(result.createdAt).toLocaleTimeString()}
                    </small>
                    <div className="workflow-readable">{trace.output}</div>
                    <p className="workflow-output-note">
                      Preview shows assembly and safeguards. It does not predict
                      what an AI model will generate.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                {node.editable ? (
                  <>
                    <label className="workflow-toggle">
                      <span>Include this guidance</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={node.enabled}
                        onChange={(e) => patch({ enabled: e.target.checked })}
                      />
                    </label>
                    {node.custom && (
                      <>
                        <label className="field">
                          <span>Layer name</span>
                          <input
                            value={node.title}
                            maxLength={80}
                            onChange={(e) => {
                              if (e.target.value.trim())
                                patch({ title: e.target.value });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>Connect after</span>
                          <select
                            value={node.after}
                            onChange={(e) => patch({ after: e.target.value })}
                          >
                            {flow.nodes
                              .filter((n) => n.editable)
                              .map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div className="workflow-reorder">
                          {[-1, 1].map((dir, i) => {
                            const Arrow = i ? ChevronDown : ChevronUp;
                            return (
                              <button
                                key={dir}
                                aria-label={
                                  i ? "Move layer later" : "Move layer earlier"
                                }
                                onClick={() =>
                                  edit((f) => {
                                    const index = f.layers.findIndex(
                                        (l) => l.id === node.id,
                                      ),
                                      other = index + dir;
                                    if (other >= 0 && other < f.layers.length) {
                                      [f.layers[index], f.layers[other]] = [
                                        f.layers[other],
                                        f.layers[index],
                                      ];
                                    }
                                  })
                                }
                              >
                                <Arrow size={14} />
                                {i ? "Later" : "Earlier"}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                    <label className="field">
                      <span>Your additional instructions</span>
                      <textarea
                        rows={7}
                        maxLength={3000}
                        value={node.text}
                        placeholder={
                          flowId === "sound"
                            ? "Describe only the sound you want…"
                            : "For example: favour quiet, observational moments and natural light…"
                        }
                        onChange={(e) => patch({ text: e.target.value })}
                      />
                    </label>
                    <small className="workflow-count">
                      {node.text.length.toLocaleString()} / 3,000
                    </small>
                    <div className="workflow-lock-note">
                      <LockKeyhole size={15} />
                      <span>
                        Original writing, exact dialogue, reference bindings and
                        response requirements remain protected. This switch only
                        bypasses your additional guidance.
                      </span>
                    </div>
                    <button
                      className="workflow-text-button"
                      disabled={!canAdd}
                      onClick={addLayer}
                    >
                      <Plus size={14} />
                      Add another prompt layer
                    </button>
                    {node.custom && (
                      <button
                        className="workflow-text-button"
                        onClick={() => {
                          edit(
                            (f) =>
                              (f.layers = f.layers.filter(
                                (l) => l.id !== node.id,
                              )),
                          );
                          setSelected(node.after);
                        }}
                      >
                        <Trash2 size={14} />
                        Remove this layer
                      </button>
                    )}
                    <button
                      className="workflow-text-button"
                      onClick={() => setReset(!reset)}
                    >
                      <RotateCcw size={14} />
                      Reset {node.custom ? "text" : "this layer"}
                    </button>
                    {reset && (
                      <div className="workflow-reset">
                        <p>
                          Remove your added guidance? Built-in instructions stay
                          in place.
                        </p>
                        <button
                          onClick={() => patch({ text: "", enabled: true })}
                        >
                          Reset guidance
                        </button>
                        <button onClick={() => setReset(false)}>Keep it</button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="workflow-lock-note">
                      <LockKeyhole size={16} />
                      <span>
                        {node.kind === "provider"
                          ? "Provider routing stays with the existing job controls so model compatibility, prices and retries remain accurate."
                          : "This step is managed by the app. It cannot be deleted or disconnected."}
                      </span>
                    </div>
                    {node.kind === "provider" && (
                      <>
                        <p className="workflow-model-label">
                          {flowId === "video"
                            ? model?.name ||
                              currentDraft?.settings?.model ||
                              "Clip’s chosen model"
                            : flowId === "sound"
                              ? "fal.ai · separate sound adapters"
                              : flowId === "assistant"
                                ? "DeepSeek · budgeted assistant"
                                : "Configured text model"}
                        </p>
                        <button
                          onClick={() =>
                            navigate(
                              flowId === "video" ? "video" : "connections",
                            )
                          }
                        >
                          <Cable size={14} />
                          {flowId === "video"
                            ? "Video model defaults"
                            : "Manage connection & models"}
                        </button>
                        <p className="workflow-output-note">
                          {flowId === "video"
                            ? "Defaults apply to new clips. Existing clips keep their explicit model choice."
                            : "Connections are global. Canvas guidance follows the selected project / global scope."}
                        </p>
                      </>
                    )}
                    <button
                      className="workflow-text-button"
                      disabled={!canAdd}
                      onClick={addLayer}
                    >
                      <Plus size={14} />
                      Add a prompt layer
                    </button>
                  </>
                )}
                <details className="workflow-boundaries">
                  <summary>What can I change?</summary>
                  <p>
                    You can add, reorder, bypass or remove creative guidance.
                    Camera, reference and continuity controls still come from
                    the clip and Directions timeline.
                  </p>
                  <p>
                    Additional layers assemble prompts locally. Adding extra AI
                    calls or arbitrary provider endpoints is not enabled here;
                    the displayed AI steps use the app’s existing jobs and
                    spending controls.
                  </p>
                </details>
              </>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
