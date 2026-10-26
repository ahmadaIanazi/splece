import { providerDefinitions } from "../shared/providers.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
export function localSession() {
  const token = randomBytes(32).toString("hex");
  return (req, res, next) => {
    // Cookies are scoped to hosts, not ports. A packaged beta and a development
    // studio may share localhost; each service must keep its own session cookie.
    const cookieName = `frame_session_${req.socket.localPort}`;
    const cookie = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (
      req.method === "GET" &&
      (!req.path.startsWith("/api/") || req.path === "/api/session")
    ) {
      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      });
      return req.path === "/api/session" ? res.json({ local: true }) : next();
    }
    if (req.path.startsWith("/api/")) {
      if (
        !cookie ||
        Buffer.byteLength(cookie) !== Buffer.byteLength(token) ||
        !timingSafeEqual(Buffer.from(cookie), Buffer.from(token))
      )
        return res
          .status(401)
          .json({ error: "Reconnect to the local studio session." });
    }
    next();
  };
}
// AI requests require an explicit live transport; demo transports cannot reach the network.
export function providerTransport({
  demo = true,
  fetcher = fetch,
  timeoutMs = 30000,
} = {}) {
  return async (url, options = {}) => {
    if (demo)
      throw Object.assign(
        new Error("Offline mode blocks all external AI requests."),
        { code: "DEMO_NETWORK_BLOCKED" },
      );
    const parsed = new URL(url);
    if (
      ![
        ...providerDefinitions.flatMap((p) => p.authHosts),
        "api.kie.ai",
        "kieai.redpandaai.co",
      ].includes(parsed.hostname) ||
      parsed.protocol !== "https:"
    )
      throw new Error("Untrusted provider endpoint");
    return fetcher(url, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  };
}
