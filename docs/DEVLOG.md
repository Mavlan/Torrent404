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

## 2026-08-27 — Phase 2.4 Download Task State Model

Phase 2.3 以 YTS JSON 与 Nyaa RSS 两个 adapter 收口，已足够验证两类数据源。

完成：

- 基于 protocol `DownloadTask` 建立无副作用的任务创建与状态转换模型。
- 新任务固定从 `queued` 开始，并校验 ID、名称、保存路径、infohash 与总大小。
- 为 queued/downloading/paused/completed/seeding/error 建立显式合法转换表。
- 非法及同状态转换抛出结构化错误；error 必须携带消息，重试时清除旧错误。
- 暂停/完成/做种等状态统一清理瞬时速度和 ETA；完成态规范化进度与字节数。
- 本步骤不接入 WebTorrent 或 TorrentManager，未修改搜索架构。

局部验证：

- Core 与 Protocol typecheck：PASS。
- `DownloadTaskModel.test.ts`：PASS，6 个测试。

## 2026-08-27 — Phase 2.5 TorrentManager

完成：

- 新增只依赖项目自有 `TorrentEngine` 接口的 `TorrentManager`；上层不接触 WebTorrent。
- 创建任务后严格通过 `DownloadTaskModel` 从 queued 转为 downloading。
- 映射 metadata 与 snapshot 的进度、速度、下载量、总大小和 ETA（毫秒转秒）。
- engine completion 映射为 seeding，engine callback/add 失败映射为 error。
- 提供最小 pause/resume/remove；暂停时记录下载或做种来源以恢复正确状态。
- 不含持久化、UI、IPC、provider 或真实网络行为。

局部验证：

- Core 与 Protocol typecheck：PASS。
- `TorrentManager.test.ts`：PASS，6 个测试。

## 2026-08-27 — Phase 2 Final Acceptance Gate

验收发现与修复：

- 首次 Tauri production build 已生成 release binary 与 NSIS，但 WiX MSI 因默认
  code page 1252 无法编码中文产品元数据而报 `LGHT0311`。
- 将 WiX installer locale 显式设为 `zh-CN`，并新增配置回归测试；随后同一次
  Tauri build 成功生成 NSIS 与 `涌流_0.1.0_x64_zh-CN.msi`。
- 新增 YTS JSON + Nyaa RSS 双 adapter 本地集成测试，确认二者可同时通过
  `ProviderRegistry` 与 `SearchAggregator` 流式输出规范结果。

最终验证（Node `v24.20.0`）：

- 全 workspace TypeScript typecheck：PASS。
- 全量自动化 tests：PASS，13 个测试文件、41 个测试。
- production build：PASS。
- `npm audit --omit=dev`：0 vulnerabilities；full audit：0 vulnerabilities。
- `cargo check --locked`：PASS。
- Tauri Windows production build：PASS；release EXE、NSIS、zh-CN MSI 均生成。
- WebTorrent 合法自生成 torrent smoke：PASS；覆盖所有输入、真实下载、进度、
  TCP/UDP tracker/DHT/peer discovery、完成做种、shutdown 与 restart/restore。
- 依赖边界：只有 `@torlink/core` 声明 WebTorrent，直接 import 仅存在于
  `WebTorrentAdapter.ts`。
- 搜索边界：YTS + Nyaa 聚合 PASS；provider timeout/error 隔离测试 PASS。
- 下载边界：`TorrentManager` 只依赖 `TorrentEngine`，所有状态转换均通过
  `DownloadTaskModel`。
- Phase 2 验收结论：PASS；未进入 Phase 3。

## 2026-08-27 — Phase 3.1 Sidecar Bootstrap

完成：

- 构建时校验并复制精确 Node `v24.20.0` 到 Tauri resources；版本不符立即失败，
  Release 用户不依赖系统 Node.js。
- 新增最小 Node bootstrap，仅声明未来 `http`、`127.0.0.1`、随机 session token
  环境接口；本步骤不开放端口、不实现 IPC command。
- bootstrap 拒绝 `0.0.0.0` 等非 IPv4 loopback host，readiness 不输出 token。
- Rust `SidecarSupervisor` 在 Tauri setup 启动 sidecar，验证 readiness，并在退出时
  发送 `shutdown`、限时等待，必要时强制终止。
