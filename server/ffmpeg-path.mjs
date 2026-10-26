// Splece invokes FFmpeg as a separate executable; it does not load the GPL npm wrapper.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const binary=process.platform==='win32'?'ffmpeg.exe':'ffmpeg';
const bundled=path.join(root,'vendor/ffmpeg',binary);
export default process.env.FFMPEG_BIN || (fs.existsSync(bundled) ? bundled : path.join(root,'node_modules/ffmpeg-static',binary));
