import { invoke } from "@tauri-apps/api/core";
import type {
  DownloadAddResponse,
  DownloadListResponse,
  DownloadRemoveResponse,
  DownloadStateControlResponse,
  IpcErrorResponse,
} from "@torlink/protocol";

export interface DownloadAddInput {
  magnet: string;
  name?: string;
  total?: number;
}

export type DownloadAddResult = DownloadAddResponse | IpcErrorResponse;
export type DownloadControlResult =
  | DownloadStateControlResponse
  | DownloadRemoveResponse
  | IpcErrorResponse;
export type DownloadListResult = DownloadListResponse["result"];

export interface DownloadClient {
  add(input: DownloadAddInput): Promise<DownloadAddResult>;
  pause(taskId: string): Promise<DownloadControlResult>;
  resume(taskId: string): Promise<DownloadControlResult>;
  startSeeding(taskId: string): Promise<DownloadControlResult>;
  stopSeeding(taskId: string): Promise<DownloadControlResult>;
  remove(taskId: string): Promise<DownloadControlResult>;
  list(): Promise<DownloadListResult>;
  directory(): Promise<string>;
}

export const desktopDownloadClient: DownloadClient = {
  add: ({ magnet, name, total }) => invoke("download_add", { magnet, name, total }),
  pause: (taskId) => invoke("download_pause", { taskId }),
  resume: (taskId) => invoke("download_resume", { taskId }),
  startSeeding: (taskId) => invoke("download_start_seeding", { taskId }),
  stopSeeding: (taskId) => invoke("download_stop_seeding", { taskId }),
  remove: (taskId) => invoke("download_remove", { taskId }),
  list: () => invoke("download_list"),
  directory: () => invoke("download_directory"),
};
