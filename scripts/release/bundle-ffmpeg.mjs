import fs from 'node:fs/promises';
import path from 'node:path';
export async function bundleFFmpeg(root,studio,platform=process.platform){
 const target=path.join(studio,'vendor/ffmpeg');await fs.mkdir(target,{recursive:true});
 const binary=platform==='win32'?'ffmpeg.exe':'ffmpeg';
 await fs.copyFile(path.join(root,'node_modules/ffmpeg-static',binary),path.join(target,binary));
 for(const extension of ['LICENSE','README'])await fs.copyFile(path.join(root,'node_modules/ffmpeg-static',binary+'.'+extension),path.join(target,'ffmpeg.'+extension));
 if(platform!=='win32')await fs.chmod(path.join(target,binary),0o755);
}
