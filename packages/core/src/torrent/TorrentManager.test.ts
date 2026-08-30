import type { DownloadTask } from "@torlink/protocol";
import { describe, expect, it, vi } from "vitest";

import type {
  AddTorrentRequest,
  TorrentEngine,
  TorrentMetadata,
  TorrentSnapshot,
} from "./TorrentEngine";
import {
  DuplicateTorrentError,
  TorrentManager,
  type PersistedDownloadTask,
} from "./TorrentManager";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";

class FakeTorrentEngine implements TorrentEngine {
  readonly requests = new Map<string, AddTorrentRequest>();
  readonly snapshots = new Map<string, TorrentSnapshot>();
  readonly pause = vi.fn((_id: string) => true);
  readonly resume = vi.fn((_id: string) => true);
  readonly remove = vi.fn(async (id: string, _options?: { deleteData?: boolean }) => {
    this.snapshots.delete(id);
    return this.requests.delete(id);
  });
  readonly destroy = vi.fn(async () => undefined);
  addError: Error | undefined;

  async add(request: AddTorrentRequest): Promise<void> {
    this.requests.set(request.id, request);
    if (this.addError) throw this.addError;
  }

  snapshot(id: string): TorrentSnapshot | null {
    return this.snapshots.get(id) ?? null;
  }

  listenPort(): number | null {
    return 51_413;
  }

  metadata(id: string, metadata: TorrentMetadata): void {
    this.requests.get(id)?.onMetadata?.(metadata);
  }

  done(id: string): void {
    this.requests.get(id)?.onDone?.();
  }

  error(id: string, error: Error): void {
    this.requests.get(id)?.onError?.(error);
  }
}

function addRequest() {
  return {
    id: "task-1",
    infoHash: HASH.toUpperCase(),
    name: "Legal fixture",
    savePath: "C:\\Downloads",
    source: `magnet:?xt=urn:btih:${HASH}`,
    total: 100,
  };
}

function snapshot(overrides: Partial<TorrentSnapshot> = {}): TorrentSnapshot {
  return {
    id: "task-1",
    name: "Fixture from metadata",
    infoHash: HASH.toUpperCase(),
    path: "C:\\Downloads",
    progress: 0.5,
    downloadSpeed: 2_000,
    uploadSpeed: 300,
    downloaded: 50,
    uploaded: 4,
    length: 100,
    timeRemaining: 25_000,
    peers: 3,
    done: false,
    paused: false,
    files: [],
    ...overrides,
  };
}

async function addedManager(engine = new FakeTorrentEngine()): Promise<{
  engine: FakeTorrentEngine;
  manager: TorrentManager;
  task: DownloadTask;
}> {
  const manager = new TorrentManager(engine);
  const task = await manager.add(addRequest());
  return { engine, manager, task };
}

