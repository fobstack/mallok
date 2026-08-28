# Mallok 0.1 技术栈与依赖边界

- 状态：0.1 技术基线
- 日期：2026-08-28
- 目标：让实现任务可以直接开始，不把选型决策丢给实现者

本文取代此前的「Bun 自包含桌面 app + Preact Studio + 构建期渲染」技术栈。旧选型的核心前提（渲染在本地机器上跑）已不成立，因此依赖清单基本全部重选。

## 1. 一句话结论

Mallok 是一个 TypeScript 单仓库项目，产物是一个跑在 Cloudflare Workers 上的 Worker（含公开站点、后台和管理 API），外加一个发布到 npm 的 CLI。**最硬的选型约束是：所有进入渲染路径的依赖必须是纯 JavaScript、能在 Workers 运行时里跑、且打包后足够小。** 任何需要原生二进制、Node 内置模块或文件系统的库自动出局。

## 2. 运行时与仓库

| 领域 | 0.1 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript strict + `noUncheckedIndexedAccess` | 一套类型跨 Worker、CLI 和后台 |
| 线上运行时 | Cloudflare Workers（`workerd`） | 产品定位如此，不做多云抽象 |
| 开发运行时 | Node.js 22 LTS | CLI 要发 npm，Node 兼容性最好；不引入第二个运行时 |
| 包管理 | pnpm + lockfile | 单仓库，锁文件是发行输入 |
| 模块 | ESM only | Workers 原生 ESM，不维护 CJS 双面 |
| 仓库结构 | 单仓库，`src/` 下按 §3 分目录 | 不拆 npm workspace，只有 CLI 单独发布 |
| 构建/部署 | `wrangler` | Cloudflare 官方工具，同时提供本地 D1/R2 模拟 |

精确版本在第一个 dependency-only 提交中锁定，之后不在功能提交里顺手升级。

## 3. 依赖分层与硬规则

依赖按「能不能进 Worker」分成三层，越界即为架构违规：

| 层 | 位置 | 约束 |
| --- | --- | --- |
| **渲染层** | `src/core/`，同时被 Worker 和 CLI 使用 | 纯 JS、无 Node 内置模块、无 Cloudflare 全局对象、体积敏感 |
| **Worker 层** | `src/worker/`、`src/db/` | 可用 Workers 运行时 API，不可用 Node 内置模块 |
| **构建/开发层** | 构建脚本、测试、CLI 的本地部分 | 无限制，但绝不进入 Worker 产物 |

`src/core/` 不得 import 任何 Cloudflare 类型或全局对象。这是保证「CLI 的本地预览和线上渲染逐字节一致」的唯一机制，必须由 lint 规则强制。

## 4. 渲染管线依赖

| 能力 | 选择 | 说明 |
| --- | --- | --- |
| Markdown 解析 | `unified` + `remark-parse` + `remark-gfm` | 纯 JS。选 AST 方案而不是 `marked`/`markdown-it`，因为插件的 `beforeRender` 钩子需要操作 AST |
| frontmatter | `yaml` | 禁用 alias、自定义 tag、重复 key |
| Markdown → HTML | `remark-rehype` + `rehype-stringify` | 与上游同一生态 |
| HTML 净化 | `rehype-sanitize` | 白名单模式，内容一律不可信 |
| Markdown 序列化 | `mdast-util-to-markdown` + `mdast-util-gfm` | 后台可视编辑保存时用，保证导出的是标准 Markdown |
| 模板引擎 | `liquidjs`（浏览器构建 `dist/liquid.browser.mjs`） | 已核实该包提供无 Node 依赖的浏览器构建；Liquid 语法为 Shopify/Jekyll/11ty 通用，主题作者上手成本低 |
| 校验 | `zod` | 内容字段、`theme.json`、`plugin.json`、API 入参 |
| 哈希/加密 | WebCrypto（运行时内置） | 内容寻址、PBKDF2、session token；不引入第二套 crypto 库 |

**体积是一等约束。** remark/rehype 生态方便但不算小，而 Worker 脚本上限是 gzip 后 3 MB（Free）/ 10 MB（Paid）。第一个实现任务必须给出打包后的实测体积，超标时的处置顺序是：先裁剪 remark 插件 → 再评估换 `markdown-it` → **绝不自写 Markdown 解析器或 HTML 净化器**。

同样明确排除：`sharp` 及任何原生图片库（Workers 里跑不了），任何依赖 `fs`/`path`/`child_process` 的模板引擎加载方式（模板从 D1 读取，以字符串形式喂给引擎）。

## 5. 后台

