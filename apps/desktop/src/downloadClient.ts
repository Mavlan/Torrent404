import { invoke } from "@tauri-apps/api/core";
import type {
  DownloadAddResponse,
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

export interface DownloadClient {
  add(input: DownloadAddInput): Promise<DownloadAddResult>;
  pause(taskId: string): Promise<DownloadControlResult>;
  resume(taskId: string): Promise<DownloadControlResult>;
  remove(taskId: string): Promise<DownloadControlResult>;
  directory(): Promise<string>;
}

export const desktopDownloadClient: DownloadClient = {
  add: ({ magnet, name, total }) => invoke("download_add", { magnet, name, total }),
  pause: (taskId) => invoke("download_pause", { taskId }),
  resume: (taskId) => invoke("download_resume", { taskId }),
  remove: (taskId) => invoke("download_remove", { taskId }),
  directory: () => invoke("download_directory"),
};
