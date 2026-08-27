# WebTorrent 2.4.1 → 3.0.21 Migration

Status: **compatible through `WebTorrentAdapter`**

Candidate release: [`webtorrent@3.0.21`](https://github.com/webtorrent/webtorrent/releases/tag/v3.0.21)

## TorLink usage inventory

TorLink v1.7.0 declares `webtorrent@^2.4.1` and currently resolves 2.8.5. All production WebTorrent calls are concentrated in `src/download/engine.ts`; `scripts/verify-seeding.ts` is a verification harness. The queue implements pause/resume by removing and re-adding a task, although its hand-written declaration also exposes torrent `pause()`/`resume()`.

Observed calls and reads:

- `new WebTorrent(options)` and client `error`;
- `client.add(magnet | infohash | .torrent path, { path, announce })`;
- torrent `metadata`, `done`, and `error` events;
- torrent `destroy()` and client `destroy()`;
- `torrentPort`;
- `progress`, `downloaded`, `length`, `downloadSpeed`, `uploadSpeed`, `uploaded`, `numPeers`, `timeRemaining`, `name`;
- `torrentFile`, `files`, `infoHash`, `path`, `done`;
- test-only `seed()` and `addPeer()`.

No UI/provider/protocol code imports WebTorrent directly in the desktop project.

## Compatibility diff

### Unchanged for TorLink's call surface

The following passed against 3.0.21 in the Node build:

- constructor and fatal-error event model;
- `add()` accepting magnet, infohash, metadata bytes, and metadata path;
- `metadata`, `done`, torrent `error` events;
- `pause()` / `resume()` and the `paused` flag;
- `remove()` and torrent/client teardown;
- all statistics and metadata fields listed above;
- TCP peers, UDP tracker, DHT, tracker peer discovery, seeding, and restored verification.

### API and semantic changes requiring adaptation

| Area | 2.4.1 / TorLink assumption | 3.0.21 behavior | Adapter decision |
|---|---|---|---|
| Node runtime | 2.4.1 declares Node `>=16`; TorLink types do not encode a stronger floor | 3.x requires Node `>=22` | Pin supported LTS 24.20.0, not merely major 22 |
| `client.get()` | TorLink's custom `.d.ts` says synchronous `Torrent \| null` | Runtime is async and returns `Promise<Torrent \| null>` (this was already true in exact 2.4.1 source) | Adapter does not expose raw `get()` |
| `client.remove()` | TorLink bypasses it and calls `torrent.destroy()`; custom type says synchronous void | Method is async for lookup but callback still marks full socket/store teardown | Adapter wraps callback plus rejected Promise and exposes `Promise<boolean>` |
| Duplicate task | TorLink destroys the old torrent directly | Direct destroy can leave client bookkeeping coupled to upstream internals | Adapter removes through the owning client before re-add |
| uTP | Enabled implicitly when native optional dependency is present | On the tested Windows Node runtime, `utp-native` retained the process after complete teardown | Force `utp:false`; verified TCP remains functional |
| WebRTC native state | Imported by Node's simple-peer polyfill | Native global state may exist even for a TCP-only run | Adapter owns explicit `node-datachannel.cleanup()` after client teardown |
| Error timing | Some invalid identifiers fail asynchronously on the torrent rather than throwing from `add()` | Same observed behavior in both test trees | Adapter handles both synchronous add errors and torrent `error` |
| Fresh 2.4.1 transitive resolution | Range allows `uint8-util@2.3.2` | Exact 2.4.1 crashes in `_onTorrentId` because that release passes a string to changed `arr2hex`; TorLink pins 2.2.6 to survive | 3.0.21 passes with current 2.3.2; remove the legacy quarantine pin |

### Deprecated or removed APIs

No TorLink-used API was found to be deprecated or removed between the compared surfaces. No fallback to 2.4.1 is required. Raw APIs not listed in the inventory are outside this migration guarantee and must not leak past the adapter.

### TypeScript types

Neither tested npm package ships complete TypeScript declarations for this call surface. TorLink supplies `src/webtorrent.d.ts`, but it incorrectly models the async `get/remove` behavior. The desktop Core supplies a narrow declaration only for adapter implementation and exports project-owned `TorrentEngine`, `TorrentMetadata`, and `TorrentSnapshot` types to consumers.

### Dependency changes

Notable major transitions across the full 2.4.1 → 3.0.21 range include:

- `bitfield` 4 → 5;
- `bittorrent-protocol` 4 → 5;
- `fs-chunk-store` 4 → 5;
- `torrent-piece` 3 → 4;
- `ut_metadata` 4 → 5;
- `ut_pex` 4 → 5;
- browser storage moves from `hybrid-chunk-store` to `fsa-chunk-store`;
- updated `streamx`, `uint8-util`, DHT, tracker/discovery, NAT, and simple-peer trees.

The 3.0.21 release itself updates `streamx` to 2.28.0. The project consumes the Node entry point, not the browser/WebRTC bundle.

## Adapter boundary

```text
TorrentManager (Phase 2)
        |
        v
TorrentEngine interface
        |
        v
WebTorrentAdapter
        |
        v
webtorrent@3.0.21
```

Only `packages/core/src/torrent/WebTorrentAdapter.ts` imports WebTorrent. Lifecycle workarounds, upstream async semantics, native cleanup, tracker lists, and future major migrations stay inside this boundary.

## Decision

Use `webtorrent@3.0.21`. It is functionally compatible for the complete TorLink call surface after a small adapter, fixes the fresh-install `uint8-util` incompatibility seen with exact 2.4.1, and passes the security gate once the unpatched tracker dependency is removed by the tested minimal fork.
