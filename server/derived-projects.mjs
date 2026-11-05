import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from './store.mjs';
import { createPortableStore } from './portable.mjs';
import { newProject } from './domain.mjs';
import { upgradeProject } from '../shared/studio.mjs';
import { captionElements } from '../shared/reel-effects.mjs';
import { validateAudio } from './audio.mjs';
import { thumbnail } from './media.mjs';
import { intervalInputs } from './reel-effects.mjs';

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const tables = { reels: 'reel_jobs', effects: 'effect_jobs' };
const stamp = s => `${s.size}:${s.mtimeMs}`;

// Build and checkpoint in isolation, then publish all database rows together.
// No provider calls, source edits, hard links, or shared media ownership.
export function createDerivedProjects({ store, projectsRoot, makeThumbnail = thumbnail, checkpoint = (staging, id) => createPortableStore(staging).checkpoint(id) }) {
  const db = store.db, pending = new Map();
  db.exec('CREATE TABLE IF NOT EXISTS derived_projects(sourceKey TEXT PRIMARY KEY, projectId TEXT NOT NULL)');
  function existing(key) {
    const row = db.prepare('SELECT projectId FROM derived_projects WHERE sourceKey=?').get(key);
    if (!row) return null;
    if (store.removing.has(row.projectId)) throw fail('This result project is being removed.', 409);
    const result = store.get(row.projectId);
    if (!result) throw fail('The previously created result project was removed. Restore it before opening this result again.', 409);
    return result;
  }
  function create(projectId, kind, jobId, options = {}) {
    if (!Object.hasOwn(tables, kind)) return Promise.reject(fail('Unknown result type.'));
    const key = JSON.stringify([projectId, kind, jobId]);
    if (pending.has(key)) return pending.get(key);
    const task = build(projectId, kind, jobId, options, key).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  async function build(projectId, kind, jobId, options, key) {
    const prior = existing(key);
    if (prior) return prior;
    const original = store.get(projectId)?.project;
    if (!original || store.removing.has(projectId)) throw fail('Source project is unavailable.', 404);
    const table = tables[kind];
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw fail('Result not found.', 404);
    const row = db.prepare(`SELECT body FROM ${table} WHERE id=? AND projectId=?`).get(jobId, projectId);
    if (!row) throw fail('Result not found in this project.', 404);
    const job = JSON.parse(row.body);
    if (job.state !== 'ready' || !job.media?.id) throw fail('Finish rendering this result first.', 409);
    if (options.name !== undefined && (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 100)) throw fail('Use a project name of 1–100 characters.');
    const project = upgradeProject(newProject(options.name?.trim() || `${original.name} · ${kind === 'reels' ? 'Reel' : 'Result'}`.slice(0, 100)));
    project.folder = path.join(await fs.realpath(await projectsRoot()), `Result-${project.id}`);
    const staged = openStore(':memory:'), copied = new Map(), checks = [];
    let published = false;
    try {
      await fs.mkdir(path.join(project.folder, 'media'), { recursive: true });
      await fs.mkdir(path.join(project.folder, 'exports'), { recursive: true });
      const root = await fs.realpath(original.folder);
      async function copyFile(file, name) {
        const actual = await fs.realpath(file);
        if (!actual.startsWith(root + path.sep)) throw fail('A result file is outside its source project.');
        const before = await fs.stat(actual);
        const expected = job.files?.find(f => path.resolve(f.path) === actual);
        if (expected && expected.stamp !== stamp(before)) throw fail('An original source changed since this Reel was rendered.', 409);
        if (!before.isFile()) throw fail('A result file is unavailable.');
        const destination = path.join(project.folder, 'media', name + path.extname(actual));
        await fs.copyFile(actual, destination, fs.constants.COPYFILE_EXCL);
        if (stamp(before) !== stamp(await fs.stat(actual))) throw fail('Source media changed while copying. Try again.', 409);
        checks.push({ file: actual, stamp: stamp(before) });
        return destination;
      }
      async function adopt(mediaId) {
        if (copied.has(mediaId)) return copied.get(mediaId);
        const source = store.media(mediaId);
        if (!source || source.projectId !== projectId) throw fail('A required media file does not belong to this project.', 409);
        const id = randomUUID();
        const media = { id, projectId: project.id, kind: source.kind, name: source.name,
          duration: source.duration, width: source.width, height: source.height, audio: source.audio,
          url: `/api/media/${id}`, thumbnail: `/api/media/${id}/thumbnail`,
          provenance: { sourceProjectId: projectId, sourceMediaId: mediaId, resultJobId: jobId } };
        for (const field of ['path', 'original', 'poster']) if (source[field]) {
          const same = ['path', 'original', 'poster'].find(k => k !== field && source[k] === source[field] && media[k]);
          media[field] = same ? media[same] : await copyFile(source[field], `${id}-${field}`);
        }
        if (!media.path) throw fail('A required media file is unavailable.');
        staged.putMedia(media); copied.set(mediaId, media);
        return media;
      }
      const result = await adopt(job.media.id);
      project.assets.push({ id: randomUUID(), kind: result.kind === 'image' ? 'image' : 'footage', name: result.name || 'Finished result', media: result, scope: 'project', tags: ['result'], description: 'Finished result. Original project preserved.' });
      project.derivedFrom = { projectId, jobId, kind, createdAt: new Date().toISOString(), resultMediaId: result.id };
      if (kind === 'reels') {
        if (!job.snapshot || !job.plan?.length || !job.sources?.length) throw fail('This Reel has no saved editable source plan.', 409);
        project.settings.export = { ...project.settings.export, aspect: job.options.recipe === 'reel' ? '9:16' : job.snapshot.settings?.export?.aspect || '16:9', resolution: job.options.resolution, fps: 24 };
        project.derivedFrom.cameraEditing = 'Shots play exactly as rendered. Use Effects → Turn into a Reel → Edit saved framing to reopen the camera plan; audio and captions remain editable on the timeline.';
        project.derivedFrom.recipe = structuredClone(job.options);
        let start = 0;
        for (const [index, shot] of job.plan.entries()) {
          const source = job.sources.find(s => s.id === shot.sourceId);
          if (!source || !Number.isFinite(shot.from) || !Number.isFinite(shot.to) || shot.from < 0 || shot.to > source.duration + .001 || shot.to <= shot.from) throw fail('The saved Reel interval is invalid.');
          const input = intervalInputs(job.snapshot, source, shot.from, shot.to);
          const raw = await adopt(source.mediaId), id = randomUUID(), duration = shot.to - shot.from;
          const media = { id, projectId: project.id, kind: 'video', name: source.name || `Shot ${index + 1}`, duration, audio: true,
            width: result.width, height: result.height, path: await copyFile(path.join(job.folder, `part-${index}.mp4`), id),
            url: `/api/media/${id}`, thumbnail: `/api/media/${id}/thumbnail` };
          media.poster = path.join(project.folder, 'media', `${id}.jpg`);
          await makeThumbnail(media.path, media.poster, Math.min(.2, duration / 2));
          staged.putMedia(media);
          let reframe;
          const baseFile = path.join(job.folder, `base-${index}.mp4`);
          if (await fs.stat(baseFile).then(s => s.isFile()).catch(() => false)) {
            const reframeId = randomUUID();
            reframe = { id: reframeId, projectId: project.id, kind: 'video', name: `${media.name} · unframed`, duration, audio: true,
              path: await copyFile(baseFile, reframeId), url: `/api/media/${reframeId}`, thumbnail: `/api/media/${reframeId}/thumbnail` };
            staged.putMedia(reframe);
            project.assets.push({ id: randomUUID(), kind: 'footage', name: reframe.name, media: reframe, scope: 'project', tags: ['reel-reframe'] });
          }
          project.clips.push({ id: randomUUID(), episodeId: project.episodeId, name: media.name, start, duration, in: 0,
            activeTake: id, takes: [media], mute: true, volume: 1,
            reelSource: { reframeMediaId: reframe?.id, reframeAspect: job.snapshot.settings?.export?.aspect || "16:9", mediaId: raw.id, in: source.in + shot.from, duration, sourceClipId: source.clipId,
              originalVisual: structuredClone(input.clip.visual || {}), shot: structuredClone(shot) } });
          project.assets.push({ id: randomUUID(), kind: 'footage', name: `${media.name} · original`, media: raw, scope: 'project', tags: ['reel-source'] });
          if (raw.audio) project.audioClips.push({ id: randomUUID(), episodeId: project.episodeId, mediaId: raw.id, name: `${media.name} · sound`, role: 'dialogue', sourceDuration: raw.duration, start, in: source.in + shot.from, duration,
            volume: input.clip.volume ?? 1, mute: !!input.clip.mute, fadeIn: input.clip.fadeIn || 0, fadeOut: input.clip.fadeOut || 0, lane: 0 });
          for (const audio of input.audio) {
            if (audio.episodeId && audio.episodeId !== job.snapshot.episodeId) continue;
            const owned = await adopt(audio.mediaId);
            const sound = Object.fromEntries(['name', 'in', 'duration', 'volume', 'mute', 'fadeIn', 'fadeOut', 'envelope', 'sourceDuration'].filter(k => audio[k] !== undefined).map(k => [k, audio[k]]));
            project.audioClips.push({ ...sound, id: randomUUID(), episodeId: project.episodeId, mediaId: owned.id, start: start + audio.start, lane: (audio.lane || 0) + 1 });
          }
          start += duration;
        }
        if (job.options.captions) project.elements = captionElements(job.plan).map(e => ({ ...e, reelCaption: true, id: randomUUID(), episodeId: project.episodeId }));
        project.audioLanes = Math.max(1, ...project.audioClips.map(c => (c.lane || 0) + 1));
      } else {
        project.clips.push({ id: randomUUID(), episodeId: project.episodeId, name: result.name || 'Result', start: 0, in: 0,
          duration: result.duration || 5, activeTake: result.id, takes: [result], volume: 1, mute: false });
        // Keep the original input independently available for comparison or another edit.
        if (job.input?.source?.mediaId) {
          const source = await adopt(job.input.source.mediaId);
          project.assets.push({ id: randomUUID(), kind: source.kind === 'image' ? 'image' : 'footage', name: 'Original source', media: source, scope: 'project' });
        }
        const ratio = result.width / result.height;
        project.settings.export.aspect = Object.entries({ '16:9': 16/9, '9:16': 9/16, '1:1': 1, '4:5': 4/5 }).sort((a,b) => Math.abs(a[1]-ratio)-Math.abs(b[1]-ratio))[0][0];
      }
      validateAudio(project.audioClips, c => staged.media(c.mediaId));
      const revision = staged.save(project, 0);
      await checkpoint(staged, project.id);
      for (const check of checks) if (stamp(await fs.stat(check.file)) !== check.stamp) throw fail('Source media changed while saving. Try again.', 409);
      if (!store.get(projectId) || store.removing.has(projectId)) throw fail('Source project became unavailable.', 409);
      db.exec('BEGIN IMMEDIATE');
      try {
        const winner = existing(key);
        if (winner) { db.exec('ROLLBACK'); return winner; }
        const p = staged.db.prepare('SELECT * FROM projects WHERE id=?').get(project.id);
        db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run(p.id, p.revision, p.body, p.updated);
        db.prepare('INSERT INTO history VALUES(?,?,?,?)').run(p.id, p.revision, p.body, p.updated);
        for (const m of staged.db.prepare('SELECT * FROM media').all()) db.prepare('INSERT INTO media VALUES(?,?,?,?)').run(m.id, m.projectId, m.path, m.body);
        db.prepare('INSERT INTO derived_projects VALUES(?,?)').run(key, project.id);
        db.exec('COMMIT'); published = true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { project, revision };
    } finally {
      staged.db.close();
      if (!published) await fs.rm(project.folder, { recursive: true, force: true });
    }
  }
  return { create };
}
export function installDerivedProjectRoutes(app, service) {
  for (const kind of Object.keys(tables)) app.post(`/api/projects/:id/${kind}/:job/project`, async (req, res) => {
    res.json(await service.create(req.params.id, kind, req.params.job, req.body || {}));
  });
}
