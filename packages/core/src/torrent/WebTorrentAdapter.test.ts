import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { WebTorrentAdapter } from "./WebTorrentAdapter";

type TestAdapterConstructor = new (
  options: ConstructorParameters<typeof WebTorrentAdapter>[0],
  clientFactory: (options: unknown) => never,
  cleanup: () => void,
) => WebTorrentAdapter;
const TestAdapter = WebTorrentAdapter as unknown as TestAdapterConstructor;

class FakeTorrent extends EventEmitter {
  infoHash = "0123456789abcdef0123456789abcdef01234567";
  magnetURI = `magnet:?xt=urn:btih:${this.infoHash}`;
  torrentFile = Uint8Array.from([1, 2, 3]);
  ready = true;
  name = "legal-fixture.bin";
  length = 3;
  downloaded = 2;
  uploaded = 1;
  downloadSpeed = 10;
  uploadSpeed = 5;
  progress = 2 / 3;
  numPeers = 2;
  timeRemaining = 100;
  done = false;
  paused = false;
  path = "C:\\downloads";
  files = [{ name: this.name, path: this.name, length: 3 }];

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
}

class FakeClient extends EventEmitter {
  readonly torrents: FakeTorrent[] = [];
  torrentPort = 51413;
  destroyed = false;

  add(): FakeTorrent {
    const torrent = new FakeTorrent();
    this.torrents.push(torrent);
    return torrent;
  }

  async remove(torrent: FakeTorrent, _options: unknown, callback: (error?: Error | null) => void): Promise<void> {
    this.torrents.splice(this.torrents.indexOf(torrent), 1);
    callback();
  }

  destroy(callback: (error?: Error | null) => void): void {
    this.destroyed = true;
    callback();
  }
}

describe("WebTorrentAdapter", () => {
  it("forces the tested TCP baseline and maps metadata/stats", async () => {
    const client = new FakeClient();
    const optionsSeen: unknown[] = [];
    const metadata = vi.fn();
    const adapter = new TestAdapter(
      {},
      (options) => {
        optionsSeen.push(options);
        return client as never;
      },
      vi.fn(),
    );

    await adapter.add({
      id: "task-1",
      source: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
      path: "C:\\downloads",
      onMetadata: metadata,
    });
    client.torrents[0]!.emit("metadata");

    expect(optionsSeen).toEqual([expect.objectContaining({ dht: true, tracker: true, utp: false })]);
    expect(metadata).toHaveBeenCalledWith(expect.objectContaining({
      infoHash: "0123456789abcdef0123456789abcdef01234567",
      length: 3,
      torrentFile: Uint8Array.from([1, 2, 3]),
    }));
    expect(adapter.snapshot("task-1")).toEqual(expect.objectContaining({
      progress: 2 / 3,
      downloadSpeed: 10,
      uploadSpeed: 5,
      downloaded: 2,
      length: 3,
      timeRemaining: 100,
      peers: 2,
      done: false,
    }));
    expect(adapter.listenPort()).toBe(51413);
  });

  it("owns pause, resume, remove, and complete shutdown", async () => {
    const client = new FakeClient();
    const cleanup = vi.fn();
    const adapter = new TestAdapter({}, () => client as never, cleanup);
    await adapter.add({ id: "task-1", source: new Uint8Array([1]), path: "C:\\downloads" });

    expect(adapter.pause("task-1")).toBe(true);
    expect(adapter.snapshot("task-1")?.paused).toBe(true);
    expect(adapter.resume("task-1")).toBe(true);
    expect(await adapter.remove("task-1")).toBe(true);
    expect(await adapter.remove("missing")).toBe(false);
    await adapter.destroy();
    await adapter.destroy();

    expect(client.destroyed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("routes torrent errors without leaking the task handle", async () => {
    const client = new FakeClient();
    const onError = vi.fn();
    const adapter = new TestAdapter({}, () => client as never, vi.fn());
    await adapter.add({ id: "task-1", source: "bad", path: "C:\\downloads", onError });
    client.torrents[0]!.emit("error", new Error("invalid torrent"));

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "invalid torrent" }));
    expect(adapter.snapshot("task-1")).toBeNull();
  });
});
