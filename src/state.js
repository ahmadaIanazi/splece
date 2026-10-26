import { setBrowserPreference, saveUndoCache } from "../shared/local-draft.mjs";
import { suppressUndoneStructureJobs } from "../shared/structure-workflow.mjs";
import { markAssistantManualEdits, syncAssistantInheritance, suppressUndoneAssistance } from "../shared/composer-assistant.mjs";
import { followSoundtrackEdits } from "../shared/soundtrack.mjs";
import { shotDefaults } from "../shared/shot-direction.mjs";
import { numberNewClips } from "../shared/editor-polish.mjs";
import { markSettingsOverrides } from "../shared/settings-defaults.mjs";
import { syncEditedDraftTimes } from "../shared/timeline-navigation.mjs";
import {
  upgradeProject,
  restoreDraftsWithoutOverwrite,
} from "../shared/studio.mjs";
import { useRef, useState, useEffect, useCallback } from "react";
export const uid = () => crypto.randomUUID();
export const tc = (n = 0) => {
  n = Math.max(0, n);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.floor(n % 60)).padStart(2, "0")}.${String(Math.floor((n % 1) * 10 + 1e-6)).slice(0, 1)}`;
};
export const defaultAutomation = {
  specs: true,
  characters: true,
  background: true,
  remarks: true,
  frames: true,
  camera: true,
  dialogue: true,
};
export const makeDraft = (start = 0) => ({
  id: uid(),
  name: "Untitled clip",
  start,
  targetId: null,
  settings: {
    model: "demo-cinema",
    duration: 5,
    resolution: "480p",
    aspect: "16:9",
  },
  general: "",
  notes: "",
  referenceIds: [],
  automation: {},
  scenes: [
    {
      id: uid(),
      text: "",
      ...shotDefaults,
      dialogue: [],
    },
  ],
  closed: false,
});
export async function api(url, body, method, { timeoutMs = 120000, signal } = {}) {
  let r = await fetch("/api" + url, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (r.status === 401) {
    await fetch("/api/session");
    r = await fetch("/api" + url, {
      method: method || (body ? "POST" : "GET"),
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  }
  const result = await r.json();
  if (!r.ok) {
    const e = new Error(result.error || "Request failed");
    e.status = r.status;
    throw e;
  }
  return result;
}
export function useProject() {
  const [project, setProject] = useState(null),
    [status, setStatus] = useState("saved"),
    [conflict, setConflict] = useState(null);
  const current = useRef(null),
    revision = useRef(0),
    version = useRef(0),
    saved = useRef(0),
    inflight = useRef(null),
    timer = useRef(null),
    history = useRef([]),
    future = useRef([]),
    conflicted = useRef(false),
    backupWarned = useRef(false);
  const journal = () => {
    try {
      localStorage.setItem(
        "frame-journal-" + current.current.id,
        JSON.stringify({
          schemaVersion: 1,
          project: current.current,
          baseRevision: revision.current,
        }),
      );
    } catch {
      if (!backupWarned.current) {
        backupWarned.current = true;
        setStatus("Browser backup full — saving to disk");
      }
    }
  };
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (conflicted.current)
      throw new Error("Resolve the project conflict before saving");
    if (inflight.current) {
      await inflight.current;
      if (saved.current < version.current) return flush();
      return revision.current;
    }
    if (!current.current || saved.current === version.current)
      return revision.current;
    const sentVersion = version.current,
      p = current.current,
      rev = revision.current;
    setStatus("saving");
    const promise = api(
      "/projects/" + p.id,
      { project: p, revision: rev },
      "PUT",
    )
      .then((result) => {
        revision.current = result.revision;
        saved.current = sentVersion;
        if (saved.current === version.current) {
          localStorage.removeItem("frame-journal-" + p.id);
          setStatus(
            result.backupError
              ? "Saved to disk · folder backup needs retry"
              : result.libraryError
                ? "Saved locally · shared library needs retry"
                : "saved",
          );
        } else {
          journal();
          setStatus("saving");
        }
      })
      .catch((e) => {
        if (e.status === 409) {
          conflicted.current = true;
          setConflict(e.message);
        }
        setStatus("unsaved");
        throw e;
      })
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = promise;
    await promise;
    if (saved.current < version.current) return flush();
    return revision.current;
  }, []);
  const load = async (id) => {
    if (current.current && !conflicted.current) await flush();
    const result = await api("/projects/" + id);
    let p = upgradeProject(result.project);
    revision.current = result.revision;
    version.current = 0;
    saved.current = 0;
    try {
      const savedHistory = JSON.parse(
        localStorage.getItem("frame-undo-" + id) || "{}",
      );
      history.current = Array.isArray(savedHistory.past) ? savedHistory.past : [];
      future.current = Array.isArray(savedHistory.future) ? savedHistory.future : [];
      // Compact legacy oversized caches when their project is opened.
      if (history.current.length || future.current.length)
        saveUndoCache(localStorage, "frame-undo-" + id, history.current, future.current);
    } catch {
      history.current = [];
      future.current = [];
    }
    conflicted.current = false;
    setConflict(null);
    const local = localStorage.getItem("frame-journal-" + id);
    if (local) {
      try {
        const j = JSON.parse(local);
        p = upgradeProject(j.project);
        version.current = 1;
        if (j.baseRevision !== result.revision) {
          conflicted.current = true;
          setConflict(
            "A newer disk revision exists. Your browser draft is preserved. Download it or reload the disk version.",
          );
        }
      } catch {}
    }
    current.current = p;
    setProject(p);
    setStatus(local ? "unsaved" : "saved");
    setBrowserPreference("frame-last-project", id);
    if (local && !conflicted.current)
      timer.current = setTimeout(() => flush().catch(() => {}), 500);
  };
  const update = useCallback(
    (fn, record = true, preserveInheritance = false, source = "manual") => {
      if (!current.current) return;
      const prev = current.current,
        next = structuredClone(prev);
      fn(next);
      if (record && source === "manual") markAssistantManualEdits(prev, next);
      syncAssistantInheritance(next);
      if (record) followSoundtrackEdits(prev, next);
      numberNewClips(prev, next);
      if (record && !preserveInheritance)
        markSettingsOverrides(prev.settings, next.settings);
      if (record) {
        history.current.push(prev);
        if (history.current.length > 80) history.current.shift();
        future.current = [];
      }
      next.editedAt = new Date().toISOString();
      upgradeProject(next);
      const editShape = (p) =>
        JSON.stringify([
          p.episodeId,
          p.clips.map((c) => [c.id, c.start, c.duration, c.storyBeatId]),
        ]);
      if (editShape(prev) !== editShape(next)) syncEditedDraftTimes(next);
      try {
        saveUndoCache(localStorage, "frame-undo-" + next.id, history.current, future.current);
      } catch {}
      current.current = next;
      version.current++;
      journal();
      setProject(next);
      setStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush().catch(() => {}), 350);
    },
    [flush],
  );
  const undo = () => {
    if (!history.current.length) return;
    const p = structuredClone(history.current.pop());
    suppressUndoneAssistance(current.current, p);
    suppressUndoneStructureJobs(current.current, p);
    future.current.push(current.current);
    update((n) => {
      Object.keys(n).forEach((k) => delete n[k]);
      Object.assign(n, p);
    }, false);
    return p.editedAt || p.createdAt;
  };
  const redo = () => {
    if (!future.current.length) return;
    const p = future.current.pop();
    history.current.push(current.current);
    update((n) => {
      Object.keys(n).forEach((k) => delete n[k]);
      Object.assign(n, p);
    }, false);
    return p.editedAt || p.createdAt;
  };
  useEffect(() => {
    const retry = setInterval(() => {
      if (
        !conflicted.current &&
        current.current &&
        saved.current < version.current
      )
        flush().catch(() => {});
    }, 5000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onUnload = (e) => {
      if (saved.current < version.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(retry);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flush]);
  return {
    project,
    forget: (id) => {
      for (const key of ["frame-journal-", "frame-undo-", "frame-asset-edit-"])
        localStorage.removeItem(key + id);
      if (localStorage.getItem("frame-last-project") === id)
        localStorage.removeItem("frame-last-project");
      if (current.current?.id === id) {
        clearTimeout(timer.current);
        current.current = null;
        history.current = [];
        future.current = [];
        saved.current = version.current;
        setProject(null);
        setConflict(null);
        conflicted.current = false;
      }
    },
    update,
    load,
    flush,
    status,
    conflict,
    undo,
    redo,
    canUndo: history.current.length > 0,
    canRedo: future.current.length > 0,
    revision: () => revision.current,
    mergeConflict: async () => {
      const recovered = structuredClone(current.current);
      const disk = await api("/projects/" + recovered.id);
      revision.current = disk.revision;
      conflicted.current = false;
      setConflict(null);
      update((n) =>
        Object.assign(
          n,
          restoreDraftsWithoutOverwrite(
            upgradeProject(disk.project),
            recovered,
          ),
        ),
      );
      return flush();
    },
    reload: async () => {
      localStorage.removeItem("frame-journal-" + current.current.id);
      conflicted.current = false;
      saved.current = version.current;
      await load(current.current.id);
    },
  };
}
export { compilePrompt as compile } from "../server/domain.mjs";
