# Mallok 0.1 技术栈与依赖边界

- 状态：Accepted for 0.1 implementation
- 目标：让 Task 01 可直接开始，不把换栈决策丢给实现者

## 1. 一句话结论

Mallok 是一个 TypeScript + Bun 的单仓库、单发行产品。`Mallok.app` 启动本地 loopback backend 并在系统浏览器打开 Preact Studio；同一 Bun application core 也暴露高级 CLI。Tier-1 另允许一个只负责 macOS Keychain 的签名 Swift helper，它不是第二套业务 runtime。用户站点不包含任何这些依赖。

## 2. Runtime 与仓库

| 领域 | 0.1 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript strict | 一套类型跨 local app、compiler 和 Worker |
| 开发/runtime | Bun stable | 内置 HTTP、Web API、test/build 与 standalone executable |
| 包管理 | 根 `package.json` + `bun.lock` | 只有 Mallok 自己有依赖，用户站点永不生成依赖树 |
| 模块 | ESM only | 不维护 CJS 双面 |
| 源码结构 | `src/domain|application|compiler|templates|adapters|embedded` | 与 ARCHITECTURE 一致，不拆 npm packages |
| 首发 | macOS 13+ Apple Silicon | 一个真正支持的平台优先于多平台假完成 |

Bun 的 exact version 在 Task 01 第一个 dependency-only commit 锁定并写入 engine/toolchain 文件。选择当时最新 stable，但只有通过 Tier-1 standalone compile、loopback server、WebCrypto、SQLite/Worker bundle 和 macOS clean-machine smoke 后才能升级基线。

## 3. Studio

- UI：`preact`、`@preact/signals`；不使用 React compatibility mode。
- build-only：`vite`、`@preact/preset-vite`；产物作为 hashed static bytes 嵌入 executable。
- 样式：仓库内部 CSS tokens/components；不使用 Tailwind、CSS-in-JS 或第三方组件库。
- 路由/状态：0.1 只有四个产品区，使用小型内部 state/router；不引入通用 SPA framework。
- backend：`Bun.serve` 绑定 `127.0.0.1`/`::1`，使用 SECURITY 规定的 session capability、Origin/Host 和 CSRF 边界。
- desktop shell：定制 `Mallok.app` bundle + `Info.plist`，启动 executable 后打开系统默认浏览器；0.1 不引入 Electron、Tauri 或 WebView runtime。

## 4. 编辑器与内容管线

### 4.1 可视编辑

- `@tiptap/core`、`@tiptap/pm`、`@tiptap/starter-kit` 及完成 EDITOR 节点所需的官方 link/image/table extensions。
- Markdown source mode：`codemirror`、`@codemirror/lang-markdown`。
- 不使用当前仍标 Beta 的 `@tiptap/markdown` 作为 0.1 数据真相。批准节点在 ProseMirror JSON 与 compiler 共用 mdast 之间做小型、穷尽的类型映射，Markdown 输出由 `mdast-util-to-markdown` + `mdast-util-gfm` 的固定选项生成。这是 AST adapter，不是自写 Markdown parser。
- Tiptap DOM 不是发布真相；每次保存生成 Markdown，preview/publish 再从磁盘 Markdown 经 compiler 解析。
- 不支持可视节点保留原 source，Studio 回退到 source mode；不因 editor extension 默认行为丢数据。

### 4.2 Compiler

| 能力 | 批准依赖 |
| --- | --- |
| Markdown AST/GFM | `unified`, `remark-parse`, `remark-gfm`, `mdast-util-to-markdown`, `mdast-util-gfm` |
| HTML AST | `remark-rehype`, `rehype-sanitize`, `rehype-stringify`, `parse5` |
| frontmatter | `yaml`，配置禁止 alias/custom tag/duplicate key |
| 字段验证 | `zod` |
| 声明式模板 | `liquidjs`，只开放 TEMPLATE_FORMAT 定义的 Mallok profile |
| 图片安全与优化 | `sharp`，读取批准格式 metadata，并按 `SEO_PERFORMANCE.md` 的固定单输出 WebP profile 自动定向/缩小/清理 metadata/编码 |
| 备份 tar.gz | `tar-stream` + runtime 内置 `node:zlib`，只用流式 entry API，不调用直接解压到目标目录的 convenience API |
| hash/crypto | Web Crypto；不引入第二套 crypto package |

Liquid 引擎的默认 tag/filter 不是公共能力。adapter 必须在 parse/compile 时拒绝非白名单语法；不得为了省事暴露完整 LiquidJS。

`sharp` 和 `tar-stream` 在 Task 02 的 dependency-only gate 锁 exact version。图片读取固定 `limitInputPixels=40_000_000`、`limitInputChannels=4`、`sequentialRead=true`、`unlimited=false`、`failOn='warning'`，并由 Mallok 再验证 `PROJECT_FORMAT.md` 的单帧上限。公开图片执行 `SEO_PERFORMANCE.md` 的确定性 WebP 三段 profile；作者源文件不改写。`sharp` 的原生 binary/libvips 必须随 Tier-1 standalone app 正确签名和打包；干净 macOS 机器不得依赖全局 Node、Bun 或 libvips。

