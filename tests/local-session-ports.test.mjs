import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { localSession } from "../server/security.mjs";

test("two local studios retain independent browser sessions and media access", async (t) => {
  async function studio() {
    const app = express();
    app.use(localSession());
    app.get("/api/media/test", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + "/api/session");
    const header = response.headers.get("set-cookie");
    assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Strict/);
    return { base, cookie: header.split(";")[0] };
  }
  const a = await studio(), b = await studio();
  assert.notEqual(a.cookie.split("=")[0], b.cookie.split("=")[0]);
  // A browser sends both host cookies regardless of the destination port.
  const jar = `${a.cookie}; ${b.cookie}; frame_session=legacy`;
  for (const service of [a, b]) {
    assert.equal((await fetch(service.base + "/api/media/test", { headers: { Cookie: jar } })).status, 200);
    assert.equal((await fetch(service.base + "/api/media/test")).status, 401);
  }
  assert.equal((await fetch(a.base + "/api/media/test", { headers: { Cookie: b.cookie } })).status, 401);
  const name = a.cookie.split("=")[0];
  assert.equal((await fetch(a.base + "/api/media/test", { headers: { Cookie: `${name}=${"é".repeat(64)}` } })).status, 401);
});
