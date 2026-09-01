# Mallok 内容格式：文章包与导入导出契约

- 状态：0.1 基线
- 日期：2026-08-28
- 地位：本文定义 D1 里的内容「长什么样」以及它进出 Mallok 的唯一格式。这是「不锁定」承诺的可执行部分，任何实现不得引入本文之外的私有结构。

## 1. 一句话定义

**一条内容的全部翻译版本、正文引用的图片与附件，构成一个普通文件夹——文章包。D1 里存的就是文章包里 `index.md` 的原文；导出就是把文章包原样放回磁盘。**

## 2. 文章包

```text
titanium-price-2026-08/          # 包名，默认等于默认语言的 slug
├── index.md                     # 默认语言版本
├── index.en.md                  # 其他语言版本，文件名带 locale
├── index.de.md
├── images/                      # 图片，各语言版本共享
│   ├── hero.jpg
│   └── chart.png
├── files/                       # 非图片附件（产品手册 PDF 等），各语言版本共享
│   └── datasheet.pdf
└── mallok.json                  # 可选：Mallok 写出的身份信息，见 §6
```

规则：

1. 一个文章包对应一个 `translation_group`；每个 `index[.<locale>].md` 对应一条 `content` 行，各自有独立的 Markdown、状态、slug 与 URL。
2. `index.md` 的语言是站点默认语言；显式写 `index.<locale>.md` 时以文件名为准。frontmatter 里的 `locale` 字段可以覆盖文件名，两者冲突时导入报错。
3. `images/` 与 `files/` 在同一包内共享，不同语言版本可以引用同一张图。
4. 包名只是磁盘上的目录名，不是身份。身份在 `mallok.json`（若有）或由导入时分配。
5. 只有一个语言版本、没有图片的内容，可以退化为单个 `slug.md` 文件（见 §7.2），Mallok 导出时仍然输出完整文章包。

## 3. `index.md`

标准 Markdown（CommonMark + GFM）加一段 YAML frontmatter。**D1 的 `content.markdown` 存的是这个文件的完整文本（含 frontmatter 块），导入不改写、导出逐字节输出。** 后台以字段表单编辑 frontmatter 时会重新序列化 YAML，这是用户主动的编辑动作，不是导入导出过程。

### 3.1 通用字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 必填 |
| `description` | string | 摘要，用于列表页、`<meta description>` 与 RSS；缺省时由第一阶段渲染从正文派生 |
| `date` | ISO 8601 | 发布时间；未来时间 = 定时发布 |
| `updated` | ISO 8601 | 最后修改时间；缺省取导入时间 |
| `slug` | string | 缺省取包名（默认语言）或按 `title` 生成 |
| `tags` | string[] | 存储并参与别名归并（§3.3 的 `categories`）。**归档页在 `/tags/<tag>`（其他语言 `/<locale>/tags/<tag>`），跨内容类型列出**；无人使用的标签返回 404，避免为任意字符串生成薄页面 |
| `draft` | boolean | `true` 为草稿；缺省 `false` |
| `cover` | 相对路径 | 封面图，如 `images/hero.jpg` |
| `kind` | string | 内容类型；缺省由所在目录或 CLI 参数决定 |
| `locale` | string | 见 §2 第 2 条 |

### 3.2 类型专属字段

由主题的 `theme.json` 为每种内容类型声明 schema，例如外贸 Starter 的 `product`：`category`（关联 `category` 内容的 slug）、`sku`、`specs`（键值表）、`gallery`（相对路径数组）、`datasheet`（`files/` 相对路径）、`moq`、`lead_time`。字段类型为 `image`、`image[]`、`file` 的值必须是相对路径，遵守 §4。未在 schema 中声明的字段原样保留，不报错、不丢弃。

### 3.3 导入别名

为了直接吃下 Astro、Hugo 与常见 CMS 导出的 frontmatter，导入时按下表**派生**到 `content.frontmatter` JSON，**不改写 `index.md` 原文**：

