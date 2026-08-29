# Security Policy

## Supported versions

| Version | Security updates |
| --- | --- |
| 0.1.x | Supported |
| Earlier development snapshots | Not supported |

## Reporting a vulnerability

Do not disclose an exploitable vulnerability, token, private path, or proof of
concept in a public issue.

Use GitHub's private vulnerability reporting for this repository when it is
available. If it is not available, open a public issue containing no sensitive
details and ask the maintainers for a private contact channel. Include the affected
version, prerequisites, impact, and a minimal reproduction only through that private
channel.

Torrent404 is currently maintained as a small open-source project, so it does not
promise a fixed response SLA. Reports will be triaged and acknowledged as capacity
allows.

## v0.1 security boundary

- The Node sidecar binds only to `127.0.0.1` on a random port.
- Every launch creates a new high-entropy session token. The token is not persisted,
  included in user-facing errors, or intentionally logged.
- Authenticated IPC is versioned; malformed requests, invalid tokens, incompatible
  protocol versions, and unknown commands are rejected with structured errors.
- Tauri owns sidecar startup and shutdown. Release bundles contain the pinned Node
  runtime and sidecar production dependency closure.
- Search, tracker, DHT, and peer traffic leave the user's machine directly. The
  project does not operate a remote control plane, search proxy, or file server.
- Download writes use the task's saved path. New default paths are selected with the
  native directory picker and validated when a task is created.
- Completed tasks are offline by default. Seeding starts only after an explicit user
  action, and stopping seeding detaches torrent network activity.
- Removing a task retains downloaded files.

## What this policy does not promise

Torrent404 is local-first, but BitTorrent is not anonymous. Peers and trackers may
observe the user's public IP address. Torrent404 does not provide Tor, VPN, proxy
bypass, IP masking, or anonymity features, and it does not bypass login, CAPTCHA,
paywall, DRM, or other access controls.

Users remain responsible for securing their device, verifying release artifacts,
and complying with applicable law.
