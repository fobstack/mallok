# Mallok 0.1 项目目录格式

- 状态：Accepted 0.1 project format
- 格式版本：`1`

Mallok 项目是可读、可移动、可纳入 Git 的数据目录，不是 JavaScript 工程。项目中不得生成 `package.json`、lockfile、`node_modules`、可执行配置、主题源码或插件。

## 1. 标准目录

```text
my-site/
├── mallok.json
├── content/
│   ├── pages/
│   │   ├── home.md
│   │   └── about.md
│   └── articles/
│       └── hello.md
├── media/
│   └── hero.webp
└── .mallok/
    ├── cache/
    ├── bundles/
    ├── publish-history/
    ├── provision.json
    ├── state.json
    └── project.lock
```

只有 `mallok.json`、`content/`、`media/` 是作者数据。`.mallok/` 由 Mallok 独占、必须 gitignore，不保存任何 credential。删除它不会丢失作者内容或改变当前线上网站，但会丢失未合并 recovery journal、本地发布记录和 cached previous bundle，因而可能暂时或永久失去“恢复上一版本”能力；Studio 必须在清理前说明影响，不能把它笼统描述为无损可重建 cache。

## 2. `mallok.json`

文件必须是无 BOM UTF-8、单一 JSON object；不允许 comment、trailing comma、duplicate key 或未知字段。

```json
{
  "formatVersion": 1,
  "siteId": "123e4567-e89b-42d3-a456-426614174000",
  "title": "Example",
  "description": "A small Mallok site",
  "logo": "/media/logo.png",
  "canonicalUrl": "https://example.com/",
  "language": "zh-CN",
  "navigation": [
    {
      "label": "首页",
      "contentId": "123e4567-e89b-42d3-a456-426614174010"
    }
  ],
  "template": {
    "id": "journal",
    "options": {
      "accent": "#2457d6",
      "font": "sans",
      "density": "comfortable"
    }
  }
}
```

| 字段 | 0.1 约束 |
| --- | --- |
| `formatVersion` | 必须为整数 `1` |
| `siteId` | init 时生成的 canonical lowercase UUID v4，之后不可自动改变 |
| `title` | trim 后 1–120 Unicode code point |
| `description` | 可选，trim 后最多 300 code point |
| `logo` | 可选，必须是有效的 `/media/...` 逻辑引用 |
| `canonicalUrl` | 可选；首次公网发布成功后写入 canonical HTTPS origin 加 `/`；无 userinfo、额外 path、query 或 fragment；规范化 UTF-8 bytes ≤255 |
| `language` | canonical BCP 47 language tag |
| `navigation` | 最多 8 项；每项 `label` 1–40 code point，`contentId` 指向存在的 page UUID；不直接保存 route |
| `template.id` | `journal`、`docs`、`company` 之一 |
| `template.options.accent` | `#RRGGBB`；默认由模板提供 |
| `template.options.font` | `sans` 或 `serif`；映射到 Mallok 内置 font stack |
| `template.options.density` | `compact` 或 `comfortable` |

项目不记录 static/Cloudflare target；同一项目可使用任一 sink，但 `canonicalOrigin` 是 bundle 显式输入，origin 不同就会生成不同 bundle hash。Cloudflare resource id 只写 `.mallok/state.json`。

`canonicalUrl` 不阻塞创建和本地预览。静态导出前由 Studio 要求用户确认；Cloudflare 首次发布使用 provision 得到的默认 Worker URL，并在发布成功后原子写回。之后修改 canonical URL 属于明确的站点设置变更，不由 sink 静默替换。

## 3. 内容文件

内容是无 BOM UTF-8 Markdown，使用 YAML frontmatter。0.1 只有 `page` 和 `article` 两种 kind：

