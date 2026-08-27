# Phase 2 小步骤

低额度开发模式下，每步只做局部实现、局部测试和独立提交。

1. **SearchProvider 契约与 registry**：统一增量搜索接口、元数据和唯一 ID 注册。（本提交完成）
2. **并发搜索聚合**：并行消费 providers、取消、超时、失败隔离、infohash 去重。
3. **首批 provider adapters**：按来源逐个迁移，每个 adapter 使用合法 fixture 测试。
4. **任务模型与状态转换**：queued/downloading/paused/completed/seeding/error 及转换约束。
5. **TorrentManager**：只依赖 `TorrentEngine`，连接任务状态与 `WebTorrentAdapter`。
6. **Phase 2 完整验收门**：仅在前五步全部完成后运行全量 typecheck/tests、audit、Cargo、Tauri build 和真实 torrent smoke。