| 别名 | 规范字段 |
| --- | --- |
| `pubDate`、`publishDate`、`published` | `date` |
| `updatedDate`、`lastmod`、`modified` | `updated` |
| `heroImage`、`image`、`featured_image`、`thumbnail` | `cover` |
| `summary`、`excerpt` | `description` |
| `categories`（字符串数组） | `tags`（追加） |

### 3.4 正文

正文是标准 Markdown。图片用 `![alt](images/hero.jpg)`，附件用 `[产品手册](files/datasheet.pdf)`。允许内联 HTML，但渲染时按白名单净化，`<script>`、事件属性、`javascript:` 链接会被移除。外链图片 `![](https://…)` 原样输出，不代理、不下载。

## 4. 相对路径规则

1. 路径相对于文章包目录；`images/hero.jpg` 与 `./images/hero.jpg` 等价，导入时归一化为前者作为 `assets` 的键，**`index.md` 原文不改**。
2. 只允许 `images/` 与 `files/` 两个前缀；不允许 `..`、绝对路径、`file:`、协议相对路径。
3. 大小写敏感；URL 编码的空格与非 ASCII 字符按解码后的文件名匹配。
4. 出现在以下位置的相对路径都会被解析：Markdown 图片与链接语法、内联 HTML 的 `<img src>` 与 `<a href>`（净化后仍保留的）、frontmatter 中 `cover` 以及 schema 声明为 `image` / `image[]` / `file` 的字段。
5. 每个相对路径在 `content.assets` 中映射到媒体的 sha256。渲染时替换为 R2 URL；导出时按映射把文件放回 `images/` 与 `files/`，文件名用 `assets` 的键，不用 R2 的哈希名。
6. 引用了包里不存在的文件是**正常状态**：内容照常保存，`assets` 中没有对应项，渲染输出原始相对路径（浏览器显示为坏图），后台与 CLI 报告「缺 N 张图」。发布时警告但不阻止。

### 4.1 接受的媒体类型

| 目录 | 0.1 接受 | 处理 |
| --- | --- | --- |
| `images/` | jpg、png、webp、gif、avif | jpg/png/avif 转 WebP 并生成多宽度变体；gif、webp 原样存储并生成变体；**svg 0.1 不接受** |
| `files/` | pdf、xlsx、docx、zip | 原样存储，按嗅探类型校验，`Content-Disposition: attachment` |

## 5. 站点导出布局

```text
export-2026-08-28/
├── site.json                    # 站点设置、语言、导航、SEO 默认值、启用的内容类型
├── content/
│   ├── article/
│   │   └── titanium-price-2026-08/   # 文章包
│   ├── product/
│   │   └── gr5-titanium-bar/
│   ├── category/
│   ├── page/
│   └── faq/
├── media/                       # 未被任何内容引用的媒体（原图，按原始文件名，重名加 sha 前缀）
├── redirects.csv                # from,to,status
└── inquiries.csv                # 若启用询盘插件
```

`content/<kind>/` 按内容类型分目录；每个目录下一个文章包对应一个翻译组。`site.json` 与 `redirects.csv` 用通用结构，不含 Worker、D1、R2 的任何标识。

**导出里没有主题目录**（2026-08-29 更正）：主题是源码，随部署走，不是站点数据。`site.json` 只记录当时用的主题 id 与版本，导入方自行确保源码里有它。此前本节画了一个 `themes/trade-1.2.0.zip`，那是已废弃的「主题打包上传」方案的残留。

## 6. `mallok.json`

导出时写入每个文章包，让再次导入能保持身份：

```json
{
  "translation_group": "5c1d…",
  "items": {
    "zh": { "id": "a1b2…", "created_at": "2026-08-28T02:10:00Z", "path": "/news/titanium-price-2026-08" },
    "en": { "id": "c3d4…", "created_at": "2026-08-28T02:12:00Z", "path": "/en/news/titanium-price-2026-08" }
  }
}
```

