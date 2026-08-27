# Phase 3 小步骤

低额度开发模式下，每步只做局部实现、局部测试和独立提交。

1. **Sidecar Bootstrap**：打包锁定 Node runtime，随 Tauri 启动并在退出时可靠终止，包含 orphan guardian。（`4172e86` 完成）
2. **Authenticated IPC Transport**：仅监听 `127.0.0.1` 随机端口；每次启动生成 256-bit session token，所有请求先鉴权；协议 v1 提供 `ping` / `health` 及结构化错误。（`5d0d1bc` 完成）
3. **Search IPC**：通过同一 authenticated IPC v1 接入 YTS + Nyaa `SearchAggregator`；支持唯一 request ID、增量结果与 provider 状态、取消旧搜索，并在 UI 展示现有结果字段。（本提交完成）

Phase 3.3 明确不接 TorrentManager、下载按钮真实行为、WebTorrent 下载、任务事件流、新 provider、SSE 或 WebSocket。
