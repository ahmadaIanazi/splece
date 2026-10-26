// Prepare a signed Windows update channel locally. This does not publish it.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validatedRelease} from './windows-updater.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/release/stage-windows-beta.mjs windows-beta-directory new-output-directory');
const feed=JSON.parse(await fs.readFile(path.join(input,'releases.win.json')));
const assets=feed.Assets.filter(a=>a.PackageId==='SpleceDesktop'&&a.Type==='Full');
if(assets.length!==1)throw Error('Expected exactly one full release package.');
const asset=assets[0];
if(!/^SpleceDesktop-[\w.-]+-full\.nupkg$/.test(asset.FileName))throw Error('Invalid package filename.');
const archive=await fs.readFile(path.join(input,asset.FileName));
if(archive.length!==asset.Size||createHash('sha256').update(archive).digest('hex').toUpperCase()!==asset.SHA256.toUpperCase())throw Error('Windows package checksum mismatch.');
const bytes=Buffer.from(JSON.stringify({schema:1,platform:'windows-x64',version:asset.Version,asset})+'\n');
const config=JSON.parse(await fs.readFile(new URL('../../packaging/updates.json',import.meta.url)));
await fs.mkdir(output); // Refuse to overwrite a staged release.
const metadata=path.join(output,'latest.json');await fs.writeFile(metadata,bytes);
const signer=process.env.SPARKLE_SIGN_UPDATE||'/tmp/splece-sparkle-sdk/bin/sign_update';
const signature=execFileSync(signer,['--account','app.splece.studio.updates','-p',metadata],{encoding:'utf8'}).trim();
validatedRelease(bytes,signature,config.publicKey,'0.0.0');
await fs.writeFile(path.join(output,'latest.json.sig'),signature+'\n');
await fs.copyFile(path.join(input,asset.FileName),path.join(output,asset.FileName));
console.log(`Prepared verified Windows update metadata for ${asset.Version}. Nothing published.`);
