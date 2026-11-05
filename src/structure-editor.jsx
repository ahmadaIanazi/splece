import React from "react";
import {
  Plus,
  Layers,
  Clapperboard,
  ChevronRight,
  ChevronsUpDown,
  CornerUpLeft,
  ArrowUpRight,
} from "lucide-react";
import { storyPlan } from "../shared/authoring.mjs";
import {
  isStructureClip,
  structureLabel,
  structureColor,
  structurePath,
  createStructureNode,
} from "../shared/structure.mjs";

import "./structure-editor.css";

export function GroupComposer({
  project,
  node,
  update,
  onSelect,
  onStructure,
  collapsed,
  onToggleCollapse,
}) {
  const plan = storyPlan(project),
    path = structurePath(plan.beats, node.id),
    children = plan.beats.filter((n) => n.parentId === node.id);
  const edit = (fn) =>
    update((p) =>
      fn(p.storyPlans[p.episodeId].beats.find((n) => n.id === node.id)),
    );
  function add(type) {
    const child = createStructureNode(plan, type, node.id);
    update((p) => p.storyPlans[p.episodeId].beats.push(child));
    onSelect(child);
  }
  return (
    <div
      className="group-composer"
      style={{ "--story-kind-color": structureColor(plan, node) }}
    >
      <div className="group-composer-heading">
        <div>
          <small>
            {path
              .slice(0, -1)
              .map((n) => n.title)
              .join(" / ") || "Plan"}{" "}
            · {structureLabel(plan, node)}
          </small>
          <h2>
            <Layers size={19} />
            {node.title}
          </h2>
        </div>
        {onToggleCollapse && (
          <button
            title={collapsed ? "Expand on timeline" : "Collapse on timeline"}
            aria-label={
              collapsed
                ? "Expand selected group on timeline"
                : "Collapse selected group on timeline"
            }
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            <ChevronsUpDown size={16} />
          </button>
        )}
        <button
          title="Open in Plan"
          aria-label="Open group in Plan"
          onClick={onStructure}
        >
          <ArrowUpRight size={17} />
        </button>
      </div>
      <div className="group-composer-body">
        <label className="field">
          <span>Name</span>
          <input
            aria-label="Group name"
            value={node.title}
            onChange={(e) => edit((n) => (n.title = e.target.value))}
          />
        </label>
        <label className="field">
          <span>Creative direction</span>
          <textarea
            aria-label="Group creative direction"
            rows={6}
            placeholder="What happens here? Describe the purpose, mood and direction…"
            value={node.description || ""}
            onChange={(e) => edit((n) => (n.description = e.target.value))}
          />
        </label>
        <p className="group-hint">
          Group direction is planning context. Open a clip to choose its exact
          prompt, references and model.
        </p>
        <div className="group-children-heading">
          <span>{children.length} items</span>
          <button onClick={() => add("group")}>
            <Plus size={13} /> Group
          </button>
          <button onClick={() => add("clip")}>
            <Plus size={13} /> Clip
          </button>
        </div>
        <div className="group-children">
          {children.map((child) => {
            const slot = project.clips.find((c) => c.storyBeatId === child.id),
              take = slot?.takes.find((t) => t.id === slot.activeTake),
              Icon = isStructureClip(child) ? Clapperboard : Layers;
            return (
              <button
                key={child.id}
                onClick={() => onSelect(child)}
                style={{ "--story-kind-color": structureColor(plan, child) }}
              >
                <span className="group-child-image">
                  {take?.thumbnail ? (
                    <img src={take.thumbnail} alt="" />
                  ) : (
                    <Icon size={19} />
                  )}
                </span>
                <span>
                  <small>{structureLabel(plan, child)}</small>
                  <b>{child.title}</b>
                  <small>
                    {slot
                      ? "In edit"
                      : isStructureClip(child)
                        ? "Planned clip"
                        : "Open group"}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            );
          })}
        </div>
        {!children.length && (
          <p className="group-hint">
            Add a clip directly, or organize this group into smaller groups.
          </p>
        )}
        {node.parentId && (
          <button
            className="group-back"
            onClick={() =>
              onSelect(plan.beats.find((n) => n.id === node.parentId))
            }
          >
            <CornerUpLeft size={13} /> Parent group
          </button>
        )}
      </div>
    </div>
  );
}
