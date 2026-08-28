import { invoke } from "@tauri-apps/api/core";
import type {
  DownloadAddResponse,
  IpcErrorResponse,
} from "@torlink/protocol";

export interface DownloadAddInput {
  magnet: string;
  name?: string;
  total?: number;
}

export type DownloadAddResult = DownloadAddResponse | IpcErrorResponse;

export interface DownloadClient {
  add(input: DownloadAddInput): Promise<DownloadAddResult>;
  directory(): Promise<string>;
}

export const desktopDownloadClient: DownloadClient = {
  add: ({ magnet, name, total }) => invoke("download_add", { magnet, name, total }),
  directory: () => invoke("download_directory"),
};
