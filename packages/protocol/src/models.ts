export const downloadStatuses = [
  "queued",
  "downloading",
  "paused",
  "seeding",
  "completed",
  "error",
] as const;

export type DownloadStatus = (typeof downloadStatuses)[number];

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

export interface SearchResult {
  id: string;
  title: string;
  source: string;
  infoHash?: string;
  category?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  magnet?: string;
  torrentUrl?: string;
}

export interface DownloadTask {
  id: string;
  infoHash: string;
  name: string;
  status: DownloadStatus;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  total: number;
  etaSeconds?: number;
  savePath: string;
  error?: string;
}

export interface Settings {
  schemaVersion: number;
  downloadDir: string;
  language: "zh-CN";
  theme: Theme;
  providerEnabled: Record<string, boolean>;
}

export type SourceRunState = "idle" | "searching" | "complete" | "error";

export interface SourceStatus {
  source: string;
  displayName: string;
  state: SourceRunState;
  resultCount: number;
  errorCode?: string;
  detail?: string;
}

export interface CoreError {
  code: string;
  messageKey: string;
  detail?: string;
  recoverable: boolean;
}
