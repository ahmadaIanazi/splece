// Runtime update download: only authenticated release metadata can select a package.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {packagedDataDir} from './bundled-launcher.mjs';
const BASE='https://www.splece.com/updates/beta/windows-x64/';
export function validatedRelease(bytes,signature,key,current) {
 const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(key,'base64')]),format:'der',type:'spki'});
 if(!verify(null,bytes,publicKey,Buffer.from(signature.trim(),'base64')))throw Error('The update listing could not be verified. Nothing was installed.');
 const value=JSON.parse(bytes);
 if(value.schema!==1||value.platform!=='windows-x64'||!/^\d+\.\d+\.\d+$/.test(value.version))throw Error('Invalid Windows release.');
 const asset=value.asset;
 if(asset?.PackageId!=='SpleceDesktop'||asset.Version!==value.version||asset.Type!=='Full'||!/^SpleceDesktop-[\w.-]+-full\.nupkg$/.test(asset.FileName)||!/^([a-fA-F0-9]{64})$/.test(asset.SHA256)||!Number.isSafeInteger(asset.Size)||asset.Size<=0||asset.Size>1024*1024*1024)throw Error('Invalid update package.');
 const a=value.version.split('.').map(Number),b=current.split('.').map(Number),i=a.findIndex((n,i)=>n!==b[i]);
 return {...value,available:i>=0&&a[i]>b[i]};
}
async function request(file,max){
 const res=await fetch(BASE+file,{redirect:'error',signal:AbortSignal.timeout(600000)});
 if(res.status===404)throw Error('The Windows beta update channel is not open yet. Your installed version is unchanged.');
 if(!res.ok)throw Error('Could not reach the update service. Please try again later.');
 let size=0;const chunks=[];for await(const chunk of res.body){size+=chunk.length;if(size>max)throw Error('The update exceeded its expected size.');chunks.push(chunk);}return Buffer.concat(chunks);
}
async function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'))),config=JSON.parse(await fs.readFile(path.join(root,'desktop-update.json')));
 const [bytes,signature]=await Promise.all([request('latest.json',65536),request('latest.json.sig',256)]);
 const release=validatedRelease(bytes,signature.toString(),config.publicKey,pkg.version);
 if(process.argv[2]!=='download'||!release.available)return {ok:true,available:release.available,version:release.version};
 if(process.argv[3]!==release.version)throw Error('A newer release was published. Check for updates again.');
 const folder=path.join(packagedDataDir(),'updates',release.version);await fs.mkdir(folder,{recursive:true});
 const archive=await request(release.asset.FileName,release.asset.Size);
 if(archive.length!==release.asset.Size||createHash('sha256').update(archive).digest('hex').toUpperCase()!==release.asset.SHA256.toUpperCase())throw Error('Update verification failed. Nothing was installed.');
 await fs.writeFile(path.join(folder,release.asset.FileName),archive);
 await fs.writeFile(path.join(folder,'releases.win.json'),JSON.stringify({Assets:[release.asset]}));
 return {ok:true,available:true,version:release.version,folder};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(v=>console.log(JSON.stringify(v))).catch(e=>{console.log(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;});
