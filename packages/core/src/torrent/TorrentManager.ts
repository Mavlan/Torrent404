import type { DownloadStatus, DownloadTask } from "@torlink/protocol";

import {
  canTransitionDownloadTask,
  createDownloadTask,
  transitionDownloadTask,
  type NewDownloadTask,
} from "../tasks/DownloadTaskModel.js";
import type {
  AddTorrentRequest,
  TorrentEngine,
  TorrentMetadata,
  TorrentSnapshot,
  TorrentSource,
} from "./TorrentEngine";

const INFO_HASH = /^[a-f\d]{40}$/i;

export interface AddDownloadRequest extends NewDownloadTask {
  source: TorrentSource;
  announce?: readonly string[];
}

export interface RemoveDownloadOptions {
  deleteData?: boolean;
}

export class DuplicateTorrentError extends Error {
  constructor(
    readonly infoHash: string,
    readonly existingTaskId: string,
  ) {
    super(`Torrent is already queued as task ${existingTaskId}`);
    this.name = "DuplicateTorrentError";
  }
}

function cloneTask(task: DownloadTask): DownloadTask {
  return { ...task };
}

function nonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function progress(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

export class TorrentManager {
  readonly #tasks = new Map<string, DownloadTask>();
  readonly #requests = new Map<string, AddDownloadRequest>();
  readonly #completing = new Set<string>();

  constructor(private readonly engine: TorrentEngine) {}

  get(id: string): DownloadTask | undefined {
    const task = this.#tasks.get(id);
    return task ? cloneTask(task) : undefined;
  }

  list(): readonly DownloadTask[] {
    return [...this.#tasks.values()].map(cloneTask);
  }

  snapshots(): readonly DownloadTask[] {
    for (const id of this.#tasks.keys()) this.refresh(id);
    return this.list();
  }

  async add(request: AddDownloadRequest): Promise<DownloadTask> {
    if (this.#tasks.has(request.id.trim())) {
      throw new Error(`Download task already exists: ${request.id.trim()}`);
    }

    const queued = createDownloadTask(request);
    const duplicate = [...this.#tasks.values()].find(
      (task) => task.infoHash === queued.infoHash,
    );
    if (duplicate) {
      throw new DuplicateTorrentError(queued.infoHash, duplicate.id);
    }
    this.#tasks.set(queued.id, queued);
    this.#requests.set(queued.id, { ...request, id: queued.id });
    this.#setStatus(queued.id, "downloading");

    try {
      await this.engine.add(this.#engineRequest(queued.id));
    } catch (error) {
      this.#fail(queued.id, error);
    }

    return cloneTask(this.#tasks.get(queued.id)!);
  }

  refresh(id: string): DownloadTask | undefined {
    const current = this.#tasks.get(id);
    if (!current) return undefined;

    const snapshot = this.engine.snapshot(id);
    if (!snapshot) return cloneTask(current);

    const updated = this.#applySnapshot(current, snapshot);
    this.#tasks.set(id, updated);
    if (snapshot.done) void this.#complete(id);
    return this.get(id);
  }

  pause(id: string): boolean {
    const current = this.#tasks.get(id);
    if (!current || !canTransitionDownloadTask(current.status, "paused")) return false;
    if (!this.engine.pause(id)) return false;

    this.#tasks.set(id, transitionDownloadTask(current, { status: "paused" }));
    return true;
  }

  resume(id: string): boolean {
    const current = this.#tasks.get(id);
    if (!current || current.status !== "paused") return false;

    const target = "downloading";
    if (!canTransitionDownloadTask(current.status, target)) return false;
    if (!this.engine.resume(id)) return false;

    this.#tasks.set(id, transitionDownloadTask(current, { status: target }));
    return true;
  }

  async startSeeding(id: string): Promise<boolean> {
    const current = this.#tasks.get(id);
    const request = this.#requests.get(id);
    if (!current || current.status !== "completed" || !request) return false;

    this.#tasks.set(id, transitionDownloadTask(current, { status: "seeding" }));
    try {
      await this.engine.add(this.#engineRequest(id));
    } catch (error) {
      this.#fail(id, error);
      return false;
    }
    return this.#tasks.get(id)?.status === "seeding";
  }

  async stopSeeding(id: string): Promise<boolean> {
    const current = this.#tasks.get(id);
    if (!current || current.status !== "seeding") return false;
    if (!await this.engine.remove(id, { deleteData: false })) return false;

    const latest = this.#tasks.get(id);
    if (!latest || !canTransitionDownloadTask(latest.status, "completed")) return false;
    this.#tasks.set(id, transitionDownloadTask(latest, { status: "completed" }));
    return true;
  }

  async remove(id: string, options: RemoveDownloadOptions = {}): Promise<boolean> {
    if (!this.#tasks.has(id)) return false;
    if (!await this.engine.remove(id, options)) return false;
    this.#tasks.delete(id);
    this.#requests.delete(id);
    this.#completing.delete(id);
    return true;
  }

  async destroy(): Promise<void> {
    await this.engine.destroy();
    this.#tasks.clear();
    this.#requests.clear();
    this.#completing.clear();
  }

  #setStatus(id: string, status: Exclude<DownloadStatus, "error">): void {
    const current = this.#tasks.get(id);
    if (!current) return;
    this.#tasks.set(id, transitionDownloadTask(current, { status }));
  }

  #applyMetadata(id: string, metadata: TorrentMetadata): void {
    const current = this.#tasks.get(id);
    if (!current) return;

    const infoHash = metadata.infoHash.trim().toLowerCase();
    this.#tasks.set(id, {
      ...current,
      name: metadata.name.trim() || current.name,
      infoHash: INFO_HASH.test(infoHash) ? infoHash : current.infoHash,
      savePath: metadata.path.trim() || current.savePath,
      total: nonNegative(metadata.length, current.total),
    });
  }

  #applySnapshot(task: DownloadTask, snapshot: TorrentSnapshot): DownloadTask {
    const { etaSeconds: _etaSeconds, ...withoutEta } = task;
    const mapped: DownloadTask = {
      ...withoutEta,
      name: snapshot.name.trim() || task.name,
      infoHash: INFO_HASH.test(snapshot.infoHash)
        ? snapshot.infoHash.toLowerCase()
        : task.infoHash,
      savePath: snapshot.path.trim() || task.savePath,
      progress: progress(snapshot.progress, task.progress),
      downloadSpeed: nonNegative(snapshot.downloadSpeed, task.downloadSpeed),
      uploadSpeed: nonNegative(snapshot.uploadSpeed, task.uploadSpeed),
      downloaded: nonNegative(snapshot.downloaded, task.downloaded),
      total: nonNegative(snapshot.length, task.total),
      peers: Math.floor(nonNegative(snapshot.peers, task.peers ?? 0)),
    };

    if (task.status === "paused") {
      return { ...mapped, downloadSpeed: 0, uploadSpeed: 0 };
    }

    return Number.isFinite(snapshot.timeRemaining) && snapshot.timeRemaining >= 0
      ? { ...mapped, etaSeconds: snapshot.timeRemaining / 1_000 }
      : mapped;
  }

  #engineRequest(id: string): AddTorrentRequest {
    const request = this.#requests.get(id);
    const task = this.#tasks.get(id);
    if (!request || !task) throw new Error(`Download task does not exist: ${id}`);
    return {
      id,
      source: request.source,
      path: task.savePath,
      onMetadata: (metadata) => this.#applyMetadata(id, metadata),
      onDone: () => void this.#complete(id),
      onError: (error) => this.#fail(id, error),
      ...(request.announce ? { announce: request.announce } : {}),
    };
  }

  async #complete(id: string): Promise<void> {
    const current = this.#tasks.get(id);
    if (
      !current
      || current.status === "completed"
      || current.status === "seeding"
      || this.#completing.has(id)
    ) return;

    if (!canTransitionDownloadTask(current.status, "completed")) return;
    this.#completing.add(id);
    try {
      if (!await this.engine.remove(id, { deleteData: false })) {
        this.#fail(id, new Error("Torrent engine could not stop the completed task"));
        return;
      }
      const latest = this.#tasks.get(id);
      if (!latest || !canTransitionDownloadTask(latest.status, "completed")) return;
      this.#tasks.set(id, transitionDownloadTask(latest, { status: "completed" }));
    } catch (error) {
      this.#fail(id, error);
    } finally {
      this.#completing.delete(id);
    }
  }

  #fail(id: string, error: unknown): void {
    const current = this.#tasks.get(id);
    if (!current || !canTransitionDownloadTask(current.status, "error")) return;

    const message = error instanceof Error ? error.message : String(error);
    this.#tasks.set(id, transitionDownloadTask(current, {
      status: "error",
      error: message.trim() || "Unknown torrent engine error",
    }));
    this.#completing.delete(id);
  }
}
