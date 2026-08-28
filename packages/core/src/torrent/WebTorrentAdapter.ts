import { cleanup as cleanupDataChannel } from "node-datachannel";
import WebTorrent, {
  type Torrent,
  type WebTorrentOptions,
} from "webtorrent";

import type {
  AddTorrentRequest,
  TorrentEngine,
  TorrentSnapshot,
} from "./TorrentEngine";

type WebTorrentClient = WebTorrent;
type ClientFactory = (options: WebTorrentOptions) => WebTorrentClient;
type ControllableTorrent = Torrent & {
  wires?: Array<{ destroy(): void }>;
  discovery?: { tracker?: { update(): void } };
};

export interface WebTorrentAdapterOptions {
  maxConnections?: number;
  dht?: boolean;
  tracker?: boolean;
  lsd?: boolean;
  natPmp?: boolean;
  natUpnp?: boolean | "permanent";
}

// WebTorrent only consumes trackers already present in a magnet when
// `tracker: true` is used. Search adapters intentionally construct minimal
// magnets from provider infohashes, so keep a small fallback set from the
// WebTorrent project's own create-torrent defaults for public torrents.
const DEFAULT_ANNOUNCE = [
  "udp://tracker.opentrackr.org:1337",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.webtorrent.dev",
] as const;

const DEFAULT_OPTIONS: WebTorrentOptions = {
  dht: true,
  lsd: true,
  // The optional native uTP addon kept the Node process alive after all
  // torrents and sockets were destroyed in the Phase 1.5 shutdown smoke.
  // TCP peer transport remains enabled and is the tested sidecar baseline.
  utp: false,
  // Avoid the known macOS NAT-PMP port collision inherited from TorLink.
  natPmp: false,
};

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class WebTorrentAdapter implements TorrentEngine {
  readonly #clientFactory: ClientFactory;
  readonly #cleanup: () => void;
  readonly #clientOptions: WebTorrentOptions;
  #client: WebTorrentClient | null = null;
  #clientError: Error | null = null;
  #destroyed = false;
  #torrents = new Map<string, Torrent>();

  constructor(options?: WebTorrentAdapterOptions);
  constructor(
    options: WebTorrentAdapterOptions = {},
    clientFactory: ClientFactory = (clientOptions) => new WebTorrent(clientOptions),
    cleanup: () => void = cleanupDataChannel,
  ) {
    this.#clientOptions = {
      ...DEFAULT_OPTIONS,
      ...(options.maxConnections === undefined ? {} : { maxConns: options.maxConnections }),
      ...(options.dht === undefined ? {} : { dht: options.dht }),
      tracker: options.tracker === false
        ? false
        : { announce: [...DEFAULT_ANNOUNCE] },
      ...(options.lsd === undefined ? {} : { lsd: options.lsd }),
      ...(options.natPmp === undefined ? {} : { natPmp: options.natPmp }),
      ...(options.natUpnp === undefined ? {} : { natUpnp: options.natUpnp }),
      utp: false,
    };
    this.#clientFactory = clientFactory;
    this.#cleanup = cleanup;
  }

  async add(request: AddTorrentRequest): Promise<void> {
    if (this.#destroyed) throw new Error("Torrent engine is destroyed");
    if (this.#torrents.has(request.id)) await this.remove(request.id);

    const client = this.#ensureClient();
    let torrent: Torrent;
    try {
      torrent = client.add(request.source, {
        path: request.path,
        ...(request.announce?.length ? { announce: [...request.announce] } : {}),
      });
    } catch (error) {
      request.onError?.(asError(error));
      return;
    }

    this.#torrents.set(request.id, torrent);
    torrent.once("metadata", () => request.onMetadata?.({
      name: torrent.name,
      infoHash: torrent.infoHash,
      magnetUri: torrent.magnetURI,
      length: torrent.length,
      path: torrent.path,
      files: torrent.files.map(({ name, path, length }) => ({ name, path, length })),
      torrentFile: Uint8Array.from(torrent.torrentFile),
    }));
    torrent.once("done", () => request.onDone?.());
    torrent.once("error", (error: unknown) => {
      this.#torrents.delete(request.id);
      request.onError?.(asError(error));
    });
  }

  async remove(id: string, options: { deleteData?: boolean } = {}): Promise<boolean> {
    const torrent = this.#torrents.get(id);
    if (!torrent) return false;
    this.#torrents.delete(id);

    const client = this.#client;
    if (!client) return true;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      client.remove(torrent, { destroyStore: options.deleteData === true }, finish).catch(finish);
    });
    return true;
  }

  pause(id: string): boolean {
    const torrent = this.#torrents.get(id);
    if (!torrent) return false;
    torrent.pause();
    // WebTorrent's pause flag prevents new peer work, but already-open wires
    // can continue filling their request pipeline. Closing those wires makes
    // pause observable immediately; resume() drains the queued peers again.
    for (const wire of [...((torrent as ControllableTorrent).wires ?? [])]) wire.destroy();
    return true;
  }

  resume(id: string): boolean {
    const torrent = this.#torrents.get(id);
    if (!torrent) return false;
    torrent.resume();
    (torrent as ControllableTorrent).discovery?.tracker?.update();
    return true;
  }

  snapshot(id: string): TorrentSnapshot | null {
    const torrent = this.#torrents.get(id);
    if (!torrent) return null;
    try {
      return {
        id,
        name: torrent.name || "",
        infoHash: torrent.infoHash || "",
        path: torrent.path || "",
        progress: torrent.progress || 0,
        downloadSpeed: torrent.downloadSpeed || 0,
        uploadSpeed: torrent.uploadSpeed || 0,
        downloaded: torrent.downloaded || 0,
        uploaded: torrent.uploaded || 0,
        length: torrent.length || 0,
        timeRemaining: Number.isFinite(torrent.timeRemaining) ? torrent.timeRemaining : Number.POSITIVE_INFINITY,
        peers: torrent.numPeers || 0,
        done: torrent.done === true,
        paused: torrent.paused === true,
        files: (torrent.files ?? []).map(({ name, path, length }) => ({ name, path, length })),
      };
    } catch {
      return null;
    }
  }

  listenPort(): number | null {
    return this.#client?.torrentPort ?? null;
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const client = this.#client;
    this.#client = null;
    this.#torrents.clear();
    if (client) {
      await new Promise<void>((resolve, reject) => {
        client.destroy((error) => error ? reject(error) : resolve());
      });
    }
    // WebTorrent's Node WebRTC polyfill initializes native global state even
    // when the sidecar only uses TCP peers. Release it after the owned client.
    this.#cleanup();
  }

  #ensureClient(): WebTorrentClient {
    if (this.#clientError) throw this.#clientError;
    if (!this.#client) {
      this.#client = this.#clientFactory(this.#clientOptions);
      this.#client.once("error", (error: unknown) => {
        this.#clientError = asError(error);
        this.#client = null;
        this.#torrents.clear();
      });
    }
    return this.#client;
  }
}
