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
  result = undefined;
  error = undefined;
  removed = [];
  destroyed = false;

  async add(request) {
    this.requests.push(request);
    if (this.error) throw this.error;
    return this.result ?? {
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
  }

  async remove(id) {
    this.removed.push(id);
    return true;
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
    downloadDir: "C:\\Downloads\\涌流404",
  });

  assert.equal(result.taskId, "download-test");
  assert.equal(result.task.status, "downloading");
  assert.deepEqual(manager.requests[0], {
    id: "download-test",
    infoHash: HASH,
    name: "Legal fixture",
    savePath: "C:\\Downloads\\涌流404",
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
  assert.deepEqual(failedManager.removed, ["download-test"]);
});

test("destroys the manager-owned engine during shutdown", async () => {
  const { manager, service: downloads } = service();
  await downloads.shutdown();
  assert.equal(manager.destroyed, true);
});
