# Mallok SEO 与性能

- 状态：0.1 基线（首次编写）
- 日期：2026-08-28
- 地位：定义核心内建的 SEO 输出、性能预算与它们的测量方式。**本文 §7 的数字是首次提出的验收门，需要产品负责人确认后才生效**（标记为「待确认」的条目尤其如此）。

## 1. 为什么这份文档存在

外贸 B2B 站的流量来自搜索。`PRODUCT_VISION §2` 把 Astro 定为「输出质量上的参照物」，意思是：**Mallok 页面的 HTML 质量必须能和一个精心配置的静态站打平**，否则「不用运维 + 不用构建」的价值主张会被「但它 SEO 不行」抵消。

同时 `PRODUCT_VISION §5.6` 承诺访客页面默认零客户端 JavaScript。这两件事互相成全：没有 JS 的页面天然容易拿高分。

## 2. 核心内建，不是插件

以下由核心提供，不依赖主题、不依赖插件（`PRODUCT_VISION §6`）：

| 输出 | 路径 / 位置 | 缓存 |
| --- | --- | --- |
| sitemap（含 hreflang） | `/sitemap.xml`（+ 分页 `/sitemap-<n>.xml`） | 边缘缓存 |
| RSS | `/feed.xml`、`/<locale>/feed.xml` | 边缘缓存 |
| robots | `/robots.txt` | 边缘缓存 |
| canonical | 每页 `<head>` | 随页面 |
| hreflang + x-default | 每页 `<head>` 与 sitemap | 随页面 |
| Open Graph / Twitter Card | 每页 `<head>` | 随页面 |
| JSON-LD | 每页 `<head>` | 随页面 |
| 重定向 | `redirect` 表，404 前查一次 | 命中后缓存 |

主题**必须**输出 `{{ page.head }}`（`THEME_FORMAT.md §7.1`）——核心生成的 hreflang 与 JSON-LD 都在里面。不输出它的主题过不了 §8 的验收。

## 3. sitemap

- 只含 `status = 'published'` 且 `published_at <= now` 的内容；
- 每个 URL 带该内容全部翻译版本的 `xhtml:link rel="alternate"`，含 `x-default` 指向默认语言（`ARCHITECTURE §9`）；
- 单文件上限 5000 条，超出分页为 `/sitemap-<n>.xml` 并输出 sitemap index（`DATA_MODEL §3` 已按 `LIMIT 5000` 规划）；
- `lastmod` 取 `updated_at`；
- **不含** `changefreq` 与 `priority`——搜索引擎已明确忽略它们，输出它们只是噪音；
- 草稿、定时未到期、`noindex` 的内容一概不进。

## 4. hreflang

规则来自 `ARCHITECTURE §9`：

- 默认语言无前缀（`/products/x`），其他语言前缀 `/<locale>/`（`/de/products/x`）；
- 每个页面输出它所在 `translation_group` 的全部语言版本；
- `x-default` 指向默认语言版本；
- **只有一个语言版本时不输出 hreflang**（当前实现 `src/worker/render.ts` 的 `headTags` 已按 `alts.length > 1` 处理）；
- **不做自动语言检测跳转**——`ARCHITECTURE §9` 明确列为不做，因为它对 SEO 有害且会让爬虫看到错误内容。

## 5. 结构化数据

0.1 输出四类（`PRODUCT_VISION §6`）：

| 类型 | 用在哪 | 来源 |
| --- | --- | --- |
| `Organization` | 首页 | `site.seo` 里的公司信息 |
| `Article` | `article` 类型的内容页 | 标题、发布/修改时间、语言、canonical |
| `Product` | `product` 类型的内容页 | frontmatter 的 `sku`、`specs`、图片、`category` |
| `FAQPage` | `faq` 类型的内容页 | frontmatter 的问答对 |

两条规则：

1. **JSON-LD 里的 `<` 必须转义成 `<`**，否则内容可以提前闭合 `<script>`。当前实现已这么做（`src/worker/render.ts` 的 `headTags`），这是安全要求不是风格。
2. 结构化数据只描述页面上**真实存在**的内容。不为了拿富媒体摘要而输出页面上没有的评分、价格或库存——那会招致人工处罚。

## 6. Open Graph 与图片

- `og:title`、`og:description`、`og:url`、`og:type`、`og:locale`、`og:site_name`；
- `og:image` 取内容的 `cover`，缺省取 `site.seo.default_og_image`；
- `twitter:card` 为 `summary_large_image`（有图时）；
- OG 图片走 R2 自定义域，内容寻址所以可以 `max-age=31536000, immutable`（`ARCHITECTURE §8`）。

**0.1 不做动态 OG 图生成**——那需要在 Worker 里画图，与「Worker 不做图片处理」冲突。

## 7. 性能预算（待确认）

> 以下数字是本文首次提出的，将成为 `ACCEPTANCE.md` 的验收门。**需要产品负责人确认。** 它们的依据是：官方主题零 JS、图片走 R2 直出、页面由边缘缓存返回。

