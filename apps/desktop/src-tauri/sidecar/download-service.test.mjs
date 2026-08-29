import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DownloadCommandError,
  DownloadService,
  parseMagnetInfoHash,
} from "./download-service.mjs";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Legal%20fixture`;

class FakeManager {
  requests = [];
  tasks = new Map();
  result = undefined;
  error = undefined;
  removed = [];
  pauseResult = true;
  resumeResult = true;
  startSeedingResult = true;
  stopSeedingResult = true;
  removeResult = true;
  destroyed = false;

  async add(request) {
    this.requests.push(request);
    if (this.error) throw this.error;
    const task = this.result ?? {
      id: request.id,
      infoHash: request.infoHash,
      name: request.name,
      status: "downloading",
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      downloaded: 0,
      total: request.total,
      savePath: request.savePath,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  get(id) {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  snapshots() {
    return [...this.tasks.values()].map((task) => ({ ...task }));
  }

  pause(id) {
    if (!this.pauseResult || !this.tasks.has(id)) return false;
    this.tasks.set(id, { ...this.tasks.get(id), status: "paused" });
    return true;
  }

  resume(id) {
    if (!this.resumeResult || !this.tasks.has(id)) return false;
    const task = this.tasks.get(id);
    this.tasks.set(id, {
      ...task,
      status: "downloading",
    });
    return true;
  }

  async startSeeding(id) {
    const task = this.tasks.get(id);
    if (!this.startSeedingResult || task?.status !== "completed") return false;
    this.tasks.set(id, { ...task, status: "seeding" });
    return true;
  }

  async stopSeeding(id) {
    const task = this.tasks.get(id);
    if (!this.stopSeedingResult || task?.status !== "seeding") return false;
    this.tasks.set(id, {
      ...task,
      status: "completed",
      uploadSpeed: 0,
      peers: 0,
    });
    return true;
  }

  async remove(id, options) {
    this.removed.push({ id, options });
    if (!this.removeResult) return false;
    return this.tasks.delete(id);
  }

  async destroy() {
    this.destroyed = true;
  }
}

function service(manager = new FakeManager(), ensureDirectory = async () => undefined) {
  return {
    manager,
    service: new DownloadService(manager, {
      ensureDirectory,
      createTaskId: () => "download-test",
    }),
  };
}

test("parses hexadecimal and base32 magnet infohashes", () => {
  assert.equal(parseMagnetInfoHash(MAGNET), HASH);
  assert.equal(
    parseMagnetInfoHash("magnet:?xt=urn:btih:VPG66ERG6DOZB5PZ5O6W2ZL3QIVU5D3K"),
    "abcdef1226f0dd90f5f9ebbd6d657b822b4e8f6a",
  );
  assert.equal(parseMagnetInfoHash("https://example.test/file"), undefined);
});

test("creates a download task through the manager with the selected directory", async () => {
  const { manager, service: downloads } = service();
  const result = await downloads.add({
    magnet: MAGNET,
    name: " Legal fixture ",
    total: 42,
    downloadDir: "C:\\Downloads\\Torrent404",
  });

  assert.equal(result.taskId, "download-test");
  assert.equal(result.task.status, "downloading");
  assert.deepEqual(manager.requests[0], {
    id: "download-test",
    infoHash: HASH,
    name: "Legal fixture",
    savePath: "C:\\Downloads\\Torrent404",
    source: MAGNET,
    total: 42,
  });
});

test("returns structured invalid magnet and directory errors", async () => {
  const invalid = service().service;
  await assert.rejects(
    invalid.add({ magnet: "not-a-magnet", downloadDir: "C:\\Downloads" }),
    (error) => error instanceof DownloadCommandError && error.code === "invalid_magnet",
  );

  const unavailable = service(
    new FakeManager(),
    async () => { throw new DownloadCommandError("download_directory_unavailable", "no", 422); },
  ).service;
  await assert.rejects(
    unavailable.add({ magnet: MAGNET, downloadDir: "Z:\\Unavailable" }),
    (error) => error.code === "download_directory_unavailable",
  );
});

test("rejects a real filesystem path that cannot be used as a directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "torlink-download-dir-"));
  const filePath = join(root, "not-a-directory");
  await writeFile(filePath, "fixture");
  try {
    const downloads = new DownloadService(new FakeManager(), {
      createTaskId: () => "download-test",
    });
    await assert.rejects(
      downloads.add({ magnet: MAGNET, downloadDir: filePath }),
      (error) => error.code === "download_directory_unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("maps duplicate and engine failures without exposing stack traces", async () => {
  const duplicateManager = new FakeManager();
  duplicateManager.error = Object.assign(new Error("internal duplicate detail"), {
    name: "DuplicateTorrentError",
    existingTaskId: "download-existing",
  });
  await assert.rejects(
    service(duplicateManager).service.add({ magnet: MAGNET, downloadDir: "C:\\Downloads" }),
    (error) => error.code === "duplicate_torrent"
      && error.message.includes("download-existing")
      && !error.message.includes("internal duplicate detail"),
  );

  const failedManager = new FakeManager();
  failedManager.result = {
    id: "download-test",
    status: "error",
    error: "private engine stack",
  };
  await assert.rejects(
    service(failedManager).service.add({ magnet: MAGNET, downloadDir: "C:\\Downloads" }),
    (error) => error.code === "engine_add_failed"
      && !error.message.includes("private engine stack"),
  );
  assert.deepEqual(failedManager.removed, [{ id: "download-test", options: undefined }]);
});

test("pauses, resumes, and removes tasks only through the manager", async () => {
  const { manager, service: downloads } = service();
  const added = await downloads.add({ magnet: MAGNET, downloadDir: "C:\\Downloads" });

  const paused = downloads.pause({ taskId: added.taskId });
  assert.equal(paused.task.status, "paused");
  const resumed = downloads.resume({ taskId: added.taskId });
  assert.equal(resumed.task.status, "downloading");
  assert.deepEqual(await downloads.remove({ taskId: added.taskId }), {
    taskId: "download-test",
    removed: true,
  });
  assert.deepEqual(manager.removed, [{ id: "download-test", options: undefined }]);
  assert.equal(manager.get("download-test"), undefined);
});

test("starts and stops seeding only through explicit manager controls", async () => {
  const { manager, service: downloads } = service();
  const added = await downloads.add({ magnet: MAGNET, downloadDir: "C:\\Downloads" });
  manager.tasks.set(added.taskId, {
    ...manager.tasks.get(added.taskId),
    status: "completed",
    progress: 1,
    downloaded: 42,
    total: 42,
    uploadSpeed: 0,
    peers: 0,
  });

  const seeded = await downloads.startSeeding({ taskId: added.taskId });
  assert.equal(seeded.task.status, "seeding");
  const stopped = await downloads.stopSeeding({ taskId: added.taskId });
  assert.equal(stopped.task.status, "completed");
  assert.equal(stopped.task.uploadSpeed, 0);
  assert.equal(stopped.task.peers, 0);
});

test("returns refreshed task snapshots from the manager", async () => {
  const { manager, service: downloads } = service();
  const added = await downloads.add({ magnet: MAGNET, downloadDir: "C:\\Downloads" });
  manager.tasks.set(added.taskId, {
    ...manager.tasks.get(added.taskId),
    progress: 0.5,
    downloaded: 21,
    downloadSpeed: 2_048,
    uploadSpeed: 256,
    peers: 3,
    etaSeconds: 10,
  });

  assert.deepEqual(downloads.list().tasks[0], manager.get(added.taskId));
});

test("returns structured missing-task, invalid-transition, and engine control errors", async () => {
  const { manager, service: downloads } = service();
  assert.throws(
    () => downloads.pause({ taskId: "missing" }),
    (error) => error.code === "download_task_not_found" && error.statusCode === 404,
  );
  assert.throws(
    () => downloads.pause({}),
    (error) => error.code === "invalid_download_task_request" && error.statusCode === 400,
  );

  const added = await downloads.add({ magnet: MAGNET, downloadDir: "C:\\Downloads" });
  await assert.rejects(
    downloads.startSeeding({ taskId: added.taskId }),
    (error) => error.code === "invalid_download_task_transition" && error.statusCode === 409,
  );
  assert.throws(
    () => downloads.resume({ taskId: added.taskId }),
    (error) => error.code === "invalid_download_task_transition" && error.statusCode === 409,
  );

  manager.pauseResult = false;
  assert.throws(
    () => downloads.pause({ taskId: added.taskId }),
    (error) => error.code === "engine_control_failed" && error.statusCode === 502,
  );
  manager.removeResult = false;
  await assert.rejects(
    downloads.remove({ taskId: added.taskId }),
    (error) => error.code === "engine_control_failed" && error.statusCode === 502,
  );
  assert.equal(manager.get(added.taskId)?.status, "downloading");
});

test("destroys the manager-owned engine during shutdown", async () => {
  const { manager, service: downloads } = service();
  await downloads.shutdown();
  assert.equal(manager.destroyed, true);
});
