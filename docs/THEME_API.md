# Mallok Theme API 契约

- 状态：Accepted for MVP
- Theme API：`0.1`
- 适用阶段：Phase 1B–3

本文是主题入口、页面上下文、资源引用和安全 HTML 组合行为的权威契约。Theme API 在 Mallok `1.0` 前仍标记为 experimental，但同一发布版本内不得静默改变。

## 1. 信任模型

主题是项目所有者安装的本地受信任 ESM 代码，不是可上传的第三方沙箱。文章正文、frontmatter、D1 字段和 URL 参数始终是不可信数据。

`runtime: "universal"` 主题必须同时能在 Node 构建进程与 Cloudflare Worker 中运行，因此不得：

- 导入 `node:*`、Wrangler 或 Cloudflare binding；
- 访问文件系统、网络、环境变量或全局可变状态；
- 读取 `Date.now()`、`new Date()`、`Math.random()` 或随机 UUID；
- 根据进程工作目录、locale 默认值或平台路径产生输出。

所有站点数据、时间和 URL 都由 context 显式传入。主题包本身仍是可信代码；Mallok 不承诺阻止恶意主题在构建阶段执行代码。

## 2. 目录与入口

默认主题目录：

```text
theme/
├── index.mjs
└── assets/
    ├── theme.css
    └── logo.svg
```

`theme.entry` 指向一个普通 ESM 文件，默认导出且只导出一个符合 `MallokTheme` 的对象。入口及其本地依赖必须位于主题目录内，不能通过 symlink、绝对路径或 `../` 逃逸。

`theme/assets/**` 只允许普通文件，不跟随 symlink，部署 URL 固定为 `/assets/theme/<relative-path>`。主题资产不能覆盖 `public` 文件或核心生成路由。

## 3. 公共 TypeScript 契约

以下类型由 `@mallok/core/theme` 导出：

```ts
export type PageRenderer<T> = (context: Readonly<T>) => SafeHtml | Promise<SafeHtml>;

export interface MallokTheme {
  readonly apiVersion: "0.1";
  readonly name: string;
  readonly runtime: "universal";
  readonly renderHome: PageRenderer<HomePageContext>;
  readonly articleTemplates: Readonly<Record<string, PageRenderer<ArticlePageContext>>>;
  readonly renderNotFound: PageRenderer<NotFoundPageContext>;
}

export interface SiteContext {
  readonly title: string;
  readonly description?: string;
  readonly url: string;       // 规范化后以 / 结尾的绝对 URL
  readonly language: string;  // canonical BCP 47
}

export interface PageHeadContext {
  readonly title: string;
  readonly description?: string;
  readonly canonicalUrl: string;
  readonly language: string;
  readonly robots: "index,follow" | "noindex,nofollow";
  readonly openGraph: Readonly<{
    type: "website" | "article";
    title: string;
    description?: string;
    url: string;
  }>;
  readonly jsonLd: Readonly<JsonValue>;
}

export interface ArticleSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description?: string;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly tags: readonly string[];
  readonly url: string;       // 站内绝对 path，以 / 结尾
}

// Opaque compile-time and runtime value; only AssetUrls can mint it.
declare const safeAssetUrlBrand: unique symbol;
export interface SafeAssetUrl {
  readonly [safeAssetUrlBrand]: true;
}

export interface AssetUrls {
  theme(relativePath: string): SafeAssetUrl;
  public(absolutePath: string): SafeAssetUrl;
}

export interface HomePageContext {
  readonly page: "home";
  readonly site: SiteContext;
  readonly head: PageHeadContext;
  readonly asOf: string;
  readonly articles: readonly ArticleSummary[]; // 最新 20 篇
  readonly assets: AssetUrls;
}

export interface ArticlePageContext {
  readonly page: "article";
  readonly site: SiteContext;
  readonly head: PageHeadContext;
  readonly asOf: string;
  readonly article: CompiledEntry;
  readonly url: string;
  readonly assets: AssetUrls;
}

export interface NotFoundPageContext {
  readonly page: "not-found";
  readonly site: SiteContext;
  readonly head: PageHeadContext;
  readonly asOf: string;
  readonly requestedPath: string; // 已解析、仍需作为普通文本转义
  readonly assets: AssetUrls;
}
```

全部 context 在交给主题前深度冻结。主题不得修改 context，也不得依赖对象 identity。Cloudflare 的 `ArticleSummary` 必须只由 metadata-only `PublishedSummary` 映射；首页/RSS 不得为了复用 article renderer 而读取 `sourceMarkdown`、`bodyHtml`、`data`、`template` 或 asset refs。static target 从内存中的 `CompiledEntry` 投影同一 summary shape，保证 DOM/feed 语义一致。

## 4. 模板选择

`articleTemplates` 必须：

