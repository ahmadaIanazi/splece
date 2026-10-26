// Optional ordered events for the prompt composer. Spoken words remain in the
// existing dialogue array so voice generation and old projects keep working.
export const eventKinds = ["speak", "action", "emote"];
export const eventRelations = ["next", "together", "pause"];
export function composerEvents(scene) {
  const dialogue = (scene.dialogue || []).map((line, i) => ({
    ...line,
    id: line.id || `line-${scene.id || "scene"}-${i}`,
  }));
  const spoken = new Map(dialogue.map((line) => [line.id, line]));
  const used = new Set();
  const events = [];
  for (const record of scene.sequence || []) {
    if (!record?.id || used.has(record.id) || !eventKinds.includes(record.kind))
      continue;
    const line = record.kind === "speak" ? spoken.get(record.id) : record;
    if (!line) continue;
    used.add(record.id);
    events.push({
      ...line,
      ...record,
      text: line.text || "",
      speaker: line.speaker || "",
      relation: eventRelations.includes(record.relation)
        ? record.relation
        : "next",
      pause: Math.min(30, Math.max(0.1, Number(record.pause) || 1)),
    });
  }
  for (const line of dialogue)
    if (!used.has(line.id))
      events.push({ ...line, kind: "speak", relation: "next", pause: 1 });
  if (events.length) events[0] = { ...events[0], relation: "next" };
  return events;
}
export function saveComposerEvents(scene, events) {
  const clean = events.map((event, index) => ({
    ...event,
    relation:
      index && eventRelations.includes(event.relation)
        ? event.relation
        : "next",
    pause: Math.min(30, Math.max(0.1, Number(event.pause) || 1)),
  }));
  scene.sequence = clean.map(({ id, kind, relation, pause, ...content }) =>
    kind === "speak"
      ? { id, kind, relation, pause }
      : {
          id,
          kind,
          relation,
          pause,
          text: content.text || "",
          speaker: content.speaker || "",
          direction: content.direction || "",
        },
  );
  scene.dialogue = clean
    .filter((event) => event.kind === "speak")
    .map(({ kind, relation, pause, ...line }) => line);
}
export function moveComposerEvent(scene, id, targetId, together = false) {
  const events = composerEvents(scene);
  const from = events.findIndex((event) => event.id === id);
  const to = events.findIndex((event) => event.id === targetId);
  if (from < 0 || to < 0 || from === to) return false;
  const [event] = events.splice(from, 1);
  const at = events.findIndex((item) => item.id === targetId);
  events.splice(together ? at + 1 : at, 0, {
    ...event,
    relation: together ? "together" : "next",
  });
  saveComposerEvents(scene, events);
  return true;
}
export function hasComposerWriting(scene) {
  return (
    !!scene.text?.trim() ||
    composerEvents(scene).some((event) => event.text?.trim())
  );
}
export function composerSequenceText(
  scene,
  assets = [],
  includeDialogue = true,
) {
  const events = composerEvents(scene);
  let moment = 0;
  return events
    .map((event, i) => {
      if (!i || event.relation !== "together") moment++;
      if (event.kind === "speak" && !includeDialogue) return "";
      if (!event.text?.trim()) return "";
      const actor =
        assets.find((asset) => asset.id === event.speaker)?.name ||
        (event.speaker
          ? "Unassigned character"
          : event.kind === "speak"
            ? "Unassigned speaker"
            : "The scene");
      const relationship =
        event.relation === "together"
          ? `Together with moment ${moment}`
          : event.relation === "pause"
            ? `After a ${event.pause}s pause, moment ${moment}`
            : `Moment ${moment}`;
      const delivery = [
        event.delivery && event.delivery !== "Auto" ? event.delivery : "",
        event.direction,
      ]
        .filter(Boolean)
        .join("; ");
      return `${relationship} — ${actor} ${event.kind === "speak" ? "says" : event.kind === "emote" ? "feels" : "does"}${delivery ? ` (${delivery})` : ""}: ${event.kind === "speak" ? `“${event.text}”` : event.text}`;
    })
    .filter(Boolean)
    .join("\n");
}
export function composerSequenceControl(
  scene,
  index,
  assets = [],
  includeDialogue = true,
) {
  if (!scene.sequence?.length) return null;
  const events = composerSequenceText(scene, assets, includeDialogue);
  if (!events) return null;
  return `Scene ${index + 1} action control: Preserve this authored event sequence and exact words: ${JSON.stringify(events)}. Next moments follow in order. Together means overlapping activity in the same moment, not a cut; choose natural overlap. Pauses are intentional. Do not invent additional events.`;
}
