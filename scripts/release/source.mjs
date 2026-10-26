// Export only the public-source allowlist; never include private Git history or handoff docs.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
const root=process.cwd(),version=JSON.parse(await fs.readFile('package.json')).version,temp=await fs.mkdtemp(path.join(os.tmpdir(),'splece-public-'));
try{
 const source=path.join(temp,'Splece');execFileSync(process.execPath,['scripts/release/prepare-public-source.mjs',source],{cwd:root,stdio:'pipe'});
 const tree=execFileSync('git',['-C',source,'write-tree'],{encoding:'utf8'}).trim();const output=path.join(root,`artifacts/splece-source-${version}.zip`);await fs.mkdir(path.dirname(output),{recursive:true});
 execFileSync('git',['-C',source,'archive','--format=zip','--prefix=Splece/',`--output=${output}`,tree]);console.log(`${output}\nPrepared only. Review the public-release checklist before publication.`);
}finally{await fs.rm(temp,{recursive:true,force:true});}
