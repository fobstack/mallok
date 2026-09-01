# Mallok 主题格式

- 状态：0.1 基线（2026-08-29 修订：主题从「zip 上传、运行时安装」改为「源码目录、构建期打包」）
- 日期：2026-08-29
- 地位：本文是主题的**唯一契约**。第三方主题与官方主题用同一套机制，没有只有官方能用的私有接口（`PRODUCT_VISION §5.10`）。契约之外的字段一律不保证。

## 1. 一句话定义

**主题是源码目录里的一个文件夹：一份 `theme.json`、若干 Liquid 模板、若干语言包、一个样式表。它不含任何可执行代码，在构建期打进 Worker 产物。**

主题决定三件事：网站长什么样、支持哪些内容类型、开放哪些配置项。它不决定内容存什么，也不能改变内容的 `id`。

**换主题要改源码并重新部署**（`PRODUCT_VISION §4`）。主题开放的配置项则是运行时设置，后台随时可改、即时生效——主题决定有哪些旋钮，运营决定旋钮拧到哪。

## 2. 安全定位

主题是**半可信**的（`ARCHITECTURE §14`）。它不能执行代码、不能访问网络、不能读文件系统，但它能输出 HTML，**而且它进入你的构建产物**。因此：

- 模板引擎的转义规则是安全边界的一部分，不是排版细节；
- 装一个陌生主题不等于在自己站上跑陌生人的代码，但**审阅一个主题和审阅任何一段进仓库的代码是一回事**；
- 一个恶意主题仍然可以输出误导性的 HTML（比如伪造的登录框）。这道关卡在代码评审，不在运行时。

## 3. 目录结构

主题住在仓库里，一个目录一个主题：

```text
src/themes/trade/
├── theme.json              # 必需
├── index.ts                # 必需：把下面的文件作为文本模块导出，见 §3.1
├── layouts/
│   ├── base.liquid         # 约定的外壳，非必需但强烈建议
│   ├── home.liquid         # 必需（theme.json 的 home 指向它）
│   ├── page.liquid         # 必需（page 是内建类型，且是降级布局）
│   ├── article.liquid
│   ├── product.liquid
│   ├── category.liquid
│   └── list.liquid
├── partials/               # 可选，被 {% render %} 引用
│   ├── header.liquid
│   ├── footer.liquid
│   └── language-switcher.liquid
├── locales/
│   ├── en.json             # 必需：theme.json 的 defaultLocale 对应的文件
│   └── zh.json
└── assets/
    └── style.css           # 可选，多文件时按需引用
```

硬规则（**全部在构建期校验，不通过就构建失败**）：

1. 目录名等于 `theme.json` 的 `id`。
2. 只接受这几类路径：`theme.json`、`index.ts`、`layouts/*.liquid`、`partials/*.liquid`、`locales/*.json`、`assets/**`。
3. `assets/` 下的扩展名限于能安全直出的一组：`css`、`woff2`、`woff`、`png`、`jpg`、`jpeg`、`webp`、`gif`、`ico`、`txt`。**`svg` 不接受**，理由与上传媒体一致（`SECURITY.md §6`）：它能携带脚本。
4. `layouts/` 与 `partials/` 的文件名限 `[a-z0-9-]+`。
5. `home` 指向的布局、每个 kind 的 `layout` 与 `listLayout`、`locales` 里声明的每个语言包，都必须真实存在。
6. 每个主题必须有 `page` kind——它是类型降级的兜底（§5.3）。

### 3.1 `index.ts`

模板和语言包以文本模块的形式导出，由 wrangler 的 `rules` 配置（`**/*.liquid`、`**/*.json` 按 `Text` 处理）打进产物：

```ts
import { parseThemeManifest, type ThemeFiles } from '../../core/index.js';
import baseLiquid from './layouts/base.liquid';
// …
import manifestJson from './theme.json';

export const manifest = parseThemeManifest(manifestJson);

export const files: ThemeFiles = {
  'layouts/base.liquid': baseLiquid,
  // …
};
```

`src/themes/index.ts` 汇总所有主题并导出当前生效的那一个。**这里就是「换主题」的那一行改动。**

### 3.2 `assets/`

构建脚本（`scripts/build-themes.mjs`）把 `src/themes/<id>/assets/**` 复制到 Static Assets 目录下的 `theme/<id>/<version>/`，公开路径即 `/theme/<id>/<version>/style.css`。

