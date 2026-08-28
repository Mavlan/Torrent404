# Movies / TV / Games / Software 搜索来源调查

核验日期：2026-08-29

## 结论

本轮没有找到一个同时满足“中文商业影视覆盖好、公开匿名、稳定结构化接口、直接 magnet/infohash、
低维护、适合公开 GitHub 项目默认内置”的来源。宽覆盖索引在技术上往往容易接入，但版权、恶意内容
和项目声誉风险明显；低风险来源则以公共领域、开放授权和开源项目为主，覆盖范围更窄。

按“稳定、简单、公开、低维护优先”给出的分类结论是：

| 分类 | Recommended | Possible | Avoid |
| --- | --- | --- | --- |
| Movies / TV | Internet Archive | 无第二个候选 | Public Domain Torrents、Knaben、EZTV |
| Games | FOSS Torrents | Internet Archive | Knaben、OpenGames（不是 Torrent 来源） |
| Software | FOSS Torrents | Internet Archive | Knaben |

Movies/TV 没有为了凑数量推荐第二个来源。Internet Archive 支持 Unicode/中文标题查询，但其优势是
公共领域和档案内容，不是主流中文院线电影或当季中文剧集；因此产品的“主流中文 Movies/TV”缺口
仍然存在。

## v0.1 Recommended Provider Set

如果 v0.1 只新增最少数量 provider，建议只评审以下两个，并继续坚持一次实现一个 adapter：

1. **Internet Archive**：优先填补 Movies/TV 的合法档案内容，同时补充历史 Games/Software；公开
   Advanced Search JSON 支持中文标题和字段过滤，带 `btih` 的结果可直接生成 magnet。
2. **FOSS Torrents**：填补 Games/Software，内容边界明确为自由开源项目；公开 RSS 分离 game、
   software 与 torrent feed，结果直达 `.torrent` 文件。

这套组合故意不追求商业内容覆盖率。它以两个来源覆盖三个空白分类，和现有 YTS/Nyaa 重复较少，
也是本轮唯一适合作为公开项目默认内置起点的组合。默认启用前仍应保留来源开关、展示来源归属，
并对 Internet Archive 结果应用 `format:"Archive BitTorrent"` 及可用的 rights/license 过滤；本文不构成
法律意见。

## 方法与安全边界

- 只查阅候选官网、官方接口说明、公开 RSS/JSON/HTML 和普通匿名 HTTP 响应。
- 未注册账户、未使用 API key/token、未访问私人 tracker，也未尝试 Cloudflare/CAPTCHA、登录、
  访问控制或镜像轮换绕过。
- 未实现 scraper、未下载候选结果指向的内容，也未验证任何商业内容的可下载性。
- 从本项目环境各做一次低频匿名探测。Internet Archive Advanced Search、Knaben v1、FOSS Torrents
  torrent RSS 和 EZTV beta API 均返回 HTTP 200；Public Domain Torrents 与 OpenGames 文档页也可
  匿名访问且未出现 challenge。这只是 2026-08-29 的单点结果，不代表 SLA。
- 中文搜索只记录命中数量和结构，不记录或下载结果内容。Internet Archive 查询 `三国演义` 得到
  9 个候选，抽样 5 个均带 `btih`；Knaben 查询 `三体` 得到 109 个候选，抽样 5 个均带 hash 和
  magnet。命中不等于标题准确、内容安全或版权状态可靠。
- 评级是面向“公开 GitHub 桌面客户端默认内置”的综合判断，不等同于接口好坏。

