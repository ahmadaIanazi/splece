export const toolViews = Object.freeze({
  plan: "plan",
  prompt: "video",
  effects: "video",
  sound: "sound",
  elements: "elements",
  direction: "direction",
});
export const studioStart = (hash) => ({
  tool: ["#plan", "#story"].includes(hash) ? "plan" : null,
  panel: ["#plan", "#story"].includes(hash),
});
export function studioNavigation(state, action) {
  if (action.type === "close") return { tool: null, panel: false };
  if (action.type === "inspect") return { tool: action.tool, panel: false };
  if (action.type === "open" && toolViews[action.tool]) {
    return !action.force && state.tool === action.tool && state.panel
      ? { tool: null, panel: false }
      : { tool: action.tool, panel: true };
  }
  return state;
}
