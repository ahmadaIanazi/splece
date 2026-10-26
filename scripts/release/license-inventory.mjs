import fs from 'node:fs/promises';import path from 'node:path';
const root=process.cwd(),out=path.resolve(process.argv[2]||'artifacts/license-review');
await fs.mkdir(path.join(out,'licenses'),{recursive:true});
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'))),rows=[];
for(const [relative,entry] of Object.entries(lock.packages)){
 if(!relative)continue;const folder=path.join(root,relative);let pkg;try{pkg=JSON.parse(await fs.readFile(path.join(folder,'package.json')));}catch{rows.push({package:relative,version:entry.version,license:entry.license||'REVIEW',installed:false,dev:!!entry.dev});continue;}
 const files=(await fs.readdir(folder)).filter(n=>/^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(n));const id=(pkg.name+'@'+pkg.version).replaceAll('/','__');
 for(const file of files){const stat=await fs.stat(path.join(folder,file));if(!stat.isFile())continue;await fs.mkdir(path.join(out,'licenses',id),{recursive:true});await fs.copyFile(path.join(folder,file),path.join(out,'licenses',id,file));}
 rows.push({package:pkg.name,version:pkg.version,license:pkg.license||entry.license||({busboy:'MIT',streamsearch:'MIT','parse-cache-control':'BSD-3-Clause'}[pkg.name])||'REVIEW',installed:true,dev:!!entry.dev,notices:files});
}
await fs.writeFile(path.join(out,'dependencies.json'),JSON.stringify(rows,null,2)+'\n');
await fs.writeFile(path.join(out,'DEPENDENCIES.md'),'# Locked dependency license inventory\n\nGenerated from package-lock.json and installed package notices. Missing platform packages and missing notices require review; this is an inventory, not legal clearance.\n\n| Package | Version | License | Installed here |\n|---|---|---|---|\n'+rows.map(r=>`| ${r.package} | ${r.version} | ${typeof r.license==='string'?r.license:JSON.stringify(r.license)} | ${r.installed?'yes':'no'} |`).join('\n')+'\n');
console.log(JSON.stringify({packages:rows.length,missingLicense:rows.filter(r=>r.license==='REVIEW').length,output:out}));
