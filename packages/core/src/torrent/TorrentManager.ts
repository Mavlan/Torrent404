import type { DownloadStatus, DownloadTask } from "@torlink/protocol";

import {
  canTransitionDownloadTask,
  createDownloadTask,
  transitionDownloadTask,
  type NewDownloadTask,
} from "../tasks/DownloadTaskModel";
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
  readonly #resumeStatus = new Map<string, "downloading" | "seeding">();

  constructor(private readonly engine: TorrentEngine) {}

  get(id: string): DownloadTask | undefined {
    const task = this.#tasks.get(id);
    return task ? cloneTask(task) : undefined;
  }

  list(): readonly DownloadTask[] {
    return [...this.#tasks.values()].map(cloneTask);
  }

  async add(request: AddDownloadRequest): Promise<DownloadTask> {
    if (this.#tasks.has(request.id.trim())) {
      throw new Error(`Download task already exists: ${request.id.trim()}`);
    }

    const queued = createDownloadTask(request);
    this.#tasks.set(queued.id, queued);
    this.#setStatus(queued.id, "downloading");

    const engineRequest: AddTorrentRequest = {
      id: queued.id,
      source: request.source,
      path: queued.savePath,
      onMetadata: (metadata) => this.#applyMetadata(queued.id, metadata),
      onDone: () => this.#complete(queued.id),
      onError: (error) => this.#fail(queued.id, error),
      ...(request.announce ? { announce: request.announce } : {}),
    };

    try {
      await this.engine.add(engineRequest);
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
    if (snapshot.done) this.#complete(id);
    return this.get(id);
  }

  pause(id: string): boolean {
    const current = this.#tasks.get(id);
    if (!current || !canTransitionDownloadTask(current.status, "paused")) return false;
    if (!this.engine.pause(id)) return false;

    this.#resumeStatus.set(
      id,
      current.status === "seeding" ? "seeding" : "downloading",
    );
    this.#tasks.set(id, transitionDownloadTask(current, { status: "paused" }));
    return true;
  }

  resume(id: string): boolean {
    const current = this.#tasks.get(id);
    if (!current || current.status !== "paused") return false;

    const target = this.#resumeStatus.get(id)
      ?? (current.progress >= 1 ? "seeding" : "downloading");
    if (!canTransitionDownloadTask(current.status, target)) return false;
    if (!this.engine.resume(id)) return false;

    this.#tasks.set(id, transitionDownloadTask(current, { status: target }));
    this.#resumeStatus.delete(id);
    return true;
  }

  async remove(id: string, options: RemoveDownloadOptions = {}): Promise<boolean> {
    if (!this.#tasks.has(id)) return false;
    await this.engine.remove(id, options);
    this.#tasks.delete(id);
    this.#resumeStatus.delete(id);
    return true;
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
    };

    return Number.isFinite(snapshot.timeRemaining) && snapshot.timeRemaining >= 0
      ? { ...mapped, etaSeconds: snapshot.timeRemaining / 1_000 }
      : mapped;
  }

  #complete(id: string): void {
    const current = this.#tasks.get(id);
    if (!current) return;

    const target = current.status === "paused" ? "completed" : "seeding";
    if (!canTransitionDownloadTask(current.status, target)) return;
    this.#tasks.set(id, transitionDownloadTask(current, { status: target }));
    this.#resumeStatus.delete(id);
  }

  #fail(id: string, error: unknown): void {
    const current = this.#tasks.get(id);
    if (!current || !canTransitionDownloadTask(current.status, "error")) return;

    const message = error instanceof Error ? error.message : String(error);
    this.#tasks.set(id, transitionDownloadTask(current, {
      status: "error",
      error: message.trim() || "Unknown torrent engine error",
    }));
    this.#resumeStatus.delete(id);
  }
}
