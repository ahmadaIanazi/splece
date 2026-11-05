import React, { useRef, useState } from "react";
import { FolderPlus, LoaderCircle } from "lucide-react";
import { api } from "./state";

// One destination action for local effects and provider results. Retries open the
// same independently owned project; navigation happens only after it is saved.
export function OpenResultProject({
  projectId,
  resultId,
  kind = "reels",
  flush,
  onOpenProject,
  primary = false,
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  return (
    <div className="result-project-action">
      <button
        className={primary ? "primary" : ""}
        disabled={busy}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            await flush?.();
            const result = await api(
              `/projects/${projectId}/${kind}/${resultId}/project`,
              {},
            );
            await onOpenProject(result.project.id);
          } catch (e) {
            setError(e.message);
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <FolderPlus size={14} />
        )}{" "}
        {busy ? "Opening your new project…" : "Open as new project"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
