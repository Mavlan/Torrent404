import type { DownloadTask, SearchCategory, SearchResult } from "./models";

export const IPC_PROTOCOL_VERSION = 1 as const;

export const IPC_COMMANDS = [
  "ping",
  "health",
  "search.providers",
  "search.start",
  "search.poll",
  "search.cancel",
  "download.add",
  "download.pause",
  "download.resume",
  "download.seed.start",
  "download.seed.stop",
  "download.remove",
  "download.list",
] as const;

export type IpcCommand = (typeof IPC_COMMANDS)[number];

export type IpcErrorCode =
  | "malformed_request"
  | "unauthorized"
  | "protocol_version_mismatch"
  | "unknown_command"
  | "invalid_search_request"
  | "duplicate_request_id"
  | "search_request_not_found"
  | "invalid_magnet"
  | "duplicate_torrent"
  | "download_directory_unavailable"
  | "engine_add_failed"
  | "invalid_download_task_request"
  | "download_task_not_found"
  | "invalid_download_task_transition"
  | "engine_control_failed"
  | "internal_error";

export interface IpcRequest {
  protocolVersion: number;
  command: string;
}

export interface SearchStartRequest extends IpcRequest {
  command: "search.start";
  requestId: string;
  query: string;
  category: SearchCategory;
  /** Optional session-level product selection; omitted keeps the default enabled set. */
  providerIds?: string[];
}

export interface SearchProviderDescriptor {
  providerId: string;
  displayName: string;
  categories: readonly SearchCategory[];
  enabled: boolean;
}

export interface SearchPollRequest extends IpcRequest {
  command: "search.poll";
  requestId: string;
  cursor: number;
}

export interface SearchCancelRequest extends IpcRequest {
  command: "search.cancel";
  requestId: string;
}

export interface DownloadAddRequest extends IpcRequest {
  command: "download.add";
  magnet: string;
  name?: string;
  total?: number;
  downloadDir: string;
}

export type DownloadControlCommand =
  | "download.pause"
  | "download.resume"
  | "download.seed.start"
  | "download.seed.stop"
  | "download.remove";

export interface DownloadControlRequest extends IpcRequest {
  command: DownloadControlCommand;
  taskId: string;
}

export interface DownloadListRequest extends IpcRequest {
  command: "download.list";
}

export interface IpcErrorResponse {
  ok: false;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  error: {
    code: IpcErrorCode;
    message: string;
  };
}

export interface PingResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "ping";
  result: {
    reply: "pong";
  };
}

export interface HealthResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "health";
  result: {
    status: "ok";
  };
}

export type SearchProviderState =
  | "searching"
  | "complete"
  | "error"
  | "timeout"
  | "cancelled";

export type SearchIpcErrorCode =
  | "provider_error"
  | "provider_timeout"
  | "search_failed";

export interface SearchIpcError {
  code: SearchIpcErrorCode;
  message: string;
}

export interface SearchProviderStatus {
  providerId: string;
  displayName: string;
  state: SearchProviderState;
  resultCount: number;
  error?: SearchIpcError;
}

export type SearchIpcEvent =
  | { type: "search.result"; requestId: string; result: SearchResult }
  | { type: "search.provider-status"; requestId: string; status: SearchProviderStatus }
  | { type: "search.error"; requestId: string; error: SearchIpcError }
  | { type: "search.complete"; requestId: string; cancelled: boolean };

export interface SearchStartResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "search.start";
  result: {
    requestId: string;
  };
}

export interface SearchProvidersResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "search.providers";
  result: {
    providers: SearchProviderDescriptor[];
  };
}

export interface SearchPollResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "search.poll";
  result: {
    requestId: string;
    events: SearchIpcEvent[];
    nextCursor: number;
    done: boolean;
  };
}

export interface SearchCancelResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "search.cancel";
  result: {
    requestId: string;
    cancelled: boolean;
  };
}

export interface DownloadAddResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "download.add";
  result: {
    taskId: string;
    task: DownloadTask;
  };
}

export interface DownloadStateControlResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command:
    | "download.pause"
    | "download.resume"
    | "download.seed.start"
    | "download.seed.stop";
  result: {
    taskId: string;
    task: DownloadTask;
  };
}

export interface DownloadRemoveResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "download.remove";
  result: {
    taskId: string;
    removed: true;
  };
}

export interface DownloadListResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "download.list";
  result: {
    tasks: DownloadTask[];
  };
}

export type IpcResponse =
  | IpcErrorResponse
  | PingResponse
  | HealthResponse
  | SearchProvidersResponse
  | SearchStartResponse
  | SearchPollResponse
  | SearchCancelResponse
  | DownloadAddResponse
  | DownloadStateControlResponse
  | DownloadRemoveResponse
  | DownloadListResponse;
