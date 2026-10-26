export function nextPreviewClip(clips, current, time, playing, enabled) {
  if (
    !enabled ||
    !playing ||
    !current ||
    current.start + current.duration - time > 3
  )
    return null;
  const end = current.start + current.duration;
  return (
    clips
      .filter(
        (c) =>
          c.id !== current.id &&
          c.activeTake &&
          c.start >= end - 0.001 &&
          c.start - time <= 5,
      )
      .sort((a, b) => a.start - b.start)[0] || null
  );
}
export function previewSlotKey(item) {
  return item?.take?.url
    ? JSON.stringify([item.clip.id, item.take.id, item.take.url])
    : null;
}
export function planPreviewSlots(previous, current, next) {
  const key = previewSlotKey(current),
    nextKey = previewSlotKey(next);
  if (!key) return { slots: [null, null], active: 0 };
  let active = previous.findIndex((item) => previewSlotKey(item) === key);
  if (active < 0) active = 0;
  const slots = [null, null];
  slots[active] = current;
  if (nextKey && nextKey !== key) slots[1 - active] = next;
  return { slots, active };
}
// Bound by estimated bytes as well as count. Entries are rebuildable UI data only.
export class MemoryLRU {
  constructor(limit = 32, maxBytes = 8 * 1024 * 1024) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.items = new Map();
    this.bytes = 0;
  }
  get(key) {
    const entry = this.items.get(key);
    if (!entry) return;
    this.items.delete(key);
    this.items.set(key, entry);
    return entry.value;
  }
  set(key, value, bytes = 1) {
    this.delete(key);
    if (bytes > this.maxBytes) return value;
    this.items.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.items.size > this.limit || this.bytes > this.maxBytes)
      this.delete(this.items.keys().next().value);
    return value;
  }
  delete(key) {
    const e = this.items.get(key);
    if (e) this.bytes -= e.bytes;
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
    this.bytes = 0;
  }
}
