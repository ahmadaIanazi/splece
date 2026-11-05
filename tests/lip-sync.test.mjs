import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { openStore } from "../server/store.mjs";
import { saveStudioMode } from "../server/mode.mjs";
import { createLipSyncService, prepareLipSync } from "../server/lip-sync.mjs";
import {
  lipSyncInput,
  lipSyncSignature,
  applyLipSync,
  saveLipSyncAsset,
  lipSyncCosts,
} from "../shared/lip-sync.mjs";
import { run, probe } from "../server/media.mjs";
import { uploadFalMedia } from "../server/adapters/fal-storage.mjs";
import { createSoundtrackPlan, applySoundtrackResults, soundSource } from "../shared/soundtrack.mjs";
import { dialogueSignature } from "../shared/soundtrack-dialogue.mjs";
import { setMixMute } from "../shared/sound-mix.mjs";
function fixture() {
  const p = upgradeProject(newProject("Lip sync test"));
  p.clips = [
    {
      id: "c",
      start: 0,
      in: 0,
      duration: 2,
      activeTake: "v",
      takes: [{ id: "v" }],
      draftId: "d",
    },
  ];
  p.drafts = [
    {
      id: "d",
      referenceIds: ["a"],
      scenes: [{ dialogue: [{ speaker: "a", text: "Hello." }] }],
    },
  ];
  p.assets = [{ id: "a", kind: "character" }];
  p.audioClips = [
    {
      id: "voice",
      mediaId: "a1",
      start: 0,
      in: 0,
      duration: 2,
      soundtrack: {
        role: "dialogue",
        sources: [{ clipId: "c", mediaId: "v", start: 0, in: 0, duration: 2 }],
      },
    },
  ];
  return p;
}
test("on-screen dialogue auditions without replacing old speech; applying changes only its selected clip", () => {
  const p=fixture();
  const other=structuredClone(p.clips[0]);other.id='other';other.start=2;other.draftId='other-draft';p.clips.push(other);
  p.drafts.push({...structuredClone(p.drafts[0]),id:'other-draft'});
  const otherAudio={...structuredClone(p.audioClips[0]),id:'other-voice',start:2,soundtrack:{role:'dialogue',sources:[soundSource(other)]}};
  p.audioClips.push(otherAudio);
  p.audioClips.push({id:'ambience',mediaId:'bed',start:0,duration:4,volume:.3,mute:false,soundtrack:{role:'ambience',sources:p.clips.map(soundSource)}});
  const untouched=JSON.stringify({clip:other,audio:otherAudio});
  let n=0;
  const run=createSoundtrackPlan(p,{roles:['dialogue'],clipIds:['c'],reviewDialogue:true},()=>`review-${++n}`);
  const unit=run.units[0];unit.state='ready';unit.media={id:'new-voice',name:'Voice',duration:2};
  applySoundtrackResults(p,run);
  assert.equal(p.audioClips.find(a=>a.id==='voice').mediaId,'a1');
  const pending=p.audioClips.find(a=>a.id===unit.id);
  assert.equal(pending.mute,true);
  assert.equal(pending.soundtrack.pendingLipSync,true);
  setMixMute(p,'dialogue',false);
  assert.equal(pending.mute,true,'global fader must not activate an unreviewed performance');
  const input=lipSyncInput(p,'c',pending.id);
  const job={id:'synced',projectId:p.id,episodeId:p.episodeId,input,signature:lipSyncSignature(input),media:{id:'picture-synced'}};
  applyLipSync(p,job);
  assert.equal(pending.mute,false);
  assert.equal(pending.soundtrack.pendingLipSync,undefined);
  assert.equal(p.audioClips.find(a=>a.id==='voice').mute,true);
  assert.equal(JSON.stringify({clip:p.clips[1],audio:p.audioClips.find(a=>a.id==='other-voice')}),JSON.stringify({...JSON.parse(untouched),audio:{...otherAudio,mute:false}}));
  assert.equal(p.audioClips.find(a=>a.id==='ambience').volume,.3);
  assert.equal(p.audioClips.find(a=>a.id==='ambience').mute,false);
  assert.equal(p.clips[0].takes.length,2);
});
test("changed dialogue cannot silently match or apply a stale voice", () => {
  const p=fixture();
  p.audioClips[0].soundtrack.scriptSignature=dialogueSignature(p,p.clips[0]);
  const input=lipSyncInput(p,'c','voice');
  p.drafts[0].scenes[0].dialogue[0].text='A different line.';
  assert.throws(()=>lipSyncInput(p,'c','voice'),/script or character voice changed/);
  assert.throws(()=>applyLipSync(p,{projectId:p.id,episodeId:p.episodeId,input,signature:lipSyncSignature(input),media:{id:'wrong'}}),/script or character voice changed/);
  assert.equal(p.clips[0].activeTake,'v');
  const unrelated=fixture();unrelated.audioClips[0].soundtrack.sources=[{clipId:'other'}];
  assert.throws(()=>lipSyncInput(unrelated,'c','voice'),/belonging to this clip/);
});
async function sandbox(fn) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "splece-lips-")),
    store = openStore(path.join(folder, "db.sqlite")),
    services = [];
  try {
    const p = fixture();
    p.folder = folder;
    const revision = store.save(p, 0);
    await saveStudioMode(folder, "test");
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=24:d=2",
      "-c:v",
      "libx264",
      path.join(folder, "v.mp4"),
    ]);
    await run([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:duration=2",
      path.join(folder, "voice.wav"),
    ]);
    store.putMedia({
      id: "v",
      projectId: p.id,
      path: path.join(folder, "v.mp4"),
      duration: 2,
    });
    store.putMedia({
      id: "a1",
      projectId: p.id,
      path: path.join(folder, "voice.wav"),
      duration: 2,
    });
    await fn({
      folder,
      store,
      p,
      revision,
      service: (options = {}) => {
        const s = createLipSyncService({ data: folder, store, ...options });
        services.push(s);
        return s;
      },
    });
  } finally {
    services.forEach((s) => s.close());
    store.db.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
}
test("lip-sync selection is one speaker with an aligned voice; originals survive applying", () => {
  const p = fixture(),
    input = lipSyncInput(p, "c", "voice"),
    job = {
      id: "new",
      projectId: p.id,
      episodeId: p.episodeId,
      input,
      signature: lipSyncSignature(input),
      media: { id: "synced", name: "Synced" },
      executionMode: "test",
    };
  saveLipSyncAsset(p, job);
  applyLipSync(p, job);
  assert.equal(p.clips[0].activeTake, "synced");
  assert.equal(p.clips[0].takes[0].id, "v");
  assert.equal(p.clips[0].duration, 2);
  assert.equal(p.audioClips[0].soundtrack.sources[0].mediaId, "synced");
  assert.equal(p.audioClips.length, 1);
  const other = fixture();
  other.id = p.id;
  other.episodeId = p.episodeId;
  other.clips[0].start = 1;
  assert.throws(() => applyLipSync(other, job), /cover|changed/);
  const group = fixture();
  group.drafts[0].scenes[0].dialogue.push({ speaker: "b", text: "Hi" });
  assert.throws(() => lipSyncInput(group, "c", "voice"), /face|timings|Assign a character/);
});
test("Test lip-sync copies silent picture without provider calls and survives service restart", () =>
  sandbox(async ({ folder, store, p, revision, service }) => {
    let s = service({
      adapterFactory: () => {
        throw Error("No network in Test");
      },
    });
    // RGB test footage encodes as 4:4:4 unless we explicitly normalize the output.
    await run(["-f", "lavfi", "-i", "testsrc=s=160x90:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv444p", path.join(folder, "v.mp4")]);
    const q = await s.estimate(p.id, { clipId: "c", audioId: "voice" }),
      j = await s.submit(p.id, {
        clipId: "c",
        audioId: "voice",
        quoteId: q.id,
        revision,
        requestId: "once",
      });
    assert.equal(q.amount, 0);
    s.close();
    s = service({
      adapterFactory: () => {
        throw Error("No network in Test");
      },
    });
    await s.tick();
    const done = s.list(p.id)[0];
    assert.equal(done.state, "ready", done.error);
    assert.equal((await probe(done.media.path)).audio, false);
    await assert.rejects(run(["-i", done.media.path]), e => /Video:.*yuv420p/.test(e.log));
    assert.equal(lipSyncCosts(done).amount, 0);
    assert.equal((await probe(path.join(folder, "v.mp4"))).duration, 2);
    assert.equal((await s.submit(p.id, { requestId: "once" })).id, j.id);
    s.ack(p.id, j.id);
    assert.equal(s.list(p.id)[0].delivered, true);
  }));