- stdin guardian 在父进程退出或崩溃导致管道关闭时让 sidecar 自行结束；supervisor
  `Drop` 再提供兜底清理，防止孤儿进程。
- 启动失败不会留下已生成的子进程，错误正文不包含未来 session token。

局部验证：

- Rust sidecar lifecycle tests：PASS，6 个测试（正常启动/退出、runtime/bootstrap
  失败、loopback 限制、guardian EOF、Drop orphan 清理）。
- Tauri resource 配置 tests：PASS，2 个测试。
- Desktop typecheck：PASS。
- `cargo check --locked`：PASS，无 warning。
- 未运行全量验收、真实 torrent smoke，未进入 Phase 3.2。

## 2026-08-27 — Phase 3.2 Authenticated IPC Transport

完成：

- Node sidecar 仅在 `127.0.0.1` 的操作系统分配随机端口监听，readiness 返回实际端口、
  transport、鉴权方式和协议版本，但不回显 session token。
- Rust supervisor 每次启动使用操作系统 CSPRNG 生成 256-bit `TORLINK_SESSION_TOKEN`，
  仅通过子进程环境传递；正常启动必须先通过鉴权 `ping → pong`。
- 定义 IPC protocol v1 与 `ping` / `health` 最小 command surface；Rust 客户端同时校验
  HTTP 状态、响应协议版本、command 与 payload。
- 所有有效 HTTP IPC 请求先验证 Bearer token；比较采用 constant-time API。
- malformed JSON/字段、错误或缺失 token、版本不匹配、未知 command 均返回带稳定
  error code 的 JSON 错误；请求与响应分别限制为 64 KiB。
- 继续复用 Phase 3.1 stdin `shutdown`、超时强杀、guardian EOF 和 Drop orphan 清理，
  未引入 SSE/WebSocket 或业务 command。

局部验证：

- Rust authenticated sidecar tests：PASS，9 个测试（随机端口/token、ping/health、
  鉴权失败、版本/请求/command 错误，以及 Phase 3.1 生命周期回归）。
- Protocol 与 Desktop typecheck：PASS。
- `cargo check`：PASS，无 warning。
- 未运行全量验收、Tauri production bundle、真实 torrent smoke，未进入 Phase 3.3。

## 2026-08-27 — Phase 3.3 Search IPC

完成：

- 在 IPC v1 定义 `search.start`、`search.poll`、`search.cancel` 及 search result、
  provider status、增量 event 和结构化 error DTO。
- Rust 使用 128-bit 随机值创建唯一 search request ID；所有搜索 command 继续通过
  Phase 3.2 的 loopback HTTP 与 session token 鉴权。
- Node sidecar 直接实例化现有 `ProviderRegistry`、`YtsProvider`、`NyaaProvider` 与
  `SearchAggregator`；构建资源只复制 Core 搜索模块，不引入 WebTorrent runtime。
- search session 以最多 25 个 event 的 cursor poll 增量返回结果，不等待全部 provider；
  provider error/timeout 独立回传，完成 session 有 60 秒兜底清理。
- `search.cancel` 将 AbortSignal 传播到 aggregator/providers；UI 新搜索会取消旧 request，
  包括旧 start 响应晚于新搜索的竞态。
- 搜索页改为真实 Tauri IPC，增量展示 YTS/Nyaa 来源、大小、seed 和 leech，并显示
  provider 搜索中/完成/error/timeout/cancelled 状态。
- Sidecar 构建阶段从 Core 输出中只复制四个搜索运行模块；本地 fixture 注入环境变量
  由 Rust 显式清除，仅测试配置可以重新设置。

局部验证：

- Protocol IPC tests：PASS，1 个测试。
- Core SearchAggregator/provider integration tests：PASS，2 个文件、6 个测试。
- Node search session tests：PASS，3 个测试（增量、失败/超时隔离、取消）。
- Desktop UI/Tauri resource tests：PASS，2 个文件、7 个测试。
- Rust authenticated sidecar tests：PASS，10 个测试，包含 YTS + Nyaa 合法本地 fixture
  经真实 authenticated IPC 增量返回与 request ID 唯一性。
- Protocol/Core/Desktop typecheck 与 `cargo check --locked`：PASS。
- 未运行全量验收、production bundle 或真实 torrent smoke，未进入 Phase 3.4。