备份使用 `tar-stream` 的 header/data stream 和内置 gzip 流；Mallok 在写磁盘前决定每个 entry 的合法性并逐 byte 计预算，只自行创建普通目录/文件。禁止自己解析 tar header，也禁止使用会在检查 entry type 前创建 link 或覆盖目标的通用 extractor。若锁定版本无法在 Bun standalone 中满足 streaming、PAX、entry type、预算中断或签名发行要求，Task 02 返回 `BLOCKED` 并先修订本文件；不得退回 shell `tar`、不安全的直接 extraction 或手写 archive parser。

## 5. Cloudflare

- runtime Worker 使用 Web-standard TypeScript，在 release build 中编译为嵌入 bytes；用户机器不需要 Wrangler。
- Studio 通过 Cloudflare 官方 HTTPS API + OAuth PKCE 直接完成 account-level provision；普通 publish 只调 generic Worker 的 site-scoped API。
- OS credential：Tier-1 macOS 随 app 签名一个最小 Swift `mallok-keychain-helper`，只封装 Security.framework 的 `SecItemAdd/CopyMatching/Update/Delete` 和固定 Mallok service/account schema。Bun core 以固定 bundle-relative path 直接 spawn helper，不经过 shell；secret 只走有长度上限的 inherited stdin/stdout frame，不进入 argv/environment/log。helper 无网络、项目文件和任意 keychain query 能力，并与主 app 一起 codesign/notarize。Task 03 必须在 clean machine 验证 add/find/update/delete、ACL prompt、取消和错误语义；禁止使用实验性的 Bun FFI 或把 `/usr/bin/security` CLI 当生产 API。
- Cloudflare contract test 可在 Task 03 的 dependency-only gate 加入 `wrangler`、`vitest`、`@cloudflare/vitest-pool-workers`；这些是开发/验证依赖，不进 runtime executable。

## 6. 质量工具

- typecheck：`typescript`，strict + no unchecked indexed access。
- lint/format：`@biomejs/biome`，不同时维护 ESLint/Prettier 组合。
- unit/component：`vitest`、`@testing-library/preact`、`happy-dom`。
- property/fault corpus：`fast-check`。
- Studio/website E2E：`playwright`、`@axe-core/playwright`。
- SEO/PageSpeed release gate：锁定 exact `lighthouse` 与 `@lhci/cli`，只作为开发/发行验证依赖，不进入 `Mallok.app` 或用户站点；runner 同时锁 Chrome、mobile 配置和顺序 5-run 聚合协议。
- 无障碍人工测试、clean-machine、真人 usability 和 Cloudflare staging 仍是独立证据，不被工具包替代。

## 7. 依赖 gate

1. 上述是 0.1 唯一批准的直接依赖名称空间；未列包需先修订本文。
2. 每个任务先提交 dependency-only diff：exact version、lock、license、engine、install script、transitive count、体积和 runtime/build/test 归属。
3. 生产 dependency 使用 exact version，lock 是发行输入；不使用 floating tag。
4. 禁止在一个功能 diff 中顺手升级工具链。
5. 依赖的安全性、维护状态或数据往返无法满足契约时返回 BLOCKED，不用自写 parser/sanitizer 或弱化 AC 规避。
6. Task 02 的 dependency gate 额外提供两份 clean-machine 证据：`sharp` 在签名 app 中覆盖 PNG/JPEG/WebP/AVIF/单帧 GIF metadata、动画拒绝、三段优化 profile、输出 hash/bytes/尺寸与拒绝语料且不加载全局 libvips；`tar-stream` 覆盖 gzip、PAX、非普通 entry、bomb、截断和恢复，并证明失败前不触及最终目标。

## 8. 明确禁止

- Astro、Next.js、Nuxt、SvelteKit、Gatsby、Eleventy 等站点框架；
- Electron、Tauri、第二 JavaScript runtime 或第二 package manager；
- React compatibility layer、通用 UI kit、Tailwind、ORM、通用 CMS/plugin/theme runtime；
- runtime 中的 Wrangler、每站点 npm 依赖、动态安装和远程代码执行；
- 为了抽象而拆 monorepo packages、公共 SDK 或 provider/plugin API。

## 9. 外部能力依据

- sharp 官方列出 Bun 安装入口、macOS ARM64 prebuilt binary，并提供受限 metadata、autoOrient、resize 和 WebP output options：[Installation](https://sharp.pixelplumbing.com/install/)、[Input metadata](https://sharp.pixelplumbing.com/api-input/)、[Constructor](https://sharp.pixelplumbing.com/api-constructor/)、[Image operations](https://sharp.pixelplumbing.com/api-operation/)、[Resize](https://sharp.pixelplumbing.com/api-resize/)、[Output](https://sharp.pixelplumbing.com/api-output/)。
- tar-stream 提供不落盘的 streaming tar parser/generator 与 entry header/data stream；gzip 由 runtime 内置 `node:zlib` 处理：[tar-stream](https://github.com/mafintosh/tar-stream)。

这些链接只证明候选依赖提供相关 API，不证明其已被 Mallok 锁版本、打入 standalone app 或通过恶意语料；Task 02 的 dependency gate 仍是硬门。