- 路径带 `version`，所以可以永久缓存；
- Static Assets 请求免费且不计入 Worker 调用（`TECH_STACK §6`）；
- **主题资源既不进 D1，也不进 R2。**

**缓存头必须显式设置。** Static Assets 的默认响应头是 `Cache-Control: public, max-age=0, must-revalidate`（2026-08-29 在 `wrangler dev` 实测），要覆盖它得在资源目录里放一个 `_headers` 文件，由构建脚本生成：

```
/theme/*
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
```

两条注意：`_headers` 只作用于 Static Assets 直出的响应，**不作用于 Worker 生成的响应**；新增或修改 `_headers` 需要重启 `wrangler dev` 才会被读到。

## 4. `theme.json`

权威 schema 是 `src/core/theme.ts` 的 `themeManifestSchema`。本节是它的说明与 0.1 的扩展。

```jsonc
{
  "id": "trade",                        // [a-z][a-z0-9-]*，安装 id，包目录名必须与之相同
  "name": "Trade",
  "version": "1.0.0",                   // 严格 x.y.z
  "description": "B2B trade site.",
  "home": "layouts/home.liquid",        // 首页布局

  "kinds": { /* §5 */ },
  "options": { /* §6 */ },

  "locales": ["en", "zh", "de"],        // locales/<locale>.json 必须都存在
  "defaultLocale": "en",                // 必须在 locales 里
  "imageWidths": [480, 960, 1440, 1920],// 升序；主题可收窄，不可新增核心不生成的宽度
  "clientScripts": []                   // 见 §9
}
```

### 4.1 校验时机

构建期用 zod 校验整个 manifest，**任何一条不通过就构建失败**。`locales` 里声明的语言包缺文件、`home` 指向不存在的布局、`kinds` 的 `layout` 指向不存在的布局，都属于校验失败。

这样做的好处是：错误在开发者的终端上出现，而不是在运营点「上传」之后。

## 5. `kinds`：内容类型声明

核心只内建 `page` 与 `article`（`docs/CONVENTIONS.md` 产品边界）。其余类型由主题声明。

```jsonc
"kinds": {
  "page":    { "layout": "layouts/page.liquid", "label": "Page" },
  "article": {
    "layout": "layouts/article.liquid",
    "listLayout": "layouts/list.liquid",
    "label": "Article",
    "base": "news"
  },
  "product": {
    "layout": "layouts/product.liquid",
    "listLayout": "layouts/list.liquid",
    "label": "Product",
    "base": "products",
    "fields": { /* §5.2 */ }
  }
}
```

| 键 | 必需 | 含义 |
| --- | --- | --- |
| `layout` | 是 | 单条内容的布局，`layouts/<name>.liquid` |
| `listLayout` | 否 | 该类型的分页列表布局。缺省则该类型没有列表页，访问列表路径返回 404 |
| `label` | 否 | 后台显示名，缺省用 kind 名 |
| `base` | 否 | 公开 URL 的基础段。`page` 恒为空（`/about`），其余缺省用 kind 名 |
| `fields` | 否 | 该类型的 frontmatter 字段 schema，**0.1 新增** |

### 5.1 `base` 与 URL

`base` 只是**默认值**。站点的实际基础段存在 `site.kinds`（`DATA_MODEL §2.1`），由向导或后台设置。这样换主题不会改变已有内容的 URL——`PRODUCT_VISION §5.7` 要求换主题「默认不改变公开 URL」。

路径计算见 `src/core/paths.ts` 的 `buildPublicPath`：非默认语言加 `/<locale>` 前缀，`page` 不加 base，其余加 base。

### 5.2 `fields`：字段 schema

后台据此自动生成表单（`ADMIN.md`），CLI 据此校验导入（`CONTENT_FORMAT §3.2`）。**主题作者不写任何后台代码。**

```jsonc
"fields": {
  "sku":       { "type": "string",   "label": "SKU" },
  "category":  { "type": "reference","label": "Category", "kind": "category" },
  "specs":     { "type": "keyvalue", "label": "Specifications" },
  "gallery":   { "type": "image[]",  "label": "Gallery", "max": 12 },
  "datasheet": { "type": "file",     "label": "Datasheet", "accept": ["pdf"] },
  "moq":       { "type": "number",   "label": "MOQ", "min": 1 },
  "lead_time": { "type": "string",   "label": "Lead time" }
}
```

