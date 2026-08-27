declare module "webtorrent" {
  import type { EventEmitter } from "node:events";

  export type TorrentIdentifier = string | Uint8Array;

  export interface TorrentFile {
    name: string;
    path: string;
    length: number;
  }

  export interface Torrent extends EventEmitter {
    readonly infoHash: string;
    readonly magnetURI: string;
    readonly torrentFile: Uint8Array;
    readonly ready: boolean;
    readonly name: string;
    readonly length: number;
    readonly downloaded: number;
    readonly uploaded: number;
    readonly downloadSpeed: number;
    readonly uploadSpeed: number;
    readonly progress: number;
    readonly numPeers: number;
    readonly timeRemaining: number;
    readonly done: boolean;
    readonly paused: boolean;
    readonly path: string;
    readonly files: TorrentFile[];
    pause(): void;
    resume(): void;
    destroy(callback?: (error?: Error | null) => void): void;
  }

  export interface TorrentOptions {
    path?: string;
    announce?: string[];
    destroyStoreOnDestroy?: boolean;
  }

  export interface WebTorrentOptions {
    maxConns?: number;
    dht?: boolean | Record<string, unknown>;
    utp?: boolean;
    tracker?: boolean | Record<string, unknown>;
    lsd?: boolean;
    natPmp?: boolean;
    natUpnp?: boolean | "permanent";
  }

  export default class WebTorrent extends EventEmitter {
    constructor(options?: WebTorrentOptions);
    readonly destroyed: boolean;
    readonly torrents: Torrent[];
    readonly torrentPort: number;
    add(
      torrentId: TorrentIdentifier,
      options?: TorrentOptions,
      onTorrent?: (torrent: Torrent) => void,
    ): Torrent;
    get(torrentId: TorrentIdentifier | Torrent): Promise<Torrent | null>;
    remove(
      torrentId: TorrentIdentifier | Torrent,
      options?: { destroyStore?: boolean } | null,
      callback?: (error?: Error | null) => void,
    ): Promise<void>;
    destroy(callback?: (error?: Error | null) => void): void;
  }
}
