// A convenience hint, never a claim that a browser proves hardware compatibility.
export function downloadDevice({userAgent='',platform='',maxTouchPoints=0,userAgentData}={}) {
  const hint=userAgentData?.platform || platform;
  const mobile=Boolean(userAgentData?.mobile)||/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)||(/Mac/i.test(hint)&&maxTouchPoints>1);
  if(mobile)return {mobile:true,platform:null};
  if(/Win/i.test(hint)||/Windows/i.test(userAgent))return {mobile:false,platform:'windows'};
  if(/Mac/i.test(hint)||/Macintosh/i.test(userAgent))return {mobile:false,platform:'mac'};
  if(/CrOS/i.test(userAgent))return {mobile:false,platform:null};
  if(/Linux/i.test(hint)||/Linux/i.test(userAgent))return {mobile:false,platform:'linux'};
  return {mobile:false,platform:null};
}
export const platformNames={mac:'Mac',windows:'Windows',linux:'Linux'};
