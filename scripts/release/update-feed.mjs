import {verify,createPublicKey,createHash} from 'node:crypto';
export function verifyArchive(bytes,signature,publicKey) {
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey,'base64')]),format:'der',type:'spki'});
  return verify(null,bytes,key,Buffer.from(signature,'base64'));
}
export function releaseFeed(manifest,bytes,signature,notes,previousVersion) {
  if(!/^\d+\.\d+\.\d+$/.test(manifest.version)||manifest.arch!=='arm64'||!manifest.signed||!manifest.notarized||!manifest.publishable) throw Error('A verified Apple Silicon release is required.');
  if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256) throw Error('Release checksum mismatch.');
  if(previousVersion){
    const a=manifest.version.split('.').map(Number),b=previousVersion.split('.').map(Number);
    const first=a.findIndex((v,i)=>v!==b[i]);
    if(first<0||a[first]<b[first])throw Error('Publish a new, increasing version. Never replace an existing update.');
  }
  if(!/^[A-Za-z0-9+/]{86}==$/.test(signature))throw Error('Invalid update signature.');
  const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  const url=`https://www.splece.com/beta/Splece-${manifest.version}-beta-Apple-Silicon.dmg`;
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel>
<title>Splece Mac beta updates</title><link>https://www.splece.com/beta/</link><description>Signed updates for Splece on Apple Silicon.</description><language>en</language>
<item><title>Splece ${xml(manifest.version)} beta</title><sparkle:version>${xml(manifest.version)}</sparkle:version><sparkle:shortVersionString>${xml(manifest.version)}</sparkle:shortVersionString>
<pubDate>${new Date(manifest.builtAt).toUTCString()}</pubDate><description>${xml(notes)}</description><sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
<enclosure url="${url}" length="${bytes.length}" type="application/octet-stream" sparkle:edSignature="${signature}"/>
</item></channel></rss>\n`;
}
