import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../server/store.mjs";
import { createLibraryOrganization } from "../server/library-organization.mjs";
import { createAssetLibrary } from "../server/library.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { importedAsset } from "../shared/smart.mjs";
import {
  libraryAssetKey,
  libraryItemKey,
  assetOrganization,
  matchesLibraryItem,
  folderPath,
  cleanLibraryTags,
} from "../shared/library-organization.mjs";

test("Organization persists across projects and restarts without changing reference metadata", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-org-")),
    dbfile = path.join(dir, "store.sqlite");
  let store = openStore(dbfile);
  try {
    const p = upgradeProject(newProject("Source"));
    p.folder = dir;
    p.assets = [
      {
        id: "location",
        kind: "location",
        name: "Rooftop",
        description: "City lights",
        tags: { lighting: "night" },
        favorite: true,
      },
    ];
    store.save(p, 0);
    const library = createAssetLibrary(store, dir),
      org = createLibraryOrganization(store);
    await library.list();
    const folders = org.saveFolder({ name: "Film references" }).folders,
      folder = folders[0];
    const id = libraryAssetKey(p.id, p.assets[0]);
    org.organize(id, {
      folderId: folder.id,
      tags: ["Night", "night", "  City  "],
      favorite: false,
      hidden: true,
    });
    assert.deepEqual(org.snapshot().metadata[id].tags, ["Night", "City"]);
    const q = upgradeProject(newProject("Destination"));
    q.folder = path.join(dir, "destination");
    const adopted = await library.adopt(id, q);
    assert.equal(libraryAssetKey(q.id, adopted), id);
    assert.deepEqual(adopted.tags, { lighting: "night" });
    p.assets[0].description = "Updated description";
    store.save(p, 1);
    await library.sync(p);
    assert.equal(
      assetOrganization(org.snapshot().metadata, id, adopted).favorite,
      false,
    );
    store.db.close();
    store = openStore(dbfile);
    const restored = createLibraryOrganization(store).snapshot();
    assert.equal(restored.metadata[id].folderId, folder.id);
    assert.equal(restored.metadata[id].hidden,true);
    assert.throws(()=>createLibraryOrganization(store).organize(id,{hidden:"true"}),/Hidden/);
    assert.equal(restored.folders[0].name, "Film references");
  } finally {
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Nested folders reject cycles and remove only organization, preserving assets and tags", () => {
  const store = openStore(":memory:");
  try {
    const org = createLibraryOrganization(store);
    const root = org.saveFolder({ name: "Movie" }).folders[0];
    const child = org
      .saveFolder({ name: "Places", parentId: root.id })
      .folders.find((f) => f.parentId);
    const leaf = org
      .saveFolder({ name: "Rooftops", parentId: child.id })
      .folders.find((f) => f.name === "Rooftops");
    assert.throws(
      () => org.saveFolder({ parentId: leaf.id }, root.id),
      /parent/,
    );
    assert.throws(
      () => org.saveFolder({ name: "Places", parentId: root.id }),
      /already exists/,
    );
    org.organize("project:asset", {
      folderId: child.id,
      tags: ["night"],
      favorite: true,
    });
    org.saveFolder({ name: "Rooftops", parentId: root.id });
    org.removeFolder(child.id);
    const snapshot = org.snapshot();
    assert.equal(snapshot.metadata["project:asset"].folderId, root.id);
    assert.deepEqual(snapshot.metadata["project:asset"].tags, ["night"]);
    assert.equal(snapshot.metadata["project:asset"].favorite, true);
    assert.equal(
      snapshot.folders.find((f) => f.id === leaf.id).parentId,
      root.id,
    );
    assert.equal(folderPath(snapshot.folders, leaf.id), "Movie / Rooftops (2)");
    assert.throws(
      () => org.organize("project:asset", { folderId: "missing" }),
      /no longer exists/,
    );
  } finally {
    store.db.close();
  }
});

test("Search combines tags, folders, asset kinds, Favorites and cross-project origin", () => {
  const folders = [
    { id: "root", name: "Film", parentId: null },
    { id: "child", name: "Ambience", parentId: "root" },
  ];
  const item = {
    kind: "audio",
    name: "Quiet pulse",
    asset: { description: "Soft drone" },
    entry: { originName: "Pilot episode" },
  };
  const meta = { favorite: true, tags: ["Night", "Calm"], folderId: "child" };
  assert.ok(
    matchesLibraryItem(
      item,
      meta,
      {
        query: "pilot calm",
        folder: "root",
        favorites: true,
        kind: "audio",
        tags: ["night"],
      },
      folders,
    ),
  );
  assert.equal(
    matchesLibraryItem(item, meta, { folder: "unfiled" }, folders),
    false,
  );
  assert.equal(
    matchesLibraryItem(item, meta, { kind: "character" }, folders),
    false,
  );
  assert.equal(
    matchesLibraryItem(item, meta, { tags: ["action"] }, folders),
    false,
  );
  assert.deepEqual(cleanLibraryTags(["A", " a ", "B", ""]), ["A", "B"]);
  assert.throws(() => cleanLibraryTags(["a".repeat(65)]), /64/);
  assert.throws(() => cleanLibraryTags({ mood: "night" }), /list/);
});

test("Every asset type can be organized, including generated footage and imported audio", () => {
  const audio = importedAsset(
    { id: "sound", kind: "audio", name: "Music" },
    "audio",
    "a",
  );
  assert.equal(audio.kind, "audio");
  assert.equal(libraryItemKey("p", { entry: { id: "shared" } }), "shared");
  assert.equal(libraryItemKey("p", { job: { id: "j" } }), "p:generation-j");
  assert.equal(
    libraryAssetKey("p", { id: "job:j", job: { id: "j" } }),
    "p:generation-j",
  );
  assert.equal(
    libraryItemKey("q", { asset: { id: "local", libraryId: "p:a" } }),
    "p:a",
  );
  assert.equal(assetOrganization({}, "p:a", { favorite: true }).favorite, true);
  assert.equal(
    assetOrganization({ "p:a": { favorite: false } }, "p:a", { favorite: true })
      .favorite,
    false,
  );
});
