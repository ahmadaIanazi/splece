import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject,compilePrompt } from '../server/domain.mjs';
import { upgradeProject,validatePreparation,reuseGeneration } from '../shared/studio.mjs';
import { videoSoundPlan,shareVideoSound,effectiveVideoSound,normalizeVideoSound,videoSoundSection,detectVideoSoundVibe,preserveVideoSoundSection } from '../shared/video-sound.mjs';
import { protectedContent,assertProtectedPrompt } from '../shared/prompt-protection.mjs';
import { smartSignature } from '../shared/smart.mjs';
import { exportPrompt,importPrompt } from '../shared/authoring.mjs';
import { buildOptimizerRequest } from '../server/prompt-optimizer.mjs';
import { falModel,falPayload } from '../server/adapters/fal.mjs';
import { optimizedSubmissionDraft } from '../shared/submission-optimization.mjs';
const model=falModel('alibaba/wan-3.0/text-to-video');
function fixture() {
 const p=upgradeProject(newProject('Native sound'));const d=p.drafts[0];
 d.settings={...d.settings,model:model.id,audio:true};
 d.scenes[0].text='A calm person walks through the room.\nThey place a cup on the table.';
 return {p,d};
}
test('sound is opt-in, strictly allowlisted, gated by actual video audio, and does not add postproduction work',()=>{
 const {p,d}=fixture();const before=compilePrompt(p,d,model);
 assert.equal(videoSoundSection(p,d,model),null);
 assert.deepEqual(normalizeVideoSound({enabled:true,voice:'clone',audio_url:'unverified',vibe:'invented'}),{enabled:true});
 d.videoSound={enabled:true};const original=structuredClone(d);
 const compiled=compilePrompt(p,d,model);assert.match(compiled.text,/\[Sound direction\]/);assert.deepEqual(d,original);
 const payload=falPayload({prompt:compiled.text,audio:true,duration:5,resolution:'480p',aspect_ratio:'16:9'},model);
 assert.equal(payload.prompt,compiled.text);assert.equal(payload.audio,true);assert.equal(payload.reference_audio_urls,undefined);
 assert.equal(p.audioClips?.length || 0,0);
 d.settings.audio=false;assert.equal(videoSoundSection(p,d,model),null);
 assert.ok(validatePreparation(p,d,compilePrompt(p,d,model),model).warnings.some(w=>w.code==='native-sound'));
 assert.equal(videoSoundSection(p,{...d,settings:{...d.settings,audio:true}},{audio:false}),null);
 assert.doesNotMatch(before.text,/\[Sound direction\]/);
});
test('three sound layers are independent and never disable or rewrite character dialogue/voice',()=>{
 const {p,d}=fixture();p.assets=[{id:'mira',name:'Mira',kind:'character',voice:{pitch:'Low',texture:'Warm',language:'Arabic',accent:'Gulf'}}];d.referenceIds=['mira'];d.scenes[0].dialogue=[{speaker:'mira',text:'انتظر هنا.',delivery:'Softly'}];
 d.videoSound={enabled:true,ambience:false,effects:false,music:true,vibe:'tense'};
 const compiled=compilePrompt(p,d,model);
 assert.match(compiled.text,/no added ambient bed/);assert.match(compiled.text,/no added sound effects/);assert.match(compiled.text,/low sustained drone/);
 assert.match(compiled.text,/انتظر هنا\./);assert.match(compiled.text,/Mira — voice identity: pitch: Low; texture: Warm; language: Arabic; accent: Gulf/);
 d.videoSound.music=false;const text=compilePrompt(p,d,model).text;assert.match(text,/BGM: no background music/);assert.match(text,/انتظر هنا\./);
 assert.deepEqual(p.assets[0].voice,{pitch:'Low',texture:'Warm',language:'Arabic',accent:'Gulf'});
});
test('inference uses local positive nonspoken context with a neutral fallback and no fabricated material',()=>{
 const {p,d}=fixture();assert.equal(detectVideoSoundVibe(p,d).id,'calm');
 let plan=videoSoundPlan(p,d);assert.ok(plan.scenes[0].effects.some(x=>x.includes('Footfalls')));assert.doesNotMatch(plan.text,/glass handling/);
 d.scenes[0].text='No rain or footsteps.\nShe is not frightened.';d.scenes[0].dialogue=[{text:'I hear rain and I am afraid.'}];
 plan=videoSoundPlan(p,d);assert.equal(plan.vibe,'natural');assert.deepEqual(plan.scenes[0].effects,[]);assert.deepEqual(plan.scenes[0].ambience,[]);
 d.scenes[0].text='غرفة هادئة.';assert.equal(detectVideoSoundVibe(p,d).id,'calm');
});
test('shared project profile pins inferred vibe, respects local overrides and invalidates preparations',()=>{
 const {p,d}=fixture();d.videoSound={enabled:true,music:true};const signature=smartSignature(p,d);
 shareVideoSound(p,d);assert.equal(p.settings.videoSound.vibe,'calm');assert.equal(d.videoSound,undefined);assert.notEqual(smartSignature(p,d),signature);
 const next=structuredClone(d);next.scenes[0].text='A tense chase.';
 assert.equal(videoSoundPlan(p,next).vibe,'calm');assert.equal(effectiveVideoSound(p,next).music,true);
 next.videoSound={music:false,vibe:'tense'};assert.equal(videoSoundPlan(p,next).vibe,'tense');assert.equal(effectiveVideoSound(p,next).music,false);
});
test('sound section is protected and optimizer receives it as locked context',()=>{
 const {p,d}=fixture();d.videoSound={enabled:true};const compiled=compilePrompt(p,d,model);
 assert.throws(()=>assertProtectedPrompt(compiled.text.replace('BGM: no background music.','BGM: loud music.'),protectedContent(d,compiled.text)),/sound direction/);
 const request=buildOptimizerRequest({draft:d,compiled,videoCapabilities:model,limit:model.promptLimit},{model:'test'});
 assert.ok(JSON.parse(request.messages[1].content).lockedSections.some(s=>s.label==='Sound direction'));
 const copy=structuredClone(d);copy.scenes[0].text='A tense chase.';preserveVideoSoundSection(copy,compiled);
 assert.equal(compilePrompt(p,copy,model).sections.find(s=>s.label==='Sound direction').text,compiled.sections.find(s=>s.label==='Sound direction').text);
});
test('optimized submitted copy freezes sound even when inferred prose changes; original is unchanged',()=>{
 const {p,d}=fixture();d.videoSound={enabled:true};const original=structuredClone(d),compiled=compilePrompt(p,d,model);
 const job={id:'opt',projectId:p.id,draftId:d.id,state:'ready',sourceSignature:smartSignature(p,d),config:{mode:'demo'},input:{operation:'optimize-writing',submissionOnly:true,draft:structuredClone(d),compiled,videoCapabilities:model},result:{scenes:[{id:d.scenes[0].id,text:'A quiet person walks through the room.\nThey place a cup on the table.'}]}};
 const copy=optimizedSubmissionDraft(p,d,job,model,'test');assert.deepEqual(d,original);
 assert.equal(compilePrompt(p,copy,model).sections.find(s=>s.label==='Sound direction').text,compiled.sections.find(s=>s.label==='Sound direction').text);
});
test('export/import and reused generations preserve sound choices and frozen absence',()=>{
 const {p,d}=fixture();const base=compilePrompt(p,d,model);const old={draft:structuredClone(d),compiled:structuredClone(base),template:structuredClone(p.settings)};
 d.videoSound={enabled:true,ambience:false,music:true,vibe:'warm'};let compiled=compilePrompt(p,d,model);
 const imported=importPrompt(exportPrompt(p,d,compiled,[model]),p,[model]);assert.deepEqual(imported.videoSound,d.videoSound);
 const snap={draft:structuredClone(d),compiled:structuredClone(compiled),template:structuredClone(p.settings)};
 p.settings.videoSound={enabled:true,music:true,vibe:'energetic'};
 const reused=reuseGeneration(p,snap);assert.equal(compilePrompt(p,reused,model).sections.find(s=>s.label==='Sound direction').text,compiled.sections.find(s=>s.label==='Sound direction').text);
 const legacy=reuseGeneration(p,old);assert.equal(legacy.sectionOverrides['Sound direction'],'');assert.ok(!compilePrompt(p,legacy,model).sections.some(s=>s.label==='Sound direction'));
});