它是可选的：手写或 AI 管线产出的文章包没有这个文件，导入时分配新的 `id` 与 `translation_group`。它也是 Mallok 唯一允许出现在文章包里的私有文件；Astro、Hugo、Obsidian 会忽略它。

## 7. 导入契约

### 7.1 输入

接受三种布局，自动识别：

1. **Mallok 导出布局**（§5），含 `site.json` 时可选择一并导入设置。
2. **文章包目录**：一个目录下若干文章包，内容类型由 `--kind` 指定或由上级目录名匹配已启用的类型。
3. **散文件**：目录下若干 `*.md`，每个文件视为一个单语言文章包，图片路径相对于该文件所在目录解析。Astro Content Collections 的 `src/content/<collection>/` 布局按此处理，`<collection>` 名映射到内容类型。

目录名或 `--kind` 无法匹配任何已启用的内容类型时，导入停止并列出无法识别的目录，不猜测、不静默归入 `article`。

### 7.2 身份与冲突

| 情况 | 行为 |
| --- | --- |
| 包内有 `mallok.json` 且 `id` 存在 | 更新该条内容（`id`、`translation_group`、`created_at` 不变） |
| 无 `mallok.json`，但 `(kind, locale, slug)` 已存在 | 更新已存在的内容（幂等的重复发布） |
| 无匹配 | 新建，分配 `id` 与 `translation_group` |
| `--create-only` | 遇到已存在即报错，不覆盖 |

**幂等**：文章包内容（`index*.md` 文本与所有引用文件的 sha）与线上完全一致时，导入是空操作，不写 D1、不清缓存。每日 AI 管线可以放心重复执行。

### 7.3 媒体

对每个被引用的文件算 sha256；`media` 表已有则复用，否则在上传端生成变体后上传 R2。图片处理在 CLI（`sharp`）或浏览器（Canvas）完成，Worker 不处理。上传按文件逐个进行，D1 写入按 D1 单条 SQL 100 KB 与每次调用查询数上限分批。

### 7.4 状态

`draft: true` → 草稿；`date` 在未来 → `scheduled`；否则 `published`。CLI `publish` 与 `import` 的区别只在默认值：`publish` 默认发布，`import` 默认保留 frontmatter 的状态；两者都可用 `--draft` 强制为草稿。

### 7.5 AI 内容管线约定（可选）

包内若有 `image-slots.json`，CLI 读取它来报告哪些图片槽位尚未提供文件；没有则只按 §4 第 6 条报告缺图。Mallok 不解释 `image-requirements.md` 等其他文件，也不会把它们上传。

## 8. 导出契约

- 导出是一次操作，产出 §5 布局的目录（CLI 写到本地；后台打包为 zip 下载）。
- `index*.md` 逐字节等于 `content.markdown`。
- `images/`、`files/` 按 `assets` 映射从 R2 取**原图**（若启用了「原图最大边长」限制，取的是上传时已缩放的原图），文件名为映射的键。
- 未被引用的媒体进入顶层 `media/`。
- 导出不包含 `render_cache`、会话、token、密钥、插件设置中的任何加密项。

## 9. 往返一致性测试（硬性）

以下断言是回归测试的必过项：

1. 导出 → 导入（到空站）→ 导出：两次导出的每个 `index*.md` 与 `images/`、`files/` 逐字节相同；`mallok.json` 中的 `id`、`translation_group`、`created_at` 相同。
2. 任意手写文章包 → 导入 → 导出：`index*.md` 逐字节相同（导入不改写原文）。
3. 含别名 frontmatter（Astro、Hugo 形态）的文章包：导入后 `content.frontmatter` 派生正确，导出原文不变。
4. 两个文章包各含同名 `images/cover.jpg` 但内容不同：导入后各自渲染正确，导出各自还原。
5. 引用缺失文件的文章包：导入成功、状态可见、导出原样保留引用。
6. 重复导入未修改的文章包：D1 无写入、无缓存清除。
7. 恶意语料（`..` 路径、`javascript:` 链接、内联 `<script>`、超 2 MB 正文）：按规则拒绝或净化，不崩溃、不泄露。