主要证据：Internet Archive 的 Advanced Search 可输出 JSON/XML/CSV/RSS，并支持 title 等字段查询；
其官方帮助说明 Archive Torrents 用于分发公开集合，且可用 `format:"Archive BitTorrent"` 收窄结果。
[Internet Archive 搜索说明](https://archivesupport.zendesk.com/hc/en-us/articles/360018359991-Search-A-Basic-Guide)、
[Archive BitTorrents](https://archivesupport.zendesk.com/hc/en-us/articles/360004715251-Archive-BitTorrents)。
FOSS Torrents 官方页面说明其目标是分发自由开源项目，并公开独立 Games、Software 与 torrent RSS。
[FOSS Torrents 首页](https://fosstorrents.com/)、
[RSS feeds](https://fosstorrents.com/feed/)。

---

## Movies / TV

### Internet Archive — Recommended

- **实际覆盖分类**：公共领域/开放集合电影、经典电视、新闻、用户贡献视频；也有独立 software
  collection。不是主流商业片库。
- **中文关键词质量**：Advanced Search 原生接受 Unicode，`title:(三国演义)` 匿名探测有命中且
  抽样均带 `btih`。中文 metadata 的完整度取决于上传者，召回和去重质量中等。
- **访问与凭据**：搜索和公开 item 匿名访问，不要求账户或 API key。
- **接口**：稳定使用多年的 Advanced Search；支持 JSON、XML、CSV、RSS，以及 Lucene 风格字段、
  Boolean、分页和排序。排序分页最多返回前 10,000 条，深分页另有 cursor search。
- **magnet/infohash/详情页**：部分 Advanced Search 文档直接带 `btih`，可不访问详情页构造 magnet；
  无 `btih` 的 item 不能假定存在 torrent，需丢弃或后续查询 item files，不能伪造。
- **分类/filter**：`mediatype`、`collection`、`subject`、`language`、`rights`、`licenseurl`、`format` 等
  metadata 字段可组合；应限定 `format:"Archive BitTorrent"`。
- **schema、限流与错误**：搜索接口公开且成熟；文档说明 10,000 排序分页边界，但没有面向本项目的
  SLA 或完整 429/错误契约，adapter 仍需超时、退避和 schema 防御。
- **反爬与当前可达性**：本次普通 JSON GET 为 200，无 CAPTCHA/Cloudflare challenge。
- **实现/维护成本**：低到中。单次 JSON search 可产出 title、identifier、mediatype、btih；主要工作
  是权限/格式过滤、缺失字段和多值 metadata 规范化。
- **与 YTS/Nyaa 重复**：低。侧重档案/公共集合，与 YTS 商业电影、Nyaa 动漫的定位不同。
- **默认内置与风险**：本轮唯一可推荐的 Movies/TV 默认候选。Internet Archive 的机构声誉和公开
  集合定位降低风险，但 community upload 不等于每项权利状态都已核验；应展示来源、过滤 license，
  并提供禁用开关。使用名称/标识时遵循其品牌规则，不暗示合作关系。
- **证据**：[Item Search APIs](https://doc-tools.readthedocs.io/en/ia-test-gsod/item-search-apis.html)、
  [字段查询说明](https://archivesupport.zendesk.com/hc/en-us/articles/360043648052-Search-Building-powerful-complex-queries)、
  [Archive BitTorrents](https://archivesupport.zendesk.com/hc/en-us/articles/360004715251-Archive-BitTorrents)。

### Public Domain Torrents — Avoid

- **实际覆盖分类**：经典电影、B 级片、serials，按动作、动画、喜剧、剧情、武侠等老式类型分类；
  TV/Series 能力很弱。
- **中文关键词质量**：目录和 metadata 基本为英文，没有面向中文别名或语言的结构化字段；不能可靠
  解决中文标题直搜。
- **访问与凭据**：浏览和下载匿名；评分/评论才要求注册。
- **接口**：遗留 HTML 目录与 tracker search，没有公开 JSON/RSS search schema。
- **magnet/infohash/详情页**：通常需要进入 movie/detail 页面取得 `.torrent`；列表不稳定提供
  magnet/infohash。
- **分类/filter**：有固定电影类型，但无现代分页、语言、年份、license 或 TV season filter。
- **schema、限流与错误**：没有版本化 schema、限流说明或结构化错误；HTML 和多子域链接是维护面。
- **反爬与当前可达性**：本次匿名首页为 200、无 challenge；部分旧目录链接返回 404，暴露长期维护
  风险。
- **实现/维护成本**：中高。必须解析旧 HTML、跟进详情页并处理失效链接，不符合低维护优先级。
- **与 YTS/Nyaa 重复**：与 YTS 在电影类别上有少量重复，但片库年代和公共领域定位不同。
- **默认内置与风险**：站点自称内容“believed to be in the public domain”，并记录过误判后下架，
  权利判断仍有不确定性；陈旧页面、广告/外链和品牌观感不适合 v0.1 默认来源。
- **证据**：[Public Domain Torrents](https://www.publicdomaintorrents.info/site2/)、
  [当前目录/声明](https://files.publicdomaintorrents.com/)。

### Knaben Database — Avoid

- **实际覆盖分类**：聚合 Movies、TV、PC Games、PC/Mac/Unix Software 等大量公开索引。
- **中文关键词质量**：Unicode title query 可用；`三体` 单点探测有 109 条命中，抽样 5 条均带 hash/
  magnet，但聚合结果的标题准确性、恶意内容和版权状态并无来源级保证。
- **访问与凭据**：v1 POST JSON 可匿名调用，不要求账户或 API key。
- **接口**：版本化 JSON v1，支持 title query、排序、分页、分类、时间、隐藏成人内容和
  `hide_unsafe`。
- **magnet/infohash/详情页**：命中可直接提供 `hash`、`magnetUrl`、size、seeders、peers、category；
  不必访问详情页，个别聚合记录可能缺 hash。
- **分类/filter**：分类 ID 完整覆盖 Movies/TV/Games/Software，技术适配性很强。
- **schema、限流与错误**：接口版本和字段公开，最大 page size 300；官方页没有给出正式限流、429、
  Retry-After、错误 schema 或 SLA。
- **反爬与当前可达性**：本次普通 POST 为 200，无 CAPTCHA/challenge。
- **实现/维护成本**：低。Node 原生 fetch + JSON validation 即可；来源差异和 unsafe 策略需额外测试。
- **与 YTS/Nyaa 重复**：高。作为聚合数据库会重新带入已有电影/动漫索引和大量相同 infohash。
- **默认内置与风险**：不适合。官方示例直接显示 The Pirate Bay proxy、1337x 等聚合来源；默认内置
  会把涌流404与高争议商业内容索引绑定，并增加恶意软件、版权、商标和项目下架风险。即使未来做
  用户显式 opt-in，也应独立法律评审，不能默认启用。
- **证据**：[Knaben API v1](https://knaben.org/api/v1/)、
  [分类目录](https://knaben.org/browse/0/1/title)。

### EZTV — Avoid

- **实际覆盖分类**：国际 TV episode/pack，基本不覆盖 Movies、Games、Software。
- **中文关键词质量**：公开 beta API 只支持 page、limit 和 IMDb ID，没有关键词参数；中文标题不能
  直接查询。网页搜索不应被当作稳定 API 契约。
- **访问与凭据**：API 匿名且明确不要求 login/API key。
- **接口**：JSON beta endpoint；IMDb lookup 适合已有规范化 IMDb ID 的调用方，不适合当前纯关键词
  SearchProvider。
- **magnet/infohash/详情页**：响应直接给 hash、magnet URL、torrent URL、season/episode、seed/
  peer，不需要详情页。
- **分类/filter**：仅 TV，API 过滤能力只有 IMDb ID 与分页；没有语言、中文别名或细分类型。
- **schema、限流与错误**：标记为 beta，limit/page 范围有文档；没有版本号、正式限流、Retry-After
  或结构化错误契约。
- **反爬与当前可达性**：本次 API GET 为 200，无 challenge。
- **实现/维护成本**：若已有 IMDb resolver 则低；当前需要另加中文标题 → IMDb metadata 路径，超出
  provider adapter 边界且引入新故障面。
- **与 YTS/Nyaa 重复**：与 YTS 类别不同，与 Nyaa 的少量动画 TV 有重叠。
- **默认内置与风险**：不能解决中文关键词需求，且商业剧集索引带来显著版权/声誉风险，不推荐。
- **证据**：[EZTV 官方 beta API](https://eztvx.to/api/)。

**Movies/TV 最终推荐：仅 Internet Archive。** 不推荐用 Knaben/EZTV 换取覆盖率，也不把
Public Domain Torrents 当成第二个名额。

---

## Games

### FOSS Torrents — Recommended

- **实际覆盖分类**：自由开源 PC 游戏、游戏引擎及 Windows/macOS/Linux 构建；不是商业游戏索引。
- **中文关键词质量**：项目标题和描述以英文为主，中文别名搜索较弱；但对国际开源游戏名称搜索稳定。
- **访问与凭据**：公开匿名，无账户或 API key 要求。
- **接口**：标准 RSS 2.0；官方分别提供 Games RSS、Software RSS、master RSS 和供 torrent client
  使用的 torrent feed。站内 keyword search 为 HTML，没有公开 JSON search API。
- **magnet/infohash/详情页**：torrent feed 的 item `link` 直达 `.torrent` 文件，不需要详情页；feed
  不直接给 btih，adapter 需要安全下载并解析 torrent metadata 后生成统一 magnet/infohash。
- **分类/filter**：独立 Games feed/目录，页面还有 genre/category；RSS 层主要按 feed 分类，复杂
  keyword/filter 需本地筛选或轻量 HTML search。
- **schema、限流与错误**：RSS 2.0 结构简单，feed 声明 TTL 30 分钟；没有版本化 API、429 或结构化
  error contract，应缓存并低频刷新。
- **反爬与当前可达性**：本次 torrent RSS 为 200，共 1,029 个 item，无 challenge。
- **实现/维护成本**：中。RSS 易解析且 torrent URL 直接，但需要已有 torrent metadata parser；若做
  在线 keyword search，HTML 会提高维护成本，建议 adapter 以缓存 feed + 本地匹配起步。
- **与 YTS/Nyaa 重复**：很低；现有来源不覆盖开源 PC games。
- **默认内置与风险**：适合。站点明确以分发自由开源项目为目标，法律和项目声誉风险显著低于通用
  torrent index；仍需保留上游项目 license/来源信息，避免暗示官方合作。
- **证据**：[FOSS Torrents Games](https://fosstorrents.com/games/)、
  [RSS feeds](https://fosstorrents.com/feed/)、
  [项目目标](https://fosstorrents.com/)。

### Internet Archive — Possible

- **实际覆盖分类**：Software Library、历史 PC/console games、shareware、emulation collections；
  适合保存/研究用途，不是当代商业 PC Games 搜索。
- **中文关键词质量**：Unicode metadata query 可用，但中文游戏别名覆盖依赖上传者，质量中低。
- **访问、接口、magnet、限流与反爬**：同 Movies/TV 评估；可匿名 JSON 搜索，带 `btih` 的结果不需
  详情页，本次 200 且无 challenge。
- **分类/filter**：可用 `mediatype:software`、collection、subject、platform、language、format、
  license 字段收窄；collection taxonomy 不等同产品 Games 分类，需要维护 allowlist。
- **实现/维护成本**：中。复用一个 InternetArchiveAdapter 即可，但 Games 分类映射和 rights 筛选
  需要 fixture 证明。
- **与 YTS/Nyaa 重复**：低。
- **默认内置与风险**：可作为同一个 Internet Archive provider 的附加 Games 能力，不建议为它再建
  第二 adapter。历史软件权利状态可能复杂，必须按 collection/license 过滤。
- **证据**：[Internet Archive Search API](https://doc-tools.readthedocs.io/en/ia-test-gsod/item-search-apis.html)、
  [Archive BitTorrents](https://archivesupport.zendesk.com/hc/en-us/articles/360004715251-Archive-BitTorrents)。

### Knaben Database — Avoid

- **覆盖和中文搜索**：PC/console Games 分类齐全，Unicode query 和直接 magnet 技术表现好。
- **访问/接口/详情/限流/反爬**：同 Movies/TV 评估；匿名 versioned JSON，无详情页，本次 200；没有
  正式限流/error contract。
- **实现/维护成本**：低，但恶意可执行文件风险高于纯视频；`hide_unsafe` 只是上游启发式评分，不能
  代替来源信任、签名或恶意软件扫描。
- **与 YTS/Nyaa 重复**：分类重复较低，infohash 层仍可能重复。
- **默认内置与风险**：商业游戏和破解软件带来最高等级的安全、版权、商标与仓库声誉风险；不适合
  默认内置。
- **证据**：[Knaben API v1](https://knaben.org/api/v1/)、
  [Knaben categories](https://knaben.org/browse/0/1/title)。

### OpenGames API — Avoid（作为 Torrent provider）

- **实际覆盖分类**：2,000+ 开源游戏目录，可按 genre、platform、programming language、engine 等
  浏览；内容本身低风险。
- **中文关键词质量**：full-text search 支持 Unicode 请求，但目录 title/description 主要为英文，
  没有中文别名保证。
- **访问与凭据**：免费公开 REST API，不要求鉴权。
- **接口/schema/error**：JSON 契约完整，100 requests/minute；明确 200/400/404/429/500 和结构化
  error，是本轮最清晰的 API 之一。
- **magnet/infohash/详情页**：不提供 torrent、magnet 或 infohash；结果是 GitHub repo/homepage/
  release metadata。
- **反爬与当前可达性**：官方文档匿名 200，无 challenge。
- **实现/维护成本**：作为游戏目录低；要变成 Torrent provider 则必须再寻找、验证和映射第三方
  下载来源，违反本阶段的来源边界。
- **与 YTS/Nyaa 重复**：无。
- **默认内置与风险**：法律/声誉风险低，但它不满足 `SearchResult` 的可下载 torrent 条件，不能
  冒充 provider 或构造虚假 magnet；可留作未来 metadata discovery，当前评级 Avoid。
- **证据**：[OpenGames 官方 API](https://www.open-source-games.com/api)。

**Games 最终推荐：FOSS Torrents；Internet Archive 作为同一跨分类 provider 的补充，不新增独立
实现名额。**

---

## Software

### FOSS Torrents — Recommended

- **实际覆盖分类**：Windows/macOS/Linux/BSD 等自由开源软件与发行版，版本和平台通常写入 title。
- **中文关键词质量**：主要按国际项目名搜索；中文本地化名称覆盖弱，但软件类用户通常可用产品名。
- **访问、接口、magnet、分类**：匿名 RSS/HTML；独立 Software RSS 和 torrent feed，item 直达
  `.torrent`，不需详情页但需解析 torrent 才能得到 infohash。
- **schema、限流/error、反爬**：标准 RSS、30 分钟 TTL，没有正式错误契约；本次 200，无 challenge。
- **实现/维护成本**：中；与 Games 共用一个 FOSS Torrents adapter 和 feed parser 即可。
- **与 YTS/Nyaa 重复**：无。
- **默认内置与风险**：适合。开放源码内容边界清晰，恶意/版权风险显著低于通用软件 torrent 索引；
  adapter 仍应显示原项目名、版本、平台和 FOSS Torrents 来源。
- **证据**：[FOSS Torrents Software search](https://fosstorrents.com/search/)、
  [RSS feeds](https://fosstorrents.com/feed/)、
  [项目目标](https://fosstorrents.com/)。

### Internet Archive — Possible

- **实际覆盖分类**：历史 software、shareware、操作系统镜像、计算机杂志附盘和 emulated software；
  不适合替代官方渠道获取当前日常软件。
- **中文关键词质量**：支持中文 metadata query，但历史软件的中文 title/language 字段不一致。
- **访问、接口、magnet、限流与反爬**：同前；匿名 JSON，部分结果直带 `btih`，本次 200，无 challenge。
- **分类/filter**：`mediatype:software` 加 collection/subject/platform/language/license/format；需要严格
  collection allowlist，避免把任意 user upload 当安全软件。
- **实现/维护成本**：中；可复用推荐的 Internet Archive provider，不应另建抓取路径。
- **与 YTS/Nyaa 重复**：无。
- **默认内置与风险**：适合作为档案类补充，不适合作为“安全软件下载站”。历史保存、可运行和可再
  分发是三件不同的事；UI 应提示来源，不能替代签名/哈希/官方发布验证。
- **证据**：[Internet Archive Search API](https://doc-tools.readthedocs.io/en/ia-test-gsod/item-search-apis.html)、
  [字段搜索](https://archivesupport.zendesk.com/hc/en-us/articles/360043648052-Search-Building-powerful-complex-queries)。

### Knaben Database — Avoid

- **实际覆盖分类**：PC、Mac、Unix software 等分类广，中文/英文关键词均可被索引。
- **访问、接口、magnet、分类、限流、反爬**：同前；匿名 v1 JSON、直接 hash/magnet、分类完整、本次
  200；没有正式限流/error contract。
- **实现/维护成本**：低，但通用聚合器的来源信任和结果安全治理成本极高。
- **与 YTS/Nyaa 重复**：类别重复低；聚合来源层可能重复。
- **默认内置与风险**：不适合。未知发布者的 Windows/macOS 可执行文件是恶意软件高风险入口；
  `hide_unsafe` 不足以把通用破解/商业软件索引变为可公开项目默认推荐的软件源。版权、商标、恶意
  软件和供应链声誉风险均高。
- **证据**：[Knaben API v1](https://knaben.org/api/v1/)、
  [Knaben categories](https://knaben.org/browse/0/1/title)。

**Software 最终推荐：FOSS Torrents；Internet Archive 仅作为历史档案补充。** 没有推荐任何通用
商业软件/破解软件索引。

## 后续 adapter 决策门

本轮只调查，不授权实现。若后续进入 adapter 阶段，应按以下顺序逐个评审：

1. **InternetArchiveProvider**：先限定 Movies/TV + `format:"Archive BitTorrent"`，仅接受存在合法
   40-hex btih 的结果；用中文标题、空结果、多值 metadata、缺失 btih 和 malformed JSON fixture。
2. **FossTorrentsProvider**：先用 Games/Software RSS fixture + `.torrent` Buffer fixture 验证；遵守
   feed TTL，不实时抓全站，不把 HTML search 作为首版硬依赖。

任何实现都必须继续复用 `SearchProvider → ProviderRegistry → SearchAggregator`，保持可禁用，且不得
为扩大商业内容覆盖而加入登录、镜像轮换、Cloudflare/CAPTCHA 绕过或第三方泄露 API key。