| 领域 | 选择 | 说明 |
| --- | --- | --- |
| UI 框架 | `preact` + `@preact/signals` | 体积优先；不使用 React 兼容层 |
| 构建 | `vite` + `@preact/preset-vite` | 仅构建期依赖 |
| 富文本编辑 | `@tiptap/core` + `@tiptap/pm` + 必要官方扩展 | 跑在浏览器里，不进 Worker |
| Markdown 源码模式 | `codemirror` + `@codemirror/lang-markdown` | 同上 |
| 样式 | 仓库内部 CSS 变量与组件 | 不引入 Tailwind、CSS-in-JS 或第三方组件库 |
| 图片处理 | 浏览器 Canvas API | 上传时在客户端转 WebP 并生成多宽度变体，见 ARCHITECTURE §8 |

**后台产物用 Cloudflare Workers Static Assets 提供，不打进 Worker 脚本。** 已核实静态资源请求免费且不计入 Worker 调用计费，这样后台 UI 的体积不挤占渲染管线的脚本预算。（具体的文件数与单文件大小上限需在实现任务中核实。）

Tiptap 的 DOM 不是内容真相。每次保存都把编辑器状态序列化成 Markdown 存进 D1；渲染永远从 D1 里的 Markdown 重新解析。可视编辑无法无损表达的内容，后台退回源码模式，绝不因编辑器默认行为丢数据。

## 6. 数据与存储

- **D1**：内容、主题、设置、会话。用 `wrangler d1 migrations` 管理 schema 版本，不引入 ORM 和迁移框架。SQL 手写、参数化绑定，查询集中在 `src/db/`，不向上层泄漏 D1 类型。
- **R2**：媒体本体与主题静态资源，内容寻址 key。
- **Cache API**：渲染结果缓存，见 ARCHITECTURE §6。
- 不引入 Workers KV，除非 ARCHITECTURE §6.2 的备选缓存方案被实测证明必需。

## 7. CLI

- 发布到 npm，`node >= 22`，可 `npx mallok` 直接用。
- 通过 HTTPS 调管理 API，与后台用同一套接口和同一套 Bearer token。**CLI 不是 Worker 的子进程，也不能有后台没有的能力。**
- 复用 `src/core/` 做本地预览和导入导出，保证与线上渲染一致。
- 命令行解析用轻量方案，不引入重型 CLI 框架。

## 8. 本地开发

`wrangler dev` 直接提供本地的 D1 和 R2 模拟，且 v3 以上默认持久化数据（可用 `--persist-to` 指定位置），迁移用 `wrangler d1 migrations apply <db> --local`。

因此 **0.1 不自写 dev server**。本地开发就是 `wrangler dev`，跑起来的是和线上完全相同的代码路径，主题和插件作者的开发体验与生产一致。

## 9. 质量工具

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

额外的、工具替代不了的证据：Worker CPU 时间实测、打包体积实测、缓存命中率实测、真实 Cloudflare 账号上的部署验证。

## 10. 依赖 gate

1. 上述是 0.1 唯一批准的直接依赖；未列出的包需先修订本文件。
2. 每个任务先提交 dependency-only diff：精确版本、锁文件、许可证、安装脚本、传递依赖数、体积、以及归属于渲染层 / Worker 层 / 构建层的哪一层。
3. 生产依赖使用精确版本，不用浮动 tag。
4. 进入渲染层的依赖必须附一份在真实 `workerd` 里跑通的证据，以及打包后的 gzip 体积。
5. 依赖无法满足契约时返回 BLOCKED 并说明，不用自写解析器或净化器绕过。

## 11. 明确禁止

- Astro、Next.js、Nuxt、SvelteKit、Gatsby、Eleventy 等站点框架（Mallok 是它们的替代品，不是它们的包装）；
- 任何原生二进制依赖（`sharp`、`better-sqlite3`、Argon2 原生绑定等）；
- 需要 Node 内置模块的库进入 Worker 层或渲染层；
- ORM、通用 CMS 运行时、第二个模板引擎、第二套渲染管线；
- 运行时动态 `import` 远程代码或任何形式的 `eval`；
- React 兼容层、通用 UI 组件库；
- 为「以后可能支持别的云」提前抽象 provider/adapter 层。

## 12. 外部依据

本文引用的平台事实取自以下官方文档，于 2026-08-28 核对：

- Worker 脚本大小、CPU 时间、启动时间、内存与子请求上限：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- D1 数据库大小、每次调用查询数、行与语句上限：[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- Cache API 的作用域与 `cache.delete` 的数据中心局部性：[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- 静态资源请求免费且不计费：[Static assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- 本地 D1 持久化与迁移命令：[D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- `liquidjs` 提供浏览器构建：npm 包 `liquidjs@10.29.0` 的 `browser` 字段映射到 `dist/liquid.browser.mjs`

这些链接只证明平台或依赖具备相关能力，不证明 Mallok 已经锁定版本、打包通过或跑过恶意语料。ARCHITECTURE §15 列出的待验证事项仍是硬门。
