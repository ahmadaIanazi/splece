import fs from "node:fs/promises";
import path from "node:path";

function storageURL(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))
  )
    throw Error("fal returned an unsupported storage URL.");
  return url.href;
}

// The Sync endpoint requires public URLs, unlike MMAudio's inline media input.
// Follow fal-js's initiate/PUT flow. Credentials never accompany the signed PUT.
export async function uploadFalMedia(
  adapter,
  file,
  contentType,
  fetcher = fetch,
) {
  if (!(await adapter.allowSubmit()))
    throw Error("Offline mode blocks media uploads to AI providers.");
  const bytes = await fs.readFile(file);
  if (!bytes.length || bytes.length > 24 * 1024 * 1024)
    throw Error("Lip-sync upload must be between 1 byte and 24 MB.");
  const response = await adapter.transport(
    "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: {
        Authorization: `Key ${adapter.key}`,
        "Content-Type": "application/json",
        "X-Fal-Object-Lifecycle": JSON.stringify({
          expiration_duration_seconds: 86400,
        }),
      },
      body: JSON.stringify({
        file_name: path.basename(file),
        content_type: contentType,
      }),
    },
  );
  if (!response.ok)
    throw Error(`fal media upload could not start (${response.status}).`);
  const result = await response.json();
  const upload = storageURL(result.upload_url),
    publicURL = storageURL(result.file_url);
  if (!(await adapter.allowSubmit()))
    throw Error("Offline mode blocks media uploads to AI providers.");
  const uploaded = await fetcher(upload, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
    signal: AbortSignal.timeout(120000),
    redirect: "error",
  });
  if (!uploaded.ok)
    throw Error(`fal media upload failed (${uploaded.status}).`);
  return publicURL;
}