test("unknown acceptance never auto-resubmits; recovery only polls existing provider request", () =>
  sandbox(async ({ folder, store, p, revision, service }) => {
    await saveStudioMode(folder, "live");
    let submits = 0,
      polls = 0;
    const adapter = {
      pricing: async () => ({ rate: 0.01 }),
      submitSound: async () => {
        submits++;
        throw Object.assign(Error("response lost"), { uncertain: true });
      },
      pollSound: async () => {
        polls++;
        return { state: "processing" };
      },
    };
    const s = service({
        adapterFactory: async () => adapter,
        prepare: async () => ({ input: {} }),
      }),
      q = await s.estimate(p.id, { clipId: "c", audioId: "voice" });
    await s.submit(p.id, {
      clipId: "c",
      audioId: "voice",
      quoteId: q.id,
      revision,
      requestId: "x",
    });
    await s.tick();
    let job = s.list(p.id)[0];
    assert.equal(job.state, "submission_uncertain");
    await s.tick();
    assert.equal(submits, 1);
    assert.throws(() => s.recover(p.id, job.id, {}), /No accepted/);
    s.recover(p.id, job.id, { providerJobId: "request-123456" });
    await s.tick();
    assert.equal(submits, 1);
    assert.equal(polls, 1);
    await saveStudioMode(folder, "test");
    await s.tick();
    assert.equal(polls, 1);
    assert.equal(lipSyncCosts(job).status, "unknown");
  }));
