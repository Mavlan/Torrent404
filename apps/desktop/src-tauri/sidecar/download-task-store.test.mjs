import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DownloadTaskStore } from "./download-task-store.mjs";

const RECORD = {
  id: "download-test",
  source: "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01",
  infoHash: "abcdef0123456789abcdef0123456789abcdef01",
  name: "Legal fixture",
  savePath: "C:\\Downloads\\Torrent404",
  total: 42,
  status: "paused",
};

test("persists versioned task records and replaces them atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "torrent404-task-store-"));
  const filePath = join(root, "nested", "download-tasks.v1.json");
  try {
    const store = new DownloadTaskStore(filePath);
    assert.deepEqual(await store.load(), []);

    store.replace([RECORD]);
    await store.flush();
    assert.deepEqual(await store.load(), [RECORD]);
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
      schemaVersion: 1,
      tasks: [RECORD],
    });

    store.replace([]);
    await store.flush();
    assert.deepEqual(await store.load(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("falls back safely when the store is corrupt or incompatible", async () => {
  const root = await mkdtemp(join(tmpdir(), "torrent404-task-store-corrupt-"));
  const filePath = join(root, "download-tasks.v1.json");
  try {
    const store = new DownloadTaskStore(filePath);
    await writeFile(filePath, "{not-json", "utf8");
    assert.deepEqual(await store.load(), []);
    await writeFile(filePath, JSON.stringify({ schemaVersion: 2, tasks: [RECORD] }), "utf8");
    assert.deepEqual(await store.load(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
