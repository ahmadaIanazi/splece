// Only the local origin may probe the studio. A public website must not scan
// visitors' computers or infer installation from a browser preference.
export function isLocalStudioHost(hostname) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

export async function canOpenStudio(location, fetcher = fetch) {
  if (!isLocalStudioHost(location.hostname)) return false;
  try {
    const response = await fetcher("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok || !(await response.json()).local) return false;
    const status = await fetcher("/api/launcher/status", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return status.ok && (await status.json()).service === "frame-studio";
  } catch {
    return false;
  }
}

export function releaseLink(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\/downloads\/[a-zA-Z0-9._/-]+$/.test(value) && !value.includes(".."))
    return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
