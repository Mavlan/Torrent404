# Contributing to Torrent404

Thanks for helping improve Torrent404. Keep proposals focused, reviewable, and
consistent with the project's local-first security boundary.

## Development environment

- Windows 10/11 x64
- Node.js `24.20.0` and npm, using the root `package-lock.json`
- Rust stable with the MSVC toolchain
- Microsoft C++ Build Tools and WebView2 for Tauri development

Install dependencies once:

```powershell
npm ci
```

## Workflow

1. Open or reference an issue for behavioral changes when practical.
2. Keep one concern per branch and avoid unrelated refactors.
3. Add fixture-backed tests for non-trivial parsing, state, IPC, or persistence logic.
4. Run the smallest relevant checks while developing, then the affected workspace
   typecheck and tests before requesting review.
5. Use a concise Conventional Commit subject such as `feat:`, `fix:`, `docs:`,
   `test:`, `refactor:`, or `chore:`.

Common full checks are:

```powershell
npm run typecheck
npm test
npm run build
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Run `npm run tauri -- dev` only when a desktop integration or UI smoke is needed.
Do not use live public endpoints in automated tests; use legal local fixtures and
injectable networking.

## Architecture and security constraints

- Preserve the dependency direction described in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- UI and IPC handlers must not import or control WebTorrent directly. Torrent engine
  behavior belongs behind `TorrentManager` and `WebTorrentAdapter`.
- Do not parse TorLink's TUI output as an API or depend on upstream UI internals.
- Do not bind the sidecar outside loopback, log session tokens, or add an
  unauthenticated control path.
- Do not add login, CAPTCHA, paywall, DRM, Cloudflare, or network-blocking bypasses.
- Provider failures must remain isolated, and provider tests must use local fixtures.
- Do not change the default no-auto-seeding policy without an explicit product and
  security review.
- Persistence must not include credentials, session tokens, transfer speeds, peers,
  or other unnecessary transient data.

## Attribution

When copying or modifying upstream code, preserve its license and copyright notice.
Changes derived from TorLink must retain `Copyright (c) 2026 bairon.dev` and the MIT
terms recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Update that file
when a new bundled dependency or code-derived upstream attribution is required.

## Security reports

Do not open a public issue containing exploit details. Follow
[`SECURITY.md`](SECURITY.md) instead.
