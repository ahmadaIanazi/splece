import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectTemplate } from "../shared/project-templates.mjs";
import { beatDraft } from "../shared/authoring.mjs";
import { isStructureClip } from "../shared/structure.mjs";
const sourceMedia = new URL("../public/templates/", import.meta.url);
const bundled = fileURLToPath(
  existsSync(sourceMedia)
    ? sourceMedia
    : new URL("../dist/templates/", import.meta.url),
);
// Only catalog IDs resolve files. Sample media is copied into the portable project.
export async function materializeProjectTemplate(project, input, store) {
  const template = findProjectTemplate(input.templateId);
  if (!template) return;
  if (input.includeSample === true)
    project.folder = await fs.realpath(project.folder);
  const plan = project.storyPlans[project.episodeId];
  const base = structuredClone(project.drafts[0]);
  const seeded = [];
  for (const [index, beat] of plan.beats.filter(isStructureClip).entries()) {
    const draft = beatDraft(project, beat, base);
    draft.settings.aspect = input.aspect || template.aspect;
    const clipId = crypto.randomUUID();
    draft.targetId = draft.generationSlotId = clipId;
    const clip = {
      id: clipId,
      episodeId: project.episodeId,
      storyBeatId: beat.id,
      sourceDraftId: draft.id,
      start: beat.start,
      in: 0,
      duration: beat.duration,
      intent: beat.description,
      takes: [],
      activeTake: null,
      takeEdits: {},
    };
    if (input.includeSample === true) {
      const mediaId = crypto.randomUUID();
      const output = path.join(project.folder, "media", mediaId + ".mp4");
      const poster = path.join(project.folder, "media", mediaId + ".jpg");
      await fs.copyFile(
        path.join(bundled, `${template.id}-${index + 1}.mp4`),
        output,
      );
      await fs.copyFile(path.join(bundled, `${template.id}.jpg`), poster);
      const media = {
        id: mediaId,
        projectId: project.id,
        name: `${beat.title} · sample animatic`,
        path: output,
        poster,
        duration: beat.duration,
        originalDuration: beat.duration,
        audio: false,
        kind: "video",
        url: "/api/media/" + mediaId,
        thumbnail: "/api/media/" + mediaId + "/thumbnail",
        provenance: {
          kind: "bundled-animatic",
          templateId: template.id,
          version: template.version,
        },
      };
      store.putMedia(media);
      clip.takes = [media];
      clip.activeTake = mediaId;
    }
    project.clips.push(clip);
    seeded.push(draft);
  }
  project.drafts = seeded;
  project.activeDraftId = seeded[0].id;
}
