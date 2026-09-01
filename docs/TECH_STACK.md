# Mallok 0.1 技术栈与依赖边界

- 状态：0.1 技术基线（2026-08-28 第二次修订）
- 日期：2026-08-28
- 目标：让实现任务可以直接开始，不把选型决策丢给实现者

本文取代此前的「Bun 自包含桌面 app + Preact Studio + 构建期渲染」技术栈。旧选型的核心前提（渲染在本地机器上跑）已不成立，因此依赖清单基本全部重选。

## 1. 一句话结论

Mallok 是一个 TypeScript 单仓库项目，产物是一个跑在 Cloudflare Workers 上的 Worker（含公开站点、后台、管理 API、向导与官方插件），外加一个发布到 npm 的 CLI。**最硬的选型约束是：所有进入渲染路径的依赖必须是纯 JavaScript、能在 Workers 运行时里跑、且打包后足够小；产品承诺从 Free 计划起步，所以每一段跑在 Worker 里的代码都要以 10 ms CPU 为预算。** 任何需要原生二进制、Node 内置模块或文件系统的库自动出局——CLI 本地部分除外。

## 2. 运行时与仓库

| 领域 | 0.1 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript strict + `noUncheckedIndexedAccess` | 一套类型跨 Worker、CLI 和后台 |
| 线上运行时 | Cloudflare Workers（`workerd`） | 产品定位如此，不做多云抽象 |
| 开发运行时 | Node.js 22 LTS | CLI 要发 npm，Node 兼容性最好；不引入第二个运行时 |
| 包管理 | pnpm + lockfile | 单仓库，锁文件是发行输入 |
| 模块 | ESM only | Workers 原生 ESM，不维护 CJS 双面 |
| 仓库结构 | 单仓库，`src/` 下按 ARCHITECTURE §3 分目录；**不采用 monorepo/workspace 布局** | Deploy to Cloudflare 按钮不支持 monorepo；只有 CLI 单独发布 |
| 构建/部署 | `wrangler` | Cloudflare 官方工具，同时提供本地 D1/R2 模拟与 cron 测试 |

精确版本在第一个 dependency-only 提交中锁定，之后不在功能提交里顺手升级。

## 3. 依赖分层与硬规则

依赖按「能不能进 Worker」分成四层，越界即为架构违规：

| 层 | 位置 | 约束 |
| --- | --- | --- |
| **渲染层** | `src/core/`，同时被 Worker、CLI 和后台预览使用 | 纯 JS、无 Node 内置模块、无 Cloudflare 全局对象、无 DOM 依赖、体积敏感 |
| **Worker 层** | `src/worker/`、`src/db/`、`src/plugins/` | 可用 Workers 运行时 API，不可用 Node 内置模块 |
| **上传端层** | `src/admin/` 的图片处理、`src/cli/` 的图片处理 | 浏览器用 Canvas，CLI 可用 `sharp`；两端产物同规格，不要求逐字节一致 |
| **构建/开发层** | 构建脚本、测试、CLI 的其余本地部分 | 无限制，但绝不进入 Worker 产物 |

`src/core/` 不得 import 任何 Cloudflare 类型或全局对象。这是保证「CLI 的本地预览、后台预览和线上渲染逐字节一致」的唯一机制，必须由 lint 规则强制。

## 4. 渲染管线依赖

| 能力 | 选择 | 说明 |
| --- | --- | --- |
| Markdown 解析 | `unified` + `remark-parse` + `remark-gfm` | 纯 JS。选 AST 方案而不是 `marked`/`markdown-it`，因为插件的 `beforeRender` 钩子需要操作 AST |
| frontmatter | `yaml` | 禁用 alias、自定义 tag、重复 key |
| Markdown → HTML | `remark-rehype` + `rehype-stringify` | 与上游同一生态 |
| HTML 净化 | `rehype-sanitize` | 白名单模式，内容一律不可信 |
| 相对路径解析 | 仓库内部的 rehype 步骤 | 把 `images/x.jpg` 按 `content.assets` 替换为 R2 URL 并补 `srcset` 等属性；只做属性替换，不自写解析 |
| Markdown 序列化 | `mdast-util-to-markdown` + `mdast-util-gfm` | 后台可视编辑（0.2）保存时用，保证导出的是标准 Markdown |
| 模板引擎 | `liquidjs`（浏览器构建 `dist/liquid.browser.mjs`） | 已核实该包提供无 Node 依赖的浏览器构建；Liquid 语法为 Shopify/Jekyll/11ty 通用，主题作者上手成本低；启用 `ownPropertyOnly`、关闭 `raw` 类输出 |
| 校验 | `zod` | 内容字段、`theme.json`、`plugin.json`、API 入参、插件路由入参 |
| 哈希/加密 | WebCrypto（运行时内置） | 内容寻址 sha256、PBKDF2、session token、AES-GCM 加密第三方密钥、HMAC 签名预览链接；不引入第二套 crypto 库 |

