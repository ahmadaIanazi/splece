import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDirectionRange, directionRanges, timedDirectionSegments, validateDirectionRanges } from '../shared/timeline-direction.mjs';
import { newProject, compilePrompt, models } from '../server/domain.mjs';
import { upgradeProject, reuseGeneration } from '../shared/studio.mjs';
import { smartSignature } from '../shared/smart.mjs';
import { exportPrompt, importPrompt } from '../shared/authoring.mjs';
const range=(patch={})=>({id:'direction',start:12,end:15,settings:{lighting:'golden'},...patch});
const fixture=()=>{const p=upgradeProject(newProject('Direction'));const d=p.drafts[0];d.start=10;d.settings.duration=10;d.scenes[0].text='A cup lifts.\nSteam rises.';return {p,d};};
test('normalization is allowlisted, nonmutating and validates invalid timing/duplicates',()=>{
 const r=range({settings:{lighting:'golden',unknown:'hacked'}});const saved=structuredClone(r);
 assert.deepEqual(normalizeDirectionRange(r).settings,{lighting:'golden'});assert.deepEqual(r,saved);
 for(const v of [range({end:12}),range({start:-1}),range({end:Infinity}),range({enabled:'yes'})]) assert.throws(()=>normalizeDirectionRange(v));
 assert.throws(()=>validateDirectionRanges([range(),range()]),/unique/);
});
test('group ranges follow edited nested descendants, use planned bounds when unplaced, and ignore deleted groups',()=>{
 const {p}=fixture();p.storyPlans ??= {};p.storyPlans[p.episodeId]={beats:[{id:'g',nodeType:'group',start:0,duration:30},{id:'nested',nodeType:'group',parentId:'g',start:0,duration:10},{id:'leaf',nodeType:'clip',parentId:'nested',start:0,duration:5}]};
 p.directionRanges=[range({groupId:'g'}),range({id:'foreign',episodeId:'other'})];
 assert.equal(directionRanges(p)[0].timingSource,'planned-group');
 p.clips=[{id:'placed',storyBeatId:'leaf',start:25,duration:8}];
 assert.deepEqual(directionRanges(p).map(r=>[r.start,r.end,r.storedStart,r.timingSource]),[[25,33,12,'edited-group']]);
 p.clips[0].start=40;assert.equal(directionRanges(p)[0].start,40);
 p.storyPlans[p.episodeId].beats=[];assert.equal(directionRanges(p)[0].resolved,false);
 assert.deepEqual(p.directionRanges[0].start,12);
});
test('partial overlaps use relative intervals and deterministic per-setting precedence',()=>{
 const {p,d}=fixture();p.settings.creativeDirection={lighting:'window',look:'clean'};
 p.directionRanges=[range(),range({id:'later',start:14,end:18,settings:{lighting:'neon',palette:'mono'}}),range({id:'disabled',start:10,end:20,enabled:false,settings:{look:'graphic'}})];
 const segments=timedDirectionSegments(p,d);
 assert.deepEqual(segments.map(s=>[s.start,s.end,s.settings.lighting]),[[0,2,'window'],[2,4,'golden'],[4,8,'neon'],[8,10,'window']]);
 d.creativeDirection={lighting:'studio'};assert.ok(timedDirectionSegments(p,d).every(s=>s.settings.lighting==='studio'));
 d.creativeDirection={customPalette:['#123456']};assert.ok(timedDirectionSegments(p,d).every(s=>!s.settings.palette && s.settings.customPalette));
});
test('timed camera defaults never compete with explicit shot camera; prose/dialogue preserved',()=>{
 const {p,d}=fixture();p.directionRanges=[range({settings:{lighting:'golden',movement:'orbit',lens:'wide',pacing:'energetic'}})];
 d.scenes[0].cameraDirection='Locked 85mm lens. No cuts.';d.scenes[0].dialogue=[{speaker:'',text:'Exactly these words.',delivery:'Auto'}];
 const original=structuredClone(d);const compiled=compilePrompt(p,d,models[0]);const section=compiled.sections.find(s=>s.label==='Creative direction');
 assert.match(section.text,/2–5s/);assert.doesNotMatch(section.text,/partial orbit|Wide-angle|brisk editorial/);
 assert.match(compiled.text,/Locked 85mm lens/);assert.match(compiled.text,/Exactly these words\./);assert.deepEqual(d,original);
 d.scenes[0].cameraDirection='';d.scenes[0].camera='Auto';d.scenes[0].movement='Auto';
 assert.match(compilePrompt(p,d,models[0]).sections.find(s=>s.label==='Creative direction').text,/partial orbit/);
 d.scenes[0].creativeDirection={lighting:'studio'};
 assert.doesNotMatch(compilePrompt(p,d,models[0]).sections.find(s=>s.label==='Creative direction').text,/Low warm sunlight/);
});
test('relevant changes invalidate preparation, nonoverlaps do not, compiled snapshots remain immutable',()=>{
 const {p,d}=fixture();p.directionRanges=[range()];const signature=smartSignature(p,d);const compiled=compilePrompt(p,d,models[0]);const frozen=structuredClone(compiled);
 p.directionRanges.push(range({id:'outside',start:50,end:60}));assert.equal(smartSignature(p,d),signature);
 p.directionRanges[0].settings.lighting='neon';assert.notEqual(smartSignature(p,d),signature);assert.deepEqual(compiled,frozen);
 d.sectionOverrides={'Creative direction':'User override'};const manualSignature=smartSignature(p,d);p.directionRanges[0].settings.lighting='studio';assert.equal(smartSignature(p,d),manualSignature);
 assert.equal(compilePrompt(p,d,models[0]).sections.find(s=>s.label==='Creative direction').text,'User override');
});
test('old generation reuse freezes absence; new reuse retains timed section and prompt export preserves explicit choices',()=>{
 const {p,d}=fixture();const original=compilePrompt(p,d,models[0]);
 const snap={draft:structuredClone(d),compiled:structuredClone(original),template:structuredClone(p.settings)};
 p.directionRanges=[range()];const oldCopy=reuseGeneration(p,snap);assert.equal(oldCopy.sectionOverrides['Creative direction'],'');
 assert.ok(!compilePrompt(p,oldCopy,models[0]).sections.some(s=>s.label==='Creative direction'));
 d.creativeDirection={look:'analog'};d.scenes[0].creativeDirection={palette:'earth'};
 const compiled=compilePrompt(p,d,models[0]);const copy=importPrompt(exportPrompt(p,d,compiled,models),p,models);
 assert.deepEqual(copy.creativeDirection,d.creativeDirection);assert.deepEqual(copy.scenes[0].creativeDirection,d.scenes[0].creativeDirection);
 const reused=reuseGeneration(p,{...snap,draft:structuredClone(d),compiled:structuredClone(compiled)});
 p.directionRanges[0].settings={lighting:'neon'};
 assert.equal(compilePrompt(p,reused,models[0]).sections.find(s=>s.label==='Creative direction').text,compiled.sections.find(s=>s.label==='Creative direction').text);
});

