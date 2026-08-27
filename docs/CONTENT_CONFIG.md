# Mallok 配置与内容契约

- 状态：Accepted for MVP
- 版本：0.1
- 适用阶段：Phase 1B–3

本文是 `mallok.config.mjs`、文章 frontmatter、文件发现和规范化行为的权威契约。

## 1. 项目目录

默认项目结构：

```text
my-site/
├── mallok.config.mjs
├── content/
│   └── articles/
│       └── hello-mallok.md
├── theme/
│   ├── index.mjs
│   └── assets/
│       └── theme.css
├── public/
│   └── favicon.svg
├── .mallok/                 # 本地状态、临时构建、测试持久化；必须 gitignore
├── .dev.vars.example        # 只有变量名/示例说明，无真实值
└── package.json
```

`content`、`theme`、`public`、输出目录和 `.mallok` 是受管理根目录，彼此不能相同、互为祖先或通过 symlink/junction 指向彼此。`.git`、项目根、用户主目录和文件系统根永远不能成为输出或临时替换目标。

## 2. 配置文件

MVP 只读取项目根的 `mallok.config.mjs`。配置是项目拥有者的受信任 ESM 代码，但默认导出必须是下面的纯数据对象；MVP 不接受函数、Promise、动态配置或 TypeScript 配置。

```js
export default {
  project: {
    id: "123e4567-e89b-42d3-a456-426614174000"
  },
  site: {
    title: "My Mallok Site",
    description: "A small content site",
    url: "https://example.com",
    language: "zh-CN"
  },
  content: {
    directory: "content/articles"
  },
  theme: {
    entry: "theme/index.mjs"
  },
  public: {
    directory: "public"
  },
  output: {
    directory: "dist",
    target: "static"
  },
  cloudflare: {
    workerName: "my-mallok-site",
    databaseName: "my-mallok-site-content",
    compatibilityDate: "2026-08-27"
  }
};
```

### 2.1 类型

```ts
export interface MallokConfigInput {
  readonly project: {
    readonly id: string;
  };
  readonly site: {
    readonly title: string;
    readonly description?: string;
    readonly url: string;
    readonly language: string;
  };
  readonly content?: { readonly directory?: string };
  readonly theme?: { readonly entry?: string };
  readonly public?: { readonly directory?: string };
  readonly output?: {
    readonly directory?: string;
    readonly target?: "static" | "cloudflare";
  };
  readonly cloudflare?: {
    readonly workerName: string;
    readonly databaseName: string;
    readonly compatibilityDate: string;
  };
}
```

规范化默认值：

| 字段 | 默认值 |
| --- | --- |
| `content.directory` | `content/articles` |
| `theme.entry` | `theme/index.mjs` |
| `public.directory` | `public` |
| `output.directory` | `dist` |
| `output.target` | `static` |

`project.*` 与 `site.*` 没有隐式默认；starter 必须生成明确值。`project.id` 是项目身份，不是文章 id 或云资源 id，由 `mallok init` 生成后保持不变。未知字段视为 `CONFIG_INVALID`，避免拼写错误被静默忽略。未来扩展必须进入版本化字段或新 ADR，不能依赖“先放一个未知 key”。

### 2.2 字段约束

- `project.id`：canonical lowercase RFC 9562 UUID v4，非 nil；
- `site.title`：trim 后 1–100 Unicode code point；只允许下述 XML-safe scalar；
- `site.description`：可选，trim 后最多 300 code point；只允许下述 XML-safe scalar；
- `site.url`：绝对 `http:` 或 `https:` URL；不得含用户名、密码、query、fragment；MVP 要求 pathname 为 `/`，子路径部署延后；末尾规范化为 `/`；`output.target="cloudflare"` 时必须为 `https:`，避免管理 API 返回与真实公开 origin 不一致的 URL；
- `site.language`：通过 `Intl.getCanonicalLocales` 校验并规范化；
- 所有目录/入口：项目根相对 POSIX 风格路径，不得为绝对路径、盘符、UNC、反斜杠、百分号、NUL、空段、`.`、`..` 或 Windows 设备名；最多 32 个非空 segment、总计 1,024 UTF-8 bytes、每 segment 255 UTF-8 bytes，三个上限均由 runtime validator 执行并覆盖边界与 `+1` 反例；
- `cloudflare.workerName`、`databaseName`：1–63 个小写 ASCII 字母、数字或单连字符，不得以连字符开头/结尾；
- `compatibilityDate`：`YYYY-MM-DD`，由项目明确提交；Mallok 不在构建时自动替换成“今天”。

