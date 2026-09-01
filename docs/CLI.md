# Mallok CLI

- 状态：0.1 基线（首次编写）
- 日期：2026-08-28
- 地位：定义 `mallok` 命令行工具的命令、参数、认证与退出码。CLI 是三个入口之一，**不是后台的子集，也不是超集**。

## 1. 一句话定义

**`mallok` 是一个发布到 npm 的 Node 命令行工具。它通过 HTTPS 调用与后台完全相同的管理 API，复用 `src/core/` 做文章包解析与本地预览，因此它的输出与线上逐字节一致。**

## 2. 硬约束

| 约束 | 来源 |
| --- | --- |
| `node >= 22`，ESM only，可 `npx mallok` 直接用 | `TECH_STACK §2`、`§8` |
| **CLI 不是 Worker 的子进程，也不能有后台没有的能力** | `TECH_STACK §8` |
| 与后台用同一套 API 和同一套 Bearer token | `PRODUCT_VISION §5.9` |
| 复用 `src/core/`，保证与线上渲染一致 | `ARCHITECTURE §3` |
| 图片处理用 `sharp`（**仅 CLI 依赖，绝不进 Worker**） | `TECH_STACK §4`、`§8` |
| 命令行解析用轻量方案，**不引入重型 CLI 框架** | `TECH_STACK §8` |

`sharp` 是原生依赖，这是允许的——CLI 是 Node 进程，不受「无原生库」规则约束。规则只约束进入 Worker 的东西。

## 3. 命令总览

```
mallok create                     部署一个新站点到你的 Cloudflare 账号
mallok publish <dir>              发布一个或多个文章包（默认发布状态）
mallok import <dir>               导入（默认保留 frontmatter 的状态）
mallok export <dir>               导出整站到目录
mallok preview <dir>              本地渲染文章包，不联网
mallok media push <dir>           只上传媒体，不动内容
mallok destroy <slug>             按顺序删除一个站点的全部资源
```

全局参数：

| 参数 | 说明 |
| --- | --- |
| `--site <slug>` | 目标站点，取自 `.mallok/sites.json`；缺省用唯一的那个，多个时报错 |
| `--url <origin>` | 直接指定站点地址，绕过登记表 |
| `--token <token>` | API token；缺省读环境变量 `MALLOK_TOKEN` |
| `--json` | 机器可读输出，用于 CI 与 AI 内容管线 |
| `--dry-run` | 只报告将要做什么，不写任何东西 |
| `-v, --verbose` | 打印每个 HTTP 请求 |

## 4. 认证

CLI 用**有作用域、可撤销的 API token**（`ARCHITECTURE §14`），在后台生成。

```sh
export MALLOK_TOKEN=mlk_live_xxxxxxxx
mallok publish ./articles
```

- token 明文只在生成时显示一次；D1 里存 `sha256(token)`（`DATA_MODEL §2.8`）。
- 作用域按操作检查：`content:write`、`media:write`、`export`、`settings:write`。
- **`create` 与 `destroy` 不用这个 token**——它们操作 Cloudflare 资源，走 `wrangler` 的 OAuth 身份。

CLI 不把 token 写进任何文件。`.mallok/sites.json` **不放 secret**（`CLOUDFLARE_RESOURCES.md §9`）。

## 5. `mallok create`

按 `CLOUDFLARE_RESOURCES.md §6` 的十步顺序执行，此处不重复。要点：

- 全程用 `wrangler login` 的 OAuth 身份，**不要求用户手动创建 token**；
- 交互式收集 slug、域名、默认语言、Starter；
- 参数化以便站群脚本化：`--slug`、`--domain`、`--locale`、`--starter`；
- 每一步打印结果，**任何一步失败就停下来说明，不跳过**；
- 结束时打开 `/_mallok/setup`，向导接手。

**schema 迁移由 Worker 在第一次请求时自行执行，CLI 不跑迁移**（`CLOUDFLARE_RESOURCES.md §6` 第 10 步）。

## 6. `mallok publish` / `import`

