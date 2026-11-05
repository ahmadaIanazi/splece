const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function boundedBox(box) {
  const w = clamp(box.w, 0.02, 1),
    h = clamp(box.h, 0.02, 1);
  return { x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h), w, h };
}
const distance = (a, b) =>
  Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
export function associateFaces(samples) {
  const tracks = [];
  for (const sample of samples) {
    const faces = sample.faces
      .filter((f) => f.confidence >= 0.55 && f.w > 0.02 && f.h > 0.02)
      .map((f) => ({ box: boundedBox(f), confidence: f.confidence }));
    const candidates = [];
    for (let i = 0; i < tracks.length; i++)
      for (let j = 0; j < faces.length; j++) {
        const previous = tracks[i].points.at(-1),
          gap = sample.t - previous.t;
        const dist = distance(previous.box, faces[j].box),
          size = Math.abs(Math.log(faces[j].box.w / previous.box.w));
        if (gap <= 1 && dist < 0.2 && size < 0.8)
          candidates.push({ i, j, score: dist + size * 0.05 });
      }
    const usedTracks = new Set(),
      usedFaces = new Set();
    for (const { i, j } of candidates.sort((a, b) => a.score - b.score)) {
      if (usedTracks.has(i) || usedFaces.has(j)) continue;
      tracks[i].points.push({ t: sample.t, ...faces[j] });
      usedTracks.add(i);
      usedFaces.add(j);
    }
    for (let j = 0; j < faces.length; j++)
      if (!usedFaces.has(j) && tracks.length < 12)
        tracks.push({
          id: `face-${tracks.length + 1}`,
          kind: "face",
          name: `Person ${tracks.length + 1}`,
          characterId: "",
          points: [{ t: sample.t, ...faces[j] }],
        });
  }
  return tracks
    .filter((s) => s.points.length >= 2)
    .sort(
      (a, b) =>
        b.points.length * b.points[0].box.w * b.points[0].box.h -
        a.points.length * a.points[0].box.w * a.points[0].box.h,
    )
    .slice(0, 6);
}
export function grayFrame(rgba, width, height) {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = Math.round(
      rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114,
    );
  return { pixels, width, height };
}
function patch(frame, box, size = 16) {
  const values = new Float32Array(size * size);
  let sum = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = clamp(
        Math.floor((box.x + ((x + 0.5) / size) * box.w) * frame.width),
        0,
        frame.width - 1,
      );
      const py = clamp(
        Math.floor((box.y + ((y + 0.5) / size) * box.h) * frame.height),
        0,
        frame.height - 1,
      );
      const value = frame.pixels[py * frame.width + px];
      values[y * size + x] = value;
      sum += value;
    }
  const mean = sum / values.length;
  let norm = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] -= mean;
    norm += values[i] * values[i];
  }
  norm = Math.sqrt(norm);
  return { values, norm };
}
export function trackSelectedSubject(frames, seed) {
  const anchor = frames.reduce(
    (best, f, i) =>
      Math.abs(f.t - seed.t) < Math.abs(frames[best].t - seed.t) ? i : best,
    0,
  );
  const reference = patch(frames[anchor], seed.box),
    result = [{ t: frames[anchor].t, box: seed.box, confidence: 1 }];
  if (reference.norm < 80) return result;
  for (const direction of [-1, 1]) {
    let box = seed.box,
      misses = 0;
    for (
      let i = anchor + direction;
      i >= 0 && i < frames.length;
      i += direction
    ) {
      const frame = frames[i];
      let best = { score: -1, box };
      const radiusX = Math.max(0.06, box.w * 0.65),
        radiusY = Math.max(0.06, box.h * 0.65);
      for (const scale of [0.92, 1, 1.08])
        for (
          let dy = -Math.ceil((radiusY * frame.height) / 2) * 2;
          dy <= radiusY * frame.height;
          dy += 2
        )
          for (
            let dx = -Math.ceil((radiusX * frame.width) / 2) * 2;
            dx <= radiusX * frame.width;
            dx += 2
          ) {
            const candidate = boundedBox({
              x: box.x + (box.w * (1 - scale)) / 2 + dx / frame.width,
              y: box.y + (box.h * (1 - scale)) / 2 + dy / frame.height,
              w: box.w * scale,
              h: box.h * scale,
            });
            const sample = patch(frame, candidate);
            if (sample.norm < 80) continue;
            let dot = 0;
            for (let k = 0; k < sample.values.length; k++)
              dot += sample.values[k] * reference.values[k];
            const score =
              dot / (sample.norm * reference.norm) -
              distance(candidate, box) * 0.08;
            if (score > best.score) best = { score, box: candidate };
          }
      if (best.score < 0.6) {
        misses++;
        if (misses >= 2) break;
        continue;
      }
      misses = 0;
      box = best.box;
      result.push({ t: frame.t, box, confidence: clamp(best.score, 0, 1) });
    }
  }
  return result.sort((a, b) => a.t - b.t);
}