test("prepared lip-sync picture is silent and voice duration matches the slot", () =>
  sandbox(async ({ folder, store, p }) => {
    const result = await prepareLipSync(
      lipSyncInput(p, "c", "voice"),
      path.join(folder, "prepared"),
      store,
    );
    assert.equal(result.input.sync_mode, "silence");
    assert.equal(result.input.model, "lipsync-2");
    assert.equal((await probe(result.picture)).audio, false);
    assert.equal(
      (await probe(path.join(folder, "prepared", "voice.wav"))).duration,
      2,
    );
  }));

test("fal upload sends public media URLs, keeps keys off PUT and blocks Test uploads", () =>
  sandbox(async ({ folder }) => {
    let posts = 0,
      puts = 0;
    const adapter = {
      key: "test-secret",
      allowSubmit: async () => true,
      transport: async (url, options) => {
        posts++;
        assert.equal(new URL(url).hostname, "rest.fal.ai");
        assert.equal(JSON.parse(options.body).content_type, "video/mp4");
        assert.equal(
          JSON.parse(options.headers["X-Fal-Object-Lifecycle"])
            .expiration_duration_seconds,
          86400,
        );
        return Response.json({
          upload_url: "https://v3-uploads.fal.media/test",
          file_url: "https://v3.fal.media/picture.mp4",
        });
      },
    };
    const put = async (url, options) => {
      puts++;
      assert.equal(options.method, "PUT");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, "error");
      assert.ok(options.body.length > 0);
      return new Response(null, { status: 200 });
    };
    assert.equal(
      await uploadFalMedia(
        adapter,
        path.join(folder, "v.mp4"),
        "video/mp4",
        put,
      ),
      "https://v3.fal.media/picture.mp4",
    );
    adapter.allowSubmit = async () => false;
    await assert.rejects(
      uploadFalMedia(adapter, path.join(folder, "v.mp4"), "video/mp4", put),
      /Offline mode/,
    );
    assert.equal(posts, 1);
    assert.equal(puts, 1);
    adapter.allowSubmit = async () => true;
    adapter.transport = async () =>
      Response.json({
        upload_url: "http://127.0.0.1/private",
        file_url: "https://v3.fal.media/file",
      });
    await assert.rejects(
      uploadFalMedia(adapter, path.join(folder, "v.mp4"), "video/mp4", put),
      /unsupported storage URL/,
    );
    assert.equal(puts, 1);
  }));

test("lip-sync uploads both prepared inputs and terminal rejection cannot be retrieved or auto-resubmitted", () =>
  sandbox(async ({ folder, p, revision, service }) => {
    await saveStudioMode(folder, "live");
    let uploads = 0,
      submits = 0;
    const s = service({
      upload: async (_, file, type) => {
        uploads++;
        return `https://v3.fal.media/${type === "video/mp4" ? "picture.mp4" : "voice.wav"}`;
      },
      adapterFactory: async () => ({
        pricing: async () => ({ rate: 0.05 }),
        submitSound: async (input) => {
          submits++;
          assert.equal(input.video_url, "https://v3.fal.media/picture.mp4");
          assert.equal(input.audio_url, "https://v3.fal.media/voice.wav");
          return { providerJobId: "accepted-1234" };
        },
        pollSound: async () => {
          throw Object.assign(Error("Input rejected"), { terminal: true });
        },
      }),
    });
    const q = await s.estimate(p.id, { clipId: "c", audioId: "voice" });
    await s.submit(p.id, {
      clipId: "c",
      audioId: "voice",
      quoteId: q.id,
      revision,
    });
    await s.tick();
    const job = s.list(p.id)[0];
    assert.equal(job.state, "failed");
    assert.equal(job.terminal, true);
    assert.equal(uploads, 2);
    assert.equal(submits, 1);
    assert.throws(() => s.recover(p.id, job.id, {}), /rejected/);
    await s.tick();
    assert.equal(submits, 1);
  }));

test("project dialogue queues separate clips but prevents a duplicate pass on the same clip", () =>
  sandbox(async ({store,p,revision,service}) => {
    const second=structuredClone(p.clips[0]);second.id="c2";second.start=2;p.clips.push(second);
    const voice=structuredClone(p.audioClips[0]);voice.id="voice2";voice.start=2;
    voice.soundtrack.sources=[soundSource(second)];p.audioClips.push(voice);
    const saved=store.save(p,revision),s=service({adapterFactory:()=>{throw Error("No network in Test");}});
    const submit=async(clipId,audioId,requestId)=>{
      const quote=await s.estimate(p.id,{clipId,audioId});
      return s.submit(p.id,{clipId,audioId,requestId,quoteId:quote.id,revision:saved});
    };
    const first=await submit("c","voice","first");
    const next=await submit("c2","voice2","next");
    assert.notEqual(first.id,next.id);
    await assert.rejects(submit("c","voice","duplicate"),/already has a lip-sync pass/);
    assert.equal(s.list(p.id).length,2);
    s.close();
  }));
