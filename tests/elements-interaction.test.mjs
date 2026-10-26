import test from "node:test";
import assert from "node:assert/strict";
import {
  createElementEditSession,
  newElement,
  setElementPose,
  putKeyframe,
  toggleElementKeyframe,
  elementPose,
  validateElements,
  resizeElementTime,
  elementKeyboardCommand,
  nudgedElementPose,
} from "../shared/elements.mjs";
import {
  setMediaPose,
  mediaPose,
  mediaVisualKind,
} from "../shared/media-animation.mjs";
function harness() {
  let sequence = 0;
  const queue = new Map(),
    previews = [],
    commits = [];
  const session = createElementEditSession({
    preview: (value) => previews.push(value),
    commit: (id, type, patch) => commits.push({ id, type, patch }),
    schedule: (fn) => {
      queue.set(++sequence, fn);
      return sequence;
    },
    cancel: (id) => queue.delete(id),
  });
  return {
    session,
    previews,
    commits,
    queue,
    paint() {
      for (const [id, fn] of queue) {
        queue.delete(id);
        fn();
      }
    },
  };
}
test("hundreds of color inputs preview at paint speed and save exactly once without mutating the source", () => {
  const h = harness(),
    e = newElement("rectangle");
  for (let n = 0; n < 500; n++)
    h.session.patch(e, "element", {
      color: "#" + n.toString(16).padStart(6, "0"),
    });
  assert.equal(h.queue.size, 1);
  assert.equal(h.commits.length, 0);
  assert.equal(h.previews.length, 0);
  h.paint();
  assert.equal(h.previews.length, 1);
  assert.equal(h.previews[0].patch.color, "#0001f3");
  h.session.finish();
  h.session.finish();
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].patch.color, "#0001f3");
  assert.equal(e.color, "#80aff5");
});
test("a gesture cancelled before paint restores the original and does not create a save or undo entry", () => {
  const h = harness(),
    e = newElement("text");
  h.session.patch(e, "element", { rotation: 50 });
  h.session.cancel();
  h.paint();
  assert.equal(h.queue.size, 0);
  assert.equal(h.commits.length, 0);
  assert.deepEqual(h.previews, [null]);
  h.session.patch(e, "element", { color: e.color });
  assert.equal(h.session.finish(), false);
  assert.equal(h.commits.length, 0);
});
test("selection changes flush to the right item, and finish includes the last unpainted update", () => {
  const h = harness(),
    a = newElement("text"),
    b = newElement("arrow");
  h.session.patch(a, "element", { text: "مرحبا · hello" });
  h.session.patch(b, "element", { color: "#112233" });
  assert.equal(h.commits[0].id, a.id);
  assert.equal(h.commits[0].patch.text, "مرحبا · hello");
  h.session.finish();
  h.paint();
  assert.equal(h.commits[1].id, b.id);
  assert.equal(h.queue.size, 0);
});
test("repeated arrow key nudges accumulate into one edit while animated values retain the same key", () => {
  const h = harness();
  let e = newElement("rectangle");
  e = putKeyframe(e, 0);
  e = putKeyframe(e, 5, { ...e, x: 0.8 });
  for (let n = 0; n < 20; n++) {
    const current = h.session.value(e, "element");
    h.session.patch(
      e,
      "element",
      setElementPose(
        current,
        nudgedElementPose(
          elementPose(current, 2.5),
          "ArrowRight",
          false,
          1000,
          500,
        ),
        2.5,
      ),
    );
  }
  const draft = h.session.value(e, "element");
  assert.equal(draft.keyframes.length, 3);
  assert.ok(Math.abs(elementPose(draft, 2.5).x - 0.67) < 1e-10);
  h.session.finish();
  assert.equal(h.commits.length, 1);
  validateElements([{ ...e, ...h.commits[0].patch }]);
});
test("media position, rotation and opacity scrub into one current-time key, preserving fit and source timing", () => {
  const h = harness();
  let c = {
    id: "footage",
    start: 10,
    duration: 5,
    in: 7,
    visual: { fit: "cover" },
  };
  c.visual = setMediaPose(c, {}, 10, { keyframe: true });
  for (let n = 0; n < 60; n++) {
    const current = h.session.value(c, "media");
    h.session.patch(c, "media", {
      visual: setMediaPose(current, { rotation: n, opacity: 1 - n / 100 }, 12),
    });
  }
  h.session.finish();
  const saved = { ...c, ...h.commits[0].patch };
  assert.equal(h.commits.length, 1);
  assert.equal(saved.in, 7);
  assert.equal(saved.visual.keyframes.length, 2);
  assert.equal(mediaPose(saved, 12).rotation, 59);
  assert.equal(mediaPose(saved, 12).opacity, 0.41000000000000003);
  assert.equal(saved.visual.fit, "cover");
});
test("typing and unrelated controls never own element delete or nudge; platform shortcuts preserve normal editing", () => {
  const event = (key, extra = {}) => ({ key, ...extra });
  for (const key of ["Delete", "Backspace", "ArrowLeft", "d"]) {
    assert.equal(elementKeyboardCommand(event(key), { owned: false }), null);
    assert.equal(
      elementKeyboardCommand(event(key), { owned: true, editable: true }),
      null,
    );
    assert.equal(
      elementKeyboardCommand(event(key, { isComposing: true }), {
        owned: true,
      }),
      null,
    );
  }
  assert.equal(
    elementKeyboardCommand(event("Delete"), { owned: true }),
    "delete",
  );
  assert.equal(
    elementKeyboardCommand(event("Delete"), { owned: true, media: true }),
    null,
  );
  assert.equal(
    elementKeyboardCommand(event("d", { metaKey: true }), { owned: true }),
    "duplicate",
  );
  assert.equal(
    elementKeyboardCommand(event("d", { ctrlKey: true }), { owned: true }),
    "duplicate",
  );
  assert.equal(
    elementKeyboardCommand(event("d", { metaKey: true, repeat: true }), {
      owned: true,
    }),
    null,
  );
  assert.equal(
    elementKeyboardCommand(
      event("ArrowLeft", { shiftKey: true, repeat: true }),
      { owned: true },
    ),
    "nudge",
  );
  assert.equal(
    elementKeyboardCommand(event("z", { metaKey: true }), { owned: true }),
    null,
  );
  assert.equal(
    elementKeyboardCommand(event("Escape"), { owned: true }),
    "close",
  );
  assert.deepEqual(
    nudgedElementPose({ x: 0.5, y: 0.5 }, "ArrowDown", true, 1000, 500),
    { x: 0.5, y: 0.52 },
  );
  assert.equal(nudgedElementPose({ x: 2, y: 0.5 }, "ArrowRight", true).x, 2);
});
test("endpoint edits update one keyframe and removing the last key holds its visible pose", () => {
  let e = newElement("text");
  e = putKeyframe(e, 0, { ...e, x: 0.2 });
  e = putKeyframe(e, 5, { ...e, x: 0.9 });
  e = setElementPose(e, { rotation: 70 }, 4.999);
  assert.equal(e.keyframes.length, 2);
  assert.equal(e.keyframes[1].t, 5);
  e = toggleElementKeyframe(e, 0);
  e = toggleElementKeyframe(e, 4.999);
  assert.equal(e.keyframes.length, 0);
  assert.equal(elementPose(e, 1).x, 0.9);
  assert.equal(elementPose(e, 1).rotation, 70);
  const long = {
    ...newElement("text"),
    duration: 250,
    keyframes: Array.from({ length: 200 }, (_, t) => ({
      t,
      ...newElement("text"),
    })),
  };
  assert.throws(() => putKeyframe(long, 220), /200 keyframes/);
  assert.equal(putKeyframe(long, 100).keyframes.length, 200);
});
test("creation and trimming stay valid at the timeline boundary", () => {
  const e = newElement("ellipse", 86400);
  validateElements([e]);
  assert.equal(e.start + e.duration, 86400);
  validateElements([resizeElementTime(e, 90000, 400)]);
});