渲染分两个阶段（ARCHITECTURE §5）：第一阶段（Markdown → 片段）在保存时执行并缓存于 D1，第二阶段（片段 → 页面）在访客请求时执行。两者都在 `core/`，都必须是纯函数。

**体积是一等约束。** remark/rehype 生态方便但不算小，而 Worker 脚本上限是 gzip 后 3 MB（Free）/ 10 MB（Paid），且官方插件预打包在内。第一个实现任务必须给出打包后的实测体积，超标时的处置顺序是：先裁剪 remark 插件 → 再评估换 `markdown-it` → **绝不自写 Markdown 解析器或 HTML 净化器**。

同样明确排除：`sharp` 及任何原生图片库进入 Worker（Workers 里跑不了），任何依赖 `fs`/`path`/`child_process` 的模板引擎加载方式（模板从 D1 读取，以字符串形式喂给引擎）。

## 5. 外部服务接入

全部通过运行时内置的 `fetch` 直接调用 HTTP API，**不引入任何服务商 SDK 进入 Worker**：

| 服务 | 用途 | 接入方式 |
| --- | --- | --- |
| Cloudflare API | 按标签/URL 清缓存；向导写 DNS 记录 | `fetch` + `CF_API_TOKEN`（Zone 级 Cache Purge + DNS 编辑） |
| Turnstile | 询盘表单防刷 | 页面嵌入官方 widget 脚本（询盘插件声明的唯一客户端 JS）；服务端 `siteverify` 接口 |
| Resend | 询盘通知与自动回执 | `fetch` Resend HTTP API；key 加密存 D1 |
| Workers 限流绑定 | 插件路由防刷 | wrangler 配置的 `ratelimit` 绑定；按数据中心计数、最终一致，只用于防刷 |

## 6. 后台

| 领域 | 选择 | 说明 |
| --- | --- | --- |
| UI 框架 | `preact` + `@preact/signals` | 体积优先；不使用 React 兼容层 |
| 构建 | `vite` + `@preact/preset-vite` | 仅构建期依赖 |
| Markdown 编辑 | `codemirror` + `@codemirror/lang-markdown` | 0.1 唯一的正文编辑器；跑在浏览器里，不进 Worker |
| 字段表单 | 仓库内部按 zod/JSON schema 生成 | 内容类型字段、主题配置、插件设置、插件面板都由 schema 驱动，不写专用表单 |
| 实时预览 | 复用 `src/core/` 在浏览器内渲染 | 与线上逐字节一致 |
| 可视化编辑 | `@tiptap/core` + `@tiptap/pm`（**0.2**） | 0.1 不引入；Tiptap 的 DOM 永远不是内容真相 |
| 样式 | 仓库内部 CSS 变量与组件 | 不引入 Tailwind、CSS-in-JS 或第三方组件库 |
| 图片处理 | 浏览器 Canvas API | 上传时在客户端算 sha256、转 WebP 并生成多宽度变体，见 ARCHITECTURE §8 |

**后台产物用 Cloudflare Workers Static Assets 提供，不打进 Worker 脚本。** 已核实静态资源请求免费且不计入 Worker 调用计费，Free 计划上限 2 万文件、单文件 25 MiB，这样后台 UI 的体积不挤占渲染管线的脚本预算。

## 7. 数据与存储

- **D1**：内容、片段缓存、媒体元数据、主题、设置、插件状态、会话、待办。schema 迁移由 Worker 在运行时自行执行（ARCHITECTURE §15），迁移文件仍按 `wrangler d1 migrations` 的目录与命名约定组织以便本地开发，不引入 ORM 和迁移框架。SQL 手写、参数化绑定，查询集中在 `src/db/`，不向上层泄漏 D1 类型。
- **R2**：媒体本体与主题静态资源，内容寻址 key；通过 R2 自定义域直出。
- **Cache API**：渲染结果缓存，见 ARCHITECTURE §6。
- **不引入 Workers KV 与 Queues**：KV 免费档每天 1000 次写不够用；Queues 免费档虽有每天 1 万次操作，但 0.1 的重试用 `job` 表 + cron 即可。

## 8. CLI

- 发布到 npm，`node >= 22`，可 `npx mallok` 直接用。
- 命令：`create`（部署向导）、`publish <dir>`（发布一个或多个文章包）、`import <dir>`、`export <dir>`、`preview <dir>`（本地渲染）、`media push`。
- 通过 HTTPS 调管理 API，与后台用同一套接口和同一套 Bearer token。**CLI 不是 Worker 的子进程，也不能有后台没有的能力。**
- 复用 `src/core/` 做文章包解析、本地预览和导入导出，保证与线上渲染一致。
- 图片处理用 `sharp`（仅 CLI 依赖，不进 Worker），输出规格与浏览器端一致。
- 命令行解析用轻量方案，不引入重型 CLI 框架。
- 可读取 AI 内容管线产出的 `image-slots.json` 报告缺图，但不依赖它。

## 9. 本地开发

