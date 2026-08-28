import type { DownloadStatus, DownloadTask } from "@torlink/protocol";

const INFO_HASH = /^[a-f\d]{40}$/i;

const LEGAL_TRANSITIONS: Readonly<Record<DownloadStatus, readonly DownloadStatus[]>> = {
  queued: ["downloading", "paused", "error"],
  downloading: ["paused", "completed", "seeding", "error"],
  paused: ["queued", "downloading", "completed", "seeding", "error"],
  completed: ["seeding"],
  seeding: ["paused", "completed", "error"],
  error: ["queued"],
};

export interface NewDownloadTask {
  id: string;
  infoHash: string;
  name: string;
  savePath: string;
  total?: number;
}

export type DownloadTaskTransition =
  | { status: Exclude<DownloadStatus, "error"> }
  | { status: "error"; error: string };

export class InvalidDownloadTaskTransitionError extends Error {
  constructor(
    readonly from: DownloadStatus,
    readonly to: DownloadStatus,
  ) {
    super(`Invalid download task transition: ${from} -> ${to}`);
    this.name = "InvalidDownloadTaskTransitionError";
  }
}

function requiredField(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
}

export function createDownloadTask(input: NewDownloadTask): DownloadTask {
  const infoHash = input.infoHash.trim().toLowerCase();
  if (!INFO_HASH.test(infoHash)) {
    throw new Error("infoHash must be a 40-character hexadecimal value");
  }

  const total = input.total ?? 0;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("total must be a non-negative safe integer");
  }

  return {
    id: requiredField("id", input.id),
    infoHash,
    name: requiredField("name", input.name),
    status: "queued",
    progress: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    downloaded: 0,
    total,
    peers: 0,
    savePath: requiredField("savePath", input.savePath),
  };
}

export function canTransitionDownloadTask(
  from: DownloadStatus,
  to: DownloadStatus,
): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function transitionDownloadTask(
  task: Readonly<DownloadTask>,
  transition: DownloadTaskTransition,
): DownloadTask {
  if (!canTransitionDownloadTask(task.status, transition.status)) {
    throw new InvalidDownloadTaskTransitionError(task.status, transition.status);
  }

  const { error: _error, etaSeconds: _etaSeconds, ...stable } = task;
  const next: DownloadTask = {
    ...stable,
    status: transition.status,
    downloadSpeed: 0,
    uploadSpeed: 0,
  };

  if (transition.status === "error") {
    const error = transition.error.trim();
    if (error.length === 0) throw new Error("error transition requires a message");
    return { ...next, error };
  }

  if (transition.status === "completed" || transition.status === "seeding") {
    const total = Math.max(task.total, task.downloaded);
    return { ...next, progress: 1, downloaded: total, total };
  }

  return next;
}