当 `output.target === "cloudflare"` 时，`cloudflare.workerName`、`databaseName` 和 `compatibilityDate` 全部必填，且 `site.url` 必须为 canonical `https:` root origin；static target 可以省略整个 `cloudflare` object并可在本地使用 `http:`。MVP 不接受按环境嵌套多套配置，环境对应的非敏感资源解析保存在本地 state；多环境 config overlay 延后。

会进入 HTML/XML metadata 的文本（`site.title/description`、文章 `title/description/tags`）必须是 well-formed Unicode scalar sequence，并只包含 XML 1.0 合法字符：U+0009、U+000A、U+000D、U+0020–U+D7FF、U+E000–U+FFFD、U+10000–U+10FFFF。其他 C0 control、lone surrogate、U+FFFE/U+FFFF 等在配置入口返回 `CONFIG_INVALID`、内容入口返回 `CONTENT_INVALID`；不得在 feed serializer 中静默删除或替换。

配置中不得出现 API token、Bearer token、Cloudflare account id、D1 `database_id` 或 secret 值。Cloudflare 非敏感资源解析结果写入被忽略的 `.mallok/state.json`，见 [Cloudflare 契约](CLOUDFLARE.md)。

## 3. 配置加载顺序

1. 解析 `--cwd`，对项目根做 `realpath`；
2. 解析显式 `--config`，否则使用 `<root>/mallok.config.mjs`；
3. 确认配置文件是项目根内普通文件，不是 symlink；
4. 使用 file URL 动态导入；
5. 只读取 default export；
6. 深度复制为普通数据并校验，拒绝 getter、Proxy、class instance、函数、symbol 和循环；
7. 解析受管理路径，先做词法边界，再对现有路径做 `realpath`/symlink 边界；
8. 返回深度冻结的 `MallokConfig`。

加载配置发生的任意异常都映射为 `CONFIG_INVALID`，用户可修复时必须附具体字段或文件路径。不得把包含环境变量值的原始对象完整打印到日志。

## 4. Markdown 文件发现

- 从规范化后的 `content.directory` 递归读取小写或大写扩展名 `.md`；
- 单项目最多发现 10,000 个 Markdown 文件；超过时返回 `CONTENT_COLLECTION_TOO_LARGE`，不继续构建部分站点；
- 路径按项目相对 POSIX 字符串排序后再解析，不能依赖文件系统枚举顺序；
- 不跟随文件或目录 symlink/junction；发现时报告 `PATH_OUTSIDE_PROJECT`；
- 忽略以 `.` 开头的目录和非 Markdown 文件；
- 单文件 UTF-8 最大 1.1 MiB，其中 frontmatter 最大 64 KiB，Markdown 正文最大 1 MiB；
- Markdown 正文规范化换行后至少 1 个 UTF-8 byte；空正文返回 `CONTENT_INVALID`；
- UTF-8 解码必须使用 fatal 模式；非法字节阻止构建；
- 文件名和目录名不是内容身份，也不自动成为 slug。

Phase 1B 应一次扫描后聚合所有文件诊断，按文件路径、字段、错误码稳定排序；不得遇到第一个坏文件就隐藏其余错误。

## 5. Frontmatter

文件必须以第一行 `---` 开始，并以独占一行的 `---` 结束。关闭标记后的内容是 Markdown 正文。

```md
---
id: 123e4567-e89b-42d3-a456-426614174000
slug: hello-mallok
title: Hello Mallok
description: The first Mallok article.
draft: false
publishedAt: 2026-08-27T09:30:00Z
updatedAt: 2026-08-27T09:30:00Z
tags:
  - release
  - mallok
template: article
data:
  accent: violet
---

# Hello Mallok

The body is CommonMark/GFM.
```

解析 YAML 时：

- 使用 YAML 1.2 core schema；日期保留字符串，不隐式转成 `Date`；
- 拒绝重复 key、alias、anchor、merge key、自定义 tag 和多文档输入；
- top-level 必须是普通 mapping；
- 未知 top-level key 视为 `CONTENT_INVALID`，自定义数据只能放在 `data`；
- 解析器必须设置输入长度和 alias 限额，不能使用不受控对象反序列化。

### 5.1 Frontmatter schema

