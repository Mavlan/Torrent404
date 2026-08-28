# Dependency Security Gate

Status: **PASS**

Gate date: 2026-08-27
Selected baseline: `webtorrent@3.0.21` on `node@24.20.0` LTS

## Method

The review used three distinct trees:

1. TorLink v1.7.0 at `205cabb00c348c2272e1761fbf4b46b682c0c275`, including its existing lockfile.
2. A clean isolated install with exact `webtorrent@2.4.1`.
3. A clean isolated install with exact `webtorrent@3.0.21`, first unmodified and then with the reviewed local `bittorrent-tracker` patch.

Evidence was collected with `npm audit --omit=dev --json`, `npm ls ... --all`, and the lockfile `packages` graph. No `npm audit fix --force` was used. The final tree does not use a blind version override.

## What the original “5 high” means

TorLink declares `"webtorrent": "^2.4.1"`; its lockfile currently resolves that range to `webtorrent@2.8.5`, not 2.4.1. Its production audit reports five **vulnerable package nodes**, not five independent High advisories:

```text
webtorrent@2.8.5                         (npm meta-vulnerability)
└─ torrent-discovery@11.0.21            (npm meta-vulnerability)
   └─ bittorrent-tracker@11.2.3         (npm meta-vulnerability)
      └─ ip@2.0.1                       (GHSA-2p57-rm9w-gvfp)

webtorrent@2.8.5
├─ load-ip-set@3.0.2
│  └─ ip-set@3.0.0
│     └─ ip-address@10.2.0              (three advisories)
└─ torrent-discovery@11.0.21
   └─ bittorrent-tracker@11.2.3
      └─ socks@2.8.9
         └─ ip-address@10.2.0 (deduped)
```

The audit raises the three parents to High because they can install the vulnerable `ip` package. `ip-address@10.2.0` contributes one High and two Moderate advisories, and npm reports that package node at its maximum severity, High.

## Original five vulnerable nodes

