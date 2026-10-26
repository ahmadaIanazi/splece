import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import recipes from '../shared/prompt-recipes.json' with { type: 'json' };
import { applyPromptPreset, renderPromptPreset, promptCategories } from '../shared/prompt-library.mjs';
import { carryPlannedContinuity, validateContinuity, continuitySection } from '../shared/clip-continuity.mjs';
import { referenceRoleInstruction } from '../shared/reference-roles.mjs';
import { newProject, compilePrompt, models } from '../server/domain.mjs';
import { upgradeProject } from '../shared/studio.mjs';
import { referenceErrors } from '../shared/references.mjs';
import { exportPrompt, importPrompt } from '../shared/authoring.mjs';
import { protectedContent, assertProtectedPrompt } from '../shared/prompt-protection.mjs';
const fixture = () => { const p = upgradeProject(newProject('Continuity test')); const d = p.drafts[0]; d.scenes[0].text = 'The hand lifts a cup.\nSteam rises.'; return {p,d}; };
test('verbatim recipes match exact archived source ranges and hashes; all categories represented', async () => {
  const source = (await readFile(new URL('../docs/models/source-recipes/tutorial-page.txt', import.meta.url), 'utf8')).split(/\r?\n/);
  for (const r of recipes) {
    assert.equal(r.verbatim, source.slice(r.sourceLines[0]-1, r.sourceLines[1]).join('\n').replace(/^\n+|\n+$/g,''));
    assert.equal(createHash('sha256').update(r.verbatim).digest('hex'), r.sha256);
    assert.equal(r.executable, false);
  }
  for (const c of promptCategories) assert.ok(recipes.some(r => r.categories.includes(c.id)));
  const manifest = JSON.parse(await readFile(new URL('../docs/models/source-recipes/manifest.json', import.meta.url)));
  for (const s of manifest) assert.equal(createHash('sha256').update(await readFile(new URL('../'+s.path, import.meta.url))).digest('hex'), s.sha256);
});
test('presets preserve original writing/dialogue/actions/camera and create a new variation', () => {
  const {p,d} = fixture(); d.scenes[0].dialogue = [{speaker:'actor',text:'Exact words!'}]; d.scenes[0].cameraDirection = 'Keep the camera fixed.';
  const original = structuredClone(d);
  const added = applyPromptPreset(p,d.id,'continuous-action',{'Subject and action':'The cup settles.'},()=> 'new');
  assert.deepEqual(d,original);
  assert.equal(added.scenes[0].text, original.scenes[0].text+'\nThe cup settles.');
  assert.deepEqual(added.scenes[0].dialogue,original.scenes[0].dialogue);
  assert.equal(added.scenes[0].cameraDirection,original.scenes[0].cameraDirection);
  assert.equal(p.activeDraftId,'new');
  assert.throws(()=> applyPromptPreset(p,d.id,'identity-portrait',{'Subject':'A person','Framing and light':'Soft light'}),/copy-only/);
  assert.throws(()=> renderPromptPreset('continuous-action',{}),/Enter/);
  assert.doesNotMatch(added.scenes[0].text,/flattering|Kai|15 hard|wardrobe|Higgsfield/);
});
test('planned ending carries as a plan, confirmed notes stay local, changed takes become stale', () => {
  const {p,d} = fixture();
  d.continuity = {plannedEnd:{text:'Coat removed, cup on table.',provenance:'observed'}};
  const next = structuredClone(d); delete next.continuity;
  assert.equal(carryPlannedContinuity(d,next),true);
  assert.equal(next.continuity.opening.provenance,'planned');
  assert.match(continuitySection(p,next).text,/intent, not observed/);
  p.clips.push({id:'prior',activeTake:'new',takes:[{id:'old'},{id:'new'}]});
  next.continuity.opening={text:'The coat is off.',provenance:'observed',source:{clipId:'prior',takeId:'old',time:2}};
  assert.match(continuitySection(p,next).text,/stale; verify/);
  assert.throws(()=>validateContinuity({opening:{text:'Coat off.',provenance:'observed'}},p),/known local take/);
  assert.equal(continuitySection(p,{...d,continuity:undefined}),null);
});
test('compiler and prompt export preserve continuity provenance, original prose and protected section', () => {
  const {p,d}=fixture();
  d.continuity={opening:{text:'Coat removed.',provenance:'user-confirmed'},plannedEnd:{text:'Cup settles.',provenance:'planned'}};
  const compiled=compilePrompt(p,d,models[0]);
  assert.match(compiled.text,/User-confirmed opening: Coat removed/);
  assert.match(compiled.text,/Planned ending \(target only/);
  assert.match(compiled.text,/Steam rises\./);
  const copy=importPrompt(exportPrompt(p,d,compiled,models),p,models);
  assert.equal(copy.continuity.opening.provenance,'user-confirmed');
  const protectedParts=protectedContent(d,compiled.text);
  assert.throws(()=>assertProtectedPrompt(compiled.text.replace('Coat removed.','Coat restored.'),protectedParts),/continuity/);
});
test('explicit wardrobe, identity and sheet roles prevent leakage; audio/video references rejected', () => {
  const clothing=referenceRoleInstruction({tag:'@Image1',role:'clothing',name:'Coat',targetName:'Mira'});
  assert.match(clothing,/for Mira/); assert.match(clothing,/Do not copy.*identity/); assert.match(clothing,/opening frame/);
  const identity=referenceRoleInstruction({tag:'@Image2',role:'identity',name:'Mira',contactSheet:true});
  assert.match(identity,/multiple views of the same character/); assert.match(identity,/does not add this person to the cast/);
  const errors=referenceErrors({text:'',references:[{id:'audio',name:'Song',selectedMedia:{id:'a',kind:'audio'}}],boundaries:{}},{referenceMode:'flat',maxReferences:30});
  assert.ok(errors.some(e=>e.includes('not implemented')));
  assert.ok(referenceErrors({text:'Lip sync to @Video 1 and @audio1.',references:[],boundaries:{}},{referenceMode:'flat'}).some(e=>e.includes('tags are not attached')));
});

test('explicit target roles compile for single-image workflows and remain protected', () => {
  const {p,d}=fixture();
  p.assets.push({id:'coat',name:'Coat reference',kind:'style',description:'Blue jacket',media:{id:'img',kind:'image'}},{id:'mira',name:'Mira',kind:'character'});
  d.referenceIds=['coat']; d.referenceOptions={coat:{role:'clothing',targetAssetId:'mira'}};
  const compiled=compilePrompt(p,d,{...models[0],referenceMode:'single'});
  assert.match(compiled.text,/Wardrobe for Mira/);
  const protectedParts=protectedContent(d,compiled.text);
  assert.throws(()=>assertProtectedPrompt(compiled.text.replace('Wardrobe for Mira','Wardrobe for someone else'),protectedParts),/reference roles/);
});

test('prior clip continuity prefers active take snapshot, never another take or edited variation', async () => {
  const { priorClipContinuitySource } = await import('../shared/clip-continuity.mjs');
  const {p,d}=fixture(); d.start=10;
  const source={id:'source',episodeId:p.episodeId,targetId:'prior',continuity:{plannedEnd:{text:'Edited later.'}}};
  p.drafts.push(source);
  p.clips=[{id:'prior',start:0,duration:5,sourceDraftId:'source',activeTake:'take',takes:[{id:'take',jobId:'job'}]}, {id:'future',start:20,duration:5,takes:[]}, {id:'overlap',start:8,duration:5,takes:[]}, {id:'other-episode',episodeId:'other',start:5,duration:5,takes:[]}];
  const frozen={...source,continuity:{plannedEnd:{text:'Frozen ending.'}}};
  const jobs=[{id:'job',kind:'generation',projectId:p.id,media:{id:'take'},snapshot:{draft:frozen}},{id:'wrong',kind:'generation',snapshot:{draft:source}}];
  const result=priorClipContinuitySource(p,d,jobs);
  assert.equal(result.origin,'active-take-plan'); assert.equal(result.draft.continuity.plannedEnd.text,'Frozen ending.');
  assert.equal(priorClipContinuitySource(p,d,[]).origin,'draft-only-plan');
  // A frozen take without an ending must not fall through to a subsequently edited draft.
  jobs[0].snapshot.draft={...frozen,continuity:undefined};
  assert.equal(priorClipContinuitySource(p,d,jobs).draft.continuity,undefined);
  d.targetId='prior'; assert.equal(priorClipContinuitySource(p,d,jobs),null);
});
test('prior clip source rejects ambiguous draft links and tied timeline endings; carry never overwrites', async () => {
  const { priorClipContinuitySource } = await import('../shared/clip-continuity.mjs');
  const {p,d}=fixture(); d.start=10;
  p.clips=[{id:'prior',start:0,duration:5,takes:[]}];
  p.drafts.push({id:'one',targetId:'prior'},{id:'two',targetId:'prior'});
  assert.equal(priorClipContinuitySource(p,d).origin,'unavailable');
  p.drafts.pop(); assert.equal(priorClipContinuitySource(p,d).draft.id,'one');
  p.clips.push({id:'tie',start:2,duration:3,takes:[]});
  assert.match(priorClipContinuitySource(p,d).reason,/Multiple clips/);
  const source={continuity:{plannedEnd:{text:'Coat off.'}}};
  d.continuity={opening:{text:'Already confirmed.',provenance:'user-confirmed'}};
  const original=structuredClone(d);
  assert.equal(carryPlannedContinuity(source,d),false); assert.deepEqual(d,original);
});