支持的 `type`：

| type | 存进 frontmatter 的形态 | 后台控件 | 备注 |
| --- | --- | --- | --- |
| `string` | 字符串 | 单行输入 | `max` 限长 |
| `text` | 字符串 | 多行输入 | 不走 Markdown 管线 |
| `number` | 数字 | 数字输入 | `min` / `max` |
| `boolean` | 布尔 | 开关 | |
| `date` | ISO 8601 字符串 | 日期选择 | |
| `select` | 字符串 | 下拉 | 必须给 `choices` |
| `string[]` | 字符串数组 | 标签输入 | |
| `color` | `#rrggbb` | 取色器 | |
| `image` | **相对路径**字符串 | 媒体选择 | 必须是 `images/…`，见 `CONTENT_FORMAT §4` |
| `image[]` | 相对路径数组 | 媒体多选 | `max` 限数量 |
| `file` | **相对路径**字符串 | 文件选择 | 必须是 `files/…`，`accept` 限扩展名 |
| `keyvalue` | `{k: v}` 对象 | 键值表 | 值一律按字符串处理 |
| `reference` | 目标内容的 **slug** 字符串 | 内容选择 | 必须给 `kind`；用 slug 而非 id，导出后仍可读 |
| `reference[]` | slug 数组 | 内容多选 | |

通用可选键：`label`、`required`（默认 `false`）、`help`、`default`、`group`（后台表单分组名）。

三条硬规则：

1. **未在 `fields` 中声明的 frontmatter 字段原样保留，不报错、不丢弃**（`CONTENT_FORMAT §3.2`）。换主题不能丢数据。
2. `image` / `image[]` / `file` 的值**只能是相对路径**，绝不能是 R2 URL。相对路径在第一阶段渲染时才解析（`ARCHITECTURE §8`）。
3. `reference` 用 slug，不用 `id`。理由：导出的 `index.md` 要能被 Astro/Hugo 直接读懂，一串 UUID 不满足「不锁定」。

### 5.3 换主题时的类型降级

切到不支持某类型的主题时（`ARCHITECTURE §7`）：

- 该类型的内容用 `kinds.page.layout` 渲染；
- `site.kinds` 中该类型的 `base` 保持不变，**URL 不变**；
- 后台在内容列表上标出「当前主题不支持此类型」；
- 内容、`id`、`frontmatter` 一概不动。

因此 **`page` 布局是每个主题的必需项**——它是降级路径的兜底。

## 6. `options`：主题配置项

```jsonc
"options": {
  "accent":            { "type": "color",   "label": "Accent color", "default": "#1d4ed8" },
  "show_reading_time": { "type": "boolean", "label": "Show reading time", "default": true },
  "products_per_page": { "type": "number",  "label": "Products per page", "default": 24 }
}
```

`type` 取值：`string` / `text` / `number` / `boolean` / `color` / `select`（与 `src/core/theme.ts` 的 `themeOptionSchema` 一致）。`select` 必须给 `choices`。

用户设置的值存 `site.theme_options`，模板通过 `theme.options.<key>` 读取；未设置时用 `default`。换主题时旧主题的 options **保留在 D1 里但不再生效**，换回来时恢复。

## 7. 视图契约

模板能看到的**全部**数据由 `src/core/page.ts` 的 `PageView` 定义。不存在「拿到整个数据库」的途径。属性名用 `snake_case`，因为这是 Shopify/Jekyll 主题作者熟悉的 Liquid 惯例（`CONTRIBUTING.md` 的两个 camelCase 例外之一）。

### 7.1 每个页面都有

```liquid
{{ site.name }}            {{ site.tagline }}
{{ site.locale }}          {{ site.default_locale }}
{{ site.locales }}         {# 数组 #}
{{ site.base_url }}        {# https://example.com，无尾斜杠 #}
{{ site.home_path }}       {# / 或 /de/ #}
{% for item in site.nav %}{{ item.label }} {{ item.href }} {{ item.active }}{% endfor %}

{{ page.title }}           {{ page.description }}
{{ page.canonical }}       {{ page.kind }}        {# home | content | list #}
{{ page.locale }}
{% for alt in page.alternates %}{{ alt.locale }} {{ alt.href }}{% endfor %}
{{ page.head }}            {# 核心生成的 hreflang 与 JSON-LD，必须放进 <head> #}

{{ theme.id }}             {{ theme.version }}
{{ theme.options.accent }}
{{ theme.asset_base }}     {# 本主题该版本的 R2 资源前缀，无尾斜杠 #}

{{ t.read_more }}          {# 语言包字符串 #}
```

