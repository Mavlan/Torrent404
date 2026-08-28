# Phase 4 小步骤

Phase 4 聚焦 v0.1.0 产品打磨。继续采用低额度模式：每步限制范围、运行直接相关验证并独立提交。

1. **Phase 4.1 Magnet Direct Add + Source Toggles**：搜索框识别 magnet 并复用 authenticated
   `download.add → DownloadService → TorrentManager → WebTorrentAdapter`；设置页可在当前会话启用或
   禁用 YTS/Nyaa，分类来源数随启用状态更新，搜索仅把当前启用来源交给既有
   `SearchAggregator`。（本提交完成）
2. **Phase 4.2 Settings Persistence + Chinese Source Reconnaissance**：使用 WebView 同源
   `localStorage` 持久化版本化的 `providerId → enabled` 布尔映射，损坏/缺失时回退 registry 默认；
   调查公开中文来源并仅推荐 AnimeGarden、AniBT 进入后续逐个 adapter 评审。（本提交完成）
3. **Phase 4.3 Chinese Movies / TV / Games / Software Provider Reconnaissance**：暂停 AnimeGarden
   adapter，只调查非 Anime 公开来源。结论为 v0.1 最小候选集 Internet Archive + FOSS Torrents；
   不推荐把通用商业内容聚合索引作为公开项目默认来源。（本提交完成）
4. **Phase 4.4 Minimum Chinese Provider Qualification**：用极少量中文关键词实测最有希望的通用
   候选；仅 Knaben 达到有限 Movies/TV 中文命中门槛，BT4G/TorrentKitty 因匿名访问 403 淘汰，
   Games/Software 暂无合格中文向来源。（本提交完成）
5. **Phase 4.5 First Qualified Provider Adapter**：仅在后续明确指令下，一次实现一个 adapter 并使用
   本地 fixture；不得接登录、个人 token、镜像轮换或 CAPTCHA/Cloudflare 绕过。（待执行）

Phase 4.1 不包含 `.torrent` 文件导入、任务持久化、新 provider、metadata/海报、限速、tracker
调整、WebTorrent 升级或 Release/installer 改造。Phase 4.2 只持久化非敏感来源布尔偏好，不新增
provider 或 adapter。Phase 4.3 仅形成调查文档，未实现 AnimeGarden 或其他 provider。

## Phase 4.4 qualification

| Provider | Movies | TV | Games | Software | 中文命中 | Interface | Maintenance | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Knaben | Partial（1/2） | Partial（1/2） | No（0/1） | No（0/1） | `流浪地球`、`庆余年` 命中；另四词未命中 | 匿名 JSON v1；命中直接 hash/magnet | Medium：分类映射有误标，需防御性过滤 | Qualified for Movies/TV beta；建议默认关闭 |
| BT4G | 未核验 | 未核验 | 未核验 | 未核验 | 四个普通中文 search GET 均 403 | HTML → detail/magnet | High：访问防护且无稳定 API | Reject；不绕过 403 |
| TorrentKitty | 未核验 | 未核验 | 未核验 | 未核验 | 匿名入口即 403，无法合法继续核验 | HTML magnet search | High：访问防护、HTML schema | Reject；不绕过 403 |

实测词为 Movies `流浪地球` / `你好李焕英`、TV `庆余年` / `狂飙`、Games `黑神话`、Software
`Windows 中文`。Knaben 使用对应分类过滤、`hide_unsafe=true`、`hide_xxx=true`；成功命中的 3 条结果
均直接提供 hash/magnet，但 Movies 的上游分类标签存在误标，不能假定分类可靠。

**v0.1 Recommended Chinese Provider Set：Knaben（仅 Movies + TV，beta、默认关闭）。** 不推荐第二个
来源；Games/Software 保持“暂无”，直到出现无需绕过访问防护且实际中文命中合格的候选。接口证据：
[Knaben API v1](https://knaben.org/api/v1/)、[Knaben categories](https://knaben.org/browse/0/1/title)、
[BT4G](https://bt4gprx.com/)、[TorrentKitty](https://www.torrentkitty.online/)。
