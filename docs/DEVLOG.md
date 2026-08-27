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

## 2026-08-27 — Phase 1.5 WebTorrent Dependency Security Gate

完成：

- 用独立 lock tree 比较精确 `webtorrent@2.4.1` 与 `webtorrent@3.0.21`。
- 将上游“5 high”还原为 `ip`、`ip-address` 两个实际漏洞包及三个 npm 元漏洞传播节点；记录每条依赖路径、公告、修复版本、bundle 与可达性。
- 确认新 lock tree 自动升级到已修复的 `ip-address@10.5.0`，剩余根因是没有安全版本的 `ip@2.0.1`。
- 基于 MIT 上游建立 `bittorrent-tracker@11.2.3` 最小 fork，删除 `ip`，仅替换 UDP tracker server 的 32 位 IPv4 解码；本地 UDP tracker smoke 覆盖该补丁。
- 采用并精确锁定 `webtorrent@3.0.21`；建立 `TorrentEngine → WebTorrentAdapter` 边界。
- 锁定 Node 24.20.0 LTS；官方 Windows zip SHA-256 校验通过。
- 新增完全合法的 4 MiB 自生成 torrent smoke，覆盖 magnet/infohash/Buffer/path、metadata、progress、完成、做种、shutdown 与 restart/restore。

兼容性发现：

- 精确 2.4.1 的宽松 transitive range 会解析到 `uint8-util@2.3.2`，随后在 `_onTorrentId` 崩溃；3.0.21 无此问题。
- `client.get/remove` 的异步语义与 TorLink 手写类型不一致，已由 adapter 收口。
- `utp-native` 在完整 shutdown 后保留进程；sidecar 基线固定 `utp:false`，TCP peers、UDP tracker、DHT 与 peer discovery 全部实测通过。

验证：

- production `npm audit --omit=dev`：0 critical、0 high、0 total。
- WebTorrent 合法真实下载 smoke：PASS。
- `npm run typecheck`：PASS。
- `npm test`：PASS，5 个测试文件、13 个测试。
- `npm run build`：PASS。
- `cargo check --locked`：PASS。
- 完整 `npm audit`（含 dev）：0 vulnerabilities。

决定：

- Phase 1.5 安全门槛通过，Phase 2 Core 基线为 `webtorrent@3.0.21` + 最小 tracker fork。
- Phase 2 业务代码不得直接 import WebTorrent。

## 2026-08-27 — Phase 2.1 Provider Foundation

完成：

- 定义传输和 UI 无关的 `SearchProvider` 增量搜索契约。
- 建立只读 `ProviderRegistry`，验证规范 ID、非空展示名/分类和重复 ID。
- registry 只负责注册与发现；并发、超时、失败隔离和结果去重留给 Phase 2.2。

局部验证：

- Core typecheck：PASS。
- `ProviderRegistry.test.ts`：PASS，3 个测试。

## 2026-08-27 — Phase 2.2 Concurrent Search Aggregation

完成：

- 并行消费已注册 providers，任一快速来源可立即流式返回结果。
- 支持调用方取消与逐 provider 超时，并把 abort 传递到 adapter 边界。
- 单个 provider 的异常或超时不会中断其他来源，并通过结构化回调报告。
- 优先使用显式 `infoHash`，同时支持从 magnet `xt` 提取并规范化后去重。

局部验证：

- Core 与 Protocol typecheck：PASS。
- `SearchAggregator.test.ts`：PASS，5 个测试。

## 2026-08-27 — Phase 2.3.1 YTS Provider Adapter

选择 YTS 作为首个 adapter：其单一 JSON 响应直接包含 infohash、大小和 swarm
数据，不需要 HTML/RSS 解析、详情页请求、认证或反爬处理，迁移成本最低且结构清晰。

完成：

- 新增独立 `YtsProvider`，复用现有 provider、registry 与 aggregator 契约。
- 严格校验并小写化 40 位十六进制 infohash，生成规范 magnet。
- 逐条跳过无效 hash/结构，并为缺失或畸形的可选字段提供安全默认值。
- 网络层仅执行普通 JSON 请求并传递 `AbortSignal`，不含绕过逻辑。
- 测试使用本地合成的合法 fixture，不访问实时公网。

局部验证：

- Core 与 Protocol typecheck：PASS。
- `YtsProvider.test.ts`：PASS，3 个测试。

## 2026-08-27 — Phase 2.3.2 Nyaa RSS Provider Adapter

选择 Nyaa 验证非 JSON adapter：RSS schema 比 YTS 稍复杂，包含 XML、CDATA、
entity、namespaced swarm 字段和文本大小，但仍是无需认证或详情页的单请求来源。

完成：

- 新增独立 `NyaaProvider`，未修改 provider registry 或 aggregator 架构。
- 使用只识别完整 RSS item 和已知字段的窄解析器；不解析 DTD 或外部实体。
- 校验并小写化 40 位十六进制 infohash，生成规范 magnet。
- 解析十进制/二进制大小单位；畸形可选字段安全归零，缺失必需字段逐条跳过。
- 三个本地合成 XML fixture 覆盖正常、空结果和字段缺失/畸形，不访问公网。

局部验证：

- Core 与 Protocol typecheck：PASS。
- `NyaaProvider.test.ts`：PASS，3 个测试。