**`page.head` 是强制项**：核心在这里输出 `hreflang`（含 `x-default`）与 JSON-LD。`base.liquid` 不输出它，站点的多语言 SEO 就是坏的。`SEO_PERFORMANCE.md` 会把它列为验收项。

样式表这样引：

```liquid
<link rel="stylesheet" href="{{ theme.asset_base }}/style.css">
```

`asset_base` 形如 `/theme/trade/1.2.0`。它带主题版本，所以指向的文件可以永久缓存；改了资源就要提 `theme.json` 的 `version`（§13）。

### 7.2 内容页额外有 `content`

```liquid
{{ content.id }}        {{ content.kind }}      {{ content.locale }}
{{ content.slug }}      {{ content.path }}
{{ content.title }}     {{ content.description }}
{{ content.published_at }} {{ content.updated_at }}
{{ content.html }}      {# 净化后的正文片段，唯一可以原样输出的富文本 #}
{{ content.excerpt }}   {{ content.reading_time }}
{% for h in content.headings %}{{ h.depth }} {{ h.text }}{% endfor %}
{% for tr in content.translations %}{{ tr.locale }} {{ tr.href }}{% endfor %}
{{ content.frontmatter.sku }}      {# 类型专属字段从这里读 #}
{{ content.cover }}                {# 封面图 URL，缺图时为空串 #}
```

### 7.3 列表页额外有 `list`

```liquid
{{ list.kind }}  {{ list.page }}  {{ list.has_next }}
{{ list.next_path }}  {{ list.prev_path }}    {# 空串表示没有 #}
{% for item in list.items %}{{ item.title }} {{ item.path }} {{ item.description }}{% endfor %}
```

`list.items` 的元素是 `ContentSummaryView`——**只有标量字段与 `frontmatter`，没有 `html`**。这是硬约束：`ARCHITECTURE §4` 要求「列表页永远不解析正文 Markdown」。想在列表上显示正文摘要，用 `item.description`。

### 7.4 首页额外有 `recent`

```liquid
{% for item in recent.article %}…{% endfor %}
{% for item in recent.product %}…{% endfor %}
```

按 kind 分组的有界最近内容，每组 `LIMIT ≤ 12`（`DATA_MODEL §3`）。

### 7.5 图片、文件与关联内容（2026-08-29 新增，Task 09）

前置事实：**frontmatter 里的图片和文件是相对路径，不是 URL**（`CONTENT_FORMAT §4`）。正文里的相对路径由第一阶段渲染解析，frontmatter 里的不会——所以核心额外给出两张已解析的表：

```liquid
{% assign shot = content.images[content.frontmatter.gallery[0]] %}
<img src="{{ shot.url }}" srcset="{{ shot.srcset }}" width="{{ shot.width }}" height="{{ shot.height }}" alt="{{ shot.alt }}">

<a href="{{ content.files[content.frontmatter.datasheet] }}" download>…</a>
```

- `content.images[<相对路径>]` → `{ url, srcset, width, height, alt }`。`url` 与 `srcset` 与正文里同一张图完全一致（同一套变体、同一个域名）；`width` / `height` 一并给出，因为主题必须能预留版位（`SEO_PERFORMANCE §9` 的 CLS 要求）。
- `content.files[<相对路径>]` → 非图片资源的 URL（数据表、图纸）。
- `content.cover` / `item.cover` 是封面图 URL，缺图时为空串；列表页的封面在**一次**查询里批量解析，不随条数增长。
- 路径查不到时该键不存在，模板用 `{% if %}` 跳过即可——缺图是正常状态，不是错误（`CONTENT_FORMAT §4`）。

关联内容由主题的 `reference` 字段声明决定，核心不认识任何具体类型：

