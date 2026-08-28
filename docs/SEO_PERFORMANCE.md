# Mallok 0.1 搜索与页面性能合同

- 状态：Accepted for 0.1
- 日期：2026-08-27
- 适用：三个官方模板、static export、Cloudflare public Worker

本文是 sitemap、technical SEO、公开页面资源预算和 PageSpeed/Lighthouse 验收的唯一权威。模板只负责视觉布局；compiler 负责本文件定义的 head、抓取文件、图片输出与确定性检查。

## 1. 术语与承诺边界

“符合 SEO 标准”不是一个由 Google 颁发的认证；sitemap、canonical、metadata 和结构正确也不保证抓取、收录、富结果或排名。Mallok 0.1 承诺的是**可自动验证的技术 SEO 合同**。

PageSpeed Insights 也是诊断工具，不是可一次性认证的 Web 标准。它同时展示 Lighthouse 实验室数据和 CrUX 真实用户数据，分数会随工具版本、设备和网络波动。Mallok 将自己的硬门称为 **Mallok PageSpeed Gate**，不宣传“任何站点永远 100 分”。

Mallok 能控制的是 compiler 生成的 HTML、CSS、抓取文件、受管图片和官方 Cloudflare runtime。搜索意图、内容质量、第三方链接、DNS、未知静态托管商和真实访问者网络不在输出保证内。

## 2. Origin 与索引模式

compiler 明确区分：

- `servingOrigin`：本次预览或公开响应实际使用的 origin；preview 可以是 loopback HTTP；
- `publicCanonicalOrigin`：公开页面 canonical 使用的 HTTPS origin；publish/static export 必填，preview 可选。

`publicCanonicalOrigin` 规范化后必须只有 `https` scheme、ASCII/punycode host、可选非默认 port，结尾一个 `/`，不得有 userinfo、额外 path、query 或 fragment，UTF-8 bytes 不超过 255。

规则：

- `publish` profile 没有合法 `publicCanonicalOrigin` 时编译失败；
- `preview` 永远输出 `noindex,nofollow`，并由 preview server 增加 `X-Robots-Tag: noindex, nofollow`；
- preview 只有在项目已经保存公开 origin 时才可指向该公开 canonical；永远不得把 `localhost`、`127.0.0.1` 或随机 preview port 写成 canonical；
- `/404.html` 输出 `noindex,nofollow`，不输出 canonical；
- 只有 status 200 的公开 HTML route 可索引。

## 3. Compiler-owned SEO head

模板源不得自行输出 title、description、canonical、robots、Open Graph 或 Twitter Card。compiler 在模板完成视觉渲染后向唯一 `<head>` 注入同一套 SEO projection，再进行 HTML5 重解析。模板切换不得改变 URL 集合或 SEO 语义。

每个公开 status 200 HTML route 必须恰有：

1. 一个 `<meta charset="utf-8">` 和一个 mobile viewport；charset 是 `<head>` 的第一个受管子节点，完整声明必须落在最终文档前 1024 bytes 内；
2. 正确的 canonical BCP 47 `html[lang]`；
3. 一个非空 `<title>`；
4. 一个非空、准确的 `<meta name="description">`；
5. 一个与 sitemap、内部链接完全一致的自引用 `<link rel="canonical">`；
6. `og:title`、`og:description`、`og:type`、`og:url`、`og:site_name`；有 cover 时再输出同源 absolute `og:image`；
7. `twitter:card`、`twitter:title`、`twitter:description`；有 cover 时为 `summary_large_image` 并输出 `twitter:image`，否则为 `summary`；
8. 可直接在初始 HTML 中抓取的正文和普通 `<a href>` 站内链接，不依赖客户端 JavaScript 生成核心内容。

确定性回退算法：

