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
