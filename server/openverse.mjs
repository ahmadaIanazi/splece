import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { probe, run } from "./media.mjs";

const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
  ["192.0.0.0", 24],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
])
  blocked.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
])
  blocked.addSubnet(ip, prefix, "ipv6");
export function publicAddress(ip) {
  const family = isIP(ip);
  // Accept global-unicast IPv6 only; reject mapped IPv4 and tunnel/local aliases.
  if (family === 6 && !/^[23][0-9a-f]{3}:/i.test(ip)) return false;
  return !!family && !blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}
export async function downloadPublicAudio(
  url,
  file,
  { lookup = dns.lookup, request = https.get } = {},
  redirects = 0,
) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443") ||
    redirects > 4
  )
    throw fail(
      "This recording does not offer a supported HTTPS download. Open its source instead.",
    );
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw fail("The recording URL does not point to a public media server.");
  // Pin the checked DNS answer for this request, including redirects.
  const response = await new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        headers: { "User-Agent": "Splece/0.1 (Openverse audio import)" },
        lookup: (_host, options, cb) =>
          options.all
            ? cb(null, addresses)
            : cb(null, addresses[0].address, addresses[0].family),
      },
      resolve,
    );
    req.on("error", reject);
    req.setTimeout(30000, () =>
      req.destroy(Error("Recording download timed out. Try again.")),
    );
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    return downloadPublicAudio(
      new URL(response.headers.location, target).href,
      file,
      { lookup, request },
      redirects + 1,
    );
  }
  if (
    response.statusCode !== 200 ||
    Number(response.headers["content-length"]) > 50 * 1024 * 1024
  ) {
    response.destroy();
    throw fail(
      "This recording is unavailable or larger than 50 MB. Try a shorter sound.",
    );
  }
  const output = await fs.open(file, "w");
  let bytes = 0;
  const timer = setTimeout(
    () => response.destroy(Error("Recording download timed out.")),
    120000,
  );
  try {
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > 50 * 1024 * 1024)
        throw fail("Choose a recording smaller than 50 MB.");
      await output.write(chunk);
    }
  } finally {
    clearTimeout(timer);
    response.destroy();
    await output.close();
  }
}
export function openverseRecord(record) {
  if (
    !record ||
    !["cc0", "by"].includes(String(record.license).toLowerCase()) ||
    record.mature
  )
    throw fail("Choose a CC0 or CC BY recording from the search results.");
  const license = record.license.toLowerCase();
  const safe = (value) => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  return {
    id: record.id,
    title: String(record.title || "Untitled recording").slice(0, 200),
    creator: String(record.creator || "Unknown creator").slice(0, 200),
    source: safe(record.foreign_landing_url),
    url: safe(record.url),
    license,
    licenseUrl: safe(record.license_url),
    attribution: `${record.title || "Untitled recording"} — ${record.creator || "Unknown creator"} · ${license === "cc0" ? "CC0" : "CC BY " + (record.license_version || "")}`,
    tags: (record.tags || [])
      .map((t) => t.name)
      .filter((t) => typeof t === "string")
      .slice(0, 30),
  };
}
export function createOpenverse({
  addons,
  store,
  fetcher = fetch,
  download = downloadPublicAudio,
  probeMedia = probe,
  convert = run,
}) {
  const cache = new Map();
  let pending = false;
  async function read(endpoint) {
    addons.requireReady("openverse");
    const response = await fetcher("https://api.openverse.org/v1/" + endpoint, {
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (response.status === 429)
      throw fail(
        "Openverse’s free search limit was reached. Wait and try again, or open Openverse to search there.",
        429,
      );
    if ([401, 403].includes(response.status))
      throw fail(
        "Openverse is restricting this connection. Open its API setup guide or try again later.",
        503,
      );
    if (!response.ok)
      throw fail(
        "Openverse is temporarily unavailable. Your local tools still work. Try again later.",
        503,
      );
    return response.json();
  }
  return {
    async search(query) {
      addons.requireReady("openverse");
      if (typeof query !== "string" || !query.trim() || query.length > 200)
        throw fail("Enter a sound to search for, up to 200 characters.");
      const key = query.trim();
      const previous = cache.get(key);
      if (previous && Date.now() - previous.at < 300000) return previous.value;
      if (pending) throw fail("A search is already running. Please wait.", 429);
      pending = true;
      try {
        const value = await read(
          `audio/?q=${encodeURIComponent(key)}&page_size=12&license=cc0,by&mature=false`,
        );
        const results = (value.results || []).flatMap((r) => {
          try {
            return [openverseRecord(r)];
          } catch {
            return [];
          }
        });
        const result = {
          results,
          attribution: "Made with Openverse",
          source: "https://openverse.org/",
        };
        if (cache.size >= 30) cache.delete(cache.keys().next().value);
        cache.set(key, { at: Date.now(), value: result });
        return result;
      } finally {
        pending = false;
      }
    },
    async import(projectId, recordId) {
      if (!/^[a-f0-9-]{36}$/i.test(recordId || ""))
        throw fail("Choose a recording from the search results.");
      const entry = store.get(projectId);
      if (!entry) throw fail("Project not found", 404);
      // Fetch trusted metadata again; never accept a client-supplied URL or license.
      const record = openverseRecord(await read(`audio/${recordId}/`));
      const id = randomUUID(),
        folder = path.join(entry.project.folder, "media"),
        file = path.join(folder, `${id}-openverse.wav`);
      await fs.mkdir(folder, { recursive: true });
      try {
        await download(record.url, file + ".partial");
        const info = await probeMedia(file + ".partial");
        if (
          !info.audio ||
          info.video ||
          !(info.duration > 0) ||
          info.duration > 600
        )
          throw fail("Choose an audio-only recording under 10 minutes.");
        // Normalize the container for predictable browser playback; preserve the source credit.
        await convert([
          "-i",
          file + ".partial",
          "-vn",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-c:a",
          "pcm_s16le",
          file,
        ]);
        const media = {
          id,
          projectId,
          path: file,
          original: file,
          name: record.title,
          kind: "audio",
          audio: true,
          duration: info.duration,
          thumbnail: "/audio.svg",
          url: `/api/media/${id}`,
          attribution: record,
        };
        store.putMedia(media);
        return {
          id,
          kind: "audio",
          name: record.title,
          description: record.attribution,
          tags: record.tags,
          media,
          attribution: record,
          scope: "project",
          version: 1,
        };
      } finally {
        await fs.rm(file + ".partial", { force: true });
      }
    },
  };
}
export function installOpenverseRoutes(app, service) {
  app.get("/api/openverse/audio", async (req, res) =>
    res.json(await service.search(req.query.q)),
  );
  app.post("/api/projects/:id/openverse/import", async (req, res) =>
    res.json(await service.import(req.params.id, req.body.recordId)),
  );
}
