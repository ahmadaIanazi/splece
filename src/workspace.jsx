import { shortcutHint } from "../shared/editor-shortcuts.mjs";
import { BillingHeader } from "./billing";
import React, { useState } from "react";
import {
  Settings,
  Undo2,
  Redo2,
  Check,
  LoaderCircle,
  CircleAlert,
  Layers,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

// A stored preference wins over the initial layout suggestion. Panels remain
// mounted when hidden, so locally edited form fields are never discarded.
export function usePanelPreference(key, compactBelow = 0) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return saved === "true";
    } catch {
      /* Storage can be unavailable in private browser sessions. */
    }
    return window.innerWidth < compactBelow;
  });
  const change = (value) => {
    setCollapsed(value);
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* Keep the in-memory preference. */
    }
  };
  return [collapsed, change];
}

export function PanelHeading({ title, collapsed, onToggle, side = "left" }) {
  const Icon =
    side === "right"
      ? collapsed
        ? PanelRightOpen
        : PanelRightClose
      : collapsed
        ? PanelLeftOpen
        : PanelLeftClose;
  const label = `${collapsed ? "Expand" : "Collapse"} ${title.toLowerCase()}`;
  return (
    <div className="panel-heading">
      {!collapsed && <h2>{title}</h2>}
      <button
        className="icon"
        onClick={onToggle}
        title={label}
        aria-label={label}
        aria-expanded={!collapsed}
      >
        <Icon size={18} />
      </button>
    </div>
  );
}

export function WorkspaceHeader({
  assistantControl,
  project,
  onHome,
  status,
  onTool,
  jobCount,
  billing,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  revisionFlash,
}) {
  const SaveIcon =
    status === "saved"
      ? Check
      : status === "saving"
        ? LoaderCircle
        : CircleAlert;
  const saveText =
    status === "saved"
      ? "Saved locally"
      : status === "saving"
        ? "Saving…"
        : "Not saved · retrying";
  return (
    <header className="workspace-header sculpted-header">
      <div className="header-project">
        <button
          className="home-control icon"
          title="Splece · Home"
          aria-label="Home · all projects"
          onClick={onHome}
        >
          <img src="/splece.svg" width="28" height="28" alt="" />
        </button>
        <strong title={project.name}>{project.name}</strong>
        <span
          className={`workspace-save ${status}`}
          title={saveText}
          aria-label={saveText}
        >
          <SaveIcon size={12} />
        </span>
        <div className="header-revisions">
          <button
            className="icon"
            aria-label={`Undo (${shortcutHint("Z", false, navigator.platform)})`}
            title={`Undo (${shortcutHint("Z", false, navigator.platform)})`}
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon"
            aria-label={`Redo (${shortcutHint("Z", true, navigator.platform)})`}
            title={`Redo (${shortcutHint("Z", true, navigator.platform)})`}
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 size={16} />
          </button>
          {revisionFlash && (
            <span
              key={revisionFlash.id}
              className="revision-flash"
              role="status"
            >
              {revisionFlash.text}
            </span>
          )}
        </div>
      </div>
      <div className="workspace-utilities">
        <BillingHeader
          billing={billing}
          onOpen={() => onTool("costs")}
          onConnections={() => onTool("connections")}
        />
        {assistantControl}
        <button
          className="icon queue-control"
          title={`Jobs & exports · ${jobCount} active`}
          aria-label={`Jobs & exports · ${jobCount} active`}
          onClick={() => onTool("jobs")}
        >
          <Layers size={17} />
          {jobCount > 0 && <span>{jobCount}</span>}
        </button>
        <button
          className="icon"
          title="Project settings"
          aria-label="Project settings"
          onClick={() => onTool("settings")}
        >
          <Settings size={17} />
        </button>
        <button
            className="export"
            aria-label="Export video"
            onClick={() => onTool("export")}
          >
            <Download size={15} />
            <span>Export</span>
        </button>
      </div>
    </header>
  );
}