test('direction records persist through project storage and invalid updates are rejected without revision advance',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {openStore}=await import('../server/store.mjs');
 const folder=await mkdtemp(join(tmpdir(),'direction-test-'));const store=openStore(join(folder,'studio.sqlite'));
 try {const {p}=fixture();p.directionRanges=[range()];const revision=store.save(p,0);assert.deepEqual(store.get(p.id).project.directionRanges,p.directionRanges);p.directionRanges=[range({end:2})];assert.throws(()=>store.save(p,revision),/valid start/);assert.equal(store.get(p.id).revision,revision);} finally {store.db.close();await rm(folder,{recursive:true,force:true});}
});

test('direction coverage follows live resized bounds, partial overlaps and episode isolation', async()=>{
 const {directionClipCoverage}=await import('../shared/timeline-direction.mjs');
 const p={episodeId:'e',clips:[{id:'a',start:0,duration:5},{id:'b',start:5,duration:5},{id:'other',episodeId:'other',start:0,duration:10},{id:'invalid',start:3,duration:0}]};
 assert.deepEqual(directionClipCoverage(p,{start:2,end:5}),[{id:'a',start:2,end:5}]);
 assert.deepEqual(directionClipCoverage(p,{start:4,end:8}),[{id:'a',start:4,end:5},{id:'b',start:5,end:8}]);
 assert.deepEqual(directionClipCoverage(p,{start:5,end:10}),[{id:'b',start:5,end:10}]);
 assert.deepEqual(directionClipCoverage(p,{start:0,end:10,enabled:false}),[]);
 assert.deepEqual(directionClipCoverage(p,{start:0,end:10,resolved:false}),[]);
 p.clips[1].start=12;
 assert.deepEqual(directionClipCoverage(p,{start:4,end:8}),[{id:'a',start:4,end:5}]);
});