```markdown
---
id: 123e4567-e89b-42d3-a456-426614174001
kind: article
slug: hello
title: Hello
description: First article
cover: /media/hero.webp
coverAlt: A titanium part on a machining table
seoTitle: Hello from Example
seoDescription: A concise search description.
status: published
publishedAt: 2026-08-27T09:30:00.000Z
updatedAt: 2026-08-27T10:00:00.000Z
tags:
  - news
---

# Hello

Content.
```

规则：

- `id`、`kind`、`slug`、`title`、`status` 必填；未知字段失败；
- `id` 是 canonical lowercase UUID v4，在文件 rename 或 slug 改变时保持不变；
- `slug` 是单个 1–80 字符 lowercase ASCII kebab-case segment；禁止 percent、`.`、`..`、Windows device name；
- `title` 1–200 code point，`description` 可选且最多 500；
- `cover` 与 `coverAlt` 必须同时存在或同时缺失；`cover` 是有效的 `/media/...` 逻辑引用，`coverAlt` 是 1–300 code point 的准确可见描述；
- `seoTitle` 可选且最多 70 code point；`seoDescription` 可选且最多 170 code point；它们是 Mallok 编辑体验限制而非搜索引擎官方字符规则；最终 title/description 按 `SEO_PERFORMANCE.md` 的 compiler 回退算法生成；
- `status` 只能为 `draft|published`；draft 不进入 PublishBundle；
- `publishedAt`、`updatedAt` 如存在必须为 canonical UTC millisecond RFC 3339；`updatedAt` 不早于 `publishedAt`；
- 0.1 不提供定时发布。published 内容的未来 `publishedAt` 在编译时失败，而不是等待 Worker runtime 自动显示；
- `tags` 可选，最多 20 个；每项 trim、1–40 code point，规范化后不得重复；
- frontmatter 后 Markdown 最大 262,144 UTF-8 bytes；原始 HTML 固定移除；
- YAML anchor、alias、自定义 tag、merge key 和 duplicate key 全部拒绝。

项目最多 1,900 个 content document（page + article，包含 draft），全部 Markdown 文件总 bytes 最多 536,870,912。该余量为 404、RSS、robots、root sitemap 和确定性 sitemap shards 保留 route 空间，使合法最大项目仍低于 PublishBundle 的 2,000 route 上限；Studio 在导入和新建前检查，不允许靠编译时才发现磁盘已被无界写满。

### 3.1 固定 route

| source | route |
| --- | --- |
| `content/pages/home.md`，`kind: page`、`slug: home` | `/` |
| 其他 `content/pages/*.md` | `/<slug>/` |
| `content/articles/*.md` | `/articles/<slug>/` |

项目必须恰有一个 published `home` page 才能生成可发布/可导出的 bundle。Studio preview 可以显式包含当前正在编辑的 draft，但必须继续使用同一 Markdown、模板、asset 和 URL 安全规则。所有 published id、slug 和 route 全局唯一。文件名只用于作者识别，不决定 URL；同一文件的 `kind` 必须与所在目录一致。

首页、文章页、普通页面、`/404.html`、`/rss.xml`、`/sitemap.xml`、可选 `/sitemaps/<4-digit>.xml` 和 `/robots.txt` 由 compiler 固定规划，内容或模板不能创建额外 route。sitemap URL 集合、分片和索引规则以 [SEO_PERFORMANCE.md](SEO_PERFORMANCE.md) 为准。

### 3.2 链接

- Studio 的站内链接选择器只写 `/`、`/<slug>/` 或 `/articles/<slug>/`，尾斜杠是 canonical 形式；0.1 站内链接不接受 query、fragment、同源 absolute URL、无尾斜杠或 `./`、`../` 等相对路径。
- 普通外部链接只接受 absolute `https:` URL；`http:`、protocol-relative、data/blob/file/javascript URL 全部拒绝。内容图片不属于本条，必须按 §4 使用 `/media/...`。
- preview 可显示指向 draft 的站内链接并标记 warning；static export/publish 要求每个站内链接都命中本 bundle 中 published status 200 HTML route，否则以源文件、链接文字和目标定位阻断。
- Studio 修改 slug 前列出受影响的站内链接数量；确认后以 expected file hash 在一个本地 mutating operation 中改写全部 exact old-route Markdown destination。任一文件外部变化时整次操作中止，不能留下部分新旧链接。手工改文件未更新链接时由 compiler 的 broken-link gate 阻断。
- 编译后的 `<a href>` 保持 canonical root-relative route；canonical 与 sitemap 使用同一 route 解析后的 absolute HTTPS URL。三者比较 route identity，而不是把 href 强制改成 absolute string。

