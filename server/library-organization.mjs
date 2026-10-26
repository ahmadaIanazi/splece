import { randomUUID } from "node:crypto";
import {
  cleanLibraryTags,
  folderContains,
} from "../shared/library-organization.mjs";
export function createLibraryOrganization(store) {
  store.db
    .exec(`CREATE TABLE IF NOT EXISTS library_folders(id TEXT PRIMARY KEY, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS library_organization(id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
  const folders = () =>
    store.db
      .prepare("SELECT body FROM library_folders")
      .all()
      .map((r) => JSON.parse(r.body));
  const snapshot = () => ({
    folders: folders(),
    metadata: Object.fromEntries(
      store.db
        .prepare("SELECT id,body FROM library_organization")
        .all()
        .map((r) => [r.id, JSON.parse(r.body)]),
    ),
  });
  function saveFolder(input, id = randomUUID()) {
    const all = folders(),
      previous = all.find((f) => f.id === id);
    const rawName = input.name ?? previous?.name ?? "";
    if (typeof rawName !== "string") throw Error("Folder name must be text.");
    const name = rawName.trim();
    if (!name || name.length > 120)
      throw Error("Folder names need 1–120 characters.");
    const parentId =
      input.parentId === undefined
        ? previous?.parentId || null
        : input.parentId || null;
    if (
      parentId &&
      (!all.some((f) => f.id === parentId) || folderContains(all, id, parentId))
    )
      throw Error("Choose a valid parent folder.");
    if (
      all.some(
        (f) =>
          f.id !== id &&
          f.parentId === parentId &&
          f.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw Error("A folder with this name already exists here.");
    const folder = { id, name, parentId };
    store.db
      .prepare("INSERT OR REPLACE INTO library_folders VALUES(?,?)")
      .run(id, JSON.stringify(folder));
    return snapshot();
  }
  function organize(id, patch) {
    if (typeof id !== "string" || !id || id.length > 250)
      throw Error("Choose a valid asset.");
    const row = store.db
      .prepare("SELECT body FROM library_organization WHERE id=?")
      .get(id);
    const value = row ? JSON.parse(row.body) : {};
    if ("hidden" in patch) {
      if (typeof patch.hidden !== "boolean") throw Error("Hidden must be on or off.");
      value.hidden = patch.hidden;
    }
    if ("favorite" in patch) {
      if (typeof patch.favorite !== "boolean")
        throw Error("Favorite must be on or off.");
      value.favorite = patch.favorite;
    }
    if ("tags" in patch) value.tags = cleanLibraryTags(patch.tags);
    if ("folderId" in patch) {
      if (
        patch.folderId !== null &&
        !folders().some((f) => f.id === patch.folderId)
      )
        throw Error("Folder no longer exists.");
      value.folderId = patch.folderId;
    }
    store.db
      .prepare("INSERT OR REPLACE INTO library_organization VALUES(?,?)")
      .run(id, JSON.stringify(value));
    return snapshot();
  }
  function removeFolder(id) {
    const folder = folders().find((f) => f.id === id);
    if (!folder) throw Error("Folder no longer exists.");
    store.db.exec("BEGIN IMMEDIATE");
    try {
      for (const child of folders().filter((f) => f.parentId === id)) {
        child.parentId = folder.parentId;
        const base = child.name;
        let suffix = 2;
        while (
          folders().some(
            (f) =>
              f.id !== child.id &&
              f.parentId === child.parentId &&
              f.name.toLowerCase() === child.name.toLowerCase(),
          )
        )
          child.name = base + ` (${suffix++})`;
        store.db
          .prepare("UPDATE library_folders SET body=? WHERE id=?")
          .run(JSON.stringify(child), child.id);
      }
      for (const [key, value] of Object.entries(snapshot().metadata))
        if (value.folderId === id) {
          value.folderId = folder.parentId;
          store.db
            .prepare("UPDATE library_organization SET body=? WHERE id=?")
            .run(JSON.stringify(value), key);
        }
      store.db.prepare("DELETE FROM library_folders WHERE id=?").run(id);
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
    return snapshot();
  }
  return { snapshot, saveFolder, organize, removeFolder };
}
export function installLibraryOrganizationRoutes(app, store) {
  const organization = createLibraryOrganization(store);
  app.get("/api/library/organization", (_req, res) =>
    res.json(organization.snapshot()),
  );
  app.post("/api/library/folders", (req, res) =>
    res.json(organization.saveFolder(req.body)),
  );
  app.patch("/api/library/folders/:id", (req, res) =>
    res.json(organization.saveFolder(req.body, req.params.id)),
  );
  app.delete("/api/library/folders/:id", (req, res) =>
    res.json(organization.removeFolder(req.params.id)),
  );
  app.patch("/api/library/organization", (req, res) =>
    res.json(organization.organize(req.body.id, req.body.patch || {})),
  );
}