| 字段 | 类型 | 必填 | 规范 |
| --- | --- | --- | --- |
| `id` | string | 是 | lowercase canonical RFC 9562 UUID v4，稳定身份 |
| `slug` | string | 是 | 1–100 字符，小写 ASCII kebab-case 单段；不得等于 `con/prn/aux/nul/com1..com9/lpt1..lpt9` |
| `title` | string | 是 | trim 后 1–200 code point |
| `description` | string | 否 | trim 后 1–500 code point；空串等于缺失 |
| `draft` | boolean | 否 | 默认 `false` |
| `publishedAt` | string | 否 | 输入接受 RFC 3339 的 `Z`/数字 offset（可省略小数秒），规范化为 UTC `.sssZ` |
| `updatedAt` | string | 否 | 输入接受 RFC 3339 的 `Z`/数字 offset（可省略小数秒），规范化为 UTC `.sssZ`；不读 mtime |
| `tags` | string[] | 否 | 默认 `[]`；最多 20；每项 NFC+trim 后 1–50 |
| `template` | string | 否 | 默认 `article`；`[a-z][a-z0-9-]{0,63}` |
| `data` | object | 否 | 默认 `{}`；只允许纯 JSON，限制见下文 |

`draft: false` 且没有 `publishedAt` 的文章立即可见，但排序在所有带显式日期的文章之后。`publishedAt > asOf` 的文章在该时间前不可见。`updatedAt` 只是作者元数据，不代表 D1 revision 的系统创建时间。

本地 content/file schema 的正文上限是 1 MiB，供 static target 使用。Cloudflare publish 另有更严格的 adapter 预算：规范化 `bodyMarkdown` 最大 262,144 UTF-8 bytes、编译后的 `bodyHtml` 最大 1,048,576 UTF-8 bytes，且整条 revision payload 最大 1,500,000 bytes；超过时返回 `CONTENT_DYNAMIC_SIZE_EXCEEDED`，static build 不因此失败。该差异是 D1 物理边界，不得把字符数当成字节数。

### 5.2 `data` 与 canonical JSON

- 只允许 null、boolean、有限 number、string、稠密 array 和普通 string-key object；
- 拒绝 `undefined`、BigInt、NaN/Infinity、函数、symbol、Date/Map/Set/class、循环、稀疏数组、数组附加属性、getter/setter 和不可安全反射的对象；
- 最大嵌套深度 8、对象 key 总数 100、canonical JSON UTF-8 最大 32 KiB；
- object key 在每层按 UTF-16 code unit 排序；array 保序；
- 调用方对象先复制再冻结，不能因为 Mallok 返回不可变对象而冻结作者持有的值。

## 6. Markdown 语义

- 支持 CommonMark 与 GFM；
- raw HTML node 被移除，不进入输出；标签之间原本属于 Markdown text 的文字可能保留为普通文本；不承诺把 raw HTML 原样显示；
- URL 协议大小写不敏感，允许 `http/https/mailto/tel` 和站内相对路径/query/fragment，拒绝 `//host`、危险 scheme、控制字符和混淆字符；
- 普通链接可以使用上述站内相对 URL；Markdown 图片的 destination 更严格，只接受绝对 HTTPS URL，或当前 asset manifest 中存在且无 query/fragment 的绝对 `/assets/...` URL。`./image.png`、`../image.png`、`data:`、`file:` 和未部署资源均返回 `CONTENT_NOT_PUBLISHABLE`；每篇文章最多引用 100 个唯一站内 `/assets/**` URL，外部 HTTPS 不计入该上限；
- 不解析 `srcset` candidate list；相关属性在 MVP 中删除；
- 输出必须经过固定 sanitizer 并成为 `SafeHtml`；
- `sourceHash`/`artifactHash` 的字段集合、`null` 规则、canonical JSON 与 UTF-8/SHA-256 编码严格使用 [ARCHITECTURE.md](ARCHITECTURE.md) 第 5 节公式；compiler、schema、sanitize pipeline 或影响输出的选项变化必须改变 `artifactHash`。

## 7. 集合级不变量

- `id` 全集合唯一；
- `slug` 全集合唯一；
- 重复值同时报告两个来源文件；
- 列表顺序固定为：有 `publishedAt` 的内容按时间降序，然后无日期内容，最后以 slug 升序打破平局；
- route 只能由规范化 entry 生成；
- 同一份输入、固定版本和固定 `asOf` 必须得到同一 entry、hash、列表顺序和 route plan。

## 8. 示例与反例

以下必须拒绝：

```yaml-invalid
slug: ../admin
publishedAt: 2026-08-27T09:30:00   # 无时区
tags: [ok, null]
data: !!js/function "alert(1)"
unknownField: typo
```

删除 Markdown 文件不会自动下线 D1 内容；动态站必须执行显式 `mallok unpublish`。这是作者源与发布投影边界，不是文件监听功能。
