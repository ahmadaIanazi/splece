import fs from 'node:fs/promises';
import {Resvg} from '@resvg/resvg-js';
const out=process.argv[2];if(!out)throw Error('Supply an output PNG path.');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="920" viewBox="0 0 720 460">
<rect width="720" height="460" fill="#F6F7FB"/>
<circle cx="698" cy="20" r="148" fill="#E9EDFF"/>
<path d="M635 -28 685 29 635 86 585 29Z" fill="#0866FF" transform="rotate(12 635 29)"/>
<text x="44" y="52" font-family="Arial" font-size="18" font-weight="700" fill="#141721">Splece</text>
<text x="44" y="110" font-family="Arial" font-size="42" font-weight="700" letter-spacing="-2" fill="#141721">One move. You're in.</text>
<text x="46" y="144" font-family="Arial" font-size="16" fill="#596171">Drag Splece into Applications to install.</text>
<rect x="124" y="209" width="132" height="150" rx="26" fill="white" stroke="#DFE3EC"/>
<rect x="464" y="209" width="132" height="150" rx="26" fill="white" stroke="#DFE3EC"/>
<path d="M297 269H419M398 248 420 269 398 290" fill="none" stroke="#0866FF" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<path d="m352 228 5-10 5 10 10 5-10 5-5 10-5-10-10-5Z" fill="#0866FF"/>
<text x="360" y="397" text-anchor="middle" font-family="Arial" font-size="14" fill="#596171">Then open Splece from Applications. Make something move.</text>
<text x="44" y="436" font-family="Arial" font-size="10" font-weight="700" letter-spacing="1.6" fill="#737B89">FREE. LOCAL. YOURS.</text>
<text x="676" y="436" text-anchor="end" font-family="Arial" font-size="11" fill="#737B89">splece.com</text></svg>`;
await fs.writeFile(out,new Resvg(svg,{fitTo:{mode:'width',value:720},font:{loadSystemFonts:true}}).render().asPng());
await fs.writeFile(out.replace(/\.png$/, '@2x.png'),new Resvg(svg,{font:{loadSystemFonts:true}}).render().asPng());
