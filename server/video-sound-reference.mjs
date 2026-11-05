import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { probe, run } from './media.mjs';
import { validSoundSource } from '../shared/video-sound-continuity.mjs';

// A short PCM sample is small enough for fal's documented base64 file input.
// Extraction stays local, including in Test mode; no separate upload/provider job.
export async function prepareSoundReference(store, project, source) {
  if (!validSoundSource(source)) throw Error('Invalid sound continuity sample.');
  const clip = project.clips?.find(c => c.id === source.clipId);
  const take = clip?.takes?.find(t => t.id === source.takeId);
  const media = store.media(source.takeId);
  if (!take?.jobId || !media?.jobId || media.projectId !== project.id || media.kind !== 'video' || media.jobId !== take.jobId)
    throw Error('The generated sound source is missing from this project.');
  const input = media.original || media.path;
  const info = await probe(input);
  if (!info.audio) throw Error('The previous generated video has no audio stream.');
  if (source.start + source.duration > info.duration + 0.05) throw Error('The sound sample extends past the source video.');
  const folder = path.join(project.folder,'references');
  await fs.mkdir(folder,{recursive:true});
  const file = path.join(folder,`sound-${randomUUID()}.wav`);
  try {
    await run(['-ss',String(source.start),'-i',input,'-t',String(source.duration),'-map','0:a:0','-vn','-ac','2','-ar','24000','-c:a','pcm_s16le',file]);
    const extracted = await probe(file);
    if (!extracted.audio || extracted.duration < source.duration - 0.1 || extracted.duration > 15.01)
      throw Error('The previous clip did not contain audio for the full sample.');
    const bytes = await fs.readFile(file);
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw Error('Sound reference exceeds the local sample limit.');
    return {url:`data:audio/wav;base64,${bytes.toString('base64')}`,binding:{...source,tag:'Audio 1',duration:extracted.duration,file:path.relative(project.folder,file)}};
  } catch (error) {
    await fs.rm(file,{force:true});
    throw error;
  }
}
