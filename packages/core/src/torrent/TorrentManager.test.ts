import type { DownloadTask } from "@torlink/protocol";
import { describe, expect, it, vi } from "vitest";

import type {
  AddTorrentRequest,
  TorrentEngine,
  TorrentMetadata,
  TorrentSnapshot,
} from "./TorrentEngine";
import { DuplicateTorrentError, TorrentManager } from "./TorrentManager";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";

class FakeTorrentEngine implements TorrentEngine {
  readonly requests = new Map<string, AddTorrentRequest>();
  readonly snapshots = new Map<string, TorrentSnapshot>();
  readonly pause = vi.fn((_id: string) => true);
  readonly resume = vi.fn((_id: string) => true);
  readonly remove = vi.fn(async (_id: string, _options?: { deleteData?: boolean }) => true);
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
      etaSeconds: 25,
    });
  });

  it("maps completion to seeding and normalizes finished counters", async () => {
    const { engine, manager } = await addedManager();
    engine.snapshots.set("task-1", snapshot({
      done: true,
      progress: 1,
      downloaded: 100,
    }));

    expect(manager.refresh("task-1")).toMatchObject({
      status: "seeding",
      progress: 1,
      downloaded: 100,
      total: 100,
    });

    engine.done("task-1");
    expect(manager.get("task-1")?.status).toBe("seeding");
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

  it("pauses and resumes both downloading and seeding tasks", async () => {
    const { engine, manager } = await addedManager();

    expect(manager.pause("task-1")).toBe(true);
    expect(manager.get("task-1")?.status).toBe("paused");
    expect(manager.resume("task-1")).toBe(true);
    expect(manager.get("task-1")?.status).toBe("downloading");

    engine.done("task-1");
    expect(manager.get("task-1")?.status).toBe("seeding");
    expect(manager.pause("task-1")).toBe(true);
    expect(manager.resume("task-1")).toBe(true);
    expect(manager.get("task-1")?.status).toBe("seeding");
    expect(engine.pause).toHaveBeenCalledTimes(2);
    expect(engine.resume).toHaveBeenCalledTimes(2);
  });

  it("removes the engine handle and local task", async () => {
    const { engine, manager } = await addedManager();

    await expect(manager.remove("task-1", { deleteData: true })).resolves.toBe(true);
    expect(engine.remove).toHaveBeenCalledWith("task-1", { deleteData: true });
    expect(manager.get("task-1")).toBeUndefined();
    await expect(manager.remove("missing")).resolves.toBe(false);
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
