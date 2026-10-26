// Browser recovery is optional; quota/security failures must never crash editing.
export function saveLocalDraft(storage, key, value) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Preferences must never interrupt project loading or editing.
export function setBrowserPreference(key, value, storage) {
  try {
    (storage || globalThis.localStorage).setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

// This is only the reload cache; the active session's undo stacks stay intact.
// Never evict journals or another project's data to make room for undo.
export function saveUndoCache(storage, key, past, future, maxBytes = 256 * 1024) {
  const cache = { past: past.slice(-15), future: future.slice(-15) };
  while (true) {
    const value = JSON.stringify(cache);
    if (value.length * 2 <= maxBytes) {
      try {
        storage.setItem(key, value);
        return true;
      } catch { /* Retry with fewer optional undo snapshots. */ }
    }
    if (cache.past.length) cache.past.shift();
    else if (cache.future.length) cache.future.shift();
    else return false;
  }
}
