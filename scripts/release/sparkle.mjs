// Pinned SDK; only the archive is cached. Extract afresh after verifying its hash.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export const exec = promisify(execFile);
export const updateConfig = JSON.parse(await fs.readFile(new URL('../../packaging/updates.json', import.meta.url)));
export async function sparkleSDK() {
  const {sparkleVersion:version,sparkleSha256:hash}=updateConfig;
  const cache=path.join(os.homedir(),'Library/Caches/SpleceRelease');
  await fs.mkdir(cache,{recursive:true});
  const archive=path.join(cache,`Sparkle-${version}.tar.xz`);
  if(!await fs.stat(archive).catch(()=>null)) {
    const temporary=archive+'.'+process.pid;
    try {
      await exec('/usr/bin/curl',['--fail','--location','--proto','=https','--proto-redir','=https','--output',temporary,`https://github.com/sparkle-project/Sparkle/releases/download/${version}/Sparkle-${version}.tar.xz`],{timeout:120000});
      if(createHash('sha256').update(await fs.readFile(temporary)).digest('hex')!==hash) throw Error('Sparkle SDK checksum mismatch.');
      await fs.rename(temporary,archive);
    } finally { await fs.rm(temporary,{force:true}); }
  }
  if(createHash('sha256').update(await fs.readFile(archive)).digest('hex')!==hash) throw Error('Cached Sparkle SDK checksum mismatch.');
  const sdk=await fs.mkdtemp(path.join(os.tmpdir(),'splece-sparkle-'));
  await exec('/usr/bin/tar',['-xf',archive,'-C',sdk]);
  return sdk;
}
export async function verifyUpdateKey(sdk) {
  const {stdout}=await exec(path.join(sdk,'bin/generate_keys'),['--account',updateConfig.keychainAccount,'-p']);
  if(stdout.trim()!==updateConfig.publicKey) throw Error('The update signing key does not match the public key embedded in Splece.');
}
