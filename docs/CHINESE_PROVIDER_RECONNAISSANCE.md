# 中文搜索来源候选调查

核验日期：2026-08-29

## 结论

建议最多两个候选进入后续 adapter 实现，按优先级为：

1. **AnimeGarden — Recommended**：公开、开源并明确面向开发者提供 JSON API；列表响应直接包含
   title、provider、type、size、magnet 等字段，不需要详情页，也不需要新增 HTML/RSS 解析依赖。
2. **AniBT — Recommended（观察期）**：公开读取无需鉴权，RSS/JSON 接口有明确契约、限流和错误
   语义，RSS 直接提供 magnet/infohash 与分类；但服务较新，应先用 fixture 和短期稳定性监测验证。

二者都只应进入“逐个实现、可关闭”的 adapter 阶段。Torrent 索引可能指向未经授权的内容；代码
开源或接口公开不代表索引内容已获授权。是否作为公开 GitHub 项目的默认启用来源，仍需项目维护者
完成适用法域、商标与项目声誉审查。本文不是法律意见。

## 方法与边界

- 只检查公开首页、公开文档、公开 JSON/RSS/HTML 搜索入口和普通匿名 HTTP 响应。
- 未注册账号、未提交凭据、未访问个人订阅、未绕过 Cloudflare/CAPTCHA/限流或访问控制。
- 从本项目运行环境对候选公开入口做一次匿名可达性探测；AnimeGarden、AniBT、ACG.RIP、動漫花園、
  蜜柑计划和 Bangumi.moe 均返回 HTTP 200。这只是 2026-08-29 的单点结果，不代表长期 SLA。
- 稳定性评级综合公开契约、数据格式、详情页需求、当前可达性和域名/接口历史；未做高频请求。
- 只研究来源适配性，不验证或下载搜索结果指向的内容。

## 候选总览

| 候选 | 评级 | 公开接口 | 直接 magnet/infohash | 登录 | 请求/维护成本 | 默认内置判断 |
| --- | --- | --- | --- | --- | --- | --- |
| AnimeGarden | Recommended | JSON API、RSS | 是 | 公开读取不需要 | 低 | 有条件适合；默认启用前需法律/声誉审查 |
| AniBT | Recommended | 有契约的 JSON、RSS | 是 | 公开读取不需要 | 低 | 技术上适合；建议先观察稳定性 |
| 動漫花園 DMHY | Possible | RSS、HTML | RSS 直接提供 | 搜索/RSS 不需要 | 中 | 不建议；旧接口、重复覆盖与法律风险 |
| 蜜柑计划 Mikan | Possible | HTML search、RSS | 通常需 episode/RSS | 搜索公开；个人 RSS 要登录/token | 中高 | 不建议；公开搜索没有稳定 JSON 契约 |
| Bangumi.moe | Possible | SPA、历史 RSS/API | RSS 可提供 | 公开读取不需要 | 中高 | 不建议；公开契约与维护状态不够清晰 |
| ACG.RIP | Possible | RSS、HTML、torrent | RSS 未直接提供 magnet | 不需要 | 中 | 不建议；需额外下载/解析 `.torrent` |
| 通用磁力站/镜像站群 | Avoid | 不稳定 HTML | 不一致 | 不一致 | 很高 | 不适合 |

## 详细评估

### AnimeGarden — Recommended

- **内容与中文覆盖**：动画 BT 聚合，来源包含動漫花園、蜜柑计划与 Bangumi.moe；标题和筛选支持
  简体/繁体、字幕组、动画类型等中文字段。
- **公开访问/登录**：公开读取 API 无登录要求。本次匿名资源列表请求返回 JSON 200。
- **数据接口**：公开 JSON API、RSS、TypeScript client；官方示例包含分页、include/keywords/search、
  type、fansub、时间范围及 tracker 参数。
- **magnet/infohash/详情页**：资源列表直接返回 `magnet`，可从标准 btih 规范化 infohash；
  `providerId` 只作为上游记录标识，不进入详情页。
- **反爬情况**：普通 API 请求未遇到 CAPTCHA 或 challenge；仍应遵守服务端限流和缓存语义。
- **分类/稳定性**：动画、字幕组、发布者和时间过滤清晰；仓库与 API 示例公开，可用契约优于 HTML。
- **请求复杂度/维护成本**：低。Node 24 原生 `fetch` 加本地 JSON fixture 即可，不需要 client 包。
- **默认内置判断**：技术上有条件适合；它是聚合层，可能与 Nyaa 或后续直接来源重复，必须按 infohash
  去重，并在默认启用前完成法律与项目声誉审查。
