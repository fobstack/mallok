# Mallok 构建与资源契约

- 状态：Accepted for MVP
- Build manifest：`1`
- 适用阶段：Phase 1B–3

## 1. 构建输入

一次构建的显式输入只有：

- 规范化配置；
- 已发现的 Markdown、theme module/theme assets、public 文件；
- Mallok/core/theme API/compiler/schema/sanitizer 版本；
- static target 由 CLI 在开始时固定的 `asOf`；cloudflare candidate 不接收该输入；
- target：`static` 或 `cloudflare`。

文件mtime、系统当前时间、随机数、绝对项目路径、用户名和进程环境不得进入页面或manifest hash。`SOURCE_DATE_EPOCH`存在时只用于static/dev的CLI默认`asOf`；显式`--as-of`优先。cloudflare build显式携带`--as-of`属于用法错误，环境中的`MALLOK_AS_OF`/`SOURCE_DATE_EPOCH`对它无效且不得写入candidate或改变hash。

## 2. 可见性与顺序

当且仅当规范化内容的 `status === "published"` 且 (`publishedAt` 缺失或 `publishedAt <= asOf`) 时，文章可见。未规范化输入中的 `draft` 只在 loader 边界转换为 `status`，构建层不得继续读取不存在的 `ContentEntry.draft`。

稳定顺序：

1. 有 `publishedAt` 的文章在前，时间降序；
2. 没有 `publishedAt` 的文章在后；
3. 日期相同或均无日期时按 `slug` Unicode code unit 升序；
4. slug 理论上唯一，`id` 只作为最后防御性 tie-breaker。

首页取前 20，RSS 取前 50，sitemap 取全部。

单项目最多 10,000 篇 Markdown/公开 document。超过时 static build 返回 `CONTENT_COLLECTION_TOO_LARGE`；动态 publish 由数据库约束在 pointer insert 前阻止。MVP 不实现 sitemap index。

## 3. 路由计划

MVP 核心路由：

| URL | static 文件 | cloudflare 来源 |
| --- | --- | --- |
| `/` | `index.html` | D1 + theme |
| `/articles/<slug>/` | `articles/<slug>/index.html` | D1 + theme |
| `/404.html` | `404.html` | Worker 使用同一主题返回 404 |
| `/rss.xml` | `rss.xml` | D1 + core feed generator |
| `/sitemap.xml` | `sitemap.xml` | D1 + core feed generator |
| `/assets/theme/**` | `assets/theme/**` | Workers Static Assets |
| 其他 public URL | 同路径 | Workers Static Assets |

MVP 没有 `/page/*`、tag archive、自定义 collection 或自定义 permalink。Node dev/preview 与 Cloudflare Worker 的 canonical 路由规则是：只有不带 query 且语法完全合法的 `/articles/<slug>` 以 `308` 跳转到带尾斜杠 canonical；不带 query 的 `/index.html` 以 `308` 跳转到 `/`。Worker-managed dynamic route 与 redirect candidate 的 query 按 `HTTP_API.md` 处理；asset-first 静态资源和 unknown-after-miss 是独立分支。`static` target 只保证生成 canonical 文件布局；任意第三方静态托管是否以及如何 redirect 取决于该 provider，Mallok MVP 不宣称 provider-independent 的 308。

公开路径拒绝状态固定如下，adapter 不得自行二选一：

- malformed percent escape，或 pathname 含 encoded slash/backslash、NUL、ASCII control、可观察的 dot segment：`400`，且在查询 D1/ASSETS 前拒绝；
- 语法有效但非 canonical 的文章 path，包括其他 percent encoding、重复斜杠、非法 slug、空段或额外 segment：主题 `404`；
- 合法但不存在、draft、future 或 unpublished 的文章：同一主题 `404`；
- 除上述两个合法 redirect 外，不做“修复性”重定向。

## 4. 保留路径与冲突

public 目录不能产生以下路径：

- `/`、`/index.html`、`/404.html`、`/rss.xml`、`/sitemap.xml`；
- `/articles` 与 `/articles/**`；
- `/__mallok` 与 `/__mallok/**`；
- `/assets/theme` 与 `/assets/theme/**`；
- `/_headers`（Cloudflare target 的生成控制文件；public/theme 都不得提供）；
- `/.mallok`、`/.git` 或 dot-segment 路径。

