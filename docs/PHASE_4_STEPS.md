# Phase 4 小步骤

Phase 4 聚焦 v0.1.0 产品打磨。继续采用低额度模式：每步限制范围、运行直接相关验证并独立提交。

1. **Phase 4.1 Magnet Direct Add + Source Toggles**：搜索框识别 magnet 并复用 authenticated
   `download.add → DownloadService → TorrentManager → WebTorrentAdapter`；设置页可在当前会话启用或
   禁用 YTS/Nyaa，分类来源数随启用状态更新，搜索仅把当前启用来源交给既有
   `SearchAggregator`。（本提交完成）
2. **Phase 4.2 Local Preference Persistence**：在不引入数据库、宽泛文件系统权限或大型状态系统的
   前提下，为搜索来源开关设计并实现最小本地持久化；同时复核 locale/theme 是否应复用同一安全
   设置边界。（待执行）

Phase 4.1 不包含 `.torrent` 文件导入、任务持久化、新 provider、metadata/海报、限速、tracker
调整、WebTorrent 升级或 Release/installer 改造。来源开关关闭应用后恢复 registry 默认值。
