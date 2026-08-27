# TorLink 上游研究记录

研究日期：2026-08-27  
仓库：<https://github.com/baairon/torlink>  
分支：`main`  
固定提交：`205cabb00c348c2272e1761fbf4b46b682c0c275`  
提交时间：2026-08-19T15:00:07-04:00  
提交主题：`chore: bump to 1.7.0 and close the category and source sets in CONTRIBUTING`

## 1. 工具与包基线

- 上游包名/版本：`torlnk@1.7.0`。
- 上游要求：Node.js `>=22`。
- 本次验证：Windows x64；Node 24.19.0；npm 11.12.1；Git 2.53.0；Rust/Cargo 1.96.0。
- `package.json` 直接依赖范围：WebTorrent `^2.4.1`、React `^19.2.7`、Ink `^7.0.5`、parse-torrent `^11.0.21`、env-paths `^4.0.0`、uint8-util `2.2.6`。
- 当前锁文件实际安装：WebTorrent 2.8.5、React 19.2.7、Ink 7.1.0、parse-torrent 11.0.21、env-paths 4.0.0、uint8-util 2.2.6。

## 2. 目录与职责

```text
src/
  cli/        CLI 参数与 headless 子命令
  config/     配置、路径、下载目录、tracker
  daemon/     watch/serve/files/attach/daemon 生命周期
  download/   WebTorrent engine、queue、history、持久化、恢复
  sources/    provider registry、adapter、magnet/.torrent 解析
  ui/         Ink TUI、状态 store、搜索 hook
  update/     npm 版本检查与自更新
  util/       原子写、网络重试、格式化、系统集成
```

构建入口是 `src/index.tsx`，用 Ink 启动 TUI，或动态加载 `watch`、`serve`、`files`、`attach` 等 headless 模式。`tsup` 生成单一 Node 22 ESM bundle，再由 postbuild 写入 CLI 包装与 WebRTC fallback。

## 3. 搜索 providers

统一类型位于 `src/sources/types.ts`：`Source.search()` 返回 `Promise<TorrentResult[]>`，支持 `AbortSignal`。registry 固定 10 个 adapter 实例：

| adapter | 类别 | 机制 | 备注 |
| --- | --- | --- | --- |
| FitGirl | Games | WordPress RSS | 无真实 swarm 统计 |
| YTS | Movies | JSON API，多 host fallback | 结果含 hash/size/seed/peer |
| TPB Movies/TV | Movies/TV | apibay JSON API | 类别过滤、空结果 sentinel 重试 |
| 1337x Movies/TV | Movies/TV | HTML 列表 + detail magnet | 多 host fallback，最多抓 4 个详情 |
| EZTV | TV | JSON API | 当前非空关键词直接返回空，仅支持 browse |
| Nyaa | Anime | RSS | 解析 namespaced swarm 字段 |
| SubsPlease | Anime | JSON API | 无真实 swarm 统计 |
| BitTorrented | Movies/TV | JSON API | 至少 3 字符，限定 video 类型 |

TUI 的 `useConcurrentSearch` 并发启动全部来源、独立捕获错误、150 ms 合并刷新，并按 infohash 去重。相同 hash 保留 seeders 较高的记录。provider 失败不会阻断其他来源。

桌面迁移决定：保留 adapter 纯逻辑和失败隔离，移除 React hook 依赖；core 聚合器改成 `AsyncIterable`/事件形式，直接向 protocol 发送增量结果和来源状态。为每个网络调用增加总超时；保留取消、有限重试和退避。

## 4. Magnet 与 .torrent 输入

- `magnet.ts` 支持 40 位 hex 和 32 位 base32 infohash，统一转小写 hex，并能补充默认 trackers。
- `torrentFile.ts` 用 parse-torrent 读取 metadata，大小硬限制 16 MiB；保留 torrent 自带 announce 列表。
- `torrentPath.ts` 处理 Windows/POSIX 拖拽路径、引号、`file://` 和 `~`。

桌面迁移决定：复用解析函数，但文件路径必须先由 Tauri 原生选择器/拖拽授权。core 不暴露“读取任意路径”的通用 IPC 命令。

## 5. WebTorrent 生命周期

`src/download/engine.ts` 延迟创建单个 WebTorrent client；每个 infohash 映射一个 torrent handle。它负责：

- add、metadata、done、error 事件适配；
- 读取进度、上下行速度、peer、ETA、名称；
- 完成后保留 torrent 继续做种；
- remove 单任务与 destroy 整体 client；
- metadata 到达后缓存 `.torrent` 数据，便于重启后本地校验和恢复做种。

`src/download/queue.ts` 是状态机与编排层：

