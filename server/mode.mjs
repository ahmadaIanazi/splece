import { studioOnline } from './online.mjs';
import fs from "node:fs/promises";
import path from "node:path";
export async function studioMode(data, lane) {
  if (!(await studioOnline(data))) return "test";
  if (lane) {
    try {const routes=JSON.parse(await fs.readFile(path.join(data,'ai-routing.json'),'utf8'));if(routes[lane])return routes[lane].enabled?'live':'test';} catch(e){if(e.code!=='ENOENT')throw e;}
  }
  try {
    return JSON.parse(
      await fs.readFile(path.join(data, "studio-mode.json"), "utf8"),
    ).mode;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function saveStudioMode(data, mode) {
  if (!["test", "live"].includes(mode)) throw Error("Choose Offline or Online.");
  const file = path.join(data, "studio-mode.json");
  const temp = file + "." + crypto.randomUUID();
  await fs.writeFile(temp, JSON.stringify({ mode }), { mode: 0o600 });
  await fs.rename(temp, file);
  return { mode };
}
