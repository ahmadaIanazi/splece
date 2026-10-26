import { renderTreatment } from "./clip-treatment.mjs";
import { isLiveJob, providerId } from "../shared/providers.mjs";
import { providerTiming } from "../shared/job-progress.mjs";
import { downloadVideo, writeVideoResponse } from "./video.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { id } from "./domain.mjs";
import { renderDemo, renderEpisode, thumbnail, probe } from "./media.mjs";
export function startWorker({
  store,
  data,
  checkpoint,
  video,
  download = downloadVideo,
  preparePreview = async () => {},
}) {
  const working = new Set();
  const owner = id();
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS worker_lock(id INTEGER PRIMARY KEY,pid INTEGER,owner TEXT);",
  );
  const previous = store.db
    .prepare("SELECT * FROM worker_lock WHERE id=1")
    .get();
  if (previous && previous.pid !== process.pid) {
    let alive = false;
    try {
      process.kill(previous.pid, 0);
      alive = true;
    } catch {}
    if (alive)
      throw new Error("This data directory already has a running worker.");
  }
  store.db
    .prepare("INSERT OR REPLACE INTO worker_lock VALUES(1,?,?)")
    .run(process.pid, owner);
  const save = (j, state, message) => {
    if (state && j.state !== state) {
      j.state = state;
      j.statusHistory ??= [];
      j.statusHistory.push({ state, at: Date.now(), message });
    }
    if (state === "ready") j.completedAt ??= Date.now();
    j.updatedAt = Date.now();
    store.putJob(j);
    checkpoint(j.projectId).catch((e) =>
      console.error("Checkpoint:", e.message),
    );
  };
  for (const j of store.allJobs()) {
    if (j.state === "preparing") {
      j.error =
        "Preparation was interrupted before submission. Your saved draft is intact.";
      save(j, "failed");
      continue;
    }
    if (j.state === "submitting" && !j.providerJobId)
      save(
        j,
        "submission_uncertain",
        "Worker stopped before the provider ID was persisted.",
      );
    else if (["rendering", "downloading", "verifying"].includes(j.state))
      save(
        j,
        ["export", "clip-treatment"].includes(j.kind)
          ? "queued"
          : "download_pending",
        "Resume local work without submitting again.",
      );
  }
  async function processJob(j) {
    working.add(j.id);
    try {
      const { project: p } = store.get(j.projectId);
      if (j.kind === "clip-treatment") {
        save(j, "rendering");
        j.media = await renderTreatment(j, store, p);
        save(j, "ready");
        return;
      }
      if (j.kind === "export") {
        save(j, "rendering");
        const out = path.join(p.folder, "exports", j.id + ".mp4");
        await fs.mkdir(path.dirname(out), { recursive: true });
        await renderEpisode(
          j.snapshot.clips,
          (c) => store.media(c.activeTake),
          path.join(p.folder, ".cache", j.id),
          out,
          j.snapshot.export,
          j.snapshot.audioClips || [],
          (c) => store.media(c.mediaId),
          j.snapshot.elements || [],
        );
        j.output = out;
        save(j, "ready");
        return;
      }
      const live = isLiveJob(j);
      const transfer = (url) =>
        download(url, undefined, providerId(j.snapshot));
      let videoResponse;
      if (live) {
        const adapter = await video.adapter(providerId(j.snapshot));
        if (j.state === "queued") {
          if ((await video.status()).mode !== "venice") {
            j.error =
              "Online generation paused in Offline mode. Reuse this prompt and review a new quote when ready.";
            save(j, "interrupted");
            return;
          }
          if (store.job(j.id)?.state !== "queued") return;
          save(j, "submitting");
          j.submitCount = (j.submitCount || 0) + 1;
          store.putJob(j);
          const accepted = await adapter.submit(j.snapshot);
          Object.assign(j, accepted, {
            acceptedAt: Date.now(),
            pollAt: Date.now() + 5000,
          });
          save(j, "running");
          return;
        }
        if (
          [
            "running",
            "retry_scheduled",
            "unreachable",
            "rate_limited",
          ].includes(j.state)
        ) {
          if (Date.now() < (j.pollAt || 0)) return;
          let result;
          try {
            result = await adapter.poll(j, { stream: true });
          } catch (error) {
            j.pollFailures = (j.pollFailures || 0) + 1;
            j.error = error.message;
            if ([400, 401, 403, 404, 410, 422].includes(error.status)) {
              save(j, "interrupted");
              return;
            }
            j.pollAt =
              Date.now() +
              Math.min(60000, 5000 * 2 ** Math.min(j.pollFailures, 4));
            save(j, error.status === 429 ? "rate_limited" : "unreachable");
            return;
          }
          j.lastPolledAt = Date.now();
          const timing = providerTiming(result.raw);
          if (timing) j.timing = timing;
          if (Number.isFinite(result.raw?.queue_position))
            j.queuePosition = result.raw.queue_position;
          else delete j.queuePosition;
          if (result.actualPrompt) j.actualPrompt = result.actualPrompt;
          j.pollFailures = 0;
          j.error = null;
          if (result.downloadUrl) j.downloadUrl = result.downloadUrl;
          if (["failed", "error", "cancelled"].includes(result.state)) {
            j.error =
              result.error ||
              "The provider reports this generation failed. Review the saved request before starting a new generation.";
            save(j, "failed");
            return;
          }
          if (result.state !== "completed") {
            j.pollAt = Date.now() + 5000;
            save(j, "running");
            return;
          }
          j.providerCompletedAt ??= Date.now();
          videoResponse = result.response;
          save(j, "download_pending");
        }
        if (j.state === "download_pending" && !videoResponse) {
          if (j.downloadUrl) videoResponse = await transfer(j.downloadUrl);
          else {
            const result = await adapter.poll(j, { stream: true });
            videoResponse = result.response;
            if (result.downloadUrl) {
              j.downloadUrl = result.downloadUrl;
              store.putJob(j);
              videoResponse = await transfer(j.downloadUrl);
            }
            if (!videoResponse)
              throw new Error(
                "Completed video is not available yet; retry transfer without regenerating",
              );
          }
        }
      }
      if (!live && j.state === "queued") {
        save(j, "submitting");
        if (j.simulation === "uncertain") {
          j.recoveryId = "local-recovered-" + j.id;
          save(
            j,
            "submission_uncertain",
            "Simulated accepted request with lost ID response. Recover the ID to continue; no automatic resubmission.",
          );
          return;
        }
        j.providerJobId ??= "local-" + j.id;
        j.acceptedAt ??= Date.now();
        j.lastPolledAt = Date.now();
        j.timing = {
          averageMs: j.simulation === "slow" ? 60000 : 1000,
          elapsedMs: 0,
          observedAt: Date.now(),
        };
        j.pollAt = Date.now() + (j.simulation === "slow" ? 60000 : 1000);
        j.submitCount = (j.submitCount || 0) + 1;
        save(j, "running");
        return;
      }
      if (
        !live &&
        ["running", "retry_scheduled", "unreachable", "rate_limited"].includes(
          j.state,
        )
      ) {
        if (Date.now() < (j.pollAt || j.dueAt || 0)) return;
        if (j.simulation === "failure")
          throw new Error(
            "Simulated provider failure. Your request is retained.",
          );
        if (
          ["rate-limit", "offline"].includes(j.simulation) &&
          !j.simulatedTransient
        ) {
          j.simulatedTransient = true;
          j.pollAt = Date.now() + 2000;
          save(
            j,
            j.simulation === "rate-limit" ? "rate_limited" : "unreachable",
            "Retry scheduled; existing provider ID retained.",
          );
          return;
        }
        j.providerCompletedAt ??= Date.now();
        save(j, "download_pending");
      }
      if (["download_pending", "download_failed"].includes(j.state)) {
        if (
          j.simulation === "download-failure" &&
          !j.simulatedDownloadFailure
        ) {
          j.simulatedDownloadFailure = true;
          j.error =
            "Simulated download failure. Retry transfer; generation will not run again.";
          save(j, "download_failed");
          return;
        }
        save(j, "downloading");
        const mid = j.outputMediaId || id();
        j.outputMediaId = mid;
        store.putJob(j);
        const folder = path.join(p.folder, "media");
        await fs.mkdir(folder, { recursive: true });
        const file = path.join(folder, mid + ".mp4"),
          part = path.join(folder, mid + ".partial.mp4"),
          poster = path.join(folder, mid + ".jpg");
        if (live) {
          if (!videoResponse && j.downloadUrl)
            videoResponse = await transfer(j.downloadUrl);
          await writeVideoResponse(videoResponse, part);
        } else
          await renderDemo(
            path.join(data, "sample.mp4"),
            part,
            j.snapshot.draft.settings,
            [4, 22, 40][Math.abs(j.id.charCodeAt(0)) % 3],
          );
        save(j, "verifying");
        const info = await probe(part);
        if (
          !info.video ||
          !Number.isFinite(info.duration) ||
          info.duration <= 0 ||
          Math.abs(info.duration - j.snapshot.draft.settings.duration) >
            (live ? 1 : 0.2)
        )
          throw new Error("Downloaded media duration is invalid");
        await thumbnail(part, poster, 0.1);
        await fs.rename(part, file);
        const m = {
          id: mid,
          projectId: p.id,
          path: file,
          original: file,
          kind: "video",
          poster,
          duration: info.duration,
          audio: info.audio,
          name: live ? `${j.snapshot.provider} generation` : "Offline sample generation",
          aspect: j.snapshot.draft.settings.aspect,
          resolution: j.snapshot.draft.settings.resolution,
          url: "/api/media/" + mid,
          thumbnail: "/api/media/" + mid + "/thumbnail",
          jobId: j.id,
          attribution: live
            ? null
            : "Big Buck Bunny © 2008 Blender Foundation · CC BY 3.0 · peach.blender.org",
        };
        store.putMedia(m);
        // A preview failure must never discard a successful paid generation.
        await preparePreview(m).catch(() => {});
        j.media = m;
        j.completedAt = Date.now();
        j.actualCharge = live ? null : { amount: 0, unit: "demo credits" };
        j.error = null;
        save(j, "ready");
        await fs.mkdir(path.join(p.folder, "generations"), { recursive: true });
        await fs.writeFile(
          path.join(p.folder, "generations", j.id + ".json"),
          JSON.stringify(j, null, 2),
          { flush: true },
        );
      }
    } catch (e) {
      j.error = e.message;
      save(
        j,
        e.stage === "submission_uncertain"
          ? "submission_uncertain"
          : ["download_pending", "downloading", "verifying"].includes(j.state)
            ? "download_failed"
            : "failed",
      );
    } finally {
      working.delete(j.id);
    }
  }
  const timer = setInterval(() => {
    const jobs = store.jobViews(undefined, true);
    for (const j of jobs) {
      if (working.has(j.id)) continue;
      if (
        ["running", "retry_scheduled", "rate_limited", "unreachable"].includes(
          j.state,
        ) &&
        Date.now() < (j.pollAt || 0)
      )
        continue;
      const p = store.get(j.projectId)?.project;
      if (!p) continue;
      const concurrency = Math.max(
        1,
        Math.min(12, p.settings.concurrency || 3),
      );
      const active = jobs.filter(
        (x) =>
          x.projectId === j.projectId &&
          ["running", "submitting", "downloading", "verifying"].includes(
            x.state,
          ),
      ).length;
      if (j.state === "queued" && active >= concurrency) continue;
      if (working.size >= concurrency) continue;
      if (
        [
          "queued",
          "running",
          "download_pending",
          "retry_scheduled",
          "rate_limited",
          "unreachable",
        ].includes(j.state)
      )
        processJob(store.job(j.id));
    }
  }, 250);
  timer.unref();
  return { stop: () => clearInterval(timer), save };
}