- document title：`seoTitle`，否则 `title`；当它与站点 title 不同，最终 `<title>` 为 `<document> — <site>`；
- 普通 page/article description：`seoDescription`，否则 `description`，否则正文第一个非空可见文本段落规范空白后截到 160 code point，最后回退为 `<title> — <site title>`；
- homepage 的标题为站点 title；description 依次使用 home page 的 `seoDescription`、home page `description`、站点 description、home page 首个可见文本段落，最后回退站点 title；
- article 的 `og:type` 为 `article`，其他页面为 `website`；
- cover 必须先经过 §5 的受管图片管线并具有 `coverAlt`；metadata URL 使用最终内容寻址 absolute URL，同时输出 `og:image:alt` 与 `twitter:image:alt`。

`70/170` code point 是 Mallok 编辑体验上限，不是 Google 官方排名规则。站内重复 title/description 是发布前 warning；缺少可生成的非空值、多个 canonical、canonical 与 route/origin 不一致、断裂内部链接或 metadata URL 不合法则阻断导出和发布。

0.1 不输出 JSON-LD，也不声称 Article rich-result eligibility。当前内容模型没有作者/发布主体，伪造这些字段比缺少结构化数据更糟。加入准确的作者/主体模型和 compiler-owned CSP/hash 方案后，JSON-LD 才能通过独立版本决策进入产品。

## 4. Sitemap 与 robots

### 4.1 URL 集合

`/sitemap.xml` 精确覆盖当前 bundle 中全部可索引 canonical HTML route：

- homepage；
- published 普通 page；
- published article。

必须排除 draft、preview、404、RSS、robots、sitemap 自身、sitemap shard 和 asset。每个 `<loc>` 都是同一 `publicCanonicalOrigin` 下的 absolute HTTPS URL，并与对应页面 canonical exact 相同。排序使用 absolute URL 的 Unicode code-unit 升序，XML 以 UTF-8、无 BOM、XML 1.0 合法字符和正确 entity escaping 确定性输出。

`urlset` 与 `sitemapindex` 必须使用 `http://www.sitemaps.org/schemas/sitemap/0.9` namespace。root 与 shard 响应均为 `200` 和 `application/xml; charset=utf-8`；`robots.txt` 为 `200` 和 `text/plain; charset=utf-8`。Cloudflare 模式由 Mallok 固定 status/header；未知 static host 的状态码、header 与压缩需要导出报告提醒并由托管方验证。

0.1 不输出 `changefreq`、`priority` 或 `lastmod`。它们都不是必填；当前模型不能在模板升级、首页聚合变化和外部 Markdown 编辑之间稳定证明真实语义修改时间，因此不能拿构建时间伪造 `lastmod`。

### 4.2 分片

Google 的协议上限是单 sitemap 50,000 URL 或 50 MB 未压缩；Mallok 还受单 route body 512 KiB 限制。serializer 使用 480 KiB 内部安全线：

1. 先按完整 absolute URL 排序；
2. 如果完整 `urlset` 不超过 480 KiB 且不超过 50,000 URL，直接写 `/sitemap.xml`；
3. 否则按顺序贪心分片为 `/sitemaps/0001.xml`、`0002.xml`……，加入下一条会越过 480 KiB 或 50,000 URL 时开启下一片；
4. `/sitemap.xml` 改为 `sitemapindex`，按 shard path 排序列出 absolute shard URL；
5. root index 和每个 shard 都必须独立满足 XML、bytes、URL 和 origin 约束；不得生成空 shard。

当前 1,900 content 上限远低于 Google URL 上限，但较长 origin 仍可能超过 Mallok 单 route body，因而分片是 0.1 正常路径，不是未来扩展。

### 4.3 robots

公开 `/robots.txt` 固定为：

```text
User-agent: *
Allow: /
Sitemap: https://example.com/sitemap.xml
```

最后一行使用实际 `publicCanonicalOrigin`，文件以 LF 结尾。robots.txt 不承担 noindex 或 canonical；preview/404 由 HTML/HTTP 明确 noindex。