- 状态包含 downloading、queued、paused、completed、failed；
- 支持并发下载上限、排队、暂停/继续、失败重试、删除与可选删除数据；
- 500 ms 轮询 engine stats；完成后写 history 并转换为 seed；
- 恢复时区分 active/paused/queued，启动崩溃后进入 safe mode；
- 检测做种文件缺失，避免把“恢复做种”意外变成重新下载。

桌面迁移决定：迁移 engine/queue 的成熟语义，但把 EventEmitter 事件适配为 protocol 事件，并把 `failed` 映射为产品契约中的 `error`。进度对 UI 降频至 500-1000 ms。

## 6. 持久化与恢复

上游使用 `env-paths` 划分 config/data 目录：

- `config.json`：downloadDir、额外 trackers。
- `queue.json`：活动/暂停/失败任务。
- `history.json`：最多 500 条完成记录。
- `seeds.json`：seeding/paused 选择。
- `torrents/<hash>.torrent`：恢复做种所需 metadata。
- `boot.marker`：上次启动在 restore 阶段崩溃时触发安全恢复。

写入通过串行 Promise 链、临时文件和 rename 完成；退出时还有同步 flush。损坏或缺失 JSON 会降级为空集合。

桌面迁移决定：Phase 2 继续使用版本化 JSON + 原子替换，不直接把上游的无 schema JSON 当成桌面格式。所有文件迁移到 Tauri app data；测试使用临时状态目录。

## 7. Headless / serve 能力与安全边界

上游提供：

- `watch <dir>`：轮询文件夹，处理 `.torrent`/`.magnet`/`.txt`，并移动到 `.processed`/`.failed`。
- `serve`：默认 `127.0.0.1:9161`，提供 `/health`、`/add`、`/downloads`、`/status`、`/control`。
- `files`：默认 `127.0.0.1:9160`，提供只读目录列表、文件和 Range 请求。
- `attach`：使用 tmux 保持 TUI。
- `--daemon`：脱离终端并写 pid/log/run descriptor。

上游已有的可参考防护包括 loopback 默认绑定、Host header 防 DNS rebinding、请求体 64 KiB 上限、Bearer token、路径遍历拒绝与公开绑定时强制 token。

桌面版不复用其远程控制模型。上游允许“带 token 绑定非 loopback 地址”，而开发手册要求桌面 sidecar 始终仅本机可达并使用每次启动随机 token。因此桌面版不导入 `serve/files/daemonize/attach`，只参考纯函数、边界检查和测试用例。

## 8. 许可证边界

上游根许可证为 MIT：`Copyright (c) 2026 bairon.dev`。直接依赖 env-paths、Ink、parse-torrent、React、uint8-util、WebTorrent 当前均声明 MIT。

处理规则：

1. 复制、修改或 vendoring 上游实质代码时，保留其版权与 MIT 许可文本。
2. `THIRD_PARTY_NOTICES.md` 记录上游 URL、固定提交、复制文件、修改说明和许可。
3. 项目采用独立名称/视觉身份；不得让用户误以为是 TorLink 官方版本。
4. Release 前对全部 npm/crate 依赖生成 notices 并复核许可证。

## 9. 上游验证结果

在固定提交、`npm ci` 后执行：

- `npm run typecheck`：PASS。
- `npm test`：PASS，45 个测试文件、311 个测试。
- `npm run build`：PASS，生成 Node 22 ESM bundle 和 CLI wrapper。
- `npm audit`：FAIL，1 low、7 high、0 critical。
- `npm audit --omit=dev`：FAIL，5 high、0 critical。

生产 high 主要来自 WebTorrent 2.8.5 的传递依赖链：`webtorrent -> torrent-discovery -> bittorrent-tracker -> ip@2.0.1`，另有 `ip-address@10.2.0`。npm 给出的自动修复建议是降级到 WebTorrent 0.7.3，属于不可接受的破坏性/过时变更，不能直接采用。dev high 来自 PostCSS/nanoid；esbuild 报告为 low 且锁文件另有已修复版本。

结论：这是已存在的上游供应链风险，不是本项目新增问题。Phase 1 不引入 WebTorrent；Phase 2 接入前必须重新审计、检查上游/依赖修复版本并完成适用性判断。若仍无安全升级路径，作为明确 Release blocker 记录，不以 `audit fix --force` 降级核心引擎。

## 10. Phase 0 结论

- 没有阻止进入 Phase 1 脚手架的架构或许可证问题。
- 上游 core 具有高复用价值，但必须从 TUI/CLI 和远程 headless 表面中解耦。
- sidecar 的 loopback + per-launch token 约束是桌面实现不可放宽的边界。
- WebTorrent 传递依赖的 high 审计项阻止“未经评估直接进入 Release”，但不阻止建立不含 WebTorrent 的 Phase 1 scaffold。

