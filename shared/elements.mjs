export const elementFonts = [
  { id: "Noto Sans", label: "Sans", file: "NotoSans.ttf" },
  { id: "Noto Serif", label: "Serif", file: "NotoSerif.ttf" },
  { id: "Noto Sans Mono", label: "Mono", file: "NotoSansMono.ttf" },
  { id: "Noto Sans Arabic", label: "Arabic", file: "NotoSansArabic.ttf" },
];
export const elementKinds = ["text", "rectangle", "ellipse", "arrow"];
export const defaultPose = {
  x: 0.5,
  y: 0.5,
  w: 0.4,
  h: 0.2,
  rotation: 0,
  opacity: 1,
};
const bounds = {
  x: [-1, 2],
  y: [-1, 2],
  w: [0.02, 2],
  h: [0.02, 2],
  rotation: [-360, 360],
  opacity: [0, 1],
};
export function normalizePose(input = {}) {
  const result = {};
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const n = input[key] ?? defaultPose[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      throw Error(`Invalid element ${key}`);
    result[key] = n;
  }
  return result;
}
export function validateElements(items = []) {
  if (!Array.isArray(items) || items.length > 100)
    throw Error("Use up to 100 elements per project.");
  const ids = new Set();
  for (const e of items) {
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      e.id.length > 100 ||
      ids.has(e.id) ||
      !elementKinds.includes(e.kind)
    )
      throw Error("Invalid element.");
    ids.add(e.id);
    if (
      typeof e.start !== "number" ||
      !Number.isFinite(e.start) ||
      e.start < 0 ||
      typeof e.duration !== "number" ||
      !Number.isFinite(e.duration) ||
      e.duration < 0.1 ||
      e.start + e.duration > 86400
    )
      throw Error("Invalid element timing.");
    normalizePose(e);
    if (e.episodeId != null && typeof e.episodeId !== "string")
      throw Error("Invalid element episode.");
    if (typeof e.text !== "string" || e.text.length > 2000)
      throw Error("Keep element text under 2000 characters.");
    if (
      !/^#[0-9a-f]{6}$/i.test(e.color) ||
      !elementFonts.some((f) => f.id === e.font) ||
      ![400, 700].includes(e.weight) ||
      !["left", "center", "right"].includes(e.align) ||
      !["linear", "smooth", "hold"].includes(e.easing)
    )
      throw Error("Invalid element styling.");
    if (!Number.isFinite(e.fontSize) || e.fontSize < 0.01 || e.fontSize > 0.5)
      throw Error("Invalid text size.");
    if (!Array.isArray(e.keyframes) || e.keyframes.length > 200)
      throw Error("Use up to 200 keyframes per element.");
    let last = -1;
    for (const k of e.keyframes) {
      if (!Number.isFinite(k.t) || k.t < 0 || k.t > e.duration || k.t <= last)
        throw Error("Invalid element keyframes.");
      normalizePose(k);
      last = k.t;
    }
  }
  return items;
}
export function newElement(kind, time = 0, episodeId) {
  return {
    id: crypto.randomUUID(),
    kind,
    episodeId,
    start: Math.max(0, Math.min(86395, Number.isFinite(time) ? time : 0)),
    duration: 5,
    text: kind === "text" ? "Your text" : "",
    color: kind === "text" ? "#ffffff" : "#80aff5",
    font: "Noto Sans",
    fontSize: 0.09,
    weight: 400,
    align: "center",
    easing: "smooth",
    ...defaultPose,
    ...(kind === "arrow" ? { w: 0.3, h: 0.1 } : {}),
    keyframes: [],
  };
}
export function elementsFor(project) {
  return (project.elements || []).filter(
    (e) => !e.episodeId || e.episodeId === project.episodeId,
  );
}
export function elementPose(e, time) {
  const frames = e.keyframes || [],
    t = Math.max(0, Math.min(e.duration, time - e.start));
  if (!frames.length) return normalizePose(e);
  if (t <= frames[0].t) return normalizePose(frames[0]);
  if (t >= frames.at(-1).t) return normalizePose(frames.at(-1));
  const index = frames.findIndex((f) => f.t > t),
    a = frames[index - 1],
    b = frames[index];
  let mix = (t - a.t) / (b.t - a.t);
  if (e.easing === "hold") mix = 0;
  else if (e.easing === "smooth") mix = mix * mix * (3 - 2 * mix);
  return Object.fromEntries(
    Object.keys(defaultPose).map((key) => [
      key,
      normalizePose(a)[key] +
        (normalizePose(b)[key] - normalizePose(a)[key]) * mix,
    ]),
  );
}
export function setElementPose(e, patch, time) {
  const nearby = e.keyframes.find(
    (k) => Math.abs(k.t - (time - e.start)) < 0.025,
  );
  const pose = normalizePose({
    ...elementPose(e, nearby ? e.start + nearby.t : time),
    ...patch,
  });
  if (!e.keyframes.length) return { ...e, ...pose };
  return putKeyframe(e, time, pose);
}
export function putKeyframe(e, time, pose = elementPose(e, time)) {
  let t =
    Math.round(Math.max(0, Math.min(e.duration, time - e.start)) * 1000) / 1000;
  const nearby = e.keyframes.find((k) => Math.abs(k.t - t) < 0.025);
  if (nearby) t = nearby.t;
  const frames = e.keyframes.filter((k) => Math.abs(k.t - t) > 0.001);
  if (frames.length >= 200)
    throw Error(
      "This element has 200 keyframes. Remove one before adding another.",
    );
  return {
    ...e,
    keyframes: [...frames, { t, ...normalizePose(pose) }].sort(
      (a, b) => a.t - b.t,
    ),
  };
}
export function resizeElementTime(e, start, duration) {
  start = Math.max(0, Math.min(86399.9, start));
  duration = Math.max(0.1, Math.min(86400 - start, duration));
  const scale = duration / e.duration;
  return {
    ...e,
    start: Math.max(0, start),
    duration: Math.max(0.1, duration),
    keyframes: e.keyframes.map((k) => ({ ...k, t: k.t * scale })),
  };
}
export const escapeXML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export function elementMarkup(e, time, width, height, index = 0) {
  const p = elementPose(e, time),
    w = p.w * width,
    h = p.h * height,
    fs = e.fontSize * height;
  let content = "";
  if (e.kind === "rectangle")
    content = `<rect width="${w}" height="${h}" rx="${Math.min(w, h) * 0.06}"/>`;
  if (e.kind === "ellipse")
    content = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
  if (e.kind === "arrow")
    content = `<path d="M0 ${h * 0.35} H${w * 0.65} V0 L${w} ${h / 2} L${w * 0.65} ${h} V${h * 0.65} H0 Z"/>`;
  if (e.kind === "text") {
    // Stable line layout is shared by the preview and export renderer.
    const max = Math.max(1, Math.floor(w / (fs * 0.6))),
      lines = [];
    for (const paragraph of e.text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(" ")) {
        if (line && (line + " " + word).length > max) {
          lines.push(line);
          line = "";
        }
        line += (line ? " " : "") + word;
      }
      lines.push(line);
    }
    const anchor =
        e.align === "left" ? "start" : e.align === "right" ? "end" : "middle",
      x = e.align === "left" ? 0 : e.align === "right" ? w : w / 2;
    const first = (h - lines.length * fs * 1.2) / 2 + fs;
    content = `<clipPath id="element-text-${index}"><rect width="${w}" height="${h}"/></clipPath><text clip-path="url(#element-text-${index})" font-family="${e.font}" font-size="${fs}" font-weight="${e.weight}" text-anchor="${anchor}"${/[\u0600-\u06ff]/.test(e.text) ? ' direction="rtl" unicode-bidi="plaintext"' : ""}>${lines.map((line, i) => `<tspan x="${x}" y="${first + i * fs * 1.2}">${escapeXML(line)}</tspan>`).join("")}</text>`;
  }
  return `<g fill="${e.color}" opacity="${p.opacity}" transform="translate(${p.x * width} ${p.y * height}) rotate(${p.rotation}) translate(${-w / 2} ${-h / 2})">${content}</g>`;
}
export function elementsSVG(elements, time, width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements
    .filter((e) => time >= e.start && time < e.start + e.duration)
    .map((e, i) => elementMarkup(e, time, width, height, i))
    .join("")}</svg>`;
}
export function normalizeMediaTransform(value = {}) {
  return {
    ...normalizePose({ ...defaultPose, w: 1, h: 1, ...value }),
    fit: value.fit === "cover" ? "cover" : "contain",
  };
}

// A gesture previews at most once per paint, then creates one project edit.
// Kept independent of React so pointer, keyboard and native color controls agree.
export function createElementEditSession({
  preview,
  commit,
  schedule,
  cancel,
}) {
  let current = null,
    pending = null;
  const clearPaint = () => {
    if (pending !== null) cancel(pending);
    pending = null;
  };
  const api = {
    begin(item, type) {
      if (current?.item.id === item.id && current.type === type) return current;
      api.finish();
      current = { item, type, patch: {} };
      return current;
    },
    patch(item, type, patch) {
      const edit = api.begin(item, type);
      Object.assign(edit.patch, patch);
      if (pending === null)
        pending = schedule(() => {
          pending = null;
          if (current)
            preview({ id: current.item.id, patch: { ...current.patch } });
        });
    },
    value(item, type) {
      return current?.item.id === item.id && current.type === type
        ? { ...item, ...current.patch }
        : item;
    },
    finish() {
      clearPaint();
      const edit = current;
      current = null;
      if (!edit) return false;
      preview(null);
      const changed = Object.entries(edit.patch).some(
        ([key, value]) =>
          JSON.stringify(edit.item[key]) !== JSON.stringify(value),
      );
      if (changed) commit(edit.item.id, edit.type, edit.patch);
      return changed;
    },
    cancel() {
      clearPaint();
      current = null;
      preview(null);
    },
    get active() {
      return !!current;
    },
  };
  return api;
}
export function toggleElementKeyframe(e, time) {
  const key = e.keyframes.find((k) => Math.abs(k.t - (time - e.start)) < 0.025);
  if (!key) return putKeyframe(e, time);
  const keyframes = e.keyframes.filter((k) => k !== key);
  return {
    ...e,
    ...(!keyframes.length ? elementPose(e, time) : {}),
    keyframes,
  };
}
export function elementKeyboardCommand(
  event,
  {
    editable = false,
    owned = false,
    media = false,
    canRemoveMedia = false,
  } = {},
) {
  if (
    !owned ||
    editable ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey
  )
    return null;
  const key = event.key.toLowerCase(),
    modifier = event.metaKey || event.ctrlKey;
  if (modifier)
    return !media && key === "d" && !event.repeat ? "duplicate" : null;
  if (key === "escape") return "close";
  if ((!media || canRemoveMedia) && ["backspace", "delete"].includes(key))
    return event.repeat ? null : "delete";
  if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key))
    return "nudge";
  return null;
}
export function nudgedElementPose(
  pose,
  key,
  shift = false,
  width = 1000,
  height = 1000,
) {
  const amount = shift ? 10 : 1;
  return {
    x: Math.max(
      -1,
      Math.min(
        2,
        pose.x +
          (key === "ArrowRight" ? amount : key === "ArrowLeft" ? -amount : 0) /
            Math.max(1, width),
      ),
    ),
    y: Math.max(
      -1,
      Math.min(
        2,
        pose.y +
          (key === "ArrowDown" ? amount : key === "ArrowUp" ? -amount : 0) /
            Math.max(1, height),
      ),
    ),
  };
}
