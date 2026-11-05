import test from "node:test";
import assert from "node:assert/strict";
import {
  studioStart,
  studioNavigation,
  toolViews,
} from "../shared/studio-navigation.mjs";
test("entry, tool toggles and dismissals have one coherent timeline view", () => {
  assert.deepEqual(studioStart(""), { tool: null, panel: false });
  assert.equal(toolViews[studioStart("#plan").tool], "plan");
  for (const tool of Object.keys(toolViews)) {
    const open = studioNavigation(studioStart(""), { type: "open", tool });
    assert.equal(open.tool, tool);
    assert.equal(open.panel, true);
    assert.deepEqual(studioNavigation(open, { type: "open", tool }), {
      tool: null,
      panel: false,
    });
    assert.deepEqual(studioNavigation(open, { type: "close" }), {
      tool: null,
      panel: false,
    });
  }
});
test("inspectors preserve their working context and can reopen a tool", () => {
  const inspector = studioNavigation(studioStart(""), {
    type: "inspect",
    tool: "elements",
  });
  assert.equal(toolViews[inspector.tool], "elements");
  assert.equal(inspector.panel, false);
  assert.equal(
    studioNavigation(inspector, { type: "open", tool: "elements" }).panel,
    true,
  );
  assert.equal(
    studioNavigation({ tool: "sound", panel: true }, { type: "close" }).tool,
    null,
  );
});
