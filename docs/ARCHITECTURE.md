# TorLink Desktop 架构说明

状态：Phase 0 基线  
目标版本：v0.1.0  
首发平台：Windows 10/11 x64  
上游研究基线：`baairon/torlink@205cabb00c348c2272e1761fbf4b46b682c0c275`

## 1. 架构目标

TorLink Desktop 是中文优先、无中央代理服务的本地 BitTorrent 搜索与下载桌面客户端。v0.1.0 必须让未安装 Node.js、Git、Rust 或命令行工具的 Windows 用户通过 GitHub Release 安装并运行。

架构必须同时满足以下约束：

- 使用 Tauri 2 + React + TypeScript 构建桌面壳。
- 搜索、Torrent 和任务状态保留 Node/TypeScript 能力，通过随应用打包的 sidecar 运行。
- UI 只依赖稳定的 `packages/protocol` 契约，不依赖 TorLink TUI、Ink 组件或上游内部对象。
- 不解析 `npx torlnk` 的终端输出，不为 v0.1.0 重写 WebTorrent。
- 所有网络与 Torrent 行为在用户设备上完成，不新增中央搜索/下载代理。
- Windows Release 是硬交付，sidecar 必须包含运行时，终端用户不需要 Node.js。

## 2. 组件与依赖方向

```text
apps/desktop (Tauri 2 + React)
  ├─ React UI：搜索、下载中、已完成、设置、关于
  ├─ Tauri commands：受控的文件选择、打开目录、sidecar 生命周期
  └─ Sidecar supervisor：生成会话令牌、启动/停止、崩溃检测
          │
          │ loopback IPC + per-launch bearer token
          ▼
packages/core (Node/TypeScript sidecar)
  ├─ command router / event stream
  ├─ provider registry + concurrent search aggregator
  ├─ input parser (.torrent / magnet / infohash)
  ├─ WebTorrent manager + task state machine
  └─ versioned persistence repository
          │
          ├─ source websites / JSON API / RSS
          ├─ BitTorrent trackers, DHT and peers
          └─ Tauri app data + user-selected download directories

packages/protocol
  ├─ DTO、commands、events
  ├─ runtime schemas and validation
  └─ protocol/version compatibility

packages/i18n
  ├─ zh-CN default messages
  └─ typed message keys and future locale boundary
```

依赖只能指向内层契约：`desktop -> protocol <- core`，`desktop -> i18n`，`core -> protocol`。`protocol` 不依赖 UI、Tauri、WebTorrent 或任何上游 TorLink 文件。

## 3. 进程和 IPC 模型

v0.1.0 采用 localhost HTTP + 流式事件通道作为初始 IPC 方案，原因是 Node sidecar 和 Tauri 均易于实现、调试和测试。若 Phase 3 验证表明 stdin/stdout framed IPC 更可靠，可以在不改变 `packages/protocol` 的前提下替换传输层。

硬性安全规则：

1. sidecar 只绑定 `127.0.0.1`，不接受配置覆盖为 `0.0.0.0`、局域网地址或公网地址。
2. Tauri 每次启动使用加密安全随机数生成一次性高熵 session token，通过受控环境变量或启动参数传给 sidecar。
3. 除仅用于进程存活探测的最小 `/health` 外，所有命令、查询和事件连接都验证令牌；令牌不得进入日志、错误正文或持久化文件。
4. Tauri 进程负责 sidecar 的启动、健康检查、退出和异常重启策略；桌面应用退出时必须结束子进程，禁止遗留孤儿进程。
5. sidecar 不复用上游公开 `serve/files` 模式，不提供无鉴权 `/control`，也不提供远程文件服务器。
6. 所有输入在 protocol 边界进行 schema 校验；未知字段、非法状态、超大请求和不兼容版本必须被拒绝。

## 4. Protocol 契约

Phase 1 先定义传输无关的数据模型，Phase 3 再实现实际 IPC。核心 DTO：

- `SearchResult`：稳定 ID、标题、来源、分类、大小、seed/leech、magnet 或 torrent URL。
- `DownloadTask`：任务 ID、infohash、名称、状态、进度、上下行速度、已下载/总大小、ETA、保存目录、错误。
- `Settings`：下载目录、语言、主题、schemaVersion、provider 开关预留。
- `SourceStatus`：provider ID、运行状态、结果数、面向用户的错误码、可选技术详情。
- `CoreError`：稳定错误码、中文可翻译消息键、可选安全技术详情。

命令：`search`、`addMagnet`、`addTorrentFile`、`pauseTask`、`resumeTask`、`removeTask`、`stopSeeding`、`setDefaultDownloadDir`、`getSettings`、`listTasks`。

事件：`search:result`、`search:source-status`、`task:added`、`task:updated`、`task:removed`、`core:error`。

进度事件由 core 节流至 500-1000 ms；UI 不直接订阅 WebTorrent 对象或高频原始事件。

## 5. 搜索架构

每个来源实现独立 `SearchProvider`：

```ts
interface SearchProvider {
  id: string
  displayName: string
  categories: string[]
  search(query: string, signal: AbortSignal): AsyncIterable<SearchResult>
  healthCheck?(): Promise<boolean>
}
```