## 4. Media

`media/` 只允许普通文件，不跟随 symlink/junction。0.1 接受静态 PNG、JPEG、WebP、AVIF 和单帧 GIF；动画 GIF/WebP/AVIF 不进入 preview/export/publish。SVG、HTML、CSS、JavaScript、可执行文件或根据内容嗅探出的类型漂移全部拒绝。

Markdown 和 config 使用逻辑绝对引用 `/media/<safe-relative-path>`。compiler 必须：

1. 解析到 `media/` 内的普通文件；
2. 验证 extension、magic bytes、单文件/总量限制；
3. 只选择 published route 实际引用的文件；
4. 按 `SEO_PERFORMANCE.md` 固定 profile 自动定向、转换 sRGB、移除 metadata、缩小并编码一个 WebP 输出；
5. 按优化后 bytes 计算 SHA-256；
6. 改写为 `/assets/<sha256>.webp`，并把准确 width/height 写入 HTML；
7. 只把优化 asset bytes 和 MIME 写入 PublishBundle，作者原图继续保存在项目/备份中。

内容图片必须使用 `/media/...`。外部 HTTPS 图片在 Markdown 导入或 source preview 中只显示不联网的 placeholder 与定位 warning，publish/static export 阻断并要求用户主动下载后拖入 Mallok。compiler 和 preview 不自动下载、代理、探测或由浏览器加载外部图片，避免 SSRF、跟踪、离线失效和不可控性能。其他图片 scheme、protocol-relative URL 与相对文件路径全部拒绝。

0.1 预算：单 media 最大 25 MiB、最多 900 个、项目 media 总 bytes 最大 512 MiB。bundle 总 asset 上限为 1,000，至少 100 个名额保留给 compiler 与官方模板产物，不能被 media 占满。预算是产品边界，不根据本机内存自动放宽。

压缩图片还必须在复制进项目和每次编译时通过解码成本门，不能只看文件 bytes：

- 有效 frame 宽、高都必须是 `1..8192` 整数，channel 数为 `1..4`；
- 单 frame `width × height` 不超过 `40,000,000` pixels；
- frame count 必须为 `1`；检测到动画立即拒绝，不解码或输出首帧冒充原意；
- 单帧累计 pixels 与单 frame 相同，仍不得超过 `40,000,000`；
- 缺失、为零、非整数、溢出的尺寸/frame metadata，截断或 decoder warning 全部拒绝；EXIF orientation 只可交换显示方向，不能放宽任一上限；
- 乘法使用 checked integer/BigInt 后再比较，不能依赖会溢出的 32-bit 运算。

0.1 原样保存作者图片，但公开 bundle 只包含 `SEO_PERFORMANCE.md` 的确定性 WebP 优化输出；不承诺保留公开 asset 的 EXIF/ICC metadata。metadata reader 必须启用 `limitInputPixels=40_000_000`、`limitInputChannels=4`、`sequentialRead=true`、`unlimited=false` 和严格 warning 失败；GIF/WebP/AVIF 都要用 `pages/pageHeight` 独立证明只有一帧，不能因为只读取首帧而绕过动画拒绝规则。

## 5. 路径与文件系统边界