| Vulnerability package/node | Dependency path | Severity | Advisory / CVE | Affected / patched | Production and bundle | Reachability in 涌流404 threat model | Recommended fix |
|---|---|---:|---|---|---|---|---|
| `webtorrent@2.8.5` | direct | High (meta) | Propagated from `ip`; no independent CVE | npm range `>=0.8.0`; npm's suggested downgrade to 0.7.3 is not viable | Yes / yes | WebTorrent itself is the Torrent engine, but the underlying vulnerable function is not reached | Move to 3.0.21 and remove the vulnerable transitive edge |
| `torrent-discovery@11.0.21` | `webtorrent → torrent-discovery` | High (meta) | Propagated from `bittorrent-tracker → ip` | npm marks all versions; no independent patch | Yes / yes | Tracker/DHT peer discovery is reachable; the affected `ip.isPublic` call is not | Keep current discovery API but supply the tested tracker fork |
| `bittorrent-tracker@11.2.3` | `webtorrent → torrent-discovery → bittorrent-tracker` | High (meta) | Propagated from `ip` | Current upstream 11.2.3 still declares `ip@^2.0.1` | Yes / yes | Tracker **client** is reachable. `ip` is imported only by `lib/server/parse-udp.js`, which WebTorrent does not import, and that file uses `toString`, not vulnerable `isPublic` | Minimal fork: remove `ip` and locally decode the one 32-bit IPv4 field; prove UDP compatibility |
| `ip@2.0.1` | `webtorrent → torrent-discovery → bittorrent-tracker → ip` | High | [GHSA-2p57-rm9w-gvfp](https://github.com/advisories/GHSA-2p57-rm9w-gvfp), CVE-2024-29415 | `<=2.0.1`; **no patched release** | Yes / yes before patch | Not reachable: advisory concerns `isPublic`; tracker server's only call is `toString`, and the desktop ships a client, not a tracker server | Remove the dependency rather than suppressing the advisory |
| `ip-address@10.2.0` | `webtorrent → load-ip-set → ip-set → ip-address`; also `… → bittorrent-tracker → socks → ip-address` | High (max of three) | [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr), CVE-2026-69192; [GHSA-4xrf-jv44-h6hh](https://github.com/advisories/GHSA-4xrf-jv44-h6hh), CVE-2026-69198; [GHSA-22jq-vg5j-6vgg](https://github.com/advisories/GHSA-22jq-vg5j-6vgg), CVE-2026-54272 | High: `<=10.3.0`, patched 10.3.1; CIDR: `10.1.1–10.2.1`, patched 10.2.2; mapped IPv6: `10.1.1–10.2.0`, patched 10.2.1 | Yes / yes | The vulnerable SSRF-classifier usage was not found in the consuming paths, but the package is unnecessary risk | Refresh the lockfile to `ip-address@10.5.0`; no override required |

## Exact A/B audit

| Tree | Critical | High | Other | Result |
|---|---:|---:|---:|---|
| A — exact `webtorrent@2.4.1`, clean install | 0 | 4 | 0 | FAIL |
| B — exact `webtorrent@3.0.21`, unmodified | 0 | 4 | 0 | FAIL |
| B — 3.0.21 + reviewed tracker fork, isolated | 0 | 0 | 0 | PASS |
| Final monorepo production tree | 0 | 0 | 0 | PASS |
| Final monorepo full tree (including dev) | 0 | 0 | 0 | PASS |

Both clean upstream versions currently resolve `ip-address@10.5.0`, so the previous fifth node is already patched. Both still resolve the same remaining chain:

```text
webtorrent → torrent-discovery@11.0.21
           → bittorrent-tracker@11.2.3
           → ip@2.0.1
```

This is why changing WebTorrent major versions alone moves the report from the old five nodes to four, but not to zero.

## Reviewed dependency patch

`packages/bittorrent-tracker` is the published MIT package `bittorrent-tracker@11.2.3` with one source-level change:

- delete the unpatched `ip` dependency;
- replace `ip.toString(uint32)` in the UDP **server** parser with a four-octet unsigned conversion;
- retain upstream authorship and license files;
- resolve it as the workspace package satisfying `torrent-discovery`'s `^11.2.3` dependency.

This is not a vulnerability suppression. `ip` is absent from the final lock graph. The patch is exercised by the local UDP tracker in `npm run smoke:webtorrent`, including announce parsing, peer discovery, and transfer.

## Node runtime baseline

The sidecar baseline is **Node.js v24.20.0 “Krypton” LTS**, released 2026-08-26. It is pinned in `.nvmrc`, `.node-version`, `package.json#engines`, and CI. The official release and signed checksum list are available from [nodejs.org](https://nodejs.org/en/blog/release/v24.20.0).

Verification performed for this gate:

```text
node --version
v24.20.0

node-v24.20.0-win-x64.zip SHA-256
6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba
```

The checksum matched Node's official `SHASUMS256.txt`. The machine-wide `v24.15.0` is deliberately not accepted as the packaging baseline because it predates the July 2026 security release.

## Legal real-transfer smoke

Command: `npm run smoke:webtorrent`

The fixture is generated locally: a deterministic 4 MiB `legal-fixture.bin`, with metadata minted by WebTorrent. It contains no third-party copyrighted material and is deleted after the run.

PASS coverage:

- `new WebTorrent()`, client/torrent error handling, and complete `destroy()`;
- magnet URI, bare infohash, `.torrent` `Uint8Array`, and `.torrent` filesystem path;
- add, remove, pause, resume, metadata, progress events, all requested statistics and file/path properties;
- local UDP tracker announce, peer discovery, and TCP peer transfer;
- DHT object creation and real UDP listening in the Node build;
- completion, continued seeding, orderly shutdown, and restart/restore from saved `.torrent` metadata plus on-disk payload;
- exact payload byte comparison after download.

uTP is explicitly disabled in `WebTorrentAdapter`. With `utp-native` enabled, the otherwise completed process retained a native event-loop handle after shutdown; with `utp:false`, the same TCP/UDP/DHT test exits cleanly. uTP is not required for the Node sidecar's validated TCP peer capability.

## Final gate decision

**PASS: adopt `webtorrent@3.0.21` as the Phase 2 baseline.**

Critical is 0 and High is 0 in the production dependency tree. WebTorrent access is confined to `WebTorrentAdapter`; UI, protocol, task model, and future `TorrentManager` depend only on `TorrentEngine`.

Final verification: typecheck PASS; 5 test files / 13 tests PASS; production build PASS; `cargo check --locked` PASS; legal transfer smoke PASS; production and full `npm audit` both report 0 total vulnerabilities.
