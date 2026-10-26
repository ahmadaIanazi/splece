import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneVectorRequest} from '../server/scene-sketch-request.mjs';
test('characters and animals request concise stick sketches without changing backgrounds',()=>{
  for(const kind of ['person','group','zombie','robot','animal']){
    const r=sceneVectorRequest({role:'subject',kind,design:'Realistic 3D',view:'front'});
    assert.match(r.messages[0].content,/simple abstract stick-man/);
    assert.doesNotMatch(r.messages[0].content,/Avoid stick figures/);
    assert.match(r.messages[0].content,/5–10/);
    assert.equal(r.max_tokens,1400);
  }
  for(const context of [{role:'environment',kind:'forest'},{role:'subject',kind:'bottle'}]){
    const r=sceneVectorRequest(context);
    assert.equal(r.max_tokens,2800);
    assert.match(r.messages[0].content,/12–22/);
    assert.doesNotMatch(r.messages[0].content,/simple abstract stick-man/);
  }
});