## 2026-08-28 — Phase 3.3 Tauri dev sidecar 启动修复

修复：

- 真实 `tauri dev` stderr 确认：Tauri 的 dev resource resolver 返回 Windows verbatim
  `\\?\C:\...\bootstrap.mjs`，Node `v24.20.0` 将该 CLI 入口参数误解析为 `C:`，并以
  `EISDIR: illegal operation on a directory, lstat 'C:'`、exit code 1 退出。
- 仅在传给 Node CLI 时将 verbatim drive/UNC 路径转换为等价普通 Windows 路径；runtime
  与 bootstrap 的存在性校验、资源定位、工作目录、环境变量及启动参数保持不变。
- 启动阶段现在限量捕获 sidecar stderr 与 exit code，后续 readiness 失败可直接报告真实
  原因，不再只有笼统的 `sidecar exited before readiness`。
- 新增 Tauri verbatim resource path 回归测试，并增强 bootstrap 提前退出诊断测试。

局部验证：

- Rust sidecar tests：PASS，11 个测试；Desktop typecheck 与 `cargo check --locked`：PASS。
- 真实 `npm run tauri dev`：窗口持续运行，supervisor 完成随机端口/token 鉴权
  `ping → pong` readiness 检查。
- 真实 App 搜索 `test`：YTS 与 Nyaa 均被调用；Nyaa 增量返回 75 条结果，来源、大小、
  seed/leech 正常显示；YTS 上游错误被独立回传且不影响 Nyaa。
- 关闭窗口后 `tauri dev` exit code 0；此前 PID 22760 的 bundled Node sidecar 正常退出，
  未发现 TorLink 或 `bootstrap.mjs` 遗留进程。
- 未进入 Phase 3.4，未运行完整 Phase 3 验收、production bundle 或 torrent smoke。

## 2026-08-28 — Phase 3.3.5 Product UX / Categories / i18n

完成：

- 产品显示名统一为“涌流404”，覆盖 HTML/桌面标题、Tauri `productName`、About、
  下载目录文案与中文 installer 描述；npm package/module namespace 保持不变。
- 正式启用 `packages/i18n`，提供完整 `zh-CN` / `en-US` typed catalogs，默认中文；
  设置页切换语言后导航、搜索、状态、空态、下载/完成、设置、关于和普通错误立即更新。
- 首页明确说明可搜索电影、剧集、动漫、游戏等 Torrent 资源，并提供 All、Movies、TV、
  Anime、Games、Software 六类选择；搜索结果原始标题保持原文。
- category 随 authenticated IPC `search.start` 传入 sidecar；SearchService 按 registry
  descriptor 的 `categories` 生成 `providerIds`，不支持分类的 provider 不会被调用。
- YTS 能力标记为 Movies，Nyaa 标记为 Anime；暂未支持 TV/Games/Software 的来源时，
  UI 明确显示暂无来源，sidecar 直接完成空 provider 搜索。
- `SearchProvider.enabled` 为可选、默认启用的向后兼容配置边界；registry 仍可发现禁用来源，
  aggregator 不会消费禁用来源。中文 displayName、稳定 source ID 与 categories 保持支持。
- 后续中文 provider reconnaissance 与 adapters 已在 `PHASE_3_STEPS.md` 拆为独立小步骤。

局部验证：

- i18n tests：2 PASS；Protocol IPC/schema tests：7 PASS。
- Core registry/aggregator tests：10 PASS；sidecar search service tests：5 PASS。
- Desktop App/Tauri metadata tests：9 PASS。
- Protocol/i18n/Core/Desktop typecheck：PASS；Rust sidecar tests：11 PASS；
  `cargo check --locked`：PASS。
- 未进入 Phase 3.4，未接下载，未修改 TorrentManager/WebTorrentAdapter，未运行完整验收。

## 2026-08-28 — Phase 3.3.6 Source Clarity UX

完成：

- IPC v1 新增只读 `search.providers` command，Desktop 通过既有 session token 从 sidecar
  的实际 `ProviderRegistry` 获取 source ID、display name、categories、enabled；分类来源数
  不再由 UI 硬编码。
- 六个分类改为人类可读的中英文来源数量；零来源分类保持可点击但视觉弱化，搜索按钮禁用，
  不创建搜索 request，并按当前分类显示动态空状态。
