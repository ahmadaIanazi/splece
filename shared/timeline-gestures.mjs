const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function scrubTime({ clientX, left, scrollLeft, zoom, fps, maxTime, offset = 0 }) {
  const seconds = (clientX - left + scrollLeft - offset) / zoom;
  return clamp(Math.round(seconds * fps) / fps, 0, maxTime);
}

export function wheelZoom({ zoom, scrollLeft, pointerX, deltaY, deltaMode = 0, width = 800 }) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? width : 1);
  const nextZoom = clamp(zoom * Math.exp(-clamp(pixels, -240, 240) * 0.003), 0.1, 240);
  const at = (scrollLeft + pointerX) / zoom;
  return { zoom: nextZoom, left: Math.max(0, at * nextZoom - pointerX) };
}
