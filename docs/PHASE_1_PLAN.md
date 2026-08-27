# Phase 1 文件级实施计划

状态：完成（2026-08-27）

目标：建立可锁定安装、可测试、可构建的 npm monorepo；提供 Tauri 2 + React 中文桌面 shell、独立 protocol/core/i18n 包和基础 CI。Phase 1 不接入真实 WebTorrent、真实 providers 或 sidecar IPC。

## 根目录

| 文件 | 计划 |
| --- | --- |
| `package.json` | npm workspaces、Node >=22、统一 typecheck/test/build/check 脚本 |
| `package-lock.json` | 固定全部 JS 依赖 |
| `tsconfig.base.json` | strict、ES2022、noUncheckedIndexedAccess、bundler resolution |
| `.gitignore` | Node、Rust、Tauri、构建与本地临时文件 |
| `README.md` | 产品定位、Phase 1 开发命令、隐私/法律边界、上游致谢 |
| `LICENSE` | 项目 MIT 许可证 |
| `THIRD_PARTY_NOTICES.md` | TorLink 固定提交、MIT 归属与后续依赖 notices 规则 |
| `SECURITY.md` | 私密报告流程、sidecar/路径/token 安全边界 |
| `CONTRIBUTING.md` | 环境、锁文件、门禁、小提交约束 |
| `CHANGELOG.md` | Phase 0/1 交付与已知风险 |

## `packages/protocol`

| 文件 | 计划 |
| --- | --- |
| `package.json` | 独立 typecheck/test/build exports |
| `tsconfig.json` | 继承根配置，生成声明文件 |
| `src/models.ts` | SearchResult、DownloadTask、Settings、SourceStatus |
| `src/messages.ts` | commands/events discriminated unions |
| `src/schemas.ts` | zod runtime 校验与版本常量 |
| `src/index.ts` | 稳定公共导出 |
| `src/schemas.test.ts` | 合法/非法消息和路径字段边界测试 |

## `packages/core`

| 文件 | 计划 |
| --- | --- |
| `package.json` | 依赖 protocol；不含 WebTorrent |
| `tsconfig.json` | Node 22/24 core 编译配置 |
| `src/index.ts` | core 公共入口与 Phase 1 stub 信息 |
| `src/runtime.ts` | 可注入 transport 的空实现/健康信息，不打开端口 |
| `src/runtime.test.ts` | 验证无网络副作用和协议版本 |

## `packages/i18n`

| 文件 | 计划 |
| --- | --- |
| `package.json` | 独立构建与类型检查 |
| `tsconfig.json` | 声明输出 |
| `src/zh-CN.ts` | 首批导航、空态、状态与错误消息 |
| `src/index.ts` | typed message key 与默认 locale |
| `src/index.test.ts` | key 完整性和 fallback 测试 |

## `apps/desktop`

| 文件 | 计划 |
| --- | --- |
| `package.json` | React 19、Vite、Tauri CLI/API、测试脚本 |
| `index.html` | 中文文档与应用挂载点 |
| `vite.config.ts` | 固定端口、Tauri dev host、忽略 `src-tauri` |
| `src/main.tsx` | React 入口 |
| `src/App.tsx` | 左侧导航 + 搜索/下载/完成/设置/关于 shell |
| `src/styles.css` | 中文优先、系统主题、键盘焦点、响应式产品视觉 |
| `src/App.test.tsx` | 导航、空态和关于/隐私文本 smoke tests |
| `src-tauri/Cargo.toml` | Tauri 2 Rust crate |
| `src-tauri/build.rs` | `tauri-build` |
| `src-tauri/src/lib.rs` | Tauri Builder；Phase 1 不启动 sidecar |
| `src-tauri/src/main.rs` | Windows release 入口 |
| `src-tauri/tauri.conf.json` | Windows 窗口、CSP、bundle 基线 |
| `src-tauri/capabilities/default.json` | 最小 `core:default`，不授予 shell/network/filesystem wildcard |
| `src-tauri/icons/*` | Tauri 构建所需占位应用图标，Phase 7 替换正式视觉 |

## CI

| 文件 | 计划 |
| --- | --- |
| `.github/workflows/ci.yml` | Windows runner、Node 22、npm ci、typecheck/test/build、cargo check、npm audit 报告 |

## Phase 1 验收

1. `npm ci` 使用根锁文件成功。
2. `npm run typecheck`、`npm test`、`npm run build` 全部 PASS。
3. `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` PASS。
4. `npm audit` 无由 Phase 1 新增的 high/critical；如工具数据库报告现有项，记录依赖链与阻塞判断。
5. React shell 可在浏览器 smoke 运行；Tauri 配置不授予 sidecar 或远程网络能力。
6. 更新 `CHANGELOG.md` 与 `docs/DEVLOG.md`。

## 实际验收结果

- `npm ci` / 根 `package-lock.json`：PASS。
- TypeScript typecheck：PASS。
- 单元/UI 测试：PASS（10/10）。
- protocol、i18n、core 与 Vite production build：PASS。
- Tauri Rust `cargo check`：PASS。
- npm audit：0 vulnerabilities。
- 本地 UI smoke 与 780×560 响应式检查：PASS；控制台无 warning/error。
