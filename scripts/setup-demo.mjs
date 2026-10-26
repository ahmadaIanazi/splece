import fs from "node:fs/promises";
import path from "node:path";
const folder = path.resolve(process.env.STUDIO_DATA_DIR || "data");
await fs.mkdir(folder, { recursive: true });
const response = await fetch(
  "https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files@master/big_buck_bunny.mp4",
);
if (!response.ok) throw new Error("Could not download sample footage");
await fs.writeFile(
  path.join(folder, "sample.mp4"),
  new Uint8Array(await response.arrayBuffer()),
);
console.log(
  "Sample ready. Big Buck Bunny © 2008 Blender Foundation, CC BY 3.0. https://peach.blender.org/about/",
);
