// One material system for every independently drawn object. No paid recoloring.
export function mixPaint(a, b, weight = 0.5) {
  const rgb = (c) =>
    /^#[\da-f]{6}$/i.test(c || "")
      ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
      : [128, 128, 128];
  const x = rgb(a),
    y = rgb(b);
  return (
    "#" +
    x
      .map((v, i) =>
        Math.round(v * (1 - weight) + y[i] * weight)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function materialPaint(colors, node = {}, manualPalette = false) {
  const [
    bg = "#293346",
    surroundings = "#72819a",
    main = "#b1c8ca",
    accent = main,
  ] = colors;
  const body =
    node.bodyColor && (!manualPalette || node.locks?.includes("bodyColor"))
      ? node.bodyColor
      : main;
  const detail =
    node.accentColor && (!manualPalette || node.locks?.includes("accentColor"))
      ? node.accentColor
      : accent;
  return {
    body,
    secondary: mixPaint(body, bg, 0.28),
    ink: mixPaint(body, bg, 0.62),
    accent: mixPaint(detail, body, 0.2),
    paper: mixPaint(body, "#f6f0e7", 0.36),
    skin: node.skinColor || "#bd9d89",
    none: "none",
  };
}
