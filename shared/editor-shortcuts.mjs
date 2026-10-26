// One keyboard owner per event. These are existing commands, not new bindings.
export const editableSelector = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
export const controlSelector = 'button,a[href],summary,[role="button"],[role="slider"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"],[role="menuitem"]';
export function editShortcut(e, { editable = false, control = false, editor = true, composer = false, timeline = false, clip = false } = {}) {
  if (e.defaultPrevented || e.repeat || e.altKey || e.isComposing) return null;
  const key = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
  if (mod && key === 's' && !e.shiftKey) return 'save';
  if (editable) return null;
  if (mod && key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (!editor || composer || (control && !clip)) return null;
  if (mod && !e.shiftKey) return ({ a: timeline ? 'selectAll' : null, c: 'copy', x: 'cut', v: 'paste' })[key] || null;
  if (mod || e.shiftKey) return null;
  return ({ s: 'split', delete: 'remove', backspace: 'remove', escape: 'clear' })[key] || null;
}
export function ownsTransport(e, { editable = false, control = false, blocked = false } = {}) {
  return !blocked && !editable && !control && !e.defaultPrevented && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey &&
    ['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !(e.code === 'Space' && (e.repeat || e.shiftKey));
}
export function shortcutHint(key, shift = false, platform = '') {
  return /Mac|iPhone|iPad/.test(platform) ? `${shift ? '⇧' : ''}⌘${key.toUpperCase()}` : `Ctrl+${shift ? 'Shift+' : ''}${key.toUpperCase()}`;
}
