export type TorrentSource = string | Uint8Array;

export interface TorrentFileSnapshot {
  name: string;
  path: string;
  length: number;
}

export interface TorrentMetadata {
  name: string;
  infoHash: string;
  magnetUri: string;
  length: number;
  path: string;
  files: TorrentFileSnapshot[];
  torrentFile: Uint8Array;
}

export interface TorrentSnapshot {
  id: string;
  name: string;
  infoHash: string;
  path: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  uploaded: number;
  length: number;
  timeRemaining: number;
  peers: number;
  done: boolean;
  paused: boolean;
  files: TorrentFileSnapshot[];
}

export interface AddTorrentRequest {
  id: string;
  source: TorrentSource;
  path: string;
  announce?: readonly string[];
  onMetadata?: (metadata: TorrentMetadata) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export interface TorrentEngine {
  add(request: AddTorrentRequest): Promise<void>;
  remove(id: string, options?: { deleteData?: boolean }): Promise<boolean>;
  pause(id: string): boolean;
  resume(id: string): boolean;
  snapshot(id: string): TorrentSnapshot | null;
  listenPort(): number | null;
  destroy(): Promise<void>;
}
