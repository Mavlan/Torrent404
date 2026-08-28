# Phase 3 小步骤

低额度开发模式下，每步只做局部实现、局部测试和独立提交。

1. **Sidecar Bootstrap**：打包锁定 Node runtime，随 Tauri 启动并在退出时可靠终止，包含 orphan guardian。（`4172e86` 完成）
2. **Authenticated IPC Transport**：仅监听 `127.0.0.1` 随机端口；每次启动生成 256-bit session token，所有请求先鉴权；协议 v1 提供 `ping` / `health` 及结构化错误。（`5d0d1bc` 完成）
3. **Search IPC**：通过同一 authenticated IPC v1 接入 YTS + Nyaa `SearchAggregator`；支持唯一 request ID、增量结果与 provider 状态、取消旧搜索，并在 UI 展示现有结果字段。（`6ba8e3f` 完成）
4. **Phase 3.3.5 Product UX / Categories / i18n**：产品显示名统一为“涌流404”；启用 zh-CN/en-US 即时切换；搜索分类通过 `SearchProvider.categories` 过滤实际调用来源；补充 provider enable/disable 兼容边界。（`d73e359` 完成）
5. **Phase 3.3.6 Source Clarity UX**：从 authenticated registry descriptor 实时计算分类来源数；无来源分类不发请求；以可读状态卡解释来源、分类与运行状态，并在设置页展示内置来源。（`513ba18` 完成）
6. **中文 provider reconnaissance**：单独调研无需登录、验证码、付费墙、DRM 或反爬绕过的合法公开来源，记录能力、稳定性、分类与风险；不在调研步骤实现 adapter。（待执行）
7. **中文 provider adapters**：基于 reconnaissance 结论逐个实现，每个来源使用本地 fixture、独立测试与独立提交，禁止批量迁移。（待执行）
8. **Phase 3.4 Start Download IPC**：复用 authenticated IPC v1，通过 `TorrentManager → TorrentEngine → WebTorrentAdapter` 从搜索结果创建真实下载任务，并在“下载中”显示初始任务。（本提交完成）
9. **Phase 3.4.1 Download Runtime Fix**：为搜索 adapter 生成的最小 magnet 补充 WebTorrent tracker fallback，确保真实任务持续 peer discovery 与写盘；使用本地合法 torrent 完成 `tauri dev` smoke。（本提交完成）
10. **Phase 3.4.2 Task Controls**：在 authenticated IPC v1 增加 pause/resume/remove；所有操作经 `TorrentManager` 和 `DownloadTaskModel`，remove 默认保留本地文件，桌面端提供双语按钮与删除确认。（本提交完成）
11. **Phase 3.4.3 Magnet Direct Add**：将搜索框中的 magnet/infohash 识别为直接添加操作；保持与 Phase 3.4 相同的校验、去重与错误边界。（待执行）
12. **Phase 3.5**：继续手册定义的后续桌面集成步骤；须另行确认后再进入。（待执行）

Phase 3.4.2 只实现任务控制链路；不包含持续进度 UI、删除本地文件、任务持久化、新 provider 或 Phase 3.5。
