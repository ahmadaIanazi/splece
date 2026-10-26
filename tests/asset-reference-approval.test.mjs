import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isProjectOnly, setAssetProjectOnly } from "../shared/asset-scope.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject, editAsset } from "../shared/studio.mjs";
import { applyStory, storySignature } from "../shared/authoring.mjs";
import { importedAsset } from "../shared/smart.mjs";
import { openStore } from "../server/store.mjs";
import { createAssetLibrary } from "../server/library.mjs";

test("New manual, imported and proposed characters start project-only; images alone do not approve them", () => {
  const p = upgradeProject(newProject("Draft cast"));
  editAsset(p, { id: "manual", kind: "character", name: "Manual" });
  assert.equal(
    p.assets.find((a) => a.id === "manual").referenceStatus,
    "draft",
  );
  const imported = importedAsset(
    { kind: "image", url: "/api/media/test", name: "Portrait" },
    "character",
  );
  assert.ok(isProjectOnly(imported));
  const proposal = {
    title: "Draft",
    beats: [],
    characters: [
      {
        id: "proposed",
        name: "Mira",
        description: "Photographer",
        scope: "shared",
      },
    ],
    assets: [
      {
        id: "room",
        kind: "location",
        name: "Studio",
        description: "Draft room",
      },
    ],
  };
  applyStory(p, proposal, storySignature(p));
  const character = p.assets.find((a) => a.id === "proposed");
  assert.ok(isProjectOnly(character));
  assert.throws(() => setAssetProjectOnly(character, false), /image reference/);
  character.media = { kind: "image", url: "/api/media/portrait" };
  assert.ok(isProjectOnly(character));
  setAssetProjectOnly(character, false);
  assert.equal(character.referenceStatus, "approved");
  assert.equal(character.scope, "shared");
  assert.ok(isProjectOnly(p.assets.find((a) => a.id === "room")));
});

test("Unapproved references stay out of shared results and become adoptable only after explicit approval", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-draft-reference-"),
  );
  const store = openStore(":memory:");
  try {
    const p = upgradeProject(newProject("Source")),
      q = upgradeProject(newProject("Target"));
    p.folder = path.join(dir, "source");
    q.folder = path.join(dir, "target");
    await fs.mkdir(p.folder, { recursive: true });
    await fs.mkdir(q.folder, { recursive: true });
    const file = path.join(p.folder, "image.png");
    await fs.writeFile(file, "fixture");
    const media = {
      id: "portrait",
      kind: "image",
      url: "/api/media/portrait",
      path: file,
      original: file,
      poster: file,
      projectId: p.id,
    };
    store.putMedia(media);
    p.assets = [
      {
        id: "draft",
        name: "Draft",
        kind: "character",
        scope: "shared",
        referenceStatus: "draft",
        media,
      },
    ];
    store.save(p, 0);
    store.save(q, 0);
    const library = createAssetLibrary(store, dir);
    assert.deepEqual(await library.list(), []);
    setAssetProjectOnly(p.assets[0], false);
    store.save(p, 1);
    const entries = await library.list();
    assert.equal(entries.length, 1);
    const adopted = await library.adopt(entries[0].id, q);
    assert.equal(adopted.libraryId, entries[0].id);
    assert.equal(adopted.referenceStatus, "approved");
    assert.ok(adopted.media.path.startsWith(q.folder));
  } finally {
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