test("media delete requires its host removal callback while normal media transform shortcuts remain available", () => {
  const e = { key: "Delete" };
  assert.equal(elementKeyboardCommand(e, { owned: true, media: true }), null);
  assert.equal(
    elementKeyboardCommand(e, {
      owned: true,
      media: true,
      canRemoveMedia: true,
    }),
    "delete",
  );
  assert.equal(
    elementKeyboardCommand(e, {
      owned: false,
      media: true,
      canRemoveMedia: true,
    }),
    null,
  );
  assert.equal(
    elementKeyboardCommand({ key: "ArrowRight" }, { owned: true, media: true }),
    "nudge",
  );
});

test("still images are identified from the active take with a stored-media fallback", () => {
  assert.equal(
    mediaVisualKind({
      activeTake: "still",
      takes: [
        { id: "video", kind: "video" },
        { id: "still", kind: "image" },
      ],
    }),
    "image",
  );
  assert.equal(
    mediaVisualKind({
      activeTake: "video",
      takes: [
        { id: "video", kind: "video" },
        { id: "still", kind: "image" },
      ],
    }),
    "video",
  );
  assert.equal(
    mediaVisualKind(
      { activeTake: "still" },
      { media: [{ id: "still", kind: "image" }] },
    ),
    "image",
  );
  assert.equal(
    mediaVisualKind(
      { activeTake: "still" },
      { media: { still: { kind: "image" } } },
    ),
    "image",
  );
  assert.equal(mediaVisualKind(undefined), "video");
});
