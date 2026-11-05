import path from 'node:path';
import { readJSON, writeJSON } from './connections.mjs';

// This gate is separate from feature preferences. Pausing never overwrites them.
// Existing installations retain their previous routing until explicitly paused.
export async function studioOnline(data) {
  return (await readJSON(path.join(data, 'studio-online.json'))).online !== false;
}
export async function saveStudioOnline(data, online) {
  if (typeof online !== 'boolean') throw Error('Choose whether connections are online.');
  await writeJSON(path.join(data, 'studio-online.json'), { online });
  return { online };
}