```liquid
{{ content.refs.category.title }}                {# 本条指向的分类 #}
{% for item in content.backrefs.product %}…{% endfor %}   {# 指向本条的产品 #}
{% for item in content.siblings %}…{% endfor %}  {# 同类型的最近内容，不含自己 #}
```

| 组 | 来自 | 上限 |
| --- | --- | --- |
| `content.refs.<字段>` | 本类型声明的 `reference` 字段，解析成目标条目 | 每字段 1 条 |
| `content.backrefs.<类型>` | **别的**类型声明了指向本类型的 `reference` 字段，反向取回 | 24 条 |
| `content.siblings` | 本类型的最近内容，排除自己；仅当本类型有 `listLayout` | 6 条 |

三组恒定存在（没有内容时为空），模板不必先判空。只取**已发布、同语言、发布时间已到**的内容。指向不存在或未发布的目标时该 `ref` 键不存在。

> 换句话说：产品页上的「所属系列」和系列页上的「本系列产品」是**同一条 `reference` 声明**的两个方向，主题只写一次。核心里没有 `category` 这个词（`ARCHITECTURE §11`）。

### 7.6 FAQ 问答对

`faq` 类型的 frontmatter 键 `faq` 由核心归一化后给到模板：

```liquid
{% for pair in content.faq %}<h3>{{ pair.question }}</h3><p>{{ pair.answer }}</p>{% endfor %}
```

接受两种写法——后台 `keyvalue` 控件产出的映射 `{问: 答}`，以及手写 Markdown 常用的列表 `- question: … / answer: …`。**核心管这一个字段，是因为同一批问答同时要生成 `FAQPage` 结构化数据**（`SEO_PERFORMANCE §5`）；模板必须把它们渲染出来，否则结构化数据描述了页面上不存在的内容。

### 7.6 语言切换器

`page.alternates` 的每一项现在带 `name`——**该语言对自己的称呼**（`中文`，不是 `Chinese` 也不是 `zh`）。找自己语言的读者是在扫自己语言的名字；用他读不懂的语言写出来，切换器就白做了。

名字来自各语言包里的 `language_name` 键；缺省回落到语言代码。核心读的是**全部**语言包而不只是当前这个，因为切换器必须叫得出读者当前不在的那些语言。

官方主题把它做成 `<details>` 下拉：

- **纯 CSS，零脚本**——`<select>` 要靠 JS 才能跳转，不符合零客户端 JS；
- **可扩展**——两种语言排一行还行，八种就不行了；
- 与移动菜单不同，这里不需要在断点处强制展开，所以 `<details>` 是对的元素（移动菜单必须用 checkbox，原因见 `tasks/TASK-09.md §4`）；
- 只有一种语言时整个控件不渲染。

### 7.6.1 配置项是站点级的，语言包才是分语言的

**主题配置项（`theme.json` 的 `options`）每个只有一个值，不分语言。** 站点开了两种语言时，任何面向读者的文案放进配置项都必然有一种语言是错的。

规则：

- **面向读者的文字进语言包**（`locales/<locale>.json`），模板用 `{{ t.xxx }}`；
- **配置项只放与语言无关的东西**：颜色、开关、链接、数量、外部 ID。

`atelier` 2.2.0 因此把 `quote_label` 与 `case_cta_label` 从配置项移进了语言包。

**但纯语言包解决不了另一半**：首页的标题、导语、数字、能力带、CTA 全是配置项——它们是**这个站的文案**，不是主题的通用词汇，不该写进主题的语言包。双语站的中文首页顶着英文大标题，是最重要的一页坏掉。

所以 `site.theme_options` 里保留一个键 `$locales`，放各语言的覆盖值：

```json
{
  "hero_title": "Titanium, delivered to specification.",
  "quote_href": "/contact",
  "$locales": {
    "zh": { "hero_title": "按规格交付的钛材。", "quote_href": "/zh/lianxi" }
  }
}
```

取值顺序：**该语言的覆盖 → 站点级的值 → `theme.json` 里的默认值**。`$locales` 不会和配置项撞名，因为配置项名受 `^[a-z][a-z0-9_]*$` 约束。后台的外观页对每个文本类配置项按启用的语言各给一个输入框。

### 7.7 分页