- 所有路径先以项目根为基准解析，再验证 realpath；
- 项目根、`content`、`media`、`.mallok` 和 static output 不得互相祖先重叠；
- 拒绝 absolute path、drive/UNC path、反斜杠、NUL/control、empty segment、`.`、`..`、percent 和 device name；
- content/media 不跟随 symlink、hardlink 到项目外、junction 或 special file；
- 枚举按规范 POSIX relative path 的 Unicode code-unit 升序；mtime 不参与语义；
- Studio 写作者文件时使用同目录 exclusive temporary file、flush 和 atomic rename；覆盖前校验原文件 hash，外部编辑冲突必须提示用户，不静默覆盖；
- 一个项目同一时刻只允许一个 Mallok mutating operation。`.mallok/project.lock` 只用于本地短期进程互斥，不是远端部署 fence；进程消失后可安全重建。

## 6. `.mallok/`

```text
.mallok/
├── cache/                      # 可删除 compiler cache
├── bundles/<bundle-hash>/      # 完整 PublishBundle，格式见下文
├── publish-history/<id>.json    # 最近产品可读发布结果
├── provision.json              # 有限、非敏感的 Cloudflare 创建回执
├── state.json                  # 非敏感 sink/resource/protocol 状态
└── project.lock                # 运行时短期锁
```

`state.json` 可以包含 `siteId`、Cloudflare account/resource id、Worker URL、最后观察到的 bundle hash 和 protocol version；不得包含 token、cookie、环境变量、Markdown、浏览器 session 或绝对 home path。所有远端字段均需在使用前重新验证，不能只信任本地 state。state/receipt 可以通过重新授权和远端 marker 重建，但 publish history 与不再能从当前作者数据重编译出的 previous bundle 不保证可重建。

`provision.json` 只保存 `provisionId`、account id、siteId、已创建的 resource type/id、ownership marker 摘要和最后完成步骤；每个远程 create 成功后必须先原子更新它，才能继续。所有远程字段均需在使用前重新验证，不能只信任本地 state/receipt。

### 6.1 PublishBundle 持久化格式 v1

```text
.mallok/bundles/<64-lower-hex>/
├── manifest.json                 # canonical manifest bytes
├── routes/<body-sha256>.body    # exact route body bytes
├── assets/<sha256>.<ext>        # 与 public asset key 一致
├── provenance.json              # 不参与 bundleHash 的 binary/build 来源
└── complete.json                # 最后写入的完整性标记
```

`manifest.json` 的 SHA-256 必须等于目录名与 manifest 推导的 `bundleHash`。`complete.json` 只包含 formatVersion、bundleHash、route/asset count 和 manifest hash；它不能代替逐项复核。读取时检查每个 route/asset 都存在、是普通文件、bytes/hash/MIME 与 manifest 一致且无多余受管文件。route path 不直接映射为文件系统 path，只通过 manifest 查到 content-addressed body file。

写入先在 `bundles/.tmp-<uuid>/` 生成并复核，最后写 `complete.json`、flush，再 rename 为 `<bundle-hash>/`。目标已存在时只能验证为 exact same bundle 并 no-op；任何不同或不完整都 fail closed。

bundle cache 必须按上述格式复核后使用；目录存在不代表 bundle 完整。cache 不能成为唯一作者真相。

### 6.2 发布历史

`publish-history/` 最多保留 50 条原子写入的非敏感 record。每条只包含 record id、action (`publish|unpublish|restore|runtime-upgrade`)、started/finished time、target origin、bundle hash、变化数量、result (`succeeded|failed|unknown`)、稳定 error code 和脱敏 request id；不包含正文、token、OAuth credential、Cloudflare resource id 或绝对 home path。

记录是用户观察与恢复索引，不是远程事务日志或作者真相。重开 Studio 时必须用 Worker status 对最新 `unknown` 记录进行对账；本地历史丢失不得改变线上 current。恢复仍要求对应本地完整 bundle 逐项复核。

## 7. Snapshot 与 determinism

编译开始时，ProjectStore 记录所有输入的 relative path、bytes、size、SHA-256。读取完成后任一输入 hash 改变，编译失败并要求重试。