文件系统大小写不敏感时也按大小写折叠检查冲突。public/public、public/generated、theme/theme 的重复 URL 都返回 `BUILD_ROUTE_CONFLICT`，不采用“后写覆盖前写”。

## 5. 资源发现

- public 与 theme assets 只读取普通文件；不跟随 symlink/junction；
- 单个资源默认上限 20 MiB，总资源默认上限 200 MiB；超限属于 `BUILD_ASSET_INVALID`；
- public+theme 合计最多 10,000 个文件、遍历最多 20,000 个文件系统 entry（含目录）；每个 POSIX 相对 path 最多 32 个非空 segment、1,024 UTF-8 bytes，每个 segment 最多 255 UTF-8 bytes。零字节文件仍计数；任一上限的第一个 `+1` entry 在读取其内容前以 `BUILD_ASSET_INVALID` 停止；
- path 按 POSIX 相对字符串排序；Unicode 文件名必须 NFC；
- 不做隐式图片转码、压缩或内容改写；MVP 的 R2 图片管线延期；
- MIME 根据扩展名白名单决定，不基于用户输入 header；未知扩展名以 `application/octet-stream` 提供并带 `nosniff`；
- 文件 hash 是原始 bytes 的 SHA-256 小写 hex。

Markdown 图片在两个 target 中都只可引用绝对 HTTPS URL，或 asset manifest 中存在且无 query/fragment 的 `/assets/**` URL。需要随站部署的图片必须放进 `public/assets/**`（主题自有图片仍位于 `/assets/theme/**`）；相对文件路径、`file:`、`data:` 和尚未部署的 asset 必须拒绝。static build 校验本次 manifest，dynamic publish 校验当前 Worker bundle 内嵌 manifest。

### 5.1 Core media contract

T-004 必须从 `@mallok/core/media` 导出以下 experimental 纯函数；T-009/T-010 只能复用，不能再做第二套 Markdown AST 或 URL 解析：

```ts
export interface MarkdownImageReference {
  readonly destination: string;
  readonly line: number;   // 1-based，来自 CommonMark/GFM AST
  readonly column: number; // 1-based，来自 CommonMark/GFM AST
}

export interface MediaAssetEntry {
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly contentType: string;
}

export interface MediaValidationIssue {
  readonly code: "CONTENT_NOT_PUBLISHABLE";
  readonly reason:
    | "IMAGE_URL_UNSAFE"
    | "ASSET_NOT_DEPLOYED"
    | "TOO_MANY_SITE_ASSETS";
  readonly destination: string;
  readonly line: number;
  readonly column: number;
}

export interface MediaAssetReference {
  readonly url: string;
}

export interface MediaValidationResult {
  readonly issues: readonly MediaValidationIssue[];
  readonly assetReferences: readonly MediaAssetReference[];
}

export function extractMarkdownImageReferences(
  sourceMarkdown: string,
): Promise<readonly MarkdownImageReference[]>;

export function validateMarkdownImageReferences(
  references: readonly MarkdownImageReference[],
  deployedAssets: readonly MediaAssetEntry[],
): Readonly<MediaValidationResult>;
```

提取器使用与 compiler 相同的 CommonMark/GFM parser，覆盖 inline 与 reference-style image 并解析 definition；code/inline-code/raw HTML 中看似图片的文本不算引用。结果按源码位置保序，不去重，以便每处错误都有位置。validator 复用核心 Markdown 图片 URL 策略：绝对 HTTPS 直接通过且不进入持久化 reference；无 query/fragment 的安全 `/assets/**` 必须逐字命中已通过 `asset-manifest` schema 的 entry；其他值返回 `IMAGE_URL_UNSAFE`，未命中返回 `ASSET_NOT_DEPLOYED`。

成功结果中的 `assetReferences` 是本地站内图片的规范化 `{url}` 集合，按 `url` Unicode code unit 升序、URL 唯一且深度冻结；同一 URL 在正文出现多次只记录一次。单 revision 最多 100 个唯一站内 asset，超过时返回定位到第 101 个首次出现位置的 `TOO_MANY_SITE_ASSETS`。只要存在任何 issue，`assetReferences` 必须为空，调用者不得持久化部分结果。issues 按 line/column/destination 稳定排序并深度冻结；函数不读文件、不访问网络、不修改输入。