列表页大小由核心固定（0.1 为 20），主题不能改。分页不做 `COUNT(*)`，用 `LIMIT n+1` 判断 `has_next`（`DATA_MODEL §3`）——所以模板拿不到总页数，只能拿到「有没有下一页」。这是刻意的：总数会让行读随内容量线性增长。

## 8. 受限 Liquid

引擎是 `liquidjs`，配置见 `src/core/liquid.ts`。

### 8.1 转义规则

**所有 `{{ }}` 输出默认 HTML 转义。** `raw` 过滤器被重写：它只放行核心标记为安全的 `SafeHtml`（净化后的正文片段、`page.head`、`theme.css`），对普通字符串**仍然转义**。因此主题作者无法通过 `{{ user_input | raw }}` 制造 XSS。

可以原样输出的只有两个：`content.html` 与 `page.head`。样式表不再作为字符串进入视图——它是 R2 上的一个文件，用 `theme.asset_base` 引用（§11）。

### 8.2 可用与不可用

| 可用 | 不可用 |
| --- | --- |
| `{% if %}` `{% unless %}` `{% case %}` | 任意 JavaScript 求值 |
| `{% for %}`（带 `limit` / `offset` / `reversed`） | 网络访问、`fs`、`import` |
| `{% assign %}` `{% capture %}` | 原型链访问（`ownPropertyOnly: true`） |
| `{% render %}` `{% include %}`（仅限本主题文件） | 未知过滤器（`strictFilters: true`，用了就报错） |
| `{% layout %}`（仅限本主题文件） | 从文件系统加载模板（引擎由内存映射支撑） |
| liquidjs 内置过滤器 | 注册自定义过滤器 |

`{% render %}` / `{% include %}` / `{% layout %}` 只能引用**本主题自己**的文件，因为引擎背后是一张内存里的模板表，没有文件系统。引用不存在的路径抛出明确错误。

### 8.3 确定性

`date` 过滤器被固定为 `timezoneOffset: 0`、`locale: 'en-US'`。理由：`ARCHITECTURE §5` 要求「同一份 Markdown、同一个管线版本加同一个主题版本，必须渲染出逐字节相同的 HTML」。主题里**不得**出现「现在几点」这类输出——没有 `now` 变量，也不要用 `date` 过滤器格式化当前时间。

### 8.4 资源限制

`parseLimit: 1e6`、`memoryLimit: 5e7`。超限抛错。模板本身的 CPU 开销计入访客请求，受 Free 计划 10 ms 约束——所以别在模板里写 `{% for %}` 嵌套三层。

## 9. `clientScripts`

主题声明它输出的客户端 JavaScript。**官方主题恒为 `[]`**（`PRODUCT_VISION §5.6`）。

```jsonc
"clientScripts": [
  { "path": "assets/gallery.js", "purpose": "Product image gallery", "bytes": 1840 }
]
```

声明了就必须在后台的主题详情页如实展示「本主题会向访客页面注入 N 个脚本，共 X KB」。**未声明却在模板里写 `<script>` 的主题，安装时拒绝**——安装器扫描模板中的 `<script` 与 `on*=` 属性，发现未声明的就报错。这是「默认零客户端 JavaScript」这条承诺可执行的部分。

移动端导航、图集这类交互，官方主题用纯 CSS 实现（`:target`、`checkbox` hack）。

## 10. 语言包

`locales/<locale>.json` 是一层扁平的字符串映射：

```json
{
  "read_more": "Read more",
  "published_on": "Published on",
  "article": "News",
  "product": "Products"
}
```

- 模板用 `{{ t.read_more }}` 读取。
- 查找顺序见 `src/core/theme.ts` 的 `themeStrings`：先取 `defaultLocale` 的全部，再用当前 locale 的覆盖。**缺 key 回退到主题默认语言，不报错、不显示 key 名。**
- 列表页标题按 `t[kind]` 取，缺失时用 `kinds[kind].label`，再缺用 kind 名本身。
- 不支持插值与复数形式。需要拼接的地方由模板自己 `{% capture %}`。0.1 刻意不引入 i18n 库。

## 11. `assets/` 与静态资源

见 §3.2。要点重复一次，因为它决定了模板怎么写：

```liquid
<link rel="stylesheet" href="{{ theme.asset_base }}/style.css">
```

`theme.asset_base` 形如 `/theme/trade/1.2.0`，带版本，因此指向的文件可以永久缓存。直出时带 `X-Content-Type-Options: nosniff`，Content-Type 只从 §3 第 3 条的白名单里取。