`wrangler dev` 直接提供本地的 D1 和 R2 模拟，且 v3 以上默认持久化数据（可用 `--persist-to` 指定位置）；cron 用 `--test-scheduled` 触发。

因此 **0.1 不自写 dev server**。本地开发就是 `wrangler dev`，跑起来的是和线上完全相同的代码路径，主题、Starter 和插件作者的开发体验与生产一致。

## 10. 质量工具

| 领域 | 选择 |
| --- | --- |
| 类型检查 | `typescript` strict |
| lint / 格式化 | `@biomejs/biome`，不同时维护 ESLint + Prettier |
| 单元测试 | `vitest` |
| Worker 集成测试 | `@cloudflare/vitest-pool-workers`（在真实 workerd 里跑） |
| 后台组件测试 | `@testing-library/preact` + `happy-dom` |
| 属性测试 / 恶意语料 | `fast-check` |
| 端到端 | `playwright` + `@axe-core/playwright` |
| 性能门 | `lighthouse` / `@lhci/cli`，锁定版本，仅开发期使用 |

额外的、工具替代不了的证据：Worker CPU 时间实测（含保存请求）、打包体积实测、缓存命中率与清除延迟实测、真实 Cloudflare 账号上的部署验证、一次真实的询盘邮件收发。

## 11. 依赖 gate

1. 上述是 0.1 唯一批准的直接依赖；未列出的包需先修订本文件。
2. 每个任务先提交 dependency-only diff：精确版本、锁文件、许可证、安装脚本、传递依赖数、体积、以及归属于渲染层 / Worker 层 / 上传端层 / 构建层的哪一层。
3. 生产依赖使用精确版本，不用浮动 tag。
4. 进入渲染层与 Worker 层的依赖必须附一份在真实 `workerd` 里跑通的证据，以及打包后的 gzip 体积。
5. 依赖无法满足契约时返回 BLOCKED 并说明，不用自写解析器或净化器绕过。
6. **「不加依赖」不是绕开第 5 条的理由。** 成熟生态已经解决的问题——压缩、解析、净化——一律采纳现成实现，需要时先修订本文件把它加进第 1 条的清单，而不是在仓库里手写一份。

### 11.1 已登记的依赖备案

| 包 | 版本 | 许可证 | 层 | 传递依赖 | 打包增量（gzip） | 安装脚本 | 备案原因 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| —— | | | | | | | 暂无。`fflate` 曾为主题 zip 解包短暂加入，随「主题改为构建期打包」一并移除（`tasks/TASK-04.md`） |

## 12. 明确禁止

- Astro、Next.js、Nuxt、SvelteKit、Gatsby、Eleventy 等站点框架（Mallok 是它们的替代品，不是它们的包装）；
- 任何原生二进制依赖进入 Worker（`sharp`、`better-sqlite3`、Argon2 原生绑定等）；
- 需要 Node 内置模块的库进入 Worker 层或渲染层；
- ORM、通用 CMS 运行时、第二个模板引擎、第二套渲染管线；
- 运行时动态 `import` 远程代码或任何形式的 `eval`；
- React 兼容层、通用 UI 组件库；
- 任何服务商 SDK（Cloudflare、Resend、Stripe 等）进入 Worker，一律直接 `fetch`；
- Workers KV、Queues、Durable Objects、Cloudflare Images（0.1 用不到）；
- 为「以后可能支持别的云」提前抽象 provider/adapter 层。

## 13. 外部依据

本文引用的平台事实取自以下官方文档，于 2026-08-28 核对：

- Worker 脚本大小、CPU 时间、启动时间、内存、子请求、Cron 数量与静态资源上限：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Workers Free/Paid 价格与包含量：[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- D1 数据库大小、行读写与查询上限：[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)、[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- R2 免费额度与价格、自定义域与缓存：[R2 pricing](https://developers.cloudflare.com/r2/pricing/)、[R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- Cache API 的可用范围与 `cache.delete` 的数据中心局部性：[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- 清缓存的速率限制与 Cache API 条目的清除方式：[Purge cache](https://developers.cloudflare.com/cache/how-to/purge-cache/)、[Purge cache key](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-cache-key/)
- KV 免费档写入上限：[KV limits](https://developers.cloudflare.com/kv/platform/limits/)
- Queues 免费档：[Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- 静态资源请求免费且不计费：[Static assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- Deploy to Cloudflare 按钮的前提与能力：[Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- Turnstile 免费档：[Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)
- Workers 限流绑定的语义：[Rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- Email Workers 发信绑定仅 Paid：[Send emails from Workers](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)
- Resend 免费档与 Pro 价格：[Resend pricing](https://resend.com/pricing)
- 本地 D1 持久化与迁移命令：[D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- `liquidjs` 提供浏览器构建：npm 包 `liquidjs@10.29.0` 的 `browser` 字段映射到 `dist/liquid.browser.mjs`

这些链接只证明平台或依赖具备相关能力，不证明 Mallok 已经锁定版本、打包通过或跑过恶意语料。ARCHITECTURE §18 列出的待验证事项仍是硬门。
