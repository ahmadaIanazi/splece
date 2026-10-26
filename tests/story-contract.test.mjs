import test from "node:test";
import assert from "node:assert/strict";
import {
  storyTool,
  storyToolFor,
  materializeStoryChanges,
  parseStoryCompletion,
  parseStoryJson,
} from "../shared/story-contract.mjs";
import { requestStory } from "../server/authoring.mjs";
import { newProject } from "../server/domain.mjs";
import { storyPlan, validateStorySetup } from "../shared/authoring.mjs";
import {
  conversationFixture,
  validatePlanningMessage,
  planningMessages,
  recordPlanningMessage,
} from "../shared/planning-conversation.mjs";
import { applyStructureJob } from "../shared/structure-workflow.mjs";

const inputFor = () => {
  const p = newProject("Structure contract regression");
  p.assets = [];
  return {
    p,
    input: {
      action: "conversation",
      planningMessage: "A quiet garden.",
      episodeId: p.episodeId,
      plan: structuredClone(storyPlan(p)),
      assets: [],
    },
  };
};
const completion = (changes) => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        tool_calls: [
          {
            type: "function",
            function: {
              name: storyTool.function.name,
              arguments: JSON.stringify(changes),
            },
          },
        ],
      },
    },
  ],
});

test("strict DeepSeek schema requires every object field and disallows extra fields", () => {
  const visit = (s) => {
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual(s.required, Object.keys(s.properties));
      Object.values(s.properties).forEach(visit);
    }
    if (s.items) visit(s.items);
  };
  visit(storyTool.function.parameters);
  assert.equal(storyTool.function.strict, true);
});
test("empty, whitespace, nontext and oversized requests stop before any provider call", async () => {
  const { input } = inputFor();
  let calls = 0;
  for (const message of [
    "",
    " \n\t ",
    undefined,
    null,
    {},
    "x".repeat(20001),
  ]) {
    await assert.rejects(
      requestStory(
        { ...input, planningMessage: message },
        { mode: "deepseek" },
        "fake-key",
        async () => {
          calls++;
          throw Error("Unexpected network");
        },
      ),
      /Write an idea|too long/,
    );
  }
  assert.equal(calls, 0);
  assert.equal(validatePlanningMessage("x".repeat(20000)).length, 20000);
  const { p } = inputFor();
  recordPlanningMessage(p, {
    id: "long",
    role: "user",
    text: "x".repeat(20000),
  });
  assert.equal(planningMessages(p)[0].text.length, 20000);
});
test("product-only stories accept zero cast without weakening text validation", () => {
  assert.equal(validateStorySetup({ castCount: 0 }, []).castCount, 0);
  assert.throws(() => validateStorySetup({ castCount: -1 }, []), /Cast count/);
  assert.throws(() => validateStorySetup({ castCount: "0" }, []), /Cast count/);
});
test("redundant trailing closers can be removed without rewriting any author text", () => {
  const value = {
      text: 'Quotes " and braces } ] {, Arabic صوص and a slash \\',
      nested: [{ a: 1 }],
    },
    s = JSON.stringify(value);
  assert.deepEqual(parseStoryJson(s + "}"), { value, normalized: true });
  assert.deepEqual(parseStoryJson(s), { value, normalized: false });
  for (const invalid of [
    s.slice(0, -1),
    s + '{"other":1}',
    s + " commentary",
    s + "\nnull",
    '{"a":1,}',
    '{"a":NaN}',
    "```json\n" + s + "\n```",
  ])
    assert.throws(() => parseStoryJson(invalid), /Unreadable/);
});
test("one changed scene leaves 999 unrelated scenes and user setup metadata intact", () => {
  const { input } = inputFor();
  input.plan = {
    ...input.plan,
    setup: {
      creativeMix: { look: ["Paper"] },
      concept: "Original author writing",
    },
    beats: Array.from({ length: 1000 }, (_, i) => ({
      id: "scene-" + i,
      title: "Scene " + i,
      start: i * 10,
      duration: 10,
      end: i * 10 + 10,
      parentId: "",
      label: "Manual label",
      description: "My words " + i,
    })),
  };
  const before = structuredClone(input.plan),
    result = materializeStoryChanges(
      {
        beats: [
          { id: "scene-500", title: "New title", start: 5000, duration: 10 },
        ],
        removedBeatIds: [],
        setup: { language: "Arabic" },
      },
      input,
    );
  assert.equal(result.beats.length, 1000);
  assert.deepEqual(result.setup.creativeMix, before.setup.creativeMix);
  assert.equal(result.beats[500].description, before.beats[500].description);
  for (let i = 0; i < 1000; i++)
    if (i !== 500) assert.deepEqual(result.beats[i], before.beats[i]);
  assert.deepEqual(input.plan, before);
});
test("ambiguous node edits and malformed or truncated output never partially apply", () => {
  const { input } = inputFor();
  input.plan.beats = [{ id: "a", start: 0, duration: 5 }];
  const before = structuredClone(input);
  for (const changes of [
    { beats: [], removedBeatIds: ["unknown"] },
    { beats: [{ id: "a" }, { id: "a" }], removedBeatIds: [] },
    { beats: [{ id: "a" }], removedBeatIds: ["a"] },
  ])
    assert.throws(
      () => materializeStoryChanges(changes, input),
      /unknown|conflicting/,
    );
  assert.throws(
    () =>
      parseStoryCompletion(
        {
          choices: [
            { finish_reason: "length", message: { content: '{"beats":' } },
          ],
        },
        input,
      ),
    /cut short/,
  );
  assert.throws(
    () =>
      parseStoryCompletion(
        { choices: [{ finish_reason: "stop", message: { content: "" } }] },
        input,
      ),
    /Unreadable/,
  );
  assert.throws(
    () =>
      parseStoryCompletion(
        { choices: [{ finish_reason: "stop", message: { content: "null" } }] },
        input,
      ),
    /Expected/,
  );
  const bad = completion({});
  bad.choices[0].message.tool_calls[0].function.name = "generate_video";
  assert.throws(() => parseStoryCompletion(bad, input), /unexpected format/);
  assert.deepEqual(input, before);
});
test("compact development has one typed clip and preserves unrelated sections", () => {
  const { input } = inputFor();
  input.action = "children";
  input.expandId = "parent";
  input.plan.beats = [
    { id: "parent", generationMode: "compact", childNodeType: "clip" },
    { id: "old", parentId: "parent" },
    { id: "outside", description: "Keep me" },
  ];
  const tool = storyToolFor(input);
  assert.ok(tool.function.parameters.properties.developedClip);
  assert.equal(tool.function.parameters.properties.beats, undefined);
  const value = parseStoryCompletion(
    completion({
      developedClip: {
        id: "old",
        parentId: "parent",
        start: 0,
        duration: 10,
        description: "One complete scene",
      },
    }),
    input,
  );
  assert.equal(value.beats.filter((b) => b.parentId === "parent").length, 1);
  assert.deepEqual(
    value.beats.find((b) => b.id === "outside"),
    input.plan.beats[2],
  );
});
test("real request uses a forced typed tool and persists usage before validating references", async () => {
  const { p, input } = inputFor(),
    changes = { ...conversationFixture(input), removedBeatIds: [] };
  let receipt = false,
    saved = false;
  changes.beats.find((b) => b.nodeType === "clip").characterIds = [
    "missing-character",
  ];
  const before = structuredClone(p);
  await assert.rejects(
    requestStory(
      input,
      { mode: "deepseek", model: "deepseek-flash" },
      "fake",
      async (url, opts) => {
        assert.equal(url, "https://api.deepseek.com/beta/chat/completions");
        const request = JSON.parse(opts.body);
        assert.equal(request.tools[0].function.strict, true);
        assert.equal(
          request.tool_choice.function.name,
          storyTool.function.name,
        );
        assert.equal(request.thinking.type, "disabled");
        return {
          ok: true,
          json: async () => ({
            ...completion(changes),
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          }),
        };
      },
      () => {
        saved = true;
      },
      () => {
        receipt = true;
      },
    ),
    /unknown character/,
  );
  assert.equal(receipt, true);
  assert.equal(saved, true);
  assert.deepEqual(p, before);
});
test("typed changes apply once and preserve exact existing dialogue", async () => {
  const { p, input } = inputFor(),
    changes = { ...conversationFixture(input), removedBeatIds: [] };
  const clip = changes.beats.find((b) => b.nodeType === "clip");
  clip.dialogue = [
    {
      speaker: changes.characters[0].id,
      text: "مرحباً! أنا نورة، وصديقي صوص.",
      delivery: "Warmly",
      direction: "",
    },
  ];
  const mock = async () => ({
    ok: true,
    json: async () => completion(changes),
  });
  const result = await requestStory(
      input,
      { mode: "deepseek", model: "deepseek-flash" },
      "fake",
      mock,
    ),
    job = {
      id: "strict-result",
      episodeId: p.episodeId,
      state: "ready",
      action: "conversation",
      result,
    };
  assert.equal(applyStructureJob(p, job).applied, true);
  assert.equal(applyStructureJob(p, job).skipped, true);
  const follow = {
      ...input,
      assets: p.assets,
      plan: structuredClone(storyPlan(p)),
    },
    node = follow.plan.beats.find((b) => b.nodeType === "clip");
  const altered = {
    ...follow.plan,
    characters: [],
    assets: [],
    beats: [{ ...node, dialogue: [{ ...node.dialogue[0], text: "Changed" }] }],
    removedBeatIds: [],
  };
  await assert.rejects(
    requestStory(follow, { mode: "deepseek" }, "fake", async () => ({
      ok: true,
      json: async () => completion(altered),
    })),
    /changed or omitted existing dialogue/,
  );
});