- 将原有小字来源矩阵改为可读状态卡，明确展示“搜索来源”、YTS/电影、Nyaa/动漫及
  Ready/Searching/Complete/Timeout/Error 等运行状态。
- 设置页新增只读的内置搜索来源区域，显示 YTS、Nyaa、分类和启用状态；本步骤未扩大为
  provider 管理或持久化开关。
- 补充 protocol、sidecar service、Rust authenticated IPC 与 Desktop UI 回归测试，覆盖
  descriptor 读取、实际来源计数、无来源短路、英文复数文案及设置页来源展示。

局部验证：

- i18n tests：2 PASS；Protocol IPC tests：2 PASS；sidecar search service tests：6 PASS。
- Desktop App tests：9 PASS；Rust authenticated sidecar tests：11 PASS。
- Protocol/i18n/Core/Desktop typecheck：PASS；`cargo check --locked`：PASS。
- 真实 `npm run tauri dev`：中英文六分类来源文案、TV 无来源空状态和禁用搜索、设置页
  YTS/Nyaa 来源信息及语言即时切换均正常；All 分类真实搜索由 Nyaa 返回 75 条结果，YTS
  错误被隔离，状态卡正确显示 Complete/Error。
- 关闭窗口后 `tauri dev` exit code 0，未发现 `torlink-desktop.exe` 或 sidecar
  `bootstrap.mjs` 遗留进程。
- 未新增 provider，未进入 Phase 3.4，未运行 production bundle、完整验收或 torrent smoke。

## 2026-08-28 — Phase 3.4 Start Download IPC

完成：

- 在 authenticated IPC v1 增加 `download.add`；接收 magnet、可选名称/大小，由 Rust
  注入系统 Downloads 下的“涌流404”默认目录，不允许 UI 任意指定保存路径。
- sidecar 下载服务严格调用 `TorrentManager.add`；生产路径固定为
  `TorrentManager → TorrentEngine → WebTorrentAdapter → webtorrent@3.0.21`，未出现
  UI 或 IPC handler 直接操作 WebTorrent 的旁路。
- `TorrentManager` 新增基于规范化 infohash 的确定性去重和 owned engine shutdown；
  所有初始 queued/downloading/error 状态仍经 `DownloadTaskModel` 转换。
- magnet 支持 40 位十六进制及 32 位 Base32 infohash；无效 magnet、重复 torrent、
  下载目录不可用、engine add failure 均返回稳定结构化错误，消息不泄露内部 stack。
- 默认目录在 sidecar 内安全递归创建并验证为可写目录；设置页显示 Rust 解析出的实际路径。
- 搜索结果新增 Download 操作；缺少 magnet 时按钮禁用。创建成功后立即切换到“下载中”，
  展示名称、大小、状态和 task ID，并提供中英文成功/失败反馈。
- 搜索框直接粘贴 magnet 仍按搜索处理；已拆为后续 Phase 3.4.3，避免扩大本步骤范围。
- sidecar 资源准备脚本开始复制既有 Core torrent/task runtime 模块，并继续使用锁定的
  bundled Node `v24.20.0`。

局部验证：

- Protocol IPC：2 PASS；i18n：2 PASS；TorrentManager：7 PASS。
- Node download service：6 PASS，覆盖 hex/Base32 magnet、目录传递与真实不可用目录、
  duplicate、engine failure 和 shutdown。
- Desktop UI/Tauri resource：12 PASS，覆盖可用/不可用下载按钮、任务页面、结构化错误与
  sidecar 异常的中英文用户提示。
- Rust authenticated download IPC：2 PASS，使用 fake TorrentEngine 验证创建、duplicate、
  invalid magnet 与 engine failure；不访问公网或执行真实 torrent smoke。
- Protocol/i18n/Core/Desktop typecheck：PASS；`cargo check --locked`：PASS。
- 未运行 Phase 3 全量验收、production bundle、audit 或真实 torrent smoke；未进入 Phase 3.5。

## 2026-08-28 — Phase 3.4.1 Download Runtime Fix

完成：

- 确认 `download.add` 返回后 `DownloadService`、`TorrentManager`、`WebTorrentAdapter` 与
  torrent 实例均持续存活；下载目录参数也已正确传入 WebTorrent，问题不是任务被提前释放。
