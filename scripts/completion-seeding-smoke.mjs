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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const destroyClient = (client) => new Promise((resolve, reject) => {
  client.destroy((error) => error ? reject(error) : resolve());
});
const destroyTracker = (tracker) => new Promise((resolve, reject) => {
  tracker.close((error) => error ? reject(error) : resolve());
});

const root = await mkdtemp(join(tmpdir(), "torrent404-completion-"));
const sourceDir = join(root, "source");
const downloadDir = join(root, "download");
await Promise.all([mkdir(sourceDir), mkdir(downloadDir)]);

const payload = Buffer.alloc(8 * 1024 * 1024);
for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
const sourcePath = join(sourceDir, "torrent404-legal-fixture.bin");
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

const engine = new WebTorrentAdapter({
  dht: false,
  tracker: true,
  lsd: false,
  natPmp: false,
  natUpnp: false,
});
const manager = new TorrentManager(engine);
const taskId = "torrent404-completion-smoke";
await manager.add({
  id: taskId,
  source: seeded.magnetURI,
  announce: [announce],
  infoHash: seeded.infoHash,
  name: "Torrent404 legal fixture",
  savePath: downloadDir,
  total: payload.length,
});

const deadline = Date.now() + 60_000;
let completed;
while (Date.now() < deadline) {
  completed = manager.snapshots().find((task) => task.id === taskId);
  if (completed?.status === "completed") break;
  await wait(100);
}
assert.equal(completed?.status, "completed");
assert.equal(completed.progress, 1);
assert.equal(completed.downloaded, payload.length);
assert.equal(completed.uploadSpeed, 0);
assert.equal(completed.peers, 0);

await wait(3_000);
const quiet = manager.snapshots().find((task) => task.id === taskId);
assert.equal(quiet?.status, "completed");
assert.equal(quiet.uploadSpeed, 0);
assert.equal(quiet.peers, 0);

const downloadedPath = join(downloadDir, "torrent404-legal-fixture.bin");
const downloadedSha256 = sha256(await readFile(downloadedPath));
assert.equal(downloadedSha256, sourceSha256);

assert.equal(await manager.startSeeding(taskId), true);
await wait(500);
const seeding = manager.snapshots().find((task) => task.id === taskId);
assert.equal(seeding?.status, "seeding");
assert.ok(engine.snapshot(taskId), "explicit seeding must reattach the torrent engine");

assert.equal(await manager.stopSeeding(taskId), true);
const stopped = manager.snapshots().find((task) => task.id === taskId);
assert.equal(stopped?.status, "completed");
assert.equal(stopped.uploadSpeed, 0);
assert.equal(stopped.peers, 0);
assert.equal(engine.snapshot(taskId), null);
assert.equal(sha256(await readFile(downloadedPath)), sourceSha256);

console.log(JSON.stringify({
  fixtureBytes: payload.length,
  sourceSha256,
  downloadedSha256,
  completed: {
    status: quiet.status,
    uploadSpeed: quiet.uploadSpeed,
    peers: quiet.peers,
  },
  explicitSeeding: seeding.status,
  stopped: {
    status: stopped.status,
    uploadSpeed: stopped.uploadSpeed,
    peers: stopped.peers,
    engineAttached: engine.snapshot(taskId) !== null,
  },
}, null, 2));

await destroyClient(seeder);
await manager.destroy();
await destroyTracker(tracker);
await rm(root, { recursive: true, force: true });