文本输入统一解码为严格 UTF-8、去 BOM（存在 BOM 即失败）、规范换行为 LF；内容正文不做 Unicode normalization，identifier/枚举字段按各自规则规范化。clock 只通过显式 `asOf` 输入；主机 timezone、locale、用户名、mtime 和 enumeration 顺序不得改变 bundle。

## 8. 迁移与可移植性

`formatVersion` 不兼容时 Mallok 先只读诊断；任何迁移必须：

1. 在项目同父目录创建完整 backup；
2. 产生 plan 并由用户确认；
3. 在新临时目录完成全部转换和验证；
4. 原子替换作者数据；
5. 不修改 `.git` 或删除用户文件。

0.1 不自动降级格式。项目复制到另一台已安装 Mallok 的机器后，无需 Node、Bun、package manager 或 install 即可打开；Cloudflare 连接可用 `siteId` 和显式凭据重新发现。

## 9. 站点库操作与身份

站点库动作必须区分“同一站点的恢复”和“创建一个独立站点”：

| 动作 | `siteId` | content `id` | `canonicalUrl` | `.mallok/` | 文件系统行为 |
| --- | --- | --- | --- | --- | --- |
| 重命名 | 保留 | 保留 | 保留 | 保留 | 只修改 `mallok.json.title`；0.1 不自动重命名项目目录 |
| 复制站点 | 生成新 UUID v4 | 保留 | 清除 | 不复制，创建全新空状态 | 先写 sibling 临时目录，完整验证后 promote 到用户选择的新目录 |
| 创建备份 | 保留 | 保留 | 保留 | 排除 | 生成一个不可变 `.mallok-backup.tar.gz`，不得覆盖既有备份 |
| 从备份恢复 | 保留 | 保留 | 保留 | 新建空状态 | 只恢复到不存在或空目录，验证完成后才成为可打开项目 |
| 删除本地副本 | 不适用 | 不适用 | 线上不变 | 随项目一起移动 | 通过 Tier-1 平台 adapter 移入系统废纸篓；无法使用废纸篓时 fail closed，不永久递归删除 |

备份 archive 只含 `backup.json`、`mallok.json`、`content/` 和 `media/`，格式固定为 gzip-compressed POSIX tar。`backup.json` 固定包含 backup format、创建时 Mallok version、`siteId`、文件清单、每个规范 relative path 的 bytes/SHA-256 和总量；禁止 absolute path、credential、`.mallok`、外部 link、special file 和额外顶层项。archive 最多 3,000 entries，压缩文件与声明的展开总量各不超过 1,200,000,000 bytes，单 entry 仍受对应 content/media 上限约束，展开比不得超过 100:1。

恢复不能把不可信 archive 直接交给“解压到目标目录”的 convenience API。实现必须流式读取 gzip/tar，在任务拥有的 sibling 临时目录中自行创建已验证的普通 directory/file；只接受 effective type 为 `file|directory` 的 entry，拒绝 symlink、hardlink、device、FIFO、socket、GNU link、重复条目、NFC/case-fold collision，以及含 absolute/parent/backslash/control/device segment 的最终 PAX/GNU path。PAX 只能影响经过同一规范化检查的 path/size；未知或矛盾的 size/path metadata 失败。每个 header 出现时就累计 entry count、声明 bytes、实际流入 bytes、目录深度和压缩/展开比，超过预算立即终止。全部 entry、`backup.json` 清单、hash 和项目 schema 通过后，才用与项目创建相同的 crash-safe promote 将临时目录变为一个原先不存在或为空的目标；失败不得触及目标目录。

复制保留 content ID 是有意行为：ID 只在 `siteId` 内有意义；新 `siteId` 隔离远端身份。副本不得继承 publish history、provision receipt、Cloudflare resource、Worker origin 或 credential lookup key，因此第一次公网发布一定走独立 provision。备份恢复则保持同一 `siteId`，用于找回同一个站点；重新连接远端仍需显式授权并核对远端 marker。
