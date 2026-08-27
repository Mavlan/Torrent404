# 涌流

一个现代、中文优先的开源 BitTorrent 搜索与下载桌面客户端。当前仓库正在按 `TorLink Desktop v0.1.0 Codex 开发手册` 分阶段实现。

> 涌流是独立的社区项目，不是 TorLink 官方版本。项目受 TorLink 启发，并计划在遵守 MIT License 的前提下复用其成熟的搜索与下载逻辑。

## 当前状态

Phase 0 Recon 已完成，Phase 1 Scaffold 已建立：

- npm workspaces monorepo；
- Tauri 2 + React 19 + TypeScript 桌面 shell；
- 独立的 `protocol`、`core` 和 `i18n` 包；
- 中文导航、空状态、设置与关于页面；
- 最小 Tauri capability，尚未授予 sidecar、网络或文件系统 wildcard 权限。

真实搜索、WebTorrent 下载和 sidecar IPC 会在后续 Phase 接入。

## 开发环境

- Windows 10/11 x64
- Node.js 22 或更高版本
- Rust stable MSVC
- Microsoft C++ Build Tools 与 WebView2

```powershell
npm ci
npm run check
npm run tauri -- dev
```

仅调试前端 shell：

```powershell
npm run dev
```

## 隐私与法律边界

- 项目不设置中央搜索/下载代理；网络和 Torrent 行为在本机完成。
- BitTorrent peers 可以看到用户公网 IP；本项目不提供匿名性。
- 软件本身不托管内容。用户应遵守所在地法律，并只下载或分享有权使用的内容。
- 不实现 Tor、VPN、封锁绕过、登录/付费/验证码/DRM 绕过。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [上游研究记录](docs/UPSTREAM_NOTES.md)
- [Phase 1 文件级计划](docs/PHASE_1_PLAN.md)
- [开发日志](docs/DEVLOG.md)

## License

本项目代码采用 MIT License。上游与第三方归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

