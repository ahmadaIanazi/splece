import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export async function folderPath(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw Error("Choose a folder or enter its full path.");
  const input = value.trim().replace(/^~(?=$|[/\\])/, os.homedir());
  if (!path.isAbsolute(input)) throw Error("Enter a full folder path, or use Browse.");
  let actual;
  try { actual = await fs.realpath(input); }
  catch { throw Error("That folder is unavailable. Connect the drive or choose another folder."); }
  if (!(await fs.stat(actual)).isDirectory()) throw Error("Choose a folder, not a file.");
  return actual;
}
export async function createFolderSettings(data) {
  const file = path.join(data, "folder-settings.json");
  await fs.mkdir(path.join(data, "projects"), { recursive: true });
  const fallback = await fs.realpath(path.join(data, "projects"));
  let saved = null, readError = "";
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof value.projectsRoot !== "string" || !path.isAbsolute(value.projectsRoot)) throw Error("Invalid folder settings");
    saved = value.projectsRoot;
  } catch (e) { if (e.code !== "ENOENT") readError = "Your saved folder setting could not be read. Choose and save a project location to continue."; }
  return {
    get: () => ({ projectsRoot: saved || fallback, defaultProjectsRoot: fallback, warning: readError }),
    async writable(value = saved || fallback) {
      if (readError) throw Error(readError);
      const folder = await folderPath(value);
      try { await fs.access(folder, constants.W_OK); }
      catch { throw Error("Splece cannot write to this folder. Choose another location or update its permissions."); }
      return folder;
    },
    async save(value) {
      const folder = await folderPath(value);
      try { await fs.access(folder, constants.W_OK); }
      catch { throw Error("Splece cannot write to this folder. Choose another location or update its permissions."); }
      const temp = file + "." + randomUUID() + ".tmp";
      try { await fs.writeFile(temp, JSON.stringify({ projectsRoot: folder }, null, 2)); await fs.rename(temp, file); }
      finally { await fs.unlink(temp).catch(() => {}); }
      saved = folder;
      readError = "";
      return this.get();
    },
  };
}
export async function chooseFolder(initial) {
  const start = initial ? await folderPath(initial).catch(() => os.homedir()) : os.homedir();
  try {
    let result;
    if (process.platform === "darwin") {
      result = await exec("osascript", ["-e", 'on run argv\nreturn POSIX path of (choose folder with prompt "Choose a Splece folder" default location (POSIX file (item 1 of argv)))\nend run', start]);
    } else if (process.platform === "win32") {
      result = await exec("powershell.exe", ["-NoProfile", "-STA", "-Command", 'Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = "Choose a Splece folder"; $picker.SelectedPath = $env:SPLECE_PICKER_START; if ($picker.ShowDialog() -eq "OK") { Write-Output $picker.SelectedPath }'], { env: { ...process.env, SPLECE_PICKER_START: start } });
    } else {
      result = await exec("zenity", ["--file-selection", "--directory", "--title=Choose a Splece folder", "--filename=" + start + path.sep]);
    }
    if (!result.stdout.trim()) throw Error("Folder selection cancelled");
    return await folderPath(result.stdout.trim());
  } catch (e) {
    if (e.code === "ENOENT") throw Error("Folder browsing is unavailable here. Paste the full folder path instead.");
    throw Error("Folder selection cancelled. Your location is unchanged.");
  }
}
export async function revealFolder(folder) {
  const actual = await folderPath(folder);
  if (process.platform === "darwin") await exec("open", [actual]);
  else if (process.platform === "win32") await exec("explorer.exe", [actual]);
  else await exec("xdg-open", [actual]);
}
export function installFolderRoutes(app, { data, store, folders, reveal = revealFolder }) {
  const locations = (projectId) => {
    const project = projectId ? store.get(projectId)?.project : null;
    if (projectId && !project) throw Error("This project could not be found.");
    return { ...folders.get(), library: path.join(data, "library"), appData: data,
      ...(project ? { project: project.folder, media: path.join(project.folder, "media"), exports: path.join(project.folder, "exports") } : {}) };
  };
  app.get("/api/studio/folders", (req, res) => res.json(locations(req.query.projectId)));
  app.put("/api/studio/folders", async (req, res) => res.json(await folders.save(req.body.projectsRoot)));
  app.post("/api/studio/folders/reveal", async (req, res) => {
    const allowed = locations(req.body.projectId);
    if (!["projectsRoot", "project", "media", "exports", "library", "appData"].includes(req.body.target) || !allowed[req.body.target]) throw Error("Choose an available folder.");
    await reveal(allowed[req.body.target]); res.json({ opened: true });
  });
}