- **证据**：[AnimeGarden 官方仓库](https://github.com/yjl9903/AnimeGarden)、
  [官方 API 请求示例](https://github.com/yjl9903/AnimeGarden/blob/main/examples/api.http)、
  [公开文档](https://animespace.onekuma.cn/animegarden/)。

### AniBT — Recommended（观察期）

- **内容与中文覆盖**：中文公开动画聚合索引，提供简/繁字幕语言、字幕组、分辨率、格式、番剧与
  other 分类；第三方 Jackett 定义也将其标记为中文公开动画索引。
- **公开访问/登录**：公开读取无需鉴权；发布、删除和个人订阅才需要 API key/token。本次公开 RSS
  与字幕组 JSON 请求均为 200。
- **数据接口**：文档化 JSON 与 RSS；公开契约声明路径和参数只扩展、不做不兼容变更，并明确
  400/429/503、`Retry-After` 与缓存行为。
- **magnet/infohash/详情页**：全站搜索 RSS 的 enclosure 直接为 magnet，并带 torrent infoHash；
  不需要详情页。
- **反爬情况**：普通匿名读取未遇到 CAPTCHA；文档说明生产边缘可能返回 Cloudflare HTML 429，
  adapter 必须按限流退避，不能尝试绕过。
- **分类/稳定性**：分类结构最好，但公开服务较新，长期可用性证据少于老站，需观察期。
- **请求复杂度/维护成本**：低。已有 Nyaa RSS parser 经验可复用，但 adapter 必须独立实现并使用
  本地 fixture。
- **默认内置判断**：技术上适合，建议第一版内置但默认关闭或标记 beta，稳定性观察通过后再决定
  是否默认启用；同样需要法律与声誉审查。
- **证据**：[AniBT 官方接口参考](https://wiki.anibt.net/docs/open-api/reference)、
  [字幕组公开接口说明](https://wiki.anibt.net/docs/open-api/subtitle-groups)、
  [Jackett 官方 indexer 定义](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/anibt.yml)。

### 動漫花園 DMHY — Possible

- **内容与中文覆盖**：动画、漫画、音乐、日剧、RAW、游戏和其他；繁体中文界面，中文发布组覆盖高。
- **公开访问/登录**：列表、搜索与 RSS 公开，不要求登录。
- **数据接口**：官方 FAQ 记录关键词、分类、联盟、发布者 RSS；HTML 也有完整分类。
- **magnet/infohash/详情页**：RSS enclosure 直接给 magnet，本次无需详情页即可读取；infohash 可能为
  base32，需要规范化测试。
- **反爬情况**：本次匿名 RSS 200、无 CAPTCHA；历史可达性和地区网络差异仍是风险。
- **分类/稳定性**：站点历史较长、RSS 简单，但属于旧式接口，没有版本化 schema 或 SLA。
- **请求复杂度/维护成本**：中等；RSS 容易解析，但遗留编码、HTTP 链接、tracker 列表和分类 ID
  需要防御性处理。
- **默认内置判断**：不建议。AnimeGarden 已聚合其数据，直接再接会制造大量重复，并放大法律与
  项目声誉风险。
- **证据**：[DMHY 首页与分类](https://share.dmhy.org/)、
  [官方搜索/RSS FAQ](https://share.dmhy.org/cms/page/name/faq.html)。

### 蜜柑计划 Mikan — Possible

- **内容与中文覆盖**：新番、剧场版和中文字幕组，简繁标题覆盖很好。
- **公开访问/登录**：首页、关键词搜索、番剧与 episode 页面公开；个人聚合 RSS/高级订阅依赖账号
  和 token，不能作为默认 provider 的凭据路径。
- **数据接口**：公开 HTML search 与番剧 RSS；未找到面向第三方、版本化的公开 JSON search 契约。
- **magnet/infohash/详情页**：搜索结果可出现 episode ID（常为 infohash），但可靠取得资源字段通常
  要解析 episode/番剧页或 RSS，不能假设搜索列表始终完整。
- **反爬情况**：本次匿名搜索返回 200、未遇 CAPTCHA；站点公布过不同地区域名，域名与可达性是
  维护变量。
- **分类/稳定性**：动画分类强，跨电影/游戏/软件能力弱；站点本身成熟，但抓 HTML 易受改版影响。
- **请求复杂度/维护成本**：中高，通常是 search → episode/detail/RSS 两段请求。
- **默认内置判断**：不建议直接默认内置；AnimeGarden 已以结构化 API 聚合 Mikan，优先使用后者。
- **证据**：[蜜柑计划官网](https://mikanani.me/)、
  [公开搜索入口](https://mikanani.me/Home/Search?searchstr=)、
  [联系方式](https://mikanani.me/Home/Contact)。

### Bangumi.moe — Possible

- **内容与中文覆盖**：动画、字幕组和简繁标签，华语字幕资源覆盖较高。
- **公开访问/登录**：首页公开且提供简体/繁体/英文切换；公开 RSS 历史上可匿名使用。
- **数据接口**：SPA 首页对无 JavaScript 客户端只返回模板；可见 RSS/API 使用案例，但没有找到当前
  维护、版本化的官方第三方接口契约。
- **magnet/infohash/详情页**：RSS 通常可携带 torrent enclosure；搜索 API/标签 ID 规则需要额外
  核验，不能以第三方逆向说明作为稳定契约。
- **反爬情况**：本次首页 200、未遇 CAPTCHA；SPA/API 变更风险高于文档化接口。
- **分类/稳定性**：动画标签丰富，但维护状态、错误模型与限流策略不透明。
- **请求复杂度/维护成本**：中高；可能依赖未文档化 POST schema 或标签 ID。
- **默认内置判断**：不建议。可在官方发布稳定 API 文档后重新评估。
- **证据**：[Bangumi.moe 官网](https://bangumi.moe/)。

### ACG.RIP — Possible

- **内容与中文覆盖**：动画和日本相关发布，简体/繁体字幕组覆盖高。
- **公开访问/登录**：搜索、RSS、详情与 torrent 下载公开，不要求登录。
- **数据接口**：关键词 RSS 结构简单，HTML 列表稳定可读。
- **magnet/infohash/详情页**：本次 RSS enclosure 指向 `.torrent`，没有直接 magnet/infohash；需再取
  torrent 或详情页才能得到本项目需要的统一字段。
- **反爬情况**：本次匿名 RSS 200、无 CAPTCHA。
- **分类/稳定性**：以动画更新为主，分类较弱；官网提示自有 tracker 已失效，但 torrent 可依赖其他
  tracker/DHT，此项不能由 adapter 擅自改写。
- **请求复杂度/维护成本**：中等；需要第二次请求和安全的 torrent 元信息解析，超出纯 RSS adapter。
- **默认内置判断**：不建议；与 AnimeGarden/DMHY 高度重复且实现成本更高。
- **证据**：[ACG.RIP 官网](https://acg.rip/)、
  [公开关键词 RSS 示例](https://acg.rip/.xml?term=ANi)。

### 通用磁力站与镜像站群 — Avoid

- **内容与中文覆盖**：覆盖广但混杂，通常缺少可信分类、发布者与内容边界。
- **公开访问/登录**：域名、镜像和访问策略频繁变化，常见跳转、广告、Cloudflare 或验证码。
- **接口与 magnet**：多为不稳定 HTML，缺少官方 API、版本契约、限流政策和可核验维护者。
- **请求/维护成本**：很高，容易滑向 selector 追逐、镜像切换或反爬对抗。
- **默认内置判断**：不适合公开 GitHub 项目。不得研究或实现验证码、Cloudflare、登录或访问控制
  绕过，也不应把域名漂移作为运行时 fallback。

## 下一阶段建议

若项目决定继续，应严格一次只实现一个 adapter：

1. 先实现 **AnimeGardenAdapter**：直接调用公开 JSON API，固定本地 fixture，覆盖正常、空、字段
   缺失/畸形、429/503；按 infohash 与现有来源去重，不增加 `@animegarden/client` 依赖。
2. 稳定性观察后再实现 **AniBtAdapter**：优先公开 RSS 搜索，验证 magnet/infohash、语言/分类、
   429 HTML 与 `Retry-After`；初始建议默认关闭并标记 beta。

不建议同时实现两个，也不建议在 adapter 阶段加入来源镜像、登录信息、个人 RSS token 或反爬逻辑。
