// Stage an already verified release on a copy of the last published static site.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sparkleSDK,updateConfig,verifyUpdateKey,exec} from './sparkle.mjs';
import {releaseFeed,verifyArchive} from './update-feed.mjs';
const [manifestArg,baseArg,outArg]=process.argv.slice(2);
if(!manifestArg||!baseArg||!outArg) throw Error('Usage: node scripts/release/stage-mac-beta.mjs build.json previous-site output-site [--legacy]');
const manifestPath=path.resolve(manifestArg),base=path.resolve(baseArg),out=path.resolve(outArg),legacy=process.argv.includes('--legacy');
if(await fs.stat(out).catch(()=>null)) throw Error('Output already exists; use a new release directory.');
const manifest=JSON.parse(await fs.readFile(manifestPath));
if(!manifest.signed||!manifest.notarized||!manifest.publishable||manifest.arch!=='arm64') throw Error('Only a fully verified Apple Silicon release can be staged.');
const dmg=path.join(path.dirname(manifestPath),manifest.dmg),bytes=await fs.readFile(dmg);
if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256) throw Error('Release checksum changed after verification.');
const approval=JSON.parse(await fs.readFile(dmg+'.notarization.json'));
if(approval.status!=='Accepted') throw Error('Apple acceptance is required.');
await fs.cp(base,out,{recursive:true});
const folder=legacy?out:path.join(out,'beta'),prefix=legacy?'':'/beta';
const filename=`Splece-${manifest.version}-beta-Apple-Silicon.dmg`,url=`${prefix}/${filename}`;
const oldNames=(await fs.readdir(folder)).filter(n=>/^Splece-.*\.dmg$/.test(n));
// Keep versioned archives immutable: an updater may still be downloading an older release.
await fs.writeFile(path.join(folder,filename),bytes);
await fs.writeFile(path.join(folder,filename+'.sha256'),`${manifest.sha256}  ${filename}\n`);
for(const name of ['index.html','READ-ME-FIRST.txt']){
 const file=path.join(folder,name);let value=await fs.readFile(file,'utf8');
 value=value.replace(/Splece-[\d.]+-beta-(?:unsigned-)?Apple-Silicon\.dmg/g,filename).replace(/v\d+\.\d+\.\d+ beta/g,`v${manifest.version} beta`).replace(/\d+ MB/g,`${Math.ceil(bytes.length/1e6)} MB`).replace(/Test mode/g,'Offline mode').replace(/Live AI/g,'Online AI');
 if(name==='index.html')value=value.replace('Start without API keys','Simple guided setup').replace('Explore in Offline mode or import your own footage.','Connect DeepSeek and Venice with step-by-step guides, or skip setup and edit your own footage Offline.');
 if(name==='index.html'&&!value.includes('id="updates"'))value=value.replace('the earlier unsigned beta','an earlier beta').replace('<section class="start"', '<section aria-labelledby="updates"><h2 id="updates">Next time, update from Settings.</h2><p>Install this version once to add in-app updates. For future releases, open <strong>Settings → Splece updates → Check for updates</strong>. Choose when to download and restart. Your projects and API connections stay on your Mac.</p></section>\n<section class="start"');
 if(name==='READ-ME-FIRST.txt'&&!value.includes('FUTURE UPDATES'))value+='\nFUTURE UPDATES\nInstall this version once. Then use Settings > Splece updates > Check for updates. Finish editing before choosing Install and Relaunch. Your projects and API connections remain on this Mac.\n';
 await fs.writeFile(file,value);
}
const configPath=path.join(out,'vercel.json'),config=JSON.parse(await fs.readFile(configPath));
config.headers ??= [];
config.headers.push({source:url,headers:[{key:'Content-Disposition',value:`attachment; filename="${filename}"`},{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]});
const redirects=new Map((config.redirects||[]).map(r=>[r.source,r]));
// Existing legacy redirects remain valid; never redirect an immutable update archive.
config.redirects=[...redirects.values()].filter(r=>r.source!==r.destination);
if(!legacy){
 if(manifest.updater?.publicKey!==updateConfig.publicKey || manifest.updater?.feedURL!==updateConfig.feedURL) throw Error('The application updater configuration does not match this release pipeline.');
 const sdk=await sparkleSDK();
 try {
  await verifyUpdateKey(sdk);
  const signature=(await exec(path.join(sdk,'bin/sign_update'),['--account',updateConfig.keychainAccount,'-p',dmg])).stdout.trim();
  if(!verifyArchive(bytes,signature,updateConfig.publicKey))throw Error('Update archive signature verification failed.');
  const updates=path.join(out,'updates/beta');await fs.mkdir(updates,{recursive:true});
  const old=await fs.readFile(path.join(base,'updates/beta/latest.json'),'utf8').then(JSON.parse).catch(()=>null);
  const notes=await fs.readFile(new URL(`../../packaging/release-notes/${manifest.version}.txt`,import.meta.url),'utf8');
  const feed=path.join(updates,'macos-arm64.xml');
  await fs.writeFile(feed,releaseFeed(manifest,bytes,signature,notes,old?.version));
  await exec(path.join(sdk,'bin/sign_update'),['--account',updateConfig.keychainAccount,feed]);
  await exec(path.join(sdk,'bin/sign_update'),['--account',updateConfig.keychainAccount,'--verify',feed]);
  await fs.writeFile(path.join(updates,'latest.json'),JSON.stringify({version:manifest.version,channel:'beta',arch:'arm64',sha256:manifest.sha256,bytes:bytes.length,url:'https://www.splece.com'+url,feed:updateConfig.feedURL,releasedAt:new Date().toISOString()},null,2)+'\n');
  config.headers=config.headers.filter(h=>h.source!=='/updates/:path*');
  config.headers.push({source:'/updates/:path*',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'}]});
 } finally {await fs.rm(sdk,{recursive:true,force:true});}
}
await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n');
if(!legacy){const file=path.join(out,'downloads.json'),downloads=JSON.parse(await fs.readFile(file));downloads.version=manifest.version+'-beta';await fs.writeFile(file,JSON.stringify(downloads)+'\n');}
console.log(`Staged ${out}. Installer: ${url}. Nothing published.`);
