# Contributing

## 环境

- Node.js >=22
- npm（使用根 `package-lock.json`）
- Rust stable MSVC
- Windows C++ Build Tools 与 WebView2（Tauri 开发）

## 工作流

```powershell
npm ci
npm run check
```

提交应小而可审查，并使用 Conventional Commits：`feat:`、`fix:`、`docs:`、`test:`、`refactor:`、`chore:`。

## 约束

- 不解析 TorLink TUI 文本作为 API。
- 不让 UI 直接依赖 WebTorrent 或上游内部类型。
- 不开放非 loopback sidecar 监听地址。
- 不记录 token，不添加绕过登录、付费、验证码、DRM 或网络封锁的机制。
- 复制/修改 TorLink 代码时更新 `THIRD_PARTY_NOTICES.md` 并保留 MIT 归属。
- 非平凡逻辑必须有自动化测试；typecheck、test、build 失败时不得继续堆叠功能。

