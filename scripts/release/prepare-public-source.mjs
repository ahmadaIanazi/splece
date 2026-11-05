// Export a fresh, reviewable tree without private history, local data or internal docs.
import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=process.cwd(),version=JSON.parse(await fs.readFile('package.json')).version;
const out=path.resolve(process.argv[2]||`artifacts/public-source-${version}`);
await fs.mkdir(out); // Never overwrite an existing reviewed candidate.
const directories=['src','server','shared','tests','macos','packaging','website','public/brand','public/fonts','public/marketing','public/templates','public/connection-guides','docs/guide','docs/assets','docs/models/source-recipes'];
const files=['package.json','package-lock.json','index.html','.gitignore','.env.example','LICENSE','NOTICE','TRADEMARKS.md','ATTRIBUTION.md','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','SECURITY.md','public/splece.svg','public/audio.svg','public/downloads.json','public/vision/blaze-face.tflite','public/vision/README.md','public/vision/LICENSE','scripts/build-interface.mjs','scripts/studio-launcher.mjs','scripts/install-macos.mjs','scripts/setup-demo.mjs','scripts/prepare-vision.mjs','scripts/check-repository.mjs','scripts/check-secrets.mjs','scripts/build-template-media.py','.github/workflows/ci.yml','.github/ISSUE_TEMPLATE/bug_report.md','.github/ISSUE_TEMPLATE/feature_request.md','.github/ISSUE_TEMPLATE/config.yml','.github/PULL_REQUEST_TEMPLATE.md'];
for(const folder of ['scripts/release','scripts/website'])directories.push(folder);
for(const name of [...directories,...files]){await fs.mkdir(path.dirname(path.join(out,name)),{recursive:true});await fs.cp(path.join(root,name),path.join(out,name),{recursive:true});}
const readme=await fs.access(path.join(root,'docs/public-README.md')).then(()=> 'docs/public-README.md',()=> 'README.md');
await fs.copyFile(path.join(root,readme),path.join(out,'README.md'));
await fs.mkdir(path.join(out,'docs'),{recursive:true});
for(const name of ['local-addons.md'])await fs.copyFile(path.join(root,'docs',name),path.join(out,'docs',name));
// A public source tree does not carry local release certificates/account settings.
for(const file of ['packaging/updates.json']){
 // Public verification keys are intentional; there is no private signing key here.
 await fs.access(path.join(out,file));
}
execFileSync('git',['init','-b','main',out],{stdio:'pipe'});
execFileSync('git',['-C',out,'add','.']);
console.log(out);