- 定位到 YTS/Nyaa 当前从 infohash 生成的最小 magnet 不包含 tracker；WebTorrent 的
  `tracker: true` 只启用 magnet 自带 tracker，不会自动补充 discovery tracker，导致真实下载
  过度依赖 DHT，出现长时间 0 peers、无 metadata/无写盘。
- `WebTorrentAdapter` 现在为 public torrent 配置来自 WebTorrent `create-torrent` 基线的
  小型 fallback tracker 集，同时保留 DHT/LSD；显式 `tracker: false` 仍会完全关闭 tracker，
  不改变 adapter/engine 架构边界。
- 补充 adapter 回归测试，锁定默认 fallback 与显式关闭行为。下载页的 speed/peers 仍是
  Phase 3.4 静态占位，本步骤不引入实时进度 UI。

局部验证：

- WebTorrentAdapter tests：4 PASS；Core typecheck：PASS。
- 锁定 Node `v24.20.0` 的既有本地 WebTorrent smoke：TCP peer、UDP tracker、DHT、metadata、
  progress、completion、写盘、restart/restore 全部 PASS。
- 真实 `npm run tauri dev` 使用本机 UDP tracker 和自建合法 4 MiB torrent fixture：
  authenticated sidecar 创建任务后实际写入 4,194,304 bytes，任务 snapshot 达到 seeding，
  文件 SHA-256 为 `06AC5FE0874BF6E13F4769115CA0CA5CF1C1586F970759D08300F2E9F553C91F`；
  退出后无遗留 sidecar。
- 未实现 pause/resume/remove、实时进度 UI 或 Phase 3.5；未运行完整验收、production bundle、
  audit 或公网版权不明 torrent smoke。

## 2026-08-28 — Phase 3.4.2 Task Controls

完成：

- authenticated IPC v1 新增 `download.pause`、`download.resume`、`download.remove`；Rust/Tauri
  bridge 继续复用随机端口与 session token，不建立第二套 transport。
- sidecar 的三个 handler 只调用 `DownloadService → TorrentManager`；未直接操作
  WebTorrent。pause/resume 的状态变化继续由 `DownloadTaskModel` 校验，seeding 暂停后恢复为
  seeding，普通下载恢复为 downloading。
- remove 仅在 engine 明确成功后移除 Core 任务，默认不传 `deleteData`，因此保留已下载文件；
  engine 返回失败或抛错时任务仍保留。
- 任务 ID 缺失、任务不存在、状态转换非法和 engine control failure 分别返回稳定结构化错误，
  UI 显示中英文用户提示而不暴露内部 stack。
- “下载中”任务卡新增 Pause/Resume/Remove 双语操作；Remove 使用最小原生确认，并明确告知
  本地文件会保留。

局部验证：

- TorrentManager controls：8 PASS；Node download service：8 PASS；Protocol IPC：2 PASS；
  Desktop UI controls：10 PASS。
- authenticated sidecar controls Rust 集成测试：PASS，覆盖 pause/resume/remove、非法转换和
  missing task；Protocol/i18n/Core/Desktop typecheck 与 `cargo check --locked`：PASS。
- 未运行 Phase 3 全量验收、production bundle、audit 或真实 torrent smoke；未进入 Phase 3.5。

## 2026-08-28 — Phase 3.5 Live Download Progress

完成：

- authenticated IPC v1 新增 `download.list`，sidecar 只通过 `DownloadService → TorrentManager.snapshots()`
  读取任务，未建立第二套 transport，也未让 UI/Rust handler 直接接触 WebTorrent。
- `TorrentManager` 将 engine snapshot 的 progress、downloaded/total、上下行速度、ETA、Peers、
  completion 和 status 统一映射回 `DownloadTaskModel`；paused snapshot 固定为 0 speed 与无 ETA。
- Desktop 在“下载中”页面激活时立即拉取 snapshot，之后每 750ms 串行 polling；离开页面停止，
  重新进入立即刷新，瞬时 IPC 失败保留最后一次有效快照。
- 下载任务卡新增双语实时进度、已下载/总大小、上下行速度、ETA、Peers、状态与可访问进度条；
  error 使用产品化文案，不暴露 engine stack。
- 实机 smoke 定位并修复 Desktop 将 Tauri `download_list` 结果体误当完整 IPC envelope 的解析问题。
- WebTorrent 的原生 `pause()` 不会终止既有 wire；Adapter 现在暂停时关闭活动 peer wire，恢复时
  主动 tracker update，确保已下载字节真正停止且 resume 能立即重新发现 peer。

