import test from "node:test";
import assert from "node:assert/strict";
import {
  canOpenStudio,
  isLocalStudioHost,
  releaseLink,
} from "../shared/home-entry.mjs";

test("public visitors never trigger local-network detection", async () => {
  let calls = 0;
  assert.equal(
    await canOpenStudio({ hostname: "splece.example" }, () => {
      calls++;
    }),
    false,
  );
  assert.equal(calls, 0);
  assert.equal(isLocalStudioHost("localhost.example.com"), false);
});
test("a working Splece session opens the workspace", async () => {
  const requests = [];
  assert.equal(
    await canOpenStudio({ hostname: "127.0.0.1" }, async (url) => {
      requests.push(url);
      return Response.json(
        url.endsWith("session") ? { local: true } : { service: "frame-studio" },
      );
    }),
    true,
  );
  assert.deepEqual(requests, ["/api/session", "/api/launcher/status"]);
});
test("static hosting, stopped service and unrelated local servers show the visitor page", async () => {
  for (const fetcher of [
    async () => {
      throw Error("offline");
    },
    async () => new Response("<html>fallback</html>"),
    async () => Response.json({ local: false }),
    async (url) =>
      Response.json(
        url.endsWith("session") ? { local: true } : { service: "unrelated" },
      ),
    async () => new Response("", { status: 404 }),
  ])
    assert.equal(
      await canOpenStudio({ hostname: "localhost" }, fetcher),
      false,
    );
});
test("downloads accept release HTTPS URLs and controlled local paths only", () => {
  assert.equal(
    releaseLink(
      "https://github.com/example/splece/releases/download/v1/Splece.dmg",
    ),
    "https://github.com/example/splece/releases/download/v1/Splece.dmg",
  );
  assert.equal(releaseLink("/downloads/Splece.dmg"), "/downloads/Splece.dmg");
  for (const value of [
    null,
    {},
    "",
    "javascript:alert(1)",
    "//bad.example/file",
    "http://example.com/file",
    "/downloads/../data/key",
    "https://user:secret@example.com/file",
  ])
    assert.equal(releaseLink(value), null);
});