Task 01 曾把样式表内联进每个页面，该捷径已移除。是否额外保留「首屏关键 CSS 内联」由 `SEO_PERFORMANCE.md` 决定，目前不做。

## 12. 换主题怎么换

```sh
# 1. 把主题目录放进 src/themes/
# 2. 在 src/themes/index.ts 里改一行，指向新主题
# 3. 提交并部署
pnpm build && npx wrangler deploy
```

**换主题不改变**：内容 `id`、`translation_group`、`site.kinds` 的 base、已有 URL、`redirect` 表、媒体。

**换主题会改变**：页面长相；以及——如果新主题不认识某个内容类型——那类内容改用 `page` 布局渲染（§5.3），URL 仍然不变。

部署完成后建议清一次边缘缓存（`site` 标签），否则访客会继续看到旧主题渲染的页面直到 `cache_ttl` 过期。未配置 `CF_API_TOKEN` 时清不了，这是已知的降级模式（`CLOUDFLARE_RESOURCES §6`）。

旧主题的 `theme_options` 仍留在 `site.theme_options` 里但不再生效，换回来时恢复。

## 13. 版本与兼容

- `version` 用 x.y.z。它出现在资源 URL 里，所以改主题资源时必须一并提版本，否则访客拿到的是缓存里的旧文件。
- 本文定义的契约有自己的版本号 `themeApi`，0.1 为 `1`。`theme.json` 可选声明 `"themeApi": 1`；缺省视为 `1`。将来契约不兼容变更时，**构建期**据此报错并给出明确提示，不做静默降级。
- 视图契约（§7）只增不减：0.1 之后新增字段是兼容变更，删改字段是破坏性变更，必须提 `themeApi`。

## 14. 官方主题

> **2026-08-29 修订**：本节原先写「0.1 交付两个：`trade` 与 `journal`」。设计评审后实际交付五个（产品负责人 2026-08-29 通过设计稿），外贸垂直那一个定名 **`atelier`** 而不是 `trade`——它就是原计划里 `trade` 的位置，改的是名字不是定位。下表是现状。

| id | 定位 | kinds |
| --- | --- | --- |
| `atelier` | 外贸 B2B 企业站，**0.1 的验收对象**（原计划中的 `trade`） | `page`、`article`、`product`、`category`、`case`、`faq` |
| `journal` | 资讯 / 博客，当前的 `ACTIVE_THEME` | `page`、`article` |
| `gazette` | 编辑部风格的资讯站 | `page`、`article` |
| `manual` | 手册 / 知识库 | `page`、`article` |
| `folio` | 作品集 | `page`、`article`、`project` |

全部：0 B 客户端 JS、`clientScripts: []`、至少 `en` 与 `zh` 语言包、通过 `SEO_PERFORMANCE.md` 的性能与 SEO 门。

`atelier` 额外满足外贸站的三条：

- **移动导航与图集都是纯 CSS**——导航用 checkbox 披露（不是 `<details>`：关闭的 `<details>` 由 UA 行为隐藏内容，CSS 的 `display` 覆盖不了，宽屏上会把导航一起藏掉），图集用 scroll-snap 加锚点圆点；
- **询盘表单有样式位**：官方插件在第二阶段注入的 `.mallok-inquiry` 由主题样式表接管，不会看起来像外挂的（`PLUGIN_API §11`）；
- **`product` ↔ `category` 用一条 `reference` 声明双向打通**（§7.5），`case` 可以指向它用到的 `product`。

## 15. 明确不做

- **不做运行时安装**：没有 zip 上传、没有在线安装、没有后台的主题管理界面。主题是源码；
- 主题里不允许任何形式的代码执行，包括 `eval`、动态 `import`、注册过滤器；
- 不支持主题继承 / 父子主题；
- 不支持主题自带数据表或路由（那是插件的能力，见 `PLUGIN_API.md`）；
- 不支持主题在运行时拉取远程资源；
- 不引入第二个模板引擎（`TECH_STACK §12`）；
- 不做主题的可视化编辑器（0.1 只有 `theme.json` 声明的 options 表单）；
- 不做主题市场运行时（1.0 的方向，届时的形态是源码模板的集市，不是在线安装）。
