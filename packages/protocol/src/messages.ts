import type { CoreError, DownloadTask, SearchResult, Settings, SourceStatus } from "./models";

export const PROTOCOL_VERSION = 1 as const;

export type CoreCommand =
  | { type: "search"; requestId: string; query: string }
  | { type: "addMagnet"; requestId: string; magnet: string; savePath?: string }
  | { type: "addTorrentFile"; requestId: string; path: string; savePath?: string }
  | { type: "pauseTask"; requestId: string; id: string }
  | { type: "resumeTask"; requestId: string; id: string }
  | { type: "removeTask"; requestId: string; id: string; deleteFiles?: boolean }
  | { type: "stopSeeding"; requestId: string; id: string }
  | { type: "setDefaultDownloadDir"; requestId: string; path: string }
  | { type: "getSettings"; requestId: string }
  | { type: "listTasks"; requestId: string };

export type CoreEvent =
  | { type: "search:result"; requestId: string; result: SearchResult }
  | { type: "search:source-status"; requestId: string; status: SourceStatus }
  | { type: "task:added"; task: DownloadTask }
  | { type: "task:updated"; task: DownloadTask }
  | { type: "task:removed"; id: string }
  | { type: "settings:updated"; settings: Settings }
  | { type: "core:error"; requestId?: string; error: CoreError };

export interface ProtocolEnvelope<T> {
  version: typeof PROTOCOL_VERSION;
  payload: T;
}