## 5. 受管图片与性能闭包

“原样发布 25 MiB 图片”与 PageSpeed 目标冲突。0.1 因此把编译期图片优化纳入 P0，但不修改作者目录中的原文件。

发布规则：

- 公开内容只允许 `/media/...` 受管图片；Markdown 中的外部 HTTPS 图片在 source preview 只显示本地 placeholder 与警告，不发起远程请求；导出/发布前必须由用户主动下载并拖入 Mallok，0.1 不自动远程抓取，避免 SSRF、跟踪和不可控性能；
- 只把 published route 实际引用的 media 编入 bundle，未引用 media 不上传；
- 0.1 只发布静态 PNG、JPEG、WebP、AVIF 和单帧 GIF；动画 GIF/WebP/AVIF 拒绝并给出“改为静态图片”的修复动作；
- 每个源图片最多产生一个公开优化 asset，保持现有 1,000 asset 预算；作者原图仍留在项目和备份中，不进入公开 bundle；
- pipeline 先按 EXIF 自动定向、转换到 sRGB、移除 metadata，再保持比例、禁止放大；
- 第一次编码：fit inside `1920×1920`，WebP `quality=80`、`alphaQuality=90`、`effort=4`、`smartSubsample=true`；若超过 512 KiB，第二次使用 `1600×1600`/`quality=75`；仍超过时第三次使用 `1280×1280`/`quality=70`；仍超过 512 KiB 则阻断并要求裁剪或替换；
- encoder、libvips 和全部选项属于 compiler output contract；升级会改变 bytes 时必须提升 `compilerOutputVersion` 并重建 golden；
- HTML 使用最终输出的准确 `width`/`height`；每页最多一个首屏/LCP 候选使用 `loading="eager" fetchpriority="high" decoding="async"`，其他图片使用 `loading="lazy" decoding="async"`；不得用 CSS background 承载内容图片；
- 每个正文图片和 cover 必须有 1–300 code point 的可见语义 `alt`；0.1 不提供“装饰图片”内容节点，Logo 的 alt 固定回退站点 title，模板装饰只能用不发请求的 CSS；
- cover/OG 图片和正文使用同一内容寻址 asset，不另存无界副本。

完整多宽度 `srcset`、art direction、手工 crop、动画优化和在线媒体库进入 P1；它们不能以绕过本节 byte gate 的方式半实现。

## 6. 官方模板资源预算

三个官方模板的 publish profile 必须同时满足：

- 客户端 JavaScript `0 B`；
- remote script/style/font `0`，第三方网络请求 `0`；
- 使用 system font stack，不下载 Web Font；
- 每页只引用一个 compiler 合并后的同源、内容寻址 CSS asset；其 gzip bytes 不超过 32 KiB；
- 首屏/LCP 受管图片不超过 200 KiB；没有图片时不生成占位请求；
- 每个公开 HTML body 的原始 UTF-8 bytes 不超过 256 KiB；
- 普通站点发布时的确定性 critical budget 定义为 `raw HTML bytes + gzip CSS bytes + eager image bytes`，总计不超过 500 KiB；它是保守的产品预算，不冒充浏览器实际传输测量；
- CSS budget 使用锁定 compiler toolchain 的 deterministic gzip profile（level 9、mtime 0）计算；改变 compressor 或输出 bytes 必须显式重建基线；
- 官方性能 fixture 在 cold cache、mobile viewport、不滚动、`load` 后等待 2 秒的初始传输量不超过 500 KiB；harness 对 navigation 与 resource timing 的 `transferSize` 求和并保存原始记录；
- 图片预留固有尺寸，不产生已知图片布局偏移；
- LCP 资源可从初始 HTML 发现，不 lazy-load，最多一个 `fetchpriority=high`；
- page、feed 和 immutable asset 使用 `CLOUDFLARE.md` 冻结的缓存与 MIME/nosniff 策略。

