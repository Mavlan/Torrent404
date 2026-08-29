# Torrent404

一个现代、中文优先的开源 BitTorrent 搜索与下载桌面客户端。当前版本为 `0.1.0` Release Candidate。

> Torrent404 是独立的社区项目，不是 TorLink 官方版本。项目受 TorLink 启发，并在遵守 MIT License 的前提下复用其部分成熟思路与逻辑。

## 当前状态

v0.1.0 当前已具备：

- npm workspaces monorepo；
- Tauri 2 + React 19 + TypeScript 桌面 shell；
- 独立的 `protocol`、`core` 和 `i18n` 包；
- YTS、Nyaa 以及默认关闭的 Knaben Beta 聚合搜索；
- Magnet 直接添加、实时下载进度及暂停、继续、移除控制；
- 随应用打包的 Node runtime、鉴权本机 IPC 与最小 Tauri capability。

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