manifest 的 schema/重复 URL/hash/bytes/contentType 错误在调用本函数前由 adapter 作为 `BUILD_ASSET_INVALID` 拒绝；不能把损坏 manifest 伪装成作者的 missing asset。该 API 不支持相对本地图片路径，也不上传、转码或推导文件名。

## 6. Manifest

构建成功生成 `.mallok/build-manifest.json`，该文件默认 gitignored，不复制到公开输出：

```json
{
  "schemaVersion": "1",
  "target": "static",
  "asOf": "2026-08-27T00:00:00.000Z",
  "mallokVersion": "0.1.0",
  "inputHash": "<sha256>",
  "files": [
    {
      "url": "/index.html",
      "outputPath": "index.html",
      "sha256": "<sha256>",
      "bytes": 1234,
      "kind": "generated"
    },
    {
      "url": "/assets/theme/theme.css",
      "outputPath": "assets/theme/theme.css",
      "sha256": "<sha256>",
      "bytes": 456,
      "kind": "theme"
    }
  ],
  "assets": [
    {
      "url": "/assets/theme/theme.css",
      "outputPath": "assets/theme/theme.css",
      "sha256": "<sha256>",
      "bytes": 456,
      "kind": "theme",
      "contentType": "text/css; charset=utf-8",
      "source": "theme"
    }
  ]
}
```

`files` 是全部具有公开 URL 的受管输出 inventory：static target 包含 generated HTML/XML 与 public/theme 资源，cloudflare target 只包含 public/theme 资源；内部 Worker bundle、manifest 自身和 `dist/assets/_headers` 不进入。`assets` 必须恰好等于 `files` 中 `kind` 为 `public|theme` 的投影，并按 `url/outputPath/sha256/bytes` 一一相同，`source` 与 `kind` 相同。两个数组各自按 `url` 的 Unicode code unit 升序，`url` 唯一；`files.outputPath` 也唯一。任何漏项、额外项或字段漂移均为 `BUILD_MANIFEST_INVALID`。

`inputHash` 按 target 使用不同 canonical JSON：static 为 `{config, visibleContentArtifactHashes, themeBundleHash, assetHashes, versions, asOf, target:"static"}`；cloudflare 为 `{runtimeConfig, themeBundleHash, assetHashes, versions, target:"cloudflare"}`。`runtimeConfig` 只包含会改变 Worker/router/theme/site metadata 的规范配置，不含 account/database id、secret、作者 Markdown 或 D1 current pointer；cloudflare candidate 不使用 build clock选择文章，因此也不包含 `asOf`。这样只 publish Markdown 不会使 Worker candidate失效。manifest自身不进入`files`或自身hash，避免自引用。

build manifest 的 `asOf` 与上面一致：static target 必填 canonical UTC；cloudflare target 禁止该字段。两种 target 共用 schema version，但不能用无意义的时间戳制造不同 candidate。

cloudflare target 另生成可嵌入 Worker 的 asset manifest，包含部署 URL、hash、bytes 和 content type。发布 API 只信任当前 Worker bundle 内嵌的 manifest，不读取客户端提交的清单。每次 deploy 在调用 Wrangler 或执行 migration 前，必须把候选 manifest 与 D1 全部 current pointer 的持久化 `assetReferences` 交叉校验；任何 URL 缺失都以 `DEPLOY_ASSET_CLOSURE_FAILED` 阻断，避免新 bundle 删除仍被线上文章引用的资源。

MVP 资源 URL 没有内容指纹且缓存只有 300 秒，所以同一个 URL 的 bytes/hash 在新 deploy 中允许变化；closure 不比较历史 hash，否则会产生“必须先 deploy 新 bytes 才能 publish、又必须先 publish 才能 deploy”的死锁。若未来要求 asset bytes 与 revision 不可变，必须改为内容寻址 URL/双版本资产协议并新增迁移 ADR。该检查属于 `doctor --remote --deep`/deploy preflight，不由普通公开请求执行。