| 预算项 | 门 | 依据 |
| --- | --- | --- |
| 官方主题客户端 JS | **0 B** | `PRODUCT_VISION §5.6`，已是承诺，非新增 |
| 唯一例外 | 询盘页的 Turnstile 脚本 | 同上，已是承诺 |
| 单页 HTML（未压缩） | ≤ 100 KB | 待确认 |
| CSS（gzip） | ≤ 24 KB | 待确认 |
| LCP 图片 | ≤ 200 KB | 待确认 |
| 每页图片请求数 | ≤ 20 | 待确认 |
| 字体 | Google Fonts，每主题至多 2 族、`display=swap`、给出系统回退栈；不自托管 | **已确认**（2026-08-29 设计评审：产品负责人通过带 Google Fonts 的四套主题设计稿） |

Lighthouse（移动端，自定义域，缓存命中）：

| 分类 | 门 |
| --- | --- |
| Performance | 中位 ≥ 95，单次 ≥ 90（待确认） |
| SEO | **每次 100**（待确认） |
| Accessibility | ≥ 95（待确认） |
| Best Practices | ≥ 95（待确认） |

**为什么 SEO 要求满分**：SEO 那一档检查的是 meta、canonical、hreflang、robots、链接文本这类确定性项目，全部由核心生成。拿不到 100 说明核心有 bug，不是环境波动。

## 8. 服务端性能

这些直接由架构决定，不是调优项：

| 指标 | 目标 | 来源 |
| --- | --- | --- |
| 缓存命中路径 CPU | < 1 ms | `ARCHITECTURE §4` |
| 冷渲染的 D1 调用 | 1 次 batch，查询数 ≤ 3 | `ARCHITECTURE §4` |
| 列表页行读 | `LIMIT n+1`，**永不 `COUNT(*)`** | `DATA_MODEL §3` |
| 列表页解析 Markdown | **永远不** | `ARCHITECTURE §4` |
| 内容保存到公开可见 | 数秒 | `PRODUCT_VISION §5.1` |

最后一条的实际延迟取决于清缓存方案（`ARCHITECTURE §6.2` 的 A/B 择一），**在 `TASK-01 §4.5` 实测出结论前不是既定事实**。

## 9. 图片输出

第一阶段渲染把相对路径替换为 R2 URL 时生成（`ARCHITECTURE §8`）：

```html
<img src="https://media.example.com/media/<sha>_960.webp"
     srcset="…480.webp 480w, …960.webp 960w, …1440.webp 1440w"
     sizes="(max-width: 768px) 100vw, 768px"
     width="1600" height="900"
     loading="lazy" decoding="async" alt="…">
```

- `width` / `height` 来自 `media` 表，**避免布局抖动**（CLS）；
- `loading="lazy"` 默认，但**首屏图（LCP 候选）应为 `eager`**——0.1 的规则：内容的 `cover` 与正文第一张图用 `eager`，其余 `lazy`；
- 外链图片原样输出，不代理、不下载（`ARCHITECTURE §8`），因此不受这些优化保护，后台应提示。

## 10. robots.txt

```
User-agent: *
Allow: /
Disallow: /_mallok/
Sitemap: https://example.com/sitemap.xml
```

- `/_mallok/*` 全部 `Disallow`；
- 未绑定自定义域时（`.workers.dev` 预览），**输出 `Disallow: /` 并在每页加 `noindex`**——预览地址被索引会造成重复内容，伤害正式域名；
- 草稿签名预览链接响应 `no-store` 且 `noindex`（`ARCHITECTURE §14`）。

## 11. 重定向

- 改 slug 时自动写一条 `redirect`（301），保证换 slug 不丢外链（`ARCHITECTURE §7`）；
- 改 `site.default_locale` 会重算全部 `path` 并批量写重定向，**这是需要明确确认的批量操作**（`DATA_MODEL §2.2`）；
- 404 前查一次 `redirect`（1 行读），命中则返回重定向并缓存。

## 12. 测量方式

| 项 | 工具 | 何时跑 |
| --- | --- | --- |
| Lighthouse | `@lhci/cli`，锁定版本，仅开发期 | 每个涉及主题或渲染的任务 |
| 无障碍 | `@axe-core/playwright` | 同上 |
| HTML / CSS 体积 | 构建脚本，对着 §7 的门断言 | 每次构建 |
| 结构化数据 | 快照测试 + schema.org 校验 | 单元测试 |
| sitemap / feed | XML 快照测试 | 单元测试 |
| 服务端 CPU | 真实账号的 Workers Logs | spike 与发布前 |

**Lighthouse 必须跑在自定义域且缓存已命中的状态下**——`.workers.dev` 无缓存，测出来的数字没有意义（`ARCHITECTURE §2`）。

## 13. 明确不做

- 不做动态 OG 图生成；
- 不做 AMP；
- 不自动生成 meta description（缺省时从正文派生摘要，这是派生不是生成）；
- 不做关键词 meta 标签（搜索引擎已忽略）；
- 不做自动语言检测跳转；
- 不在访客页面注入分析脚本——用 Cloudflare 站点级分析，它不需要客户端 JS（`PRODUCT_VISION §7`）；
- 不做 service worker 或预取。