聚合器并行启动已启用 providers，将结果增量推送给 UI。一个 provider 超时、返回错误或解析失败只更新该来源状态，不终止其他来源。结果优先按规范化 infohash 去重；没有可用 hash 时保留结果。网络层统一设置超时、User-Agent、取消、有限重试和退避，不实现登录、付费墙、验证码、DRM 或反爬绕过。

首批 adapter 对应上游已验证来源：FitGirl、YTS、EZTV、The Pirate Bay、1337x、BitTorrented、Nyaa、SubsPlease。来源集合是产品配置，不在 UI 中宣传特定版权内容。

## 6. Torrent 生命周期

```text
input -> validate/parse -> dedupe(infohash) -> queued -> downloading
                                                     ├─ pause -> paused -> resume
                                                     ├─ failure -> error -> retry
                                                     └─ done -> completed/seeding -> stop seeding
```

- `.torrent` 只作为受限大小的 bencoded metadata 读取，不执行其包含的任何文件。
- 下载前规范化路径并验证目录来自默认下载目录或当前 Tauri 文件选择授权。
- 删除任务默认保留磁盘文件；删除数据必须由显式二次确认触发。
- 完成后保留做种状态，并允许停止/暂停。
- 任务恢复保留最小必要信息；恢复失败时任务继续可见并显示错误，不静默丢弃。
- core 到 UI 的公开状态使用 `error`，不沿用上游 `failed` 命名，适配层负责转换。

## 7. 持久化

v0.1.0 初始选择版本化 JSON + 原子替换，沿用上游已验证的简单模型；如果 Phase 6 的恢复与迁移复杂度超过单文件事务能力，再切换 SQLite，protocol 不受影响。

数据位于 Tauri app data 目录：

```text
app-data/
  settings.json       # schemaVersion、downloadDir、language、theme
  tasks.json          # 未完成任务与恢复信息
  history.json        # 已完成任务（有上限）
  seeds.json          # 做种/暂停选择
  torrents/           # 恢复做种所需的 .torrent metadata
  boot.marker         # 恢复崩溃保护
```

所有 JSON 写入必须序列化并采用同目录临时文件 + 原子 rename。schema 从版本 1 开始，加载时执行严格校验和显式迁移。测试通过临时 app-data 根目录运行，绝不触碰真实用户数据。

## 8. 文件系统边界

- 默认下载目录为系统 Downloads 下的应用目录；用户可通过原生目录选择器修改。
- sidecar 不接受任意路径读取命令。`.torrent` 文件必须由 Tauri 文件选择/拖拽授权后，以受控命令传入。
- 所有路径使用平台原生规范化；拒绝遍历、设备路径、意外 UNC/网络位置和不在授权范围内的写入。
- 日志默认不记录完整本地路径；需要诊断时仅记录脱敏尾段和稳定错误码。

## 9. 上游复用策略

优先迁移并改造成无 UI 依赖的模块：

- `src/sources/*`：provider 映射、magnet/infohash、torrent metadata 解析、网络重试。
- `src/download/engine.ts`：WebTorrent 生命周期包装。
- `src/download/queue.ts`、`types.ts`、`reconcile.ts`：任务状态与恢复语义。
- `src/download/persist.ts`、`history.ts`、`bootguard.ts`、`src/util/atomic.ts`：原子持久化与安全启动。

不复用：

- `src/ui/*` 和 Ink/TUI store；只作为交互与状态语义参考。
- `src/index.tsx` 的 CLI 分发、终端 escape sequence 与 tmux attach。
- `src/daemon/serve.ts`、`files.ts` 的可公开绑定/远程控制模型；只参考纯函数和 loopback 防护思路。
- `src/daemon/daemonize.ts`；桌面 sidecar 生命周期必须由 Tauri 管理。

复制或修改上游代码时保留 `Copyright (c) 2026 bairon.dev` 和 MIT 许可文本，并在 `THIRD_PARTY_NOTICES.md` 标注文件来源、固定提交和修改范围。

## 10. Windows 构建与发布

- Tauri 目标：`x86_64-pc-windows-msvc`。
- 终端用户包内包含 self-contained Node sidecar；开发机 Node 仅用于构建。
- 安装策略优先 per-user NSIS，安装目录不要求管理员权限；MSI 作为可选附加产物。
- CI 在 Windows runner 使用 Node 22、锁文件安装、Rust stable MSVC，依次执行 typecheck、unit tests、core build、desktop build 和 smoke checks。
- tag `v*` 重跑门禁后构建 sidecar、Tauri bundle、SHA-256，并上传 GitHub Release。
- 未签名构建可能触发 SmartScreen，发布说明必须如实披露。

## 11. 架构验收原则

- `packages/protocol` 可在没有 Tauri/WebTorrent 的环境独立 typecheck/test/build。
- UI 使用 mock transport 可启动和展示空态，不需要真实 sidecar。
- core 使用 fake providers/fake torrent engine 可测试失败隔离和状态转换。
- sidecar 无法绑定非 loopback 地址，错误 token 被拒绝，日志中检索不到 token。
- 发布包在无 Node.js 的 Windows 测试环境中启动。

