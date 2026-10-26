export const MAX_DIALOGUE_TEMPO = 1.2;
export function dialogueTiming(parts, duration, maximum = MAX_DIALOGUE_TEMPO) {
  let end=0;
  return parts.map((part,index)=>{
    const next=parts[index+1];
    const start=Math.max(Number(part.start)||0,end);
    const available=Math.max(.05,Math.min(next?.start ?? duration,duration)-start-.04);
    const speed=Math.max(1,Math.min(maximum,(part.audioDuration||part.duration)/available));
    const actualDuration=(part.audioDuration||part.duration)/speed;
    end=start+actualDuration+.12;
    return {start,duration:actualDuration,speed};
  });
}