这些是 Mallok 产品预算，不是 Google 强制数字。用户正文长度仍受 route bytes 上限；输出超过预算时 Studio 必须指出具体页面/资源和自动或人工修复动作。

## 7. 验证协议

### 7.1 确定性 technical SEO

Task 02 对三模板的 home、page、article 和 404 fixture 验证：

- HTML5 parse 后 head 数量/值、charset byte offset、lang、status、noindex 和普通链接；
- canonical 集合与 sitemap URL 集合 exact 相等；
- robots 指向可解析的 root sitemap；
- XML parser、namespace、escaping、排序、bytes、50,000/50,001 和 480 KiB 分片边界；
- 最大合法 origin、1,900 content、特殊 XML 字符、draft、duplicate metadata 和 broken link；
- 同输入、工具链、template 和 `asOf` 产生相同 HTML/XML/body hash。

### 7.2 Mallok PageSpeed Gate

对三个官方模板分别使用固定 publish fixture 的 home、page、article：

1. 锁定 Chrome、Lighthouse、操作系统、CPU、server/header adapter 和 mobile 配置；
2. 每页依次执行 5 次 cold run，禁止同机并发；
3. Performance 5 次中位数必须 `≥95`，任一次不得 `<90`；
4. Accessibility 和 Best Practices 每次 `≥95`；
5. SEO 每次 `=100`；结构化数据不计入该分数，也不是 0.1 承诺；
6. 保存 45 份原始报告、代表性中位报告、工具版本、benchmark index、环境与 candidate SHA；升级 Lighthouse/Chrome 后显式重建基线，不能与旧版本直接混算。

### 7.3 公网 PageSpeed 与 Core Web Vitals

Task 05 在真实 Cloudflare staging 为每个官方模板至少测试 homepage 和 article。release runner 使用 PageSpeed Insights API v5 的 release CI key，固定 `strategy=mobile` 和 Performance/Accessibility/Best Practices/SEO categories，每 URL 顺序运行 3 次；中位 Performance `≥90`，其他类别沿用上述门。key 不进入日志、证据或发行物；证据保存去除 key 的 request 参数、完整 response、调用时间、工具/API version 与 candidate SHA。PSI 结果与本地 Lighthouse 分开保存，不挑最好一次；API/网络不可用时保持 `NOT_RUN` 并重试，不能伪造通过。

CrUX 查询不从 PSI mobile strategy 推断设备数据。release runner 使用 Google Cloud 中启用 Chrome UX Report API 的专用 API key，通过 `POST /v1/records:queryRecord` 对每个代表性 `url` 和其 `origin` 分别查询 `PHONE`、`DESKTOP`，只请求 `largest_contentful_paint`、`interaction_to_next_paint`、`cumulative_layout_shift`。API key 只进入 release CI secret，不进入 URL 日志、证据或发行物；证据保存 request body（不含 key）、response key、collectionPeriod、percentiles、HTTP 结果和 candidate SHA。

CrUX 可能因新站或细分样本不足返回无 record；每个 URL/origin × form factor 独立记录 `FIELD_DATA_UNAVAILABLE`，不判发布失败，也不把 origin 数据冒充 URL 数据。有足够数据后按 URL 与 origin、phone 与 desktop 分开报告第 75 百分位：

- LCP `≤2.5s`；
- INP `≤200ms`；
- CLS `≤0.1`。

field data 是发布后运营指标，不由一次实验室分数替代；实验室高分也不能证明真实用户一定达标。

## 8. 失败、警告与用户文案

阻断单个站点的导出/发布：canonical/sitemap/robots 集合不一致、无效 XML/HTML、broken internal route、draft 泄露、缺失/空图片 alt、外部内容图片、动画图片、受管图片无法进入 512 KiB、JS/远程脚本样式字体或确定性 CSS/首屏资源预算超限。