每个成功 Worker version 的 canonical embedded manifest 与 candidate inventory 必须按各自 SHA-256 保存为 gitignored deployment evidence。Cloudflare version tag 受 32 字符上限约束，不能容纳完整 hash；因此 tag 只使用 [CLOUDFLARE.md](CLOUDFLARE.md) 冻结的 31 字符短指纹，完整 candidate/Worker/asset/inventory hashes 与 version/activation operation+attempt 放入受控 message 和本地 evidence。短 tag 只能用于快速关联，不能单独证明目标 version。rollback 不是把当前 candidate 倒放：它必须读取显式目标 version 的保存 manifest/inventory，在 D1 deployment fence 内重新验证**当前** pointer URL closure；evidence/tag/message/hash/URL 任一不一致就阻断。

## 7. 输出布局

### 7.1 static

```text
dist/
├── index.html
├── 404.html
├── rss.xml
├── sitemap.xml
├── articles/<slug>/index.html
├── assets/theme/**
└── <public files>
```

目录可直接交给任意静态托管。Mallok MVP 不宣称对所有托管平台提供“一键 deploy”；平台适配器属于后续范围。

### 7.2 cloudflare

```text
dist/
├── worker/index.js
└── assets/
    ├── _headers
    ├── assets/theme/**
    └── <public files>
```

cloudflare assets 目录不得生成 `/`、`/articles/**`、`/404.html`、`/rss.xml`、`/sitemap.xml`，确保默认 asset-first 行为找不到静态同名文件后进入 Worker。Cloudflare 的 404 由 Worker 使用同一主题动态渲染。

`dist/assets/_headers` 由 Mallok 确定性生成，内容固定为：

```text
/*
  Cache-Control: public, max-age=300
  X-Content-Type-Options: nosniff
```

MVP 资源 URL 不做文件名指纹改写，因此一律使用 300 秒客户端缓存，不宣称一年 `immutable`。`_headers` 是部署控制文件，不是公开资源：不得进入 public/theme asset manifest、embedded media manifest 或 build manifest 的 `files/assets` 数组，也不得由用户文件覆盖。生成的 Wrangler 配置见 [CLOUDFLARE.md](CLOUDFLARE.md)。

### 7.3 Cloudflare 不可变 candidate snapshot

`dist/**` 是面向本地 preview/检查的可替换视图，**不得**直接作为远程 deploy 的输入。Cloudflare build service 必须在同一个受控写入过程中产生并返回：

```text
.mallok/candidates/<input-hash>/
├── worker/index.js
├── assets/**
├── build-manifest.json
└── asset-manifest.json
```

- `<input-hash>` 必须等于 build manifest 的 64 位小写 hex `inputHash`；snapshot 目录、两个 manifest、Worker bundle 与全部 asset 都是同一 build attempt 的产物；
- 先写项目根内、同文件系统且不可被其他构建发现的随机临时目录，完整验证 inventory/hash 后用 exclusive rename 发布；已存在目标目录时逐项重算并要求完全相同，只可返回 `reused`，任何字节差异返回 `BUILD_NONDETERMINISTIC_OUTPUT`，不得覆盖；
- snapshot 发布后只读；build/dev/preview 不得原地修改或清理它。普通 `dist` 的原子替换不影响 snapshot；
- `worker/index.js` 的原始 bytes SHA-256、asset manifest SHA-256、build manifest SHA-256 与完整 inventory 在返回的 `CloudflareCandidate` 中冻结；deploy 必须在获取 fence 前、进入 external 前以及启动 Wrangler 前重算这些摘要；
- Wrangler 的本次 deploy config 只能引用该 snapshot 内的 `worker/index.js` 与 `assets/`，不得引用 `dist/**`、symlink/junction 或重新解析 project source；
- current/previous deployment state 或 active D1 deployment fence 引用的 snapshot/manifest/inventory evidence 不得清理。未被引用的 orphan snapshot 才可由未来显式 maintenance 按保留策略清理；MVP 不自动清理。

规范端口：