describe("TorrentManager", () => {
  it("creates a queued task and drives it through the model to downloading", async () => {
    const { engine, manager, task } = await addedManager();

    expect(task).toMatchObject({
      id: "task-1",
      infoHash: HASH,
      status: "downloading",
      progress: 0,
    });
    expect(engine.requests.get("task-1")).toMatchObject({
      id: "task-1",
      path: "C:\\Downloads",
      source: `magnet:?xt=urn:btih:${HASH}`,
    });

    task.status = "completed";
    expect(manager.get("task-1")?.status).toBe("downloading");
  });

  it("maps metadata and snapshot metrics, converting ETA milliseconds to seconds", async () => {
    const { engine, manager } = await addedManager();
    engine.metadata("task-1", {
      name: "Metadata title",
      infoHash: HASH.toUpperCase(),
      magnetUri: `magnet:?xt=urn:btih:${HASH}`,
      length: 200,
      path: "D:\\Payloads",
      files: [],
      torrentFile: new Uint8Array(),
    });
    engine.snapshots.set("task-1", snapshot({
      name: "Snapshot title",
      path: "D:\\Payloads",
      length: 200,
      downloaded: 80,
      progress: 0.4,
    }));

    expect(manager.refresh("task-1")).toMatchObject({
      name: "Snapshot title",
      infoHash: HASH,
      savePath: "D:\\Payloads",
      progress: 0.4,
      downloadSpeed: 2_000,
      uploadSpeed: 300,
      downloaded: 80,
      total: 200,
      peers: 3,
      etaSeconds: 25,
    });
  });

  it("refreshes all task snapshots and keeps paused speed and ETA idle", async () => {
    const { engine, manager } = await addedManager();
    engine.snapshots.set("task-1", snapshot({
      progress: 0.25,
      downloaded: 25,
      downloadSpeed: 4_000,
      uploadSpeed: 500,
      timeRemaining: 30_000,
      peers: 4,
    }));

    expect(manager.snapshots()[0]).toMatchObject({
      progress: 0.25,
      downloaded: 25,
      downloadSpeed: 4_000,
      uploadSpeed: 500,
      peers: 4,
      etaSeconds: 30,
    });
    expect(manager.pause("task-1")).toBe(true);
    expect(manager.snapshots()[0]).toMatchObject({
      status: "paused",
      progress: 0.25,
      downloaded: 25,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 4,
    });
    expect(manager.snapshots()[0]).not.toHaveProperty("etaSeconds");
  });

  it("stops networking at completion and seeds only after explicit controls", async () => {
    const { engine, manager } = await addedManager();
    engine.snapshots.set("task-1", snapshot({
      done: true,
      progress: 1,
      downloaded: 100,
      uploadSpeed: 500,
      peers: 4,
    }));

    manager.refresh("task-1");
    await vi.waitFor(() => expect(manager.get("task-1")).toMatchObject({
      status: "completed",
      progress: 1,
      downloaded: 100,
      total: 100,
      uploadSpeed: 0,
      peers: 0,
    }));
    expect(engine.remove).toHaveBeenLastCalledWith("task-1", { deleteData: false });

    await expect(manager.startSeeding("task-1")).resolves.toBe(true);
    expect(manager.get("task-1")?.status).toBe("seeding");
    expect(engine.requests.get("task-1")?.path).toBe("C:\\Downloads");

    await expect(manager.stopSeeding("task-1")).resolves.toBe(true);
    expect(manager.get("task-1")).toMatchObject({
      status: "completed",
      uploadSpeed: 0,
      peers: 0,
    });
    expect(engine.remove).toHaveBeenLastCalledWith("task-1", { deleteData: false });
  });

  it("maps callback and add failures through the error transition", async () => {
    const { engine, manager } = await addedManager();
    engine.error("task-1", new Error("peer failure"));
    expect(manager.get("task-1")).toMatchObject({
      status: "error",
      error: "peer failure",
    });

    const rejectedEngine = new FakeTorrentEngine();
    rejectedEngine.addError = new Error("add failed");
    const rejectedManager = new TorrentManager(rejectedEngine);
    await expect(rejectedManager.add({ ...addRequest(), id: "task-2" }))
      .resolves.toMatchObject({ status: "error", error: "add failed" });
  });

  it("pauses and resumes incomplete downloads", async () => {
    const { engine, manager } = await addedManager();

    expect(manager.pause("task-1")).toBe(true);
    expect(manager.get("task-1")?.status).toBe("paused");
    await expect(manager.resume("task-1")).resolves.toBe(true);
    expect(manager.get("task-1")?.status).toBe("downloading");

    expect(engine.pause).toHaveBeenCalledOnce();
    expect(engine.resume).toHaveBeenCalledOnce();
  });

  it("keeps task state unchanged when controls are invalid or the engine rejects them", async () => {
    const { engine, manager } = await addedManager();

    engine.pause.mockReturnValueOnce(false);
    expect(manager.pause("task-1")).toBe(false);
    expect(manager.get("task-1")?.status).toBe("downloading");

    await expect(manager.resume("task-1")).resolves.toBe(false);
    expect(engine.resume).not.toHaveBeenCalled();

    expect(manager.pause("task-1")).toBe(true);
    engine.resume.mockReturnValueOnce(false);
    await expect(manager.resume("task-1")).resolves.toBe(false);
    expect(manager.get("task-1")?.status).toBe("paused");
  });

  it("removes only the engine task by default and preserves it when the engine fails", async () => {
    const { engine, manager } = await addedManager();

    engine.remove.mockResolvedValueOnce(false);
    await expect(manager.remove("task-1")).resolves.toBe(false);
    expect(manager.get("task-1")).toBeDefined();

    await expect(manager.remove("task-1")).resolves.toBe(true);
    expect(engine.remove).toHaveBeenLastCalledWith("task-1", {});
    expect(manager.get("task-1")).toBeUndefined();
    await expect(manager.remove("missing")).resolves.toBe(false);
  });

  it("restores incomplete tasks offline and reattaches their original source on resume", async () => {
    let persisted: readonly PersistedDownloadTask[] = [];
    const firstEngine = new FakeTorrentEngine();
    const first = new TorrentManager(firstEngine, {
      onPersistenceChange: (tasks) => { persisted = tasks; },
    });
    await first.add(addRequest());
    firstEngine.metadata("task-1", {
      name: "Metadata title",
      infoHash: HASH,
      magnetUri: `magnet:?xt=urn:btih:${HASH}&dn=Metadata%20title`,
      length: 200,
      path: "D:\\Payloads",
      files: [],
      torrentFile: new Uint8Array(),
    });
    firstEngine.snapshots.set("task-1", snapshot({
      name: "Snapshot title",
      path: "D:\\Payloads",
      length: 200,
      downloaded: 80,
      progress: 0.4,
    }));
    first.refresh("task-1");
    expect(first.pause("task-1")).toBe(true);
    expect(persisted).toEqual([{
      id: "task-1",
      source: `magnet:?xt=urn:btih:${HASH}&dn=Metadata%20title`,
      infoHash: HASH,
      name: "Snapshot title",
      savePath: "D:\\Payloads",
      total: 200,
      status: "paused",
    }]);
    expect(persisted[0]).not.toHaveProperty("progress");
    expect(persisted[0]).not.toHaveProperty("downloadSpeed");
    await first.destroy();

    const resumedEngine = new FakeTorrentEngine();
    const resumed = new TorrentManager(resumedEngine);
    expect(resumed.restore(persisted)[0]).toMatchObject({
      status: "paused",
      progress: 0,
      downloaded: 0,
      savePath: "D:\\Payloads",
      infoHash: HASH,
    });
    expect(resumedEngine.requests.size).toBe(0);
    await expect(resumed.resume("task-1")).resolves.toBe(true);
    expect(resumedEngine.requests.get("task-1")).toMatchObject({
      source: `magnet:?xt=urn:btih:${HASH}&dn=Metadata%20title`,
      path: "D:\\Payloads",
    });
    resumedEngine.snapshots.set("task-1", snapshot({
      path: "D:\\Payloads",
      length: 200,
      downloaded: 200,
      progress: 1,
      done: true,
    }));
    resumed.refresh("task-1");
    await vi.waitFor(() => expect(resumed.get("task-1")?.status).toBe("completed"));
  });

  it("persists explicit announce trackers through metadata and torrent-file resume", async () => {
    const announce = [
      "udp://tracker.example:1337/announce",
      "https://private.example/announce?passkey=abc%2F123",
    ];
    let persisted: readonly PersistedDownloadTask[] = [];
    const firstEngine = new FakeTorrentEngine();
    const first = new TorrentManager(firstEngine, {
      onPersistenceChange: (tasks) => { persisted = tasks; },
    });
    await first.add({ ...addRequest(), announce });
    firstEngine.metadata("task-1", {
      name: "Metadata title",
      infoHash: HASH,
      magnetUri: `magnet:?xt=urn:btih:${HASH}&dn=Metadata%20title`,
      length: 200,
      path: "D:\\Payloads",
      files: [],
      torrentFile: Uint8Array.from([1, 2, 3]),
    });

    expect(persisted[0]?.announce).toEqual(announce);
    expect(persisted[0]?.torrentFileBase64).toBe("AQID");

    const resumedEngine = new FakeTorrentEngine();
    const resumed = new TorrentManager(resumedEngine);
    resumed.restore(persisted);
    await expect(resumed.resume("task-1")).resolves.toBe(true);
    const engineRequest = resumedEngine.requests.get("task-1");
    expect(engineRequest?.source).toEqual(Uint8Array.from([1, 2, 3]));
    expect(engineRequest?.announce).toEqual(announce);
  });

  it("restores completed and seeding records offline and removes them durably", async () => {
    const completedRecord: PersistedDownloadTask = {
      id: "task-1",
      source: `magnet:?xt=urn:btih:${HASH}`,
      infoHash: HASH,
      name: "Completed fixture",
      savePath: "C:\\Downloads",
      total: 100,
      status: "completed",
    };
    for (const storedStatus of ["completed", "seeding"] as const) {
      let persisted: readonly PersistedDownloadTask[] = [];
      const engine = new FakeTorrentEngine();
      const manager = new TorrentManager(engine, {
        onPersistenceChange: (tasks) => { persisted = tasks; },
      });
      expect(manager.restore([{ ...completedRecord, status: storedStatus }])[0]).toMatchObject({
        status: "completed",
        progress: 1,
        uploadSpeed: 0,
        peers: 0,
      });
      expect(engine.requests.size).toBe(0);
      expect(persisted[0]?.status).toBe("completed");

      await expect(manager.startSeeding("task-1")).resolves.toBe(true);
      expect(persisted[0]?.status).toBe("seeding");
      await expect(manager.stopSeeding("task-1")).resolves.toBe(true);
      expect(persisted[0]?.status).toBe("completed");
      await expect(manager.remove("task-1")).resolves.toBe(true);
      expect(persisted).toEqual([]);
    }
  });

  it("rejects duplicate infohashes and destroys its owned engine", async () => {
    const { engine, manager } = await addedManager();

    const duplicate = manager.add({ ...addRequest(), id: "task-duplicate" });
    await expect(duplicate).rejects.toBeInstanceOf(DuplicateTorrentError);
    await expect(duplicate).rejects.toMatchObject({
        name: "DuplicateTorrentError",
        infoHash: HASH,
        existingTaskId: "task-1",
      });
    expect(manager.list()).toHaveLength(1);

    await manager.destroy();
    expect(engine.destroy).toHaveBeenCalledOnce();
    expect(manager.list()).toHaveLength(0);
  });
});
