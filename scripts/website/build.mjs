import { build } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const output = path.join(root, "artifacts/website-release");
await build({
  root: path.join(root, "website"),
  publicDir: false,
  build: { outDir: output, emptyOutDir: true, sourcemap: false },
});
// Explicit public assets only. Never copy public/downloads or the app bundle.
for (const name of [
  "splece.svg",
  "brand/splece-logo-white.svg",
  "marketing/splece-editor.webp",
  "marketing/demo/after-the-rain.mp4",
  "marketing/demo/coast.jpg",
  "marketing/demo/walk.jpg",
]) {
  const to = path.join(output, name);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(path.join(root, "public", name), to);
}
await fs.copyFile(
  path.join(root, "public/brand/Splece.ico"),
  path.join(output, "favicon.ico"),
);
await fs.writeFile(
  path.join(output, "downloads.json"),
  JSON.stringify({ version: "0.1.0", mac: null, windows: null, source: null }),
);
await fs.mkdir(path.join(output, "welcome"));
await fs.copyFile(
  path.join(output, "index.html"),
  path.join(output, "welcome/index.html"),
);
await fs.writeFile(
  path.join(output, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://www.splece.com/sitemap.xml\n",
);
await fs.writeFile(
  path.join(output, "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.splece.com/</loc></url></urlset>',
);
await fs.writeFile(
  path.join(output, "vercel.json"),
  JSON.stringify(
    {
      version: 2,
      framework: null,
      buildCommand: "",
      outputDirectory: ".",
      headers: [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            {
              key: "Referrer-Policy",
              value: "strict-origin-when-cross-origin",
            },
            { key: "X-Frame-Options", value: "DENY" },
          ],
        },
      ],
    },
    null,
    2,
  ),
);
console.log("Homepage-only release ready: " + output);
