import { useEffect, useRef, useState } from "react";
import { api } from "./state";
import { useProviderConnection, openProviderConnect } from "./provider-connect";
import { storyPlan, validateStory } from "../shared/authoring.mjs";
import {
  applyStructureJob,
  structureVersionList,
  restoreStructureVersion,
  replaceStructureReference,
  undevelopedStructureGroups,
} from "../shared/structure-workflow.mjs";

// App owns result consumption, so collapsing Structure never loses a response.
export function useStructureWorkflow({ project, update, flush, undo }) {
  const { needsConnection } = useProviderConnection("deepseek");
  const connect = () => openProviderConnect({ provider: "deepseek", feature: "story planning", returnLabel: "Back to my story" });
  const latest = useRef({ project, update, flush, undo });
  latest.current = { project, update, flush, undo };
  const [savedJobs, setJobs] = useState([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const pending = useRef(false),
    refreshRef = useRef(async () => {});
  useEffect(() => {
    if (!project?.id) {
      setJobs([]);
      return;
    }
    const projectId = project.id;
    let stopped = false,
      polling = false;
    setJobs([]);
    setError("");
    setMessage("");
    const refresh = async () => {
      if (stopped || polling) return;
      polling = true;
      try {
        const result = await api(`/projects/${projectId}/story-jobs`);
        if (stopped || latest.current.project?.id !== projectId) return;
        setJobs(result);
        const current = latest.current.project;
        const ready = result
          .filter(
            (j) =>
              j.autoApply &&
              j.state === "ready" &&
              j.episodeId === current.episodeId &&
              !current.storyJobReceipts?.[j.id] &&
              !current.appliedStoryJobs?.includes(j.id),
          )
          .sort((a, b) => a.createdAt - b.createdAt);
        if (ready.length) {
          let applied = 0,
            conflicts = 0;
          latest.current.update(
            (p) => {
              if (p.id !== projectId) return;
              for (const job of ready) {
                const r = applyStructureJob(p, job);
                applied += r.applied ? 1 : 0;
                conflicts += r.conflict ? 1 : 0;
              }
            },
            true,
            false,
            "assistant",
          );
          setMessage(
            conflicts
              ? "Some saved results need attention because their sections changed."
              : `${applied} section${applied === 1 ? "" : "s"} added to Structure.`,
          );
          await latest.current.flush();
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      } finally {
        polling = false;
      }
    };
    refreshRef.current = refresh;
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [project?.id, project?.episodeId]);

  async function submit(body) {
    if (needsConnection) {
      connect();
      throw Error("Connect your story assistant, then send when you’re ready. Your writing is kept.");
    }
    if (pending.current)
      throw Error("The previous request is still being saved.");
    pending.current = true;
    setSubmitting(true);
    setError("");
    const { project: p } = latest.current;
    try {
      validateStory({ ...storyPlan(p), characters: [], assets: [] }, p);
      const revision = await latest.current.flush();
      if (latest.current.project?.id !== p.id)
        throw Error("Project changed before submission. Nothing was sent.");
      const result = await api(`/projects/${p.id}/story-jobs`, {
        ...body,
        revision,
        autoApply: true,
        requestId: body.action === "conversation" && body.planningMessageId ? `conversation:${body.planningMessageId}` : crypto.randomUUID(),
      });
      setMessage(
        result.ids?.length === 0
          ? "All selected groups already contain sections or clips."
          : "Developing in the background. You can keep working.",
      );
      await refreshRef.current();
      return result;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }
  async function recover(jobId) {
    const p = latest.current.project;
    await api(`/projects/${p.id}/story-jobs/${jobId}/recover`, {});
    const all = await api(`/projects/${p.id}/story-jobs`);
    const job = all.find((j) => j.id === jobId);
    if (!job) throw Error("Saved development not found.");
    let result;
    latest.current.update(
      (n) => {
        if (n.id !== p.id) return;
        delete n.storyJobReceipts?.[jobId];
        n.appliedStoryJobs = (n.appliedStoryJobs || []).filter(
          (id) => id !== jobId,
        );
        result = applyStructureJob(n, job);
      },
      true,
      false,
      "assistant",
    );
    await latest.current.flush();
    await refreshRef.current();
    if (result?.conflict) throw Error(result.message);
    return result;
  }
  async function restore(id, options = {}) {
    const p = latest.current.project;
    const preview = restoreStructureVersion(structuredClone(p), id, options);
    if (preview.needsConfirmation) return preview;
    latest.current.update((n) => {
      if (n.id === p.id) restoreStructureVersion(n, id, options);
    });
    await latest.current.flush();
    setMessage(
      "Structure version restored. Editor footage and timings are preserved.",
    );
    return preview;
  }
  async function replaceReference(fromId, toId, options = {}) {
    const p = latest.current.project;
    const resolve = async (id) => {
      if (!id.startsWith("shared:"))
        return latest.current.project.assets.find((a) => a.id === id);
      const libraryId = id.slice(7);
      return (
        p.assets.find((a) => a.libraryId === libraryId) ||
        (await api(`/projects/${p.id}/library/adopt`, { libraryId }))
      );
    };
    await latest.current.flush();
    const from = await resolve(fromId),
      to = await resolve(toId);
    if (!from || !to) throw Error("This reference is not available.");
    let result;
    latest.current.update((n) => {
      if (n.id !== p.id)
        throw Error("Project changed. Please choose the replacement again.");
      for (const a of [from, to])
        if (!n.assets.some((x) => x.id === a.id)) n.assets.push(a);
      result = replaceStructureReference(n, from.id, to.id, options);
    });
    await latest.current.flush();
    setMessage(
      `Updated references to ${to.name}. Spoken words and generated takes are unchanged.`,
    );
    return result;
  }
  const jobs = savedJobs
    .filter((j) => j.episodeId === project?.episodeId)
    .map((j) => ({
      ...j,
      application:
        project?.storyJobReceipts?.[j.id] ||
        (project?.appliedStoryJobs?.includes(j.id)
          ? { state: "applied" }
          : undefined),
    }));
  return {
    needsConnection,
    connect,
    jobs,
    error,
    message,
    versions: project ? structureVersionList(project) : [],
    busy:
      submitting || jobs.some((j) => ["queued", "running"].includes(j.state)),
    chat: (planningMessage, planningMessageId, planningFocusId=null) => submit({action:"conversation",planningMessage,planningMessageId,planningFocusId}),
    prepare: (expandId = null, action = null) =>
      submit({
        expandId,
        action: action || (expandId ? "children" : "outline"),
      }),
    develop: async (ids = []) => {
      if (
        !undevelopedStructureGroups(storyPlan(latest.current.project), ids)
          .length
      ) {
        setMessage("These groups already contain sections or clips.");
        return { ids: [] };
      }
      return submit({ bulk: true, scopeIds: ids, action: "children" });
    },
    recover,
    restore,
    replaceReference,
    undo: () => latest.current.undo(),
  };
}