局部验证：

- Protocol IPC/schema：7 PASS；TorrentManager/DownloadTaskModel：15 PASS；WebTorrentAdapter/
  TorrentManager：13 PASS；Node download service：9 PASS；Desktop App：11 PASS。
- authenticated Rust download IPC 集成测试：PASS；Protocol/i18n/Core/Desktop typecheck：PASS；
  `cargo check --locked`：PASS；`git diff --check`：PASS。
- 真实 `npm run tauri dev` 使用锁定 Node `v24.20.0`、本机 UDP tracker 与自建合法 32 MiB
  torrent：进度从 55.4% 增至 59.4%，速度约 162 KiB/s、Peers=1、ETA=2m；pause 后连续观察
  保持 59.4% 且速度为 0、ETA 为“—”、Peers=0；resume 后恢复到 71 KiB/s、Peers=1，最终
  达到 100% / 33,554,432 bytes 并显示 completed。输出 SHA-256 与自建源数据一致：
  `1CBD22E11BC209926B1E050D644779BA4105D7A023109C3B78BB35EDF5C7C292`。
- 页面切换后重新进入下载页会立即取得最新快照；关闭桌面窗口后未发现遗留 `bootstrap.mjs`
  Node sidecar。
- 未运行 Phase 3 全量验收、production bundle、全量 audit 或公网 torrent smoke；未进入下一阶段。

## 2026-08-29 — Phase 3 Final Acceptance Gate

完成：

- Phase 3.1–3.5 的完整桌面链路通过最终验收；未新增产品功能，未进入中文 provider、
  metadata、Release 页面或其他后续阶段。
- 验收发现 Desktop Vitest 会误收集使用 Node `node:test` 的 sidecar `.test.mjs`，导致 workspace
  全量测试以 “No test suite found” 失败。现将 Vitest 限定到 `src/**/*.test.{ts,tsx}`，并在
  Desktop workspace test script 中显式运行 search/download sidecar native suites；新增配置回归
  测试，确保两类 runner 的收集边界与 root 全量测试入口保持稳定。
- WebTorrent 直接依赖边界复核通过：业务 UI、protocol、IPC handler 均未直接 import
  `webtorrent`；生产代码仅 `packages/core/src/torrent/WebTorrentAdapter.ts` 在 engine adapter
  边界导入 `webtorrent@3.0.21`。

全量自动化与安全门：

- 全 workspace TypeScript typecheck：Protocol、i18n、Core、Desktop 全部 PASS。
- 全量 JavaScript/TypeScript tests：Protocol 7、i18n 2、Core 37、Desktop 14、sidecar native
  15，合计 75 PASS；Rust/Tauri tests 13 PASS。
- production build：Protocol、i18n、Core、Desktop 全部 PASS；Vite production bundle 107
  modules，主 JS 299.07 kB；sidecar prepare 锁定 bundled Node `v24.20.0`。
- `npm audit --omit=dev`：0 vulnerabilities；full `npm audit`：0 vulnerabilities。
- `cargo fmt --check`、`cargo check --locked`、`git diff --check`：PASS。

Windows production bundle 与 sidecar：

- Tauri Windows production build PASS；生成 NSIS
  `涌流404_0.1.0_x64-setup.exe`（25,439,442 bytes）与 zh-CN MSI
  `涌流404_0.1.0_x64_zh-CN.msi`（37,781,504 bytes）。
- 将运行环境 PATH 限定为 Windows System32 后启动 release executable，桌面仍使用 bundle 内
  `target/release/sidecar/node.exe` 启动 `bootstrap.mjs`；health 状态显示本机服务准备就绪，
  因此 Release 不依赖系统安装 Node.js。
- authenticated IPC v1 的随机 session token、随机 `127.0.0.1` 端口及
  ping/health/search providers/start/poll/cancel/download add/list/pause/resume/remove 均由全量
  Rust/Node tests 覆盖并通过；malformed、wrong token、version mismatch、unknown command 与
  task/control 错误均保持结构化响应。
- production App 真实搜索 `ubuntu` 时，YTS 返回 Error、Nyaa 独立完成并返回结果；单一 provider
  失败未阻断健康来源，验证 YTS/Nyaa 隔离。

