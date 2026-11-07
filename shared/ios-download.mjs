// Mobile navigation is independent of the desktop installer recommendation.
export function isAppleMobile({userAgent='',platform='',maxTouchPoints=0}={}) {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Mac/i.test(platform) && maxTouchPoints>1);
}

// Release owners set downloads.json.ios only after verifying public access.
export function iosDownload(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
  if (url.hostname === 'apps.apple.com' && /^\/(?:[a-z]{2}\/)?app\/(?:[\w-]+\/)?id6829883680\/?$/.test(url.pathname)) {
    return {href:url.href, label:'Download on the App Store'};
  }
  if (url.hostname === 'testflight.apple.com' && /^\/join\/[A-Za-z0-9]{8}\/?$/.test(url.pathname)) {
    return {href:url.href, label:'Join the TestFlight beta'};
  }
  return null;
}
