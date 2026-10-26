import React, { useState } from "react";
import {
  ArrowLeft,
  CopyPlus,
  SlidersHorizontal,
  ChevronRight,
} from "lucide-react";
import {
  promptGroups,
  promptGroupKey,
  promptPath,
} from "../shared/prompt-navigation.mjs";
export function PromptHeading({
  project,
  draft,
  onSelect,
  onVariant,
  onRename,
  onClose,
  onNode,
  tools,
  onContext,
  contextOpen,
}) {
  const [renaming, setRenaming] = useState(false),
    [name, setName] = useState(draft.name);
  const path = promptPath(project, draft),
    group = promptGroups(project).find((g) => g.key === promptGroupKey(draft));
  const commit = () => {
    setRenaming(false);
    const next = name.trim();
    if (next && next !== draft.name) onRename(next);
  };
  return (
    <div className="prompt-heading">
      <button
        className="composer-back"
        title="Close composer"
        aria-label="Close composer"
        onClick={onClose}
      >
        <ArrowLeft size={16} />
      </button>
      <div className="prompt-heading-text">
        <small className="composer-context">
          {path.slice(0, -1).map((n, i) => (
            <React.Fragment key={n.id}>
              {i > 0 && <ChevronRight size={10} />}
              <button
                title={"Open group: " + n.title}
                onClick={() => onNode?.(n)}
              >
                {n.title}
              </button>
            </React.Fragment>
          ))}
          {!path.length && "From scratch"}
        </small>
        {renaming ? (
          <input
            className="composer-name-input"
            aria-label="Prompt title"
            autoFocus
            value={name}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            title="Rename prompt"
            onClick={() => {
              setName(draft.name);
              setRenaming(true);
            }}
          >
            {draft.name}
          </button>
        )}
        {group?.drafts.length > 1 && (
          <select
            className="composer-variation-select"
            aria-label="Prompt variation"
            value={draft.id}
            onChange={(e) =>
              onSelect(group.drafts.find((d) => d.id === e.target.value))
            }
          >
            {group.drafts.map((d, i) => (
              <option key={d.id} value={d.id}>
                V{i + 1}
                {d.closed ? " · closed" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="prompt-heading-actions">
        {tools}
        <button
          title="Fine-tune prompt injections"
          aria-label="Fine-tune prompt injections"
          aria-pressed={contextOpen}
          onClick={onContext}
        >
          <SlidersHorizontal size={16} />
        </button>
        <button
          title="New prompt variation"
          aria-label="New prompt variation"
          onClick={onVariant}
        >
          <CopyPlus size={16} />
        </button>
      </div>
    </div>
  );
}