两者共用一条管线，**只有默认状态不同**（`CONTENT_FORMAT §7.4`）：

| | 默认状态 |
| --- | --- |
| `publish` | 发布 |
| `import` | 保留 frontmatter 里的状态 |

都支持 `--draft` 强制为草稿。

### 6.1 输入布局

自动识别三种（`CONTENT_FORMAT §7.1`）：Mallok 导出布局、文章包目录、散 `*.md` 文件。

目录名或 `--kind` 无法匹配任何已启用类型时，**导入停止并列出无法识别的目录，不猜测、不静默归入 `article`**。

### 6.2 流程

```
扫描目录 → 识别布局 → 解析每个文章包
  → 校验 frontmatter（按 theme.json 的字段 schema）
  → 收集相对路径引用，算每个文件的 sha256
  → 问 API 哪些 sha 已存在
  → 缺失的：sharp 转 WebP + 生成变体 → 上传
  → 逐个 POST 内容（含 assets 映射）
  → 打印结果表
```

### 6.3 幂等

**文章包内容与线上完全一致时，导入是空操作：不写 D1、不清缓存**（`CONTENT_FORMAT §7.2`）。判定依据是 `index*.md` 的文本与所有引用文件的 sha。

这条是为每日 AI 内容管线设计的——可以放心重复执行整个目录。

### 6.4 身份与冲突

按 `CONTENT_FORMAT §7.2` 的表处理。`--create-only` 时遇到已存在即报错，不覆盖。

### 6.5 分批

D1 单条 SQL 上限 100 KB、每次调用查询数上限 50（`ARCHITECTURE §2`）。CLI 按此分批，**不一次性提交整个目录**。

### 6.6 缺图报告

引用了包里不存在的文件是正常状态（`CONTENT_FORMAT §4` 第 6 条）。CLI：

- 打印「N 篇内容共缺 M 个文件」，逐条列出；
- 包内若有 `image-slots.json`，读取它以报告哪些图片槽位尚未提供（`CONTENT_FORMAT §7.5`）；
- **发布时警告但不阻止**；
- `--fail-on-missing` 让 CI 可以选择严格模式。

Mallok 不解释 `image-requirements.md` 等其他文件，也不会上传它们。

## 6.7 `mallok build` —— 不用 D1 的那条路（2026-08-31 新增）

```sh
mallok build ./my-site --theme ./src/themes/atelier --origin https://example.com
```

读一个本地目录，产出一个完整的静态站，**全程不碰 D1、不碰网络**。目录布局就是 `CONTENT_FORMAT §5` 的导出布局——所以 `mallok export` 的产物可以直接 `mallok build`。

```
my-site/
├── site.json          # 名称、语言、内容类型、导航、主题配置项
├── content/
│   ├── article/  product/  category/  faq/ …
└── media/             # 可选：未被引用的媒体
```

生成的东西：每条内容一页（含各语言）、每种类型的列表页（分页）、**标签归档**、每语言首页与 feed、`sitemap.xml`（含 hreflang 与 x-default）、`robots.txt`、主题资源、各文章包引用的图片。

**渲染用的是和 Worker 完全相同的 `src/core` 函数**，所以同样的输入产出同样的字节。这正是 `src/core` 不许 import Cloudflare 类型的原因。

### 仓库自带一份可直接构建的 `content/`（2026-08-31 决定）

仓库根目录的 `site.json` 与 `content/` **就是这个布局**，不是示例的副本：

```sh
pnpm build:site      # → dist/site，34 页，双语
```

同一批文件同时是 starter 的内容源——`src/starters/trade-b2b/index.ts` 用
`import … from '../../../content/<kind>/<slug>/index.md'` 读它们，设置读
根目录的 `site.json`。所以首次启动向导导进 D1 的，和 `mallok build` 编译成
静态站的，是同一份文件；改 `content/` 两条路一起变。

之前 starter 在 `src/starters/trade-b2b/content/` 下另存了一份，fork 仓库的
人看不到内容目录、也无从下手改。旧副本已移到 `_to_delete/`。

