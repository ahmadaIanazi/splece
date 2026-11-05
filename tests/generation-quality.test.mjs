import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityResolution, validateQualityPresets } from '../shared/generation-quality.mjs';
import { validateDefaults, resolveProjectDefaults } from '../shared/settings-defaults.mjs';
import { imageDimensions, normalizeImageInput } from '../shared/asset-generation.mjs';
import { imagePayload } from '../server/asset-images.mjs';
test('Draft and Final resolve per-model overrides without changing models',()=>{
  const model={id:'wan',resolutions:['1080p','480p','720p']};
  assert.equal(qualityResolution({},model),'480p');
  assert.equal(qualityResolution({},model,'final'),'1080p');
  assert.equal(qualityResolution({models:{wan:{draft:'720p'}}},model),'720p');
  assert.equal(model.id,'wan');
  assert.equal(qualityResolution({}, {resolutions:['1080p','720p']}),'720p');
  assert.equal(qualityResolution({}, {resolutions:['1K']},'final'),'1K');
});
test('presets persist through global validation and project inheritance',()=>{
  const generationPresets={draft:'480p',final:'1080p',models:{test:{draft:'720p',final:'1080p'}}};
  const saved=validateDefaults({generationPresets});
  assert.deepEqual(saved.generationPresets,generationPresets);
  assert.deepEqual(resolveProjectDefaults({inherit:['video']},saved).generationPresets,generationPresets);
  assert.throws(()=>validateQualityPresets({draft:'2160p',final:'480p'}));
  assert.throws(()=>validateQualityPresets({models:[]}));
  assert.throws(()=>validateQualityPresets({draft:'garbage'}));
});
test('image resolution reaches the provider and preserves aspect',()=>{
  const base={assetId:'a',kind:'location',mode:'create',modelId:'fal-schnell',description:'A landscape',ratio:'16:9'};
  const draft=normalizeImageInput({...base,resolution:'480p'});
  const final=normalizeImageInput({...base,resolution:'1080p'});
  assert.deepEqual(imageDimensions(draft),[853,480]);
  assert.deepEqual(imagePayload(final,'A landscape').image_size,{width:1920,height:1080});
  assert.throws(()=>normalizeImageInput({...base,resolution:'8K'}));
  assert.throws(()=>normalizeImageInput({...base,modelId:'venice-grok',resolution:'480p'}));
});
