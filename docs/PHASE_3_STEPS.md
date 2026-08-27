# Phase 3 小步骤

低额度开发模式下，每步只做局部实现、局部测试和独立提交。

1. **Sidecar Bootstrap**：打包锁定 Node runtime，随 Tauri 启动并在退出时可靠终止，包含 orphan guardian。（`4172e86` 完成）
2. **Authenticated IPC Transport**：仅监听 `127.0.0.1` 随机端口；每次启动生成 256-bit session token，所有请求先鉴权；协议 v1 提供 `ping` / `health` 及结构化错误。（本提交完成）

Phase 3.2 明确不接搜索、TorrentManager、WebTorrent、UI 数据、持久化、SSE 或 WebSocket。
