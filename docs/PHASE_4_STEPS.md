# Phase 4 小步骤

Phase 4 聚焦 v0.1.0 产品打磨。继续采用低额度模式：每步限制范围、运行直接相关验证并独立提交。

1. **Phase 4.1 Magnet Direct Add + Source Toggles**：搜索框识别 magnet 并复用 authenticated
   `download.add → DownloadService → TorrentManager → WebTorrentAdapter`；设置页可在当前会话启用或
   禁用 YTS/Nyaa，分类来源数随启用状态更新，搜索仅把当前启用来源交给既有
   `SearchAggregator`。（本提交完成）
2. **Phase 4.2 Settings Persistence + Chinese Source Reconnaissance**：使用 WebView 同源
   `localStorage` 持久化版本化的 `providerId → enabled` 布尔映射，损坏/缺失时回退 registry 默认；
   调查公开中文来源并仅推荐 AnimeGarden、AniBT 进入后续逐个 adapter 评审。（本提交完成）
3. **Phase 4.3 First Chinese Provider Adapter**：从 Phase 4.2 推荐候选中一次只实现一个 adapter，
   使用本地 fixture，不接登录、个人 token、CAPTCHA/Cloudflare 绕过。（待执行）

Phase 4.1 不包含 `.torrent` 文件导入、任务持久化、新 provider、metadata/海报、限速、tracker
调整、WebTorrent 升级或 Release/installer 改造。Phase 4.2 只持久化非敏感来源布尔偏好，不新增
provider 或 adapter。
