import { planningColumns } from './planning-conversation.mjs';
// Only terminal nodes occupy the card lane. Ancestors label their descendants' span.
export function planningTimeline(plan, timings = new Map()) {
  const nodes = planningColumns(plan).flatMap(column=>column.nodes).map(node=>{const timing=timings.get(node.id);return timing?.placed ? {...node,start:timing.start,duration:timing.end-timing.start} : node;});
  const children = new Map();
  for(const node of nodes) {
    const list=children.get(node.parentId)||[];list.push(node);children.set(node.parentId,list);
  }
  const bounds=(node,seen=new Set())=>{
    if(seen.has(node.id)) return {start:node.start,end:node.start+node.duration};
    seen.add(node.id);
    const nested=children.get(node.id)||[];
    if(!nested.length) return {start:Math.max(0,node.start||0),end:Math.max(0,node.start||0)+Math.max(.1,node.duration||.1)};
    const spans=nested.map(n=>bounds(n,new Set(seen)));
    return {start:Math.min(...spans.map(s=>s.start)),end:Math.max(...spans.map(s=>s.end))};
  };
  const groups=nodes.filter(n=>children.has(n.id)).map(n=>({...n,...bounds(n)}));
  const cards=nodes.filter(n=>!children.has(n.id)).sort((a,b)=>a.start-b.start);
  return {groups,cards,depth:Math.max(0,...groups.map(n=>n.boardDepth+1)),end:Math.max(0,...cards.map(n=>n.start+n.duration))};
}

// Planning is a readable board, not a duration-proportional editing timeline.
export function planningBoard(layout, clips = [], pixelsPerSecond = 20) {
  const known = new Set(layout.cards.map(c => c.id));
  const represented = new Set();
  const imported = clips.filter(c => {const id=c.storyBeatId||c.structureNodeId;if(known.has(id)&&!represented.has(id)){represented.add(id);return false;}return true;}).map(c => ({
    id: `import:${c.id}`, importedClipId: c.id, nodeType: "clip", title: c.title || c.name || c.takes?.find(t=>t.id===c.activeTake)?.name || "Imported clip",
    description: c.description || "Imported media · ready to edit", start: c.start, duration: c.duration, boardDepth: 0,
  }));
  let left = 0;
  const cards = [...layout.cards, ...imported].sort((a,b)=>a.start-b.start).map(c => {
    const width = Math.max(260, Math.min(420, c.duration * pixelsPerSecond));
    const next = {...c, left, width}; left += width + 12; return next;
  });
  const end = Math.max(layout.end, ...cards.map(c=>c.start+c.duration), 0);
  const atTime = time => {
    const card = cards.find(c=>time>=c.start && time<c.start+c.duration) || (time>=end ? cards.at(-1) : cards.find(c=>c.start>=time));
    return card ? card.left + Math.max(0, Math.min(1,(time-card.start)/Math.max(.001,card.duration))) * card.width : 0;
  };
  const atPixel = x => {
    const card = cards.find(c=>x<c.left+c.width+12) || cards.at(-1);
    return card ? card.start+Math.max(0,Math.min(1,(x-card.left)/card.width))*card.duration : 0;
  };
  return {...layout, cards, end, width:Math.max(0,left-12), atTime, atPixel};
}
