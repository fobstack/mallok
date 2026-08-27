# T-001：Phase 1A foundation and core

- 状态：Approved for implementation
- Base SHA：开始任务前在 clean 文档基线执行 `git rev-parse HEAD`，把结果写入交付报告；不得从旧文档 commit 启动
- 日期：2026-08-27

开始条件：产品负责人已经确认可控制 npm `@mallok` namespace；否则本任务为 `BLOCKED`，必须先统一修改 package/import/文档名称，不能在 T-012 批量补救。

## 1. 目标

只实现实施计划定义的 Phase 1A：建立 workspace 和平台无关的 `@mallok/core`。不实现文件系统、CLI、完整主题、Cloudflare、D1、部署或 GUI。

## 2. 权威顺序与精确必读范围

1. accepted ADR 的明确取代条款与 `docs/SECURITY.md`
2. `docs/PRD.md` 与本任务引用的领域 reference（领域冲突则 `BLOCKED`）
3. `docs/ARCHITECTURE.md`
4. `docs/ACCEPTANCE.md`、`docs/TRACEABILITY.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. 本任务（只能收窄）
7. 现有代码

若存在不可同时满足的条款，返回 `BLOCKED`，不得自行修改权威文档。

开始实现前必须完整阅读下列精确范围，不能只依赖本任务摘要：

- `CLAUDE.md`、`docs/README.md`、`docs/DEVELOPMENT.md`；
- `docs/PRD.md` 第 5.1、5.1.1 节、FR-003～FR-006、NFR-002、NFR-004；
- `docs/ARCHITECTURE.md` 第 3～5、10、12、13 节；
- `docs/CONTENT_CONFIG.md` 第 5～7 节、`docs/BUILD.md` 第 2～5.1 节、`docs/THEME_API.md` 第 6、7 节；
- `docs/SECURITY.md` 第 2、3、9～11 节、`docs/TESTING.md` 第 2～6、8～10、12、13 节、`docs/VERSIONING.md` 第 2、3、6 节；
- `docs/ACCEPTANCE.md` 第 1、8 节中 AC-1A-01～08 对应条款、`docs/TRACEABILITY.md` 中 AC-1A-01～08 对应行、`docs/IMPLEMENTATION_PLAN.md` Phase 1A 与全局质量门；
- ADR-0001～ADR-0004 全文。

## 3. 已批准的计划决策

- `PublishedQuery` 严格使用架构中的 `limit/offset/tag`，不得新增 cursor API。
- `COMPILER_VERSION = "1"`、`SCHEMA_VERSION = "1"`；默认 compile options 固定为 `{ gfm: true, allowRawHtml: false, sanitizeSchemaId: "mallok-default-v1" }`，调用者不可覆盖安全项。
- 无 `publishedAt` 的 published 内容立即可见，列表中排在所有显式日期内容之后，再按 slug 升序。
- `renderMarkdown` 和 `compileEntry` 使用 Web Crypto，因此是异步 API。
- Phase 1A 只实现和测试本阶段抛出点，不能预先冻结其他 adapter 的实现 API；公共 content error union 预留 `CONTENT_COLLECTION_TOO_LARGE` 供 T-002/动态发布使用。
- frontmatter/YAML 推迟到 Phase 1B；Phase 1A 输入是结构化 `ContentInput`。
- 一般 URL helper 允许 `http/https/mailto/tel`、站内相对 URL、query 和 fragment，拒绝协议相对 URL；通用 helper 不替代下面更严格的 Markdown 图片策略。
- Markdown renderer 对图片 destination 使用单独的媒体 URL 策略：只接受绝对 HTTPS 或无 query/fragment 的绝对 `/assets/...`；本阶段只校验 URL 类别，资源是否存在由 T-004/T-009 校验。
- 集合规范化按输入顺序快速失败；Phase 1B 另加文件级聚合诊断。
- 不引入 Prettier，不创建 `.npmrc`。
- 根 `packageManager` 固定 `pnpm@11.1.3`，repository `engines.node` 固定 `^22.13.0 || >=24.0.0`；`@mallok/core` runtime engines 可为 `>=22.0.0`。
- `BuildWriter` 推迟到 Phase 1B。
- `MallokError` 构造签名不增加第五个参数；可操作错误必须提供 hint。
- 公共 content error union 包含 `CONTENT_NOT_PUBLISHABLE`，用于 Markdown 图片 destination 不符合发布策略；不得把“资源尚未部署”降级成普通链接 warning。
- `@mallok/core` 在发布候选前设置 `private: true`；package 必须包含 README，说明 trusted theme code 与 untrusted content。
- 规范 JSON 对所有对象层级递归排序键，数组保序。
- 安全输出路径允许多段 POSIX 相对路径，例如 `articles/hello/index.html`；不得把所有含 `/` 的路径判为非法。
- slug 与输出路径拒绝 Windows 保留设备名。
- `SafeHtml`、`SafeAttribute`、`SafeUrl` 使用模块私有运行时身份；结构相似对象不得伪造。
- `html` 静态片段禁止 script/style/comment；JSON-LD 只用完整 `jsonScript`，避免实现不完整的浏览器 raw-text tokenizer。
- `jsonScript` 同步记录标签之间精确 script text contribution；`SafeHtml` 私有元数据在 `html` 组合中合并，外部不能注册、读取可变集合或伪造 contribution。异步 adapter serializer 才以 Web Crypto 计算 SHA-256 + 标准 Base64 CSP source。
- canonical JSON 拒绝稀疏数组、数组额外 string/symbol key、getter/setter、Proxy/revoked Proxy 和反射异常；不同非纯输入不能静默碰撞为同一 hash。
- 所有 caller-owned `tags/data/entry` 在冻结前深复制，调用后原对象仍可修改。

## 4. 依赖白名单

只允许以下精确版本，不得增加替代品或额外依赖：

### Runtime dependencies of `@mallok/core`

- `unified@11.0.5`
- `remark-parse@11.0.0`
- `remark-gfm@4.0.1`
- `remark-rehype@11.1.2`
- `rehype-sanitize@6.0.0`
- `rehype-stringify@10.0.1`

### Root devDependencies

- `typescript@6.0.3`
- `vitest@4.1.11`
- `@vitest/coverage-v8@4.1.11`
- `eslint@10.9.1`
- `@eslint/js@10.0.1`
- `typescript-eslint@8.68.0`
- `@types/node@22.20.1`

选择 TypeScript 6.0.3 而不是当前 7.0.2，是因为 `typescript-eslint@8.68.0` 的 peer range 为 `>=4.8.4 <6.1.0`。Node types 锁定 22.x，避免类型声明超出项目最低运行时。

## 5. 允许改动

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `tsconfig.json`
- `eslint.config.js`
- `vitest.config.ts`
- `pnpm-lock.yaml`（只能由 pnpm 生成）
- `packages/core/**`

根 `package.json` 必须从本任务起提供稳定 `test:security`（运行当前已有安全 corpus）与 `pack:check:core` scripts；后续任务只能扩展其覆盖面，不能重新定义退出语义。

## 6. 禁止改动

- `README.md`
- `CLAUDE.md`
- `.gitignore`
- `.claude/**`
- `docs/**`
- `.git/**`
- 允许列表外的任何路径

禁止 git add/commit/push、浏览器、npm publish、云端操作和开发服务器。唯一允许的网络步骤是负责人审核 `package.json` 后执行一次受控 bootstrap：

```bash
corepack prepare pnpm@11.1.3 --activate
corepack pnpm install --lockfile-only
corepack pnpm install --frozen-lockfile
```

`corepack prepare pnpm@11.1.3 --activate` 是该 bootstrap 的必需第一步；只允许获取并激活这个精确 pnpm 版本。该步骤只能访问标准 npm registry，只能解析本任务白名单中的精确 direct dependency，并在交付报告中记录命令、registry、lockfile diff 与结果。lockfile 生成并复核后，后续实现与验证阶段一律断网；不得把 `pnpm install --offline` 假设为新环境的必备前提。

## 7. 关键实现约束

- `packages/core/src/**` 不得导入 `node:*`、Cloudflare、Wrangler 或文件系统库。
- 只在 `@mallok/core/adapter` 暴露 reference 定义的异步 `serializeSafeHtml(SafeHtml)` 冻结快照；不得暴露 string → SafeHtml、任意 CSP contribution/source 注册器或可变 metadata。
- Markdown 原始 HTML关闭；必须使用 approved unified/remark/rehype pipeline。
- `SafeHtml` 不能是只有 TypeScript brand 的 primitive string。
- 不从包入口导出任意字符串到 `SafeHtml` 的构造器。
- `html` 必须区分文本与 tag/attribute 上下文；属性只能通过不透明 helper；literal script/style/comment 全部拒绝，不自研简化 raw-text parser。
- `jsonScript` 返回完整 script 元素并处理 `</script>`、`<!--`、`]]>`、U+2028、U+2029；异步 serializer 产生的 CSP hash 必须与最终 script text bytes 一致并按契约排序。
- 所有内容返回值深度冻结，不修改调用者对象。
- 不使用隐式当前时间、随机 ID 或文件 mtime。
- SHA-256 使用 Web Crypto，不得回退到 `node:crypto`。

## 8. 必须覆盖的测试类别

- 内容字段默认值、边界、UUID、日期、data 限额、重复 id/slug；
- draft/未来发布过滤和稳定排序；
- route plan 与 POSIX/Windows 词法路径攻击；
- Markdown raw HTML、危险协议、事件属性、mXSS corpus；
- Markdown 图片的 HTTPS、`/assets/...`、相对路径、query/fragment、`data:`/`file:` corpus；
- HTML 文本/属性/URL/JSON script 上下文；
- JSON script 精确 bytes、标准 Base64/padding、多个 contribution 去重排序、HTML 组合后元数据保留与伪造拒绝；
- 伪造 SafeHtml/SafeAttribute/SafeUrl；
- canonical JSON、source/artifact hash 和 compiler/schema version 变化；
- sparse/array extra key/symbol/getter/Proxy/reflection failure 与调用者不变性；
- 输入不可变、输出深度冻结；
- source/published memory repository；
- 公共导出面和平台依赖边界。

## 9. AC 映射

| AC | 来源 | 验收证据 |
|---|---|---|
| AC-1A-01 | Architecture §3 / NFR-004 | ESM tarball consumer 与 core production boundary |
| AC-1A-02 | FR-006 | Markdown → runtime SafeHtml 与 caller ownership tests |
| AC-1A-03 | FR-006 / NFR-002 | sanitizer、HTML/URL/JSON/CSP contribution 安全 corpus |
| AC-1A-04 | FR-004 | fixed-clock visibility/order vectors |
| AC-1A-05 | FR-005 / NFR-002 | slug/route/POSIX/Windows path corpus |
| AC-1A-06 | FR-003 / NFR-002 | canonical JSON purity、collision 与 cross-runtime hash vectors |
| AC-1A-07 | FR-006 / VERSIONING | source/artifact hash profile invalidation vectors |
| AC-1A-08 | NFR-004 | lint/typecheck/build/coverage thresholds |

## 10. 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm test:security
pnpm build
pnpm pack:check:core
git diff --check
git status --short
```

`pack:check:core` 只打包 `@mallok/core`，在临时 consumer 中从 tarball 安装并验证 Node ESM import 与 TypeScript declarations；本阶段不得要求尚未实现的 `mallok` bin 或其他 package。T-012 才创建覆盖所有发布包与 CLI smoke 的完整 `pack:check`。

覆盖率门：lines/statements/functions ≥ 90%，branches ≥ 85%。不得降低阈值。

## 11. 停止条件

出现以下任一条件时返回 `BLOCKED`：

- 需要白名单外依赖或路径；
- 权威文档冲突；
- 白名单依赖无法解析或 engines 与仓库 Node 基线冲突；
- 除第 6 节一次性受控依赖 bootstrap 外需要联网，或需要 Git、Cloudflare、文件系统实现；
- 必须削弱 sanitizer、类型严格度、测试或覆盖率才能通过。

## 12. 交付报告

必须报告：状态、base SHA、requirement/AC → files/tests 映射、changed files、准确命令与结果、依赖、偏差和剩余风险。不得把未运行的验证写成通过。