```ts
export interface CloudflareCandidate {
  readonly inputHash: string;
  readonly snapshotPath: string;
  readonly workerBundleHash: string;
  readonly buildManifestHash: string;
  readonly assetManifestHash: string;
  readonly inventoryHash: string;
  readonly inventory: CandidateInventory;
  readonly result: "built" | "reused";
}

export interface CandidateInventory {
  readonly schemaVersion: "1";
  readonly candidateInputHash: string;
  readonly entries: readonly CandidateInventoryEntry[];
}

export interface CandidateInventoryEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: "worker" | "build-manifest" | "asset-manifest" | "asset";
}
```

inventory 必须通过 [`candidate-inventory.schema.json`](schemas/candidate-inventory.schema.json)：按 path 的 Unicode code unit 升序，覆盖 snapshot 下**全部且仅有**的普通文件；固定 singleton 为 `worker/index.js`、`build-manifest.json`、`asset-manifest.json`，其余全部位于 `assets/**`。不得包含 inventory 自身；它的 canonical JSON 存在 snapshot 外的 deploy evidence 中，`inventoryHash` 是该 exact canonical bytes 的 SHA-256。`snapshotPath` 是项目根内的规范 POSIX 相对路径，不是由调用者任意提供。这样 closure、version tag、evidence 与 Wrangler 实际读取的是同一份不可变 candidate，关闭“检查 A、并发构建替换 `dist`、实际部署 B”的本地 TOCTOU。

## 8. 安全写入边界

输出、内容、theme、public、`.git`、`.mallok` 与配置文件之间必须双向不重叠：任何一方不能等于或成为另一方祖先。检查同时覆盖词法路径、existing ancestor `realpath`、symlink/junction 和大小写折叠。

对尚不存在的目标：逐级向上寻找最近存在祖先，验证其 realpath 位于项目根且不是保留根，再创建目录。每次最终 rename 前重新验证，降低检查与使用间路径被替换的风险。

`BuildWriter` 只接受 route planner 产生的 POSIX 相对输出 path；adapter 将其逐段解析，拒绝绝对路径、盘符/UNC、反斜杠、空段、`.`、`..`、NUL、百分号和 Windows 设备名。

## 9. 失败安全替换

Mallok 不宣称所有平台都支持严格原子目录交换。MVP 保证的是“验证失败不触碰旧输出；替换失败尽力回滚”：

1. 在项目 `.mallok/tmp/build-<id>` 写完整 stage；
2. 校验文件清单、hash、路由和 manifest；
3. 将旧 output rename 为同父级唯一 backup；
4. 将 stage rename 为 output；
5. 成功后删除 backup；
6. 第 4 步失败时立即把 backup rename 回 output；若回滚失败，返回 `BUILD_RECOVERY_REQUIRED` 并保留两者的明确绝对路径，不自动删除。

构建开始前清理只能删除 `.mallok/tmp` 下经 schema 验证、超过 24 小时且不属于当前进程的 stage；不得递归删除不明目录。

Windows 上文件句柄可能使 rename 失败。这是可恢复错误，不得退化成逐文件覆盖旧 output。

## 10. 开发模式

dev 与 production 使用相同 loader/compiler/renderer/route planner。默认 dev 使用第 2 节 selection；loopback-only `--include-drafts` 在内存计划中额外包含全部 draft（无视其 future `publishedAt`），但非 draft future 仍按本次 rebuild 固定的 `asOf` 排除。该模式所有响应 `no-store` + `X-Robots-Tag: noindex, nofollow, noarchive`，不得写 stage、manifest 或 production output。开发刷新脚本只能由 dev HTTP 响应在发送前临时注入。重建失败时继续提供最后一次成功产物，并在浏览器错误页/终端显示聚合诊断；错误页面不包含绝对 home 路径或 secret。

## 11. 确定性验收

固定 fixture、Mallok 版本和 `asOf`：

1. 清空两个不同绝对路径下的临时项目；
2. 分别构建；
3. 比较 URL/file 清单、每个文件 bytes 和 manifest（排除 manifest 存放位置）；
4. 第二次构建前改变文件 mtime 和枚举顺序；
5. 结果仍应逐字节一致。

失败注入至少覆盖 renderer 抛错、stage 写满、hash 不符、旧 output rename 失败、新 output rename 失败和 rollback 失败。