Mallok PageSpeed Gate 只阻断 Mallok 里程碑或官方 release candidate，不在每次普通用户发布时现场运行 Lighthouse/PSI，也不能把模板/runtime 的 gate 失败冒充成用户内容错误。普通发布只执行确定性的 HTML、资源与预算检查；Task 02 运行固定本地 Lighthouse，Task 05 对同一候选 SHA 运行真实 staging PSI/CrUX 边界检查。

只警告：站内重复 title/description、内容质量过短、外部普通链接不可离线验证、未知静态托管商的压缩/缓存/404 状态。warning 必须说明 Mallok 已验证什么、未验证什么；不得把“SEO 100”说成收录或排名保证。

稳定 code 至少包括：

| code | level | 用户动作 |
| --- | --- | --- |
| `SEO_PUBLIC_ORIGIN_REQUIRED` | error | 在导出/发布页确认公开地址 |
| `SEO_CANONICAL_MISMATCH` | error | 修复冲突 URL；不得继续输出两套 canonical |
| `SEO_INTERNAL_LINK_BROKEN` | error | 打开具体内容并选择存在的页面 |
| `SEO_METADATA_DUPLICATE` | warning | 打开列出的页面改写 title/description |
| `SITEMAP_CONTRACT_INVALID` | error | compiler bug；保留旧导出/线上版本并导出诊断 |
| `MEDIA_EXTERNAL_IMAGE_NOT_PUBLISHABLE` | error | 下载后拖入 Mallok，换成受管图片 |
| `MEDIA_ANIMATION_UNSUPPORTED` | error | 换成静态 PNG/JPEG/WebP/AVIF/GIF |
| `MEDIA_ALT_REQUIRED` | error | 为正文图片或 cover 填写准确替代文本 |
| `MEDIA_OPTIMIZED_BYTES_EXCEEDED` | error | 裁剪或替换图片 |
| `PAGE_PERFORMANCE_BUDGET_EXCEEDED` | error | 按页面与资源清单处理超限项 |
| `PAGESPEED_GATE_FAILED` | release blocker | 不是普通用户内容错误；修复模板/runtime 后重跑全部样本 |

0.1 自动生成 sitemap 和 robots，但不代用户连接 Google Search Console 或提交站点所有权；这属于后续引导能力。

## 9. 官方依据

- Google sitemap 的 UTF-8、absolute canonical URL、50,000 URL/50 MB 与提交边界：[Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- canonical 是信号而非强制结果：[Canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- title 与 description 应准确、清楚且页面唯一，但没有固定官方字符数：[SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- robots.txt sitemap 使用 absolute URL：[Robots.txt specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)
- PSI 的 lab/field 区分、`90+` good 区间和 CrUX 缺失语义：[About PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about)
- PSI API v5 的 `runPagespeed`、strategy/category 与自动化 API key：[PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started)
- Core Web Vitals 的 LCP/INP/CLS 与第 75 百分位门：[Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- CrUX API 的 URL/origin、`PHONE|DESKTOP` form factor、API key 与 p75 response：[CrUX API](https://developer.chrome.com/docs/crux/api/)
- Lighthouse 分数会波动，5 次中位数比单次稳定：[Lighthouse variability](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md)
- 图片尺寸、LCP priority 与 Google 图片抓取建议：[Optimize CLS](https://web.dev/articles/optimize-cls)、[Optimize LCP](https://web.dev/articles/optimize-lcp)、[Image SEO best practices](https://developers.google.com/search/docs/appearance/google-images)
- 图片 alt 与装饰图空 alt 的语义边界：[W3C WAI Images Tutorial](https://www.w3.org/WAI/tutorials/images/)
- sharp 的自动定向、resize 和 WebP 参数由官方 API 提供：[Image operations](https://sharp.pixelplumbing.com/api-operation/)、[Resizing images](https://sharp.pixelplumbing.com/api-resize/)、[Output options](https://sharp.pixelplumbing.com/api-output/)
