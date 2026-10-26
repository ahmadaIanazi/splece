import test from "node:test";
import assert from "node:assert/strict";
import { requestStructuredStory } from "../server/story-request.mjs";
const valid = {
  title: "Untouched words",
  beats: [],
  characters: [],
  setup: {},
};
const data = (content, finish = "stop", i = 1) => ({
  id: "response-" + i,
  model: "deepseek-flash",
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  choices: [{ finish_reason: finish, message: { content } }],
});
const args = {
  input: { plan: { beats: [] } },
  request: { messages: [] },
  key: "fake",
  config: { mode: "deepseek", model: "deepseek-flash" },
};
test("one format retry accounts for both attempts and signals progress", async () => {
  let calls = 0;
  const receipts = [],
    progress = [];
  const result = await requestStructuredStory({
    ...args,
    transport: async () => ({
      ok: true,
      json: async () =>
        ++calls === 1
          ? data('{"broken" string="false">[]}', "stop", 1)
          : data(JSON.stringify(valid), "stop", 2),
    }),
    onUsage: (r) => receipts.push(r),
    onProgress: (p) => progress.push(p),
  });
  assert.equal(calls, 2);
  assert.equal(receipts[1].attempts.length, 2);
  assert.equal(receipts[1].usage.prompt_tokens, 200);
  assert.equal(result.usage.completion_tokens, 100);
  assert.ok(receipts[1].estimate.amount > receipts[0].estimate.amount);
  assert.equal(result.value.title, valid.title);
  assert.equal(progress[0].phase, "format-repair");
});
test("a second malformed response stops; there is no retry loop", async () => {
  let calls = 0;
  const receipts = [];
  await assert.rejects(
    requestStructuredStory({
      ...args,
      transport: async () => {
        calls++;
        return { ok: true, json: async () => data("bad") };
      },
      onUsage: (r) => receipts.push(r),
    }),
    /Unreadable/,
  );
  assert.equal(calls, 2);
  assert.equal(receipts.at(-1).usage.completion_tokens, 100);
});
test("truncation, HTTP failures, timeouts and disabled repairs never auto-retry", async () => {
  for (const transport of [
    async () => ({ ok: true, json: async () => data("broken", "length") }),
    async () => ({ ok: false, status: 429 }),
    async () => {
      throw Error("timeout");
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      requestStructuredStory({
        ...args,
        transport: async (...v) => {
          calls++;
          return transport(...v);
        },
        onUsage: () => {},
      }),
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    requestStructuredStory({
      ...args,
      config: { ...args.config, storyFormatRetries: 0 },
      transport: async () => {
        calls++;
        return { ok: true, json: async () => data("bad") };
      },
      onUsage: () => {},
    }),
    /Unreadable/,
  );
  assert.equal(calls, 1);
});

test('a completed tool response missing change arrays gets one bounded format retry', async () => {
  const toolData = value => ({...data(null), choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'submit_story_changes',arguments:JSON.stringify(value)}}]}}]});
  let calls = 0;
  const receipts=[];
  const result=await requestStructuredStory({...args,onUsage:r=>receipts.push(r),transport:async()=>({ok:true,json:async()=>toolData(++calls===1?{planning:{reply:'Done'}}:{...valid,removedBeatIds:[]})})});
  assert.equal(calls,2);
  assert.deepEqual(result.value.beats,[]);
  assert.equal(receipts.at(-1).attempts.length,2);
});

test('semantic changes never trigger a paid retry and failed output is retained for diagnosis', async () => {
  let calls=0;
  await assert.rejects(requestStructuredStory({...args,onUsage:()=>{},transport:async()=>{calls++;return {ok:true,json:async()=>({...data(null),choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'submit_story_changes',arguments:JSON.stringify({...valid,removedBeatIds:['unknown']})}}]}}]})}}}),e=>{assert.ok(e.providerResponse);return /unknown section/.test(e.message)});
  assert.equal(calls,1);
});
