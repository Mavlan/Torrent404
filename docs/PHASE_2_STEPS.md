# Phase 2 小步骤

低额度开发模式下，每步只做局部实现、局部测试和独立提交。

1. **SearchProvider 契约与 registry**：统一增量搜索接口、元数据和唯一 ID 注册。（已完成：`c1ef618`）
2. **并发搜索聚合**：并行消费 providers、取消、超时、失败隔离、infohash 去重。（已完成：`953fc9a`）
3. **首批 provider adapters**：YTS JSON 与 Nyaa RSS 已验证两类 adapter。（完成）
   - **3.1 YTS JSON adapter**：已完成（`401d2d8`）。
   - **3.2 Nyaa RSS adapter**：已完成（`fc21d9b`）。
4. **任务模型与状态转换**：queued/downloading/paused/completed/seeding/error 及转换约束。（已完成：`58b92b5`）
5. **TorrentManager**：只依赖 `TorrentEngine`，连接任务状态与 `WebTorrentAdapter`。（已完成：`0107ee1`）
6. **Phase 2 完整验收门**：全量 typecheck/tests、audit、Cargo、Tauri build 和真实 torrent smoke。（PASS）

## Phase 2 最终状态

**PASS — Phase 2.1–2.5 已作为整体通过验收，尚未进入 Phase 3。**

- Node runtime：`v24.20.0`。
- 全 workspace typecheck：PASS。
- 全量 tests：PASS，13 个测试文件、41 个测试。
- production build：PASS。
- `npm audit --omit=dev` 与 full audit：均为 0 vulnerabilities。
- `cargo check --locked`：PASS。
- Tauri Windows production build：PASS，生成 NSIS 与 zh-CN MSI。
- 合法自生成 torrent WebTorrent smoke：PASS。
- WebTorrent import 仅位于 Core adapter；YTS + Nyaa 聚合、provider 失败隔离和
  TorrentManager 状态边界均通过测试。
