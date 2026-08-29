import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sidecarDir = process.env.TORRENT404_SIDECAR_DIR;
assert.ok(sidecarDir, "TORRENT404_SIDECAR_DIR is required");
const moduleUrl = (...segments) => pathToFileURL(join(sidecarDir, ...segments)).href;
const { default: WebTorrent } = await import(moduleUrl("node_modules", "webtorrent", "index.js"));
const { default: TrackerServer } = await import(moduleUrl("node_modules", "bittorrent-tracker", "server.js"));
const { WebTorrentAdapter } = await import(moduleUrl("core", "torrent", "WebTorrentAdapter.js"));
const { TorrentManager } = await import(moduleUrl("core", "torrent", "TorrentManager.js"));
const { DownloadTaskStore } = await import(moduleUrl("download-task-store.mjs"));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const destroyClient = (client) => new Promise((resolve, reject) => {
  client.destroy((error) => error ? reject(error) : resolve());
});
const destroyTracker = (tracker) => new Promise((resolve, reject) => {
  tracker.close((error) => error ? reject(error) : resolve());
});

const root = await mkdtemp(join(tmpdir(), "torrent404-restart-resume-"));
const sourceDir = join(root, "source");
const downloadDir = join(root, "download");
const storePath = join(root, "state", "download-tasks.v1.json");
await Promise.all([mkdir(sourceDir), mkdir(downloadDir)]);

const payload = Buffer.alloc(4 * 1024 * 1024);
for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
const sourcePath = join(sourceDir, "torrent404-restart-fixture.bin");
await writeFile(sourcePath, payload);
const sourceSha256 = sha256(payload);

const tracker = new TrackerServer({ http: false, udp: true, ws: false, stats: false });
await new Promise((resolve, reject) => {
  tracker.once("error", reject);
  tracker.listen(0, { udp: "127.0.0.1", udp6: "::1" }, resolve);
});
const announce = `udp://127.0.0.1:${tracker.udp.address().port}`;
const clientOptions = {
  dht: false,
  tracker: true,
  lsd: false,
  utp: false,
  natUpnp: false,
  natPmp: false,
};
const seeder = new WebTorrent(clientOptions);
const seeded = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("local seed timed out")), 30_000);
  seeder.seed(sourcePath, { announce: [announce] }, (torrent) => {
    clearTimeout(timer);
    resolve(torrent);
  });
});
seeder.throttleUpload(256 * 1024);

const store = new DownloadTaskStore(storePath);
const createRuntime = async () => {
  const engine = new WebTorrentAdapter({
    dht: false,
    tracker: true,
    lsd: false,
    natPmp: false,
    natUpnp: false,
  });
  const manager = new TorrentManager(engine, {
    onPersistenceChange: (tasks) => store.replace(tasks),
  });
  manager.restore(await store.load());
  return { engine, manager };
};

const taskId = "torrent404-restart-resume-smoke";
const first = await createRuntime();
await first.manager.add({
  id: taskId,
  source: seeded.magnetURI,
  announce: [announce],
  infoHash: seeded.infoHash,
  name: "Torrent404 restart fixture",
  savePath: downloadDir,
  total: payload.length,
});

const partialDeadline = Date.now() + 30_000;
let partial;
while (Date.now() < partialDeadline) {
  partial = first.manager.snapshots().find((task) => task.id === taskId);
  if (partial && partial.downloaded >= 256 * 1024 && partial.downloaded < payload.length) break;
  await wait(100);
}
assert.ok(partial?.downloaded >= 256 * 1024 && partial.downloaded < payload.length);
assert.equal(first.manager.pause(taskId), true);
const pausedBytes = first.manager.get(taskId).downloaded;
await store.flush();
await first.manager.destroy();

seeder.throttleUpload(1);

const second = await createRuntime();
const restoredPaused = second.manager.get(taskId);
assert.equal(restoredPaused?.status, "paused");
assert.equal(restoredPaused.progress, 0);
assert.equal(restoredPaused.savePath, downloadDir);
assert.equal(restoredPaused.infoHash, seeded.infoHash);
assert.equal(second.engine.snapshot(taskId), null);
assert.equal(await second.manager.resume(taskId), true);

const verificationDeadline = Date.now() + 15_000;
let verifiedBytes = 0;
while (Date.now() < verificationDeadline) {
  verifiedBytes = second.engine.snapshot(taskId)?.downloaded ?? 0;
  if (verifiedBytes > 0) break;
  await wait(100);
}
assert.ok(verifiedBytes > 0, "restart must verify and reuse existing pieces before new upload");

seeder.throttleUpload(256 * 1024);
seeded.discovery?.tracker?.update();
const completionDeadline = Date.now() + 45_000;
let completed;
while (Date.now() < completionDeadline) {
  completed = second.manager.snapshots().find((task) => task.id === taskId);
  if (completed?.status === "completed") break;
  await wait(100);
}
assert.equal(completed?.status, "completed");
assert.equal(completed.uploadSpeed, 0);
assert.equal(completed.peers, 0);
const downloadedPath = join(downloadDir, "torrent404-restart-fixture.bin");
const downloadedSha256 = sha256(await readFile(downloadedPath));
assert.equal(downloadedSha256, sourceSha256);
await store.flush();
await second.manager.destroy();

const third = await createRuntime();
assert.equal(third.manager.get(taskId)?.status, "completed");
assert.equal(third.manager.get(taskId)?.uploadSpeed, 0);
assert.equal(third.manager.get(taskId)?.peers, 0);
assert.equal(third.engine.snapshot(taskId), null);
assert.equal(await third.manager.startSeeding(taskId), true);
await store.flush();
await third.manager.destroy();

const fourth = await createRuntime();
const seedingRestartStatus = fourth.manager.get(taskId)?.status;
assert.equal(seedingRestartStatus, "completed");
assert.equal(fourth.engine.snapshot(taskId), null);
assert.equal(await fourth.manager.remove(taskId), true);
await store.flush();
assert.deepEqual(await store.load(), []);
assert.equal(sha256(await readFile(downloadedPath)), sourceSha256);

console.log(JSON.stringify({
  fixtureBytes: payload.length,
  pausedBytes,
  verifiedBytesAfterRestart: verifiedBytes,
  restoredIncompleteStatus: restoredPaused.status,
  completedRestartStatus: "completed",
  seedingRestartStatus,
  removedAfterRestart: (await store.load()).length === 0,
  sourceSha256,
  downloadedSha256,
}, null, 2));

await fourth.manager.destroy();
await destroyClient(seeder);
await destroyTracker(tracker);
await rm(root, { recursive: true, force: true });
