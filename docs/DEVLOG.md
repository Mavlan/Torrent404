# 开发日志

## 2026-08-27 — Phase 0 Recon

完成：

- 核对 Windows、Git、Node/npm、Rust/Cargo 工具链。
- 克隆并固定 TorLink 当前 `main` 提交。
- 审查上游目录、providers、搜索聚合、WebTorrent 生命周期、任务状态、持久化、安全启动、watch/serve/files/attach 能力与 MIT 许可证。
- 输出 `ARCHITECTURE.md`、`UPSTREAM_NOTES.md` 和 Phase 1 文件级计划。

验证：

- 上游 typecheck PASS。
- 上游 45 个测试文件、311 个测试 PASS。
- 上游 production build PASS。
- 上游 `npm audit --omit=dev` 报告 5 high、0 critical；属于 WebTorrent 传递依赖既有风险，未自动降级修复。

决定：

- Phase 1 不引入 WebTorrent，因此该供应链问题不阻止 scaffold。
- 桌面版不复用上游可公开绑定的 headless server；IPC 始终 loopback 且每次启动鉴权。
- 初始持久化使用版本化 JSON + 原子替换，复杂度需要时再迁移 SQLite。

遗留：

- Phase 2 接入 WebTorrent 前复核 advisories 和安全升级路径。
- Phase 3 通过测试决定 localhost HTTP/SSE 与 framed stdio 的最终传输实现。

## 2026-08-27 — Phase 1 Scaffold

完成：

- 建立 npm workspaces 和根锁文件。
- 创建 `packages/protocol`：稳定 DTO、commands/events、Zod runtime schemas 与协议版本。
- 创建 `packages/core`：无网络、无 Torrent 副作用的 Phase 1 runtime seam。
- 创建 `packages/i18n`：中文默认消息与 typed keys。
- 创建 Tauri 2 + React 19 桌面 shell，产品名“涌流”，包含五个主要页面、主题选择、空状态和隐私/上游说明。
- 将 Tauri capability 收紧为 `core:default`，未启用 shell/opener/filesystem/network 插件。
- 添加 Windows CI 与项目治理文件。

验证：

- `npm run typecheck`：PASS。
- `npm test`：PASS，4 个测试文件、10 个测试。
- `npm run build`：PASS；Vite 生产 bundle 约 202 kB JS（gzip 约 64 kB）。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：PASS。
- `tauri build --debug --no-bundle`：PASS，生成本地 Windows 可执行文件。
- `npm audit`：PASS，0 vulnerabilities。
- 本地浏览器 smoke：搜索提交、页面导航、关于页、780×560 窄窗口均正常；控制台无 warning/error。

修复：

- 首轮前端测试发现 Vitest 环境未在测试间自动清理 DOM，导致重复可访问元素；在测试 setup 中显式 cleanup 后全绿。

遗留：

- 当前图标为 Tauri scaffold 占位图标，Phase 7 替换为独立视觉资产。
- Phase 2 才引入真实 providers/WebTorrent；Phase 1 搜索提交仅验证 UI 状态。