- 至少包含 `article`；
- key 满足 `[a-z][a-z0-9-]{0,63}`；
- 每个 value 都是函数；
- 不使用原型继承的 key。

文章的 `template` 必须命中主题中的同名 renderer。未命中时 `validate/build/publish` 均返回 `THEME_TEMPLATE_NOT_FOUND`，不得静默回退到 `article`。这样拼写错误不会在静态与动态模式得到不同页面。

## 5. 完整文档责任

三个 renderer 都必须返回完整 HTML 文档，而不是 fragment：

1. 第一项是 `<!doctype html>`；
2. 只有一个 `<html lang="...">`、`<head>` 和 `<body>`；
3. `<meta charset="utf-8">` 位于 head 前 1024 bytes；
4. 包含 viewport、title、canonical、description（存在时）、Open Graph；
5. 文章页包含 `head.jsonLd` 生成的 Article JSON-LD；
6. 404 使用 `noindex,nofollow`；
7. 默认主题不得包含客户端脚本。

Core 生成 context、RSS 和 sitemap；主题负责 HTML 文档结构。Core 在构建或响应前执行文档级校验，缺少硬性字段时返回 `THEME_OUTPUT_INVALID`。

MVP 首页固定展示最多 20 篇文章，不提供公开分页路由。RSS 固定最多 50 篇，sitemap 包含全部当前可见文章。分页和 tag archive 是 P1，不应由主题私自发明 URL。

## 6. HTML 组合 API

主题只能通过受控 helper 组合 HTML：

```ts
html`<h1>${title}</h1>`;
html`<a ${urlAttribute("href", safeUrl(url))}>${label}</a>`;
jsonScript("article-jsonld", context.head.jsonLd);
externalScript(context.assets.public("/assets/app.js"), { type: "module" });
```

规则：

- 普通插值只作为文本并转义 `& < > " '`；
- 属性必须是完整的 `SafeAttribute` 插值，不能动态生成 tag/属性名；
- `SafeHtml`、`SafeAttribute`、`SafeUrl`、`SafeAssetUrl` 都有彼此独立的模块私有运行时身份，结构相同的对象不能伪造；`SafeHtml` 还携带不可由主题伪造或修改的内部 CSP contribution metadata；
- `attribute()` 拒绝 `on*`、`style`、`srcset`、`imagesrcset` 和未知危险属性；URL 属性只能用 `urlAttribute()`；
- `html` 静态片段中禁止 `<script`、`<style` 和 `<!--`（ASCII 大小写不敏感），以免简化 scanner 与浏览器 raw-text/comment 状态机产生偏差；
- JSON/JSON-LD 只用返回完整元素的 `jsonScript()`；外部脚本只用返回完整元素的 `externalScript(SafeAssetUrl, options)`。该 helper 只接受 `AssetUrls.theme/public` 对已存在 manifest entry mint 的 opaque `SafeAssetUrl`，不接受通用 `SafeUrl`、string、绝对远程 URL、query 或 fragment；options 只允许 `{type?: "module", defer?: true, async?: true}` 且 `defer`/`async` 不得同时出现。MVP 不支持 inline JavaScript 或 inline `<style>`；
- 未闭合 tag、comment、doctype 之外的 declaration、动态 tag、raw-text 或歧义属性状态统一抛 `HTML_CONTEXT_UNSAFE`；
- 输出必须在 HTML5 parser 重解析后仍满足相同的安全不变量。

`jsonScript()` 必须转义 `<`、`>`、`&`、U+2028 和 U+2029，并拒绝循环、稀疏数组、getter、Proxy 等非纯 JSON。它不能返回“半安全 JSON 字符串”。helper 把其生成的 script 起止标签之间的精确文本作为私有 CSP contribution 随 `SafeHtml` 保存；`html` 组合只合并这些受控 contribution。公开 API 不提供任意字符串注册 contribution/hash、读取/改写内部集合或伪造 contribution 的入口。SHA-256 必须使用异步 Web Crypto，因此不允许在同步 helper 中偷用 Node crypto 或手写同步 hash。

Node build 与 Worker 只能从 adapter 子路径消费最终值；该子路径不包含 mint API：

```ts
// @mallok/core/adapter
export interface SerializedSafeHtml {
  readonly html: string;
  readonly scriptHashSources: readonly string[]; // 每项已含单引号：'sha256-<base64>'
}

export function serializeSafeHtml(value: SafeHtml): Promise<Readonly<SerializedSafeHtml>>;
```

`serializeSafeHtml` 先验证运行时身份，再用 `TextEncoder` 取得每个精确 contribution 的 UTF-8 bytes，通过 `crypto.subtle.digest("SHA-256", ...)` 计算摘要，并编码为保留 `=` padding 的 RFC 4648 标准 Base64 source。返回值是新建、深度冻结的快照；`scriptHashSources` 已去重并按完整字符串稳定升序。它不接收字符串、额外 contribution/hash 或 header 片段。static writer `await` 后只使用 `html`；Cloudflare response builder 使用同一次结果中的 `html` 与 `scriptHashSources` 生成 CSP，禁止各自解析 HTML或二次序列化 script text。