合法 torrent 实机 smoke：

- 使用锁定 bundled Node `v24.20.0`、本机 UDP tracker 与自建合法 8 MiB fixture 执行真实
  `npm run tauri dev`。搜索结果经 authenticated IPC 创建下载任务，UI 先后显示非零 downloaded、
  427 KiB/s、ETA 与 Peers=1。
- pause 时任务停在 2.1 MiB / 26.8%，连续观察 downloaded 不再增长，download/upload speed
  为 0、ETA 为“—”、Peers=0；resume 后恢复到非零速度、Peers=1 并继续增长。
- 最终达到 100% / 8,388,608 bytes，状态进入 seeding，ETA=0；输出 SHA-256 为
  `8B065F520886246E8004A2968B437FABB0E51E927B763576B4FF61E4EED4FE38`。
- remove 经过确认后从任务列表移除，默认保留下载文件；关闭桌面窗口和 tracker 后，未发现
  `torlink-desktop.exe`、TorLink `bootstrap.mjs` sidecar 或 acceptance helper 遗留进程。

## 2026-08-29 — Phase 4.1 Magnet Direct Add + Source Toggles

完成：

- 搜索框现在识别 `magnet:` 输入并把主操作切换为“添加下载 / Add download”；提交继续复用既有
  authenticated `download.add → DownloadService → TorrentManager → WebTorrentAdapter`，没有新增
  下载路径。普通关键词仍进入原有增量搜索。
- invalid magnet、duplicate torrent 与 Core/sidecar failure 继续使用既有结构化错误和中英文产品
  文案，不向 UI 暴露内部错误详情。
- 设置页为 YTS/Nyaa 增加 session 内启用开关；分类来源数和无来源状态立即随当前启用来源更新。
  UI 不会在全部关闭或当前分类无来源时发起搜索。
- authenticated `search.start` 新增可选 `providerIds`，Rust bridge 与 sidecar 只把调用方当前启用的
  registry provider ID 交给既有 `SearchAggregator`；未知或静态禁用来源不会因此被启用。
- 仓库当前没有适合复用的设置持久化机制，因此本步不引入数据库或宽泛文件权限。开关关闭应用后
  恢复默认启用，最小安全持久化记录为 Phase 4.2。

局部验证：

- magnet detection/direct-add 与 Desktop source toggle UI：15 PASS；i18n：2 PASS；Core provider
  registry/aggregator：10 PASS；bundled Node sidecar provider selection：7 PASS。
- authenticated Rust search IPC 定向测试：1 PASS；Protocol/Core/Desktop typecheck、shared
  protocol/i18n build、`cargo fmt --check` 与 `cargo check --locked`：PASS。
- 未运行完整 acceptance gate、production bundle、audit、大型 torrent smoke 或 `tauri dev`；既有
  Phase 3 下载、sidecar lifecycle、authenticated IPC 与 WebTorrent 架构未重构。

## 2026-08-29 — Phase 4.2 Settings Persistence + Chinese Source Reconnaissance

完成：

- YTS/Nyaa enabled 状态保存为 WebView 同源 `localStorage` 中的版本化
  `providerId → boolean` 映射；首次启动和缺失、损坏、版本不兼容配置均回退 registry 默认值。
- 存储只含 provider ID 与布尔值，不保存 token、credential、URL、下载路径或其他敏感信息；不引入
  数据库、Tauri 文件系统 command/plugin 或新增权限。新增 provider 没有旧记录时自然采用其默认值。
- UI 初始化时合并 registry descriptor 与本机偏好，切换后立即保存；重建 Desktop UI 后仍恢复选择，
  分类来源数和 SearchAggregator provider selection 继续使用恢复后的 enabled 状态。
- 完成公开中文来源调查，只访问匿名公开接口，不实现 adapter、不新增抓取依赖。最终推荐
  AnimeGarden（公开 JSON、直接 magnet、低维护）和 AniBT（有契约的公开 RSS/JSON、直接
  magnet/infohash；因服务较新需观察期）。

局部验证：

- provider preferences 与 Desktop persistence/UI：17 PASS；i18n：2 PASS；Desktop typecheck：PASS。
- 未改 Rust/Tauri 代码，因此未运行不必要的 Cargo check；未运行全量 tests、production bundle、
  audit、torrent smoke 或下一阶段 adapter 工作。