`test/cli/content-dir.test.ts` 把两种读法钉在一起：目录名必须是 `site.json`
声明的类型、starter 的条目必须与磁盘上的包一一对应、翻译的 `slug`
前言必须等于向导用的那个（否则同一页在两条路上会得到两个 URL）。

### 静态构建做不到什么

诚实地列出来，而不是让用户自己撞上：

| 做不到 | 为什么 |
| --- | --- |
| **询盘表单** | 表单要有服务端接收。构建时遇到 `[[inquiry]]` 会**移除标记并报告**，而不是留一个点了没反应的表单 |
| 后台编辑器 | 没有可写的地方 |
| 改完即时生效 | 改内容 = 重新构建 + 重新部署 |
| 定时发布 | 构建那一刻的时间决定什么算已发布；到点不会自己出现 |

**关联断链会被报出来**：`category: 某个不存在的 slug` 在有后台的站点上由内容选择器兜底，静态构建没有这层保护，所以它明确报错而不是悄悄少一个链接。

## 7. `mallok export`

产出 `CONTENT_FORMAT §5` 的目录布局。硬性保证：

- `index*.md` **逐字节等于** `content.markdown`；
- `images/`、`files/` 按 `assets` 映射从 R2 取原图，文件名用映射的键（不用 R2 的哈希名）；
- 未被引用的媒体进顶层 `media/`；
- **导出不包含** `render_cache`、会话、token、任何加密项。

`--include-inquiries` 控制是否导出 `inquiries.csv`（默认包含，因为「数据能带走」是产品承诺）。

## 8. `mallok preview`

本地渲染，**完全不联网**。

```sh
mallok preview ./articles/titanium-price-2026-08 --theme ./src/themes/atelier
```

- 用 `src/core/` 跑两个阶段，输出 HTML 到 stdout 或 `--out <dir>`；
- 主题从本地目录或已下载的 zip 读；
- 用于主题作者与内容作者在发布前检查。

因为跑的是同一套 `src/core/`，预览结果与线上**逐字节一致**——这是 `core/` 不许 import Cloudflare 或 Node API 的全部意义（`CONTRIBUTING.md` 分层规则）。

## 9. `mallok media push`

只上传媒体、建立 `media` 行，不创建或修改内容。用于先把图片备好、稍后再发内容的工作流。

## 10. `mallok destroy <slug>`

按 `CLOUDFLARE_RESOURCES.md §10` 的九步顺序执行，**每步幂等、每步打印结果、任何一步失败停下来说明，不跳过**。

第一步是确认已导出。`--yes` 跳过交互确认，但**不跳过导出检查**——除非再加 `--i-have-a-backup`。

## 11. 输出与退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 用户错误（参数、文件不存在、校验失败） |
| 2 | 认证失败（token 无效、作用域不足） |
| 3 | 远端错误（API 5xx、配额耗尽） |
| 4 | 部分成功（一批内容里有失败项） |

`--json` 时输出单个 JSON 对象到 stdout，人类可读的进度走 stderr。这样 `mallok publish --json | jq` 可用。

D1 免费档超额当天不可用（`ARCHITECTURE §2`），CLI 遇到这个错误必须给出**明确的、非技术的**说明，而不是透传 SQL 错误。

## 12. 错误信息规则

- 不透传 SQL、bucket 名、database id 或堆栈（`CONTRIBUTING.md`）；
- 校验失败时指出**哪个文件的哪个字段**，不给「invalid input」；
- 网络失败区分「连不上」与「服务端拒绝」，后者带上服务端给的 message。

## 13. 明确不做

- 不做本地 dev server（`wrangler dev` 已经是，`TECH_STACK §9`）；
- 不做交互式内容编辑器（那是后台的事）；
- 不做 CLI 独有的能力（`TECH_STACK §8`）；
- 不引入重型 CLI 框架；
- 不缓存 token 到磁盘；
- 不做 WordPress 导入（0.2，`ARCHITECTURE §16`）；
- 不做产品 CSV/Excel 导入（0.2）。