## 7. URL 与资源

- `assets.theme("theme.css")` 生成 `/assets/theme/theme.css`；只接受已发现的主题资产；
- `assets.public("/favicon.svg")` 只接受绝对站内 path，并验证已出现在 public manifest；
- 两者返回专用 `SafeAssetUrl`，可用于 `urlAttribute()`；只有它能传给 `externalScript()`。通用 `safeUrl()` 不能升级或伪造该身份，因此远程/未部署脚本既不会绕过 manifest，也不会与 Cloudflare `script-src 'self'` 冲突；
- 资源 path 禁止 query、fragment、百分号、反斜杠、`.`/`..`、空段和控制字符；
- `safeUrl` 的通用协议规则见 [CONTENT_CONFIG.md](CONTENT_CONFIG.md)；图片发布层可更严格；
- 主题不能读取磁盘来判断资源是否存在，必须使用 context helper。

public 文件与核心生成 URL 冲突时构建失败；主题资产始终在命名空间下，不参与根路径覆盖。

## 8. SEO feed 契约

Core 不向主题开放 RSS/sitemap renderer，避免两个 target 漂移。两个 serializer 都输出 XML declaration `<?xml version="1.0" encoding="UTF-8"?>`、两空格缩进、LF 换行并以一个 LF 结尾；文本按 XML 1.0 转义 `& < >`，attribute 另转义 `" '`。配置/内容入口已经拒绝 XML 1.0 非法 scalar；serializer 仍须 fail closed，不能删除或替换非法字符。

### 8.1 `/rss.xml`

固定 RSS 2.0 结构与顺序：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>site.title</title>
    <link>canonical site URL</link>
    <description>site.description 或 site.title</description>
    <language>canonical BCP 47</language>
    <item>
      <title>article.title</title>
      <link>article canonical URL</link>
      <guid isPermaLink="true">article canonical URL</guid>
      <pubDate>Thu, 27 Aug 2026 09:30:00 GMT</pubDate>
      <description>article.description</description>
    </item>
  </channel>
</rss>
```

- 最多取当前可见排序的前 50 篇；不得再按 feed 自行排序；
- item 字段顺序固定为 `title, link, guid, pubDate?, description?`；缺 `publishedAt`/description 时分别完整省略对应元素；正文、tag、构建时间不进入 feed；
- `pubDate` 只从 canonical `publishedAt` 转为 RFC 822/1123 英文固定 weekday/month 和 `GMT`，格式严格为 `ddd, DD Mon YYYY HH:mm:ss GMT`；不能调用 locale-dependent formatter。

### 8.2 `/sitemap.xml`

固定 Sitemap XML 0.9 结构与顺序：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>canonical site URL</loc>
  </url>
  <url>
    <loc>article canonical URL</loc>
    <lastmod>2026-08-27T09:30:00.000Z</lastmod>
  </url>
</urlset>
```

- 首页固定第一项且不生成虚构 `lastmod`；随后是同一可见排序的全部文章，最多 10,000 篇，因此总 URL 最多 10,001；
- article 字段顺序固定为 `loc, lastmod?`；`lastmod` 优先 canonical `updatedAt`，其次 `publishedAt`，都没有就省略；
- 两个 target 对固定 site/entries/asOf 必须逐字节相同。生成器使用传入 `asOf` 做 selection，不读取系统时间；asOf 本身不写入 XML。

## 9. 加载与验证

主题验证依次执行：

1. 路径和 symlink 边界；
2. universal bundle 静态检查；
3. default export shape 与 `apiVersion`；
4. 模板 key；
5. 用固定最小 context 调用每个 renderer；
6. 验证返回值的运行时 `SafeHtml` 身份；
7. HTML5 重解析并验证文档结构；
8. Node 与 Worker 两个 bundle smoke。

加载异常映射为 `THEME_INVALID`，输出结构异常映射为 `THEME_OUTPUT_INVALID`。错误应指出主题入口或 template key，但不能泄露环境变量。

## 10. Golden fixture

`examples/basic-blog` 是跨运行时 golden fixture。固定 `asOf=2026-08-27T00:00:00.000Z` 时，static 与 Cloudflare-local 对首页、文章、404 的以下内容必须一致：

- `html[lang]`、title、canonical、description、Open Graph；
- 主导航链接；
- 文章标题、正文 DOM、日期与 tags；
- JSON-LD 的 canonical JSON；
- 主题/public 资源 URL。

比较前只规范化无语义空白和属性顺序；不得排除业务字段。HTTP-only 的 ETag、Cache-Control 与 request id 不属于 DOM fixture。
