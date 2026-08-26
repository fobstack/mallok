# T-001：Phase 1A foundation and core

- 状态：Approved for implementation
- Authority base SHA：`5573d2f911bda1fa2ae083765c5456d2cc242ac2`
- Claude planning session：`3cf9220e-dad3-4576-a0c8-b1bf5c842481`
- 日期：2026-08-27

## 1. 目标

只实现 `.claude/prompts/01-foundation-core.md` 定义的 Phase 1A：建立 workspace 和平台无关的 `@mallok/core`。不实现文件系统、CLI、主题、Cloudflare、D1、部署或 GUI。

## 2. 权威顺序

1. `docs/PRD.md`
2. `docs/ARCHITECTURE.md`
3. `docs/ACCEPTANCE.md`
4. `docs/IMPLEMENTATION_PLAN.md`
5. 本任务
6. `.claude/prompts/01-foundation-core.md`
7. 现有代码

若存在不可同时满足的条款，返回 `BLOCKED`，不得自行修改权威文档。

## 3. 已批准的计划决策

- `PublishedQuery` 严格使用架构中的 `limit/offset/tag`，不得新增 cursor API。
- `COMPILER_VERSION = "1"`、`SCHEMA_VERSION = "1"`；默认 compile options 固定为 `{ gfm: true, allowRawHtml: false, sanitizeSchemaId: "mallok-default-v1" }`，调用者不可覆盖安全项。
- 无 `publishedAt` 的 published 内容立即可见，列表中排在所有显式日期内容之后，再按 slug 升序。
- `renderMarkdown` 和 `compileEntry` 使用 Web Crypto，因此是异步 API。
- Phase 1A 可以声明架构中全部错误码，但只实现和测试 Phase 1A 列出的抛出点。
- frontmatter/YAML 推迟到 Phase 1B；Phase 1A 输入是结构化 `ContentInput`。
- 一般 URL helper 允许 `http/https/mailto/tel`、站内相对 URL、query 和 fragment，拒绝协议相对 URL；媒体层的 HTTPS 限制不在本阶段。
- 集合规范化按输入顺序快速失败；Phase 1B 另加文件级聚合诊断。
- 不引入 Prettier，不创建 `.npmrc`。
- `BuildWriter` 推迟到 Phase 1B。
- `MallokError` 构造签名不增加第五个参数；可操作错误必须提供 hint。
- `@mallok/core` 在发布候选前设置 `private: true`。
- 规范 JSON 对所有对象层级递归排序键，数组保序。
- 安全输出路径允许多段 POSIX 相对路径，例如 `articles/hello/index.html`；不得把所有含 `/` 的路径判为非法。
- slug 与输出路径拒绝 Windows 保留设备名。
- `SafeHtml`、`SafeAttribute`、`SafeUrl` 使用模块私有运行时身份；结构相似对象不得伪造。

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

## 6. 禁止改动

- `README.md`
- `CLAUDE.md`
- `.gitignore`
- `.claude/**`
- `docs/**`
- `.git/**`
- 允许列表外的任何路径

禁止 git add/commit/push、网络搜索、浏览器、MCP、子代理、npm publish、云端操作和开发服务器。

## 7. 关键实现约束

- `packages/core/src/**` 不得导入 `node:*`、Cloudflare、Wrangler 或文件系统库。
- Markdown 原始 HTML关闭；必须使用 approved unified/remark/rehype pipeline。
- `SafeHtml` 不能是只有 TypeScript brand 的 primitive string。
- 不从包入口导出任意字符串到 `SafeHtml` 的构造器。
- `html` 必须区分文本、tag/attribute、script/style 上下文；属性只能通过不透明 helper。
- `jsonScript` 返回完整 script 元素并处理 `</script>`、`<!--`、`]]>`、U+2028、U+2029。
- 所有内容返回值深度冻结，不修改调用者对象。
- 不使用隐式当前时间、随机 ID 或文件 mtime。
- SHA-256 使用 Web Crypto，不得回退到 `node:crypto`。

## 8. 必须覆盖的测试类别

- 内容字段默认值、边界、UUID、日期、data 限额、重复 id/slug；
- draft/未来发布过滤和稳定排序；
- route plan 与 POSIX/Windows 词法路径攻击；
- Markdown raw HTML、危险协议、事件属性、mXSS corpus；
- HTML 文本/属性/URL/JSON script 上下文；
- 伪造 SafeHtml/SafeAttribute/SafeUrl；
- canonical JSON、source/artifact hash 和 compiler/schema version 变化；
- 输入不可变、输出深度冻结；
- source/published memory repository；
- 公共导出面和平台依赖边界。

## 9. 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test -- --coverage
pnpm build
```

覆盖率门：lines/statements/functions ≥ 90%，branches ≥ 85%。不得降低阈值。

## 10. 停止条件

出现以下任一条件时返回 `BLOCKED`：

- 需要白名单外依赖或路径；
- 权威文档冲突；
- offline install 缺包；
- 需要联网、Git、Cloudflare 或文件系统实现；
- 必须削弱 sanitizer、类型严格度、测试或覆盖率才能通过。

## 11. 交付报告

必须报告：状态、requirement → files/tests 映射、changed files、准确命令与结果、依赖、偏差和剩余风险。不得把未运行的验证写成通过。

