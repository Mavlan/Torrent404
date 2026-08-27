# Phase 3 小步骤

低额度开发模式下，每步只做局部实现、局部测试和独立提交。

1. **Sidecar Bootstrap**：打包锁定 Node runtime，随 Tauri 启动并在退出时可靠终止，包含 orphan guardian。（本提交完成）
2. **IPC transport 与随机 session token**：待后续单独执行，Phase 3.1 不实现 command surface。

Phase 3.1 明确不接搜索、TorrentManager、UI 数据、持久化或完整 IPC command。
