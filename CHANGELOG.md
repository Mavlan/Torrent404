# Changelog

## Unreleased

### Phase 0 — Recon

- 固定并研究 TorLink `main@205cabb00c348c2272e1761fbf4b46b682c0c275`（v1.7.0）。
- 记录可复用 providers、WebTorrent queue/engine、持久化、headless 与许可证边界。
- 确定 Tauri 2 + React + Node/TypeScript sidecar 架构，以及 loopback + per-launch token 安全模型。
- 记录上游生产依赖 5 个 high 审计项，Phase 2 接入 WebTorrent 前必须复核。

### Phase 1 — Scaffold

- 建立 npm workspaces monorepo，以及独立的 protocol、core、i18n 和 Tauri desktop workspace。
- 定义并校验 v1 commands/events、搜索结果、任务、设置和来源状态契约。
- 创建中文优先的“涌流”桌面 shell，包含搜索、下载中、已完成、设置和关于页面及响应式导航。
- Tauri 使用最小 `core:default` capability，未授予 shell、网络或文件系统插件权限。
- 添加 Windows CI、MIT/第三方 notices、安全策略与贡献指南。
- Phase 1 typecheck、10 个单元/UI 测试、生产构建、Rust `cargo check` 和 npm audit 全绿。

### Phase 1.5 — WebTorrent Dependency Security Gate

- 对 `webtorrent@2.4.1` 与 `3.0.21` 执行隔离依赖审计、API compatibility diff 和真实 Node torrent smoke。
- 将原 5 个 High 节点还原到实际 advisory 与完整传递路径。
- 采用 `webtorrent@3.0.21`，以安全补丁 fork 移除无修复版本的 `ip@2.0.1`，production audit 归零。
- 新增 `TorrentEngine` / `WebTorrentAdapter` 隔离层，固定 TCP 基线与完整 native shutdown。
- 将 sidecar Node runtime 锁定为 24.20.0 LTS。
