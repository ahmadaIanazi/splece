// This browser journal is only a recovery hint. The project is saved before
// submission and accepted jobs are tracked by the durable server queue.
export function createSubmissionJournal(
  getStorage = () => globalThis.localStorage,
) {
  const fallback = new Map();
  const key = (projectId) => "frame-submissions-" + projectId;
  return {
    read(projectId) {
      if (fallback.has(projectId)) return fallback.get(projectId);
      try {
        const value = JSON.parse(getStorage().getItem(key(projectId)) || "[]");
        return Array.isArray(value)
          ? value.filter((intent) => typeof intent?.requestId === "string")
          : [];
      } catch {
        return [];
      }
    },
    write(projectId, intents) {
      // Keep the latest state in memory if storage is full or unavailable,
      // including an empty list so stale browser entries cannot reappear.
      fallback.set(projectId, intents);
      try {
        const storage = getStorage();
        if (intents.length)
          storage.setItem(key(projectId), JSON.stringify(intents));
        else storage.removeItem(key(projectId));
        fallback.delete(projectId);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export const submissionJournal = createSubmissionJournal();

export async function submitGenerationIntents({
  projectId,
  intents,
  journal = submissionJournal,
  submit,
  onAccepted,
}) {
  let browserBackup = journal.write(projectId, [
    ...journal.read(projectId),
    ...intents,
  ]);
  for (const intent of intents) {
    // Never retry automatically: a lost response may still mean acceptance.
    const job = await submit(intent);
    onAccepted(job);
    const persisted = journal.write(
      projectId,
      journal.read(projectId).filter((x) => x.requestId !== intent.requestId),
    );
    browserBackup = persisted && browserBackup;
  }
  return { browserBackup };
}
