# Mallok 编码助手执行手册

- 状态：Approved workflow
- 适用范围：`docs/tasks/T-002.md` 至 `docs/tasks/T-013.md`
- 说明：文件名保留 `CLAUDE_CODE.md` 便于 Claude Code 用户查找，但本流程不依赖某个模型或工具。

## 1. 目的

编码助手在 Mallok 中只承担“受约束的实现者”角色。产品边界、公共契约、验收口径和云端授权由仓库文档及任务负责人决定。更换 Claude Code、Codex 或其他本地编码助手，不应改变任务输入、输出或验收结果。

每次只执行一个任务文件。不得把整个路线图作为一次开放式实现请求，也不得在当前任务通过前提前实现后续阶段。

## 2. 权威与冲突处理

开始前必须完整阅读：

1. `CLAUDE.md`；
2. `docs/README.md` 与 `docs/DEVELOPMENT.md`；
3. `docs/PRODUCT_VISION.md`；
4. 当前任务涉及的字段级 reference，例如 `CONTENT_CONFIG.md`、`THEME_API.md`、`CLI.md`、`HTTP_API.md`、`DATABASE.md`、`BUILD.md`、`CLOUDFLARE.md`；
5. `docs/SECURITY.md` 与当前任务明确引用的 accepted ADR；
6. `docs/PRD.md`、`docs/ARCHITECTURE.md`；
7. `docs/ACCEPTANCE.md`、`docs/TRACEABILITY.md`、`docs/IMPLEMENTATION_PLAN.md`；
8. 当前唯一的 `docs/tasks/T-xxx.md`。

产品契约的权威关系以 `docs/DEVELOPMENT.md` 为准：accepted ADR 只在声明范围内取代旧决策；Product Vision 管长期用户/竞争边界但不扩大当前交付；PRD 管当前产品范围、字段级 reference 管各自协议，两者冲突即停止；Security 是不可降低的下限；之后才是 Architecture → Acceptance/Traceability → 当前任务 → 现有代码和工具 prompt。`CLAUDE.md` 与本文提供执行边界，不能被任务中的普通实现细节放宽。

`.claude/prompts/01-foundation-core.md` 只属于 T-001。执行 T-002 及之后任务时，调用者必须明确写出当前任务路径；不得把旧的 Phase 1A prompt 当成 active prompt。

如果两个要求无法同时满足，实现者必须返回 `BLOCKED`，指出文件、条款和最小待决问题；不得自行创建第三种契约。破坏性公共 API 变更必须先由负责人批准 ADR，不得由实现者顺手修改文档来合理化代码。

## 3. 角色分离

- **任务负责人**：选择当前任务、确认前置任务状态、批准依赖和外部副作用。
- **实现者**：仅在允许路径内实现、测试并提交结构化报告；默认不执行 Git commit。
- **审查者**：独立检查 diff、运行验收命令、确认 requirement → test 映射，再决定是否接受。
- **云端操作者**：只在 T-013 的显式授权窗口中持有 staging 权限；不得把凭据交给普通实现任务。

同一个人可以承担多个角色，但证据仍须区分“实现者自报”和“独立复验”。

## 4. 每次任务的只读预检

在修改前运行并报告：

```bash
pwd
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short
node --version
corepack pnpm --version
```

要求：

- 仓库根必须是目标 Mallok 仓库；
- Node 与 pnpm 必须满足根 `package.json` 的 `engines` 和 `packageManager`；
- 首个 MVP 仓库基线是 Node `22.22.2`、pnpm `11.1.3`；兼容矩阵及 Cloudflare 工具版本以 `docs/VERSIONING.md` 为准；
- 必须记录实现 base SHA；
- 发现无关改动时保留它们；若改动与任务允许路径重叠，停止并请求负责人处理；
- 不使用 `git reset --hard`、`git clean -fdx`、`git checkout --` 或其他破坏性清理命令；
- 不读取或输出 `.env`、`.dev.vars`、系统密钥链、Cloudflare 凭据或其他不属于任务输入的秘密。

## 5. 标准执行循环

```text
确认前置任务已验收
  -> 只读预检并冻结 base SHA
  -> 复述允许路径、非目标和停止条件
  -> 先补失败测试或契约测试
  -> 最小实现
  -> 运行任务级验证
  -> 运行通用质量门
  -> 检查 diff 与越界文件
  -> 输出结构化报告
  -> 审查者独立复验
  -> 接受或生成窄范围修订任务
```

修订必须继续使用同一任务编号并列出尚未通过的 AC，不得借修复扩大功能范围。

## 6. 权限默认值

除非当前任务明确允许：

- 文件系统只允许读取仓库和写入任务列出的路径；
- 不联网；
- 不增加、升级或替换依赖；
- 不运行全局安装；
- 不启动长期运行的开发服务器；
- 不执行 Git add/commit/push/tag；
- 不发布 npm 包；
- 不登录 Cloudflare，不创建、迁移、部署、删除云资源；
- 不向外部服务发送源码、文章、日志或测试数据。

需要新依赖时，任务负责人必须先批准包名、用途、精确版本、运行时归属和许可证。没有精确批准版本时返回 `BLOCKED`，不能使用浮动版本，也不能利用未声明的传递依赖。

允许联网安装依赖不等于允许访问 Cloudflare、GitHub 写接口、npm publish 或任意第三方 API。网络权限必须按目的单独授权。

## 7. 通用工程要求

- TypeScript strict、ESM-only；禁止未解释的 `any`、`@ts-ignore` 和跳过测试。
- `@mallok/core` 保持平台无关；Node 和 Cloudflare 能力只能位于对应 adapter。
- 输出必须由显式输入决定；测试不得依赖隐式当前时间、随机数、文件 mtime、locale 或主机时区。
- 所有可修复错误必须使用稳定错误码并提供可执行 hint。
- 不冻结、修改或复用调用方可变对象作为内部快照。
- 不通过降低 sanitizer、路径边界、认证、数据库原子性、类型检查或覆盖率让测试通过。
- 主题和配置是可信本地代码；内容、frontmatter、D1 row 和管理 API 输入是不可信数据。
- 不把计划中的命令描述成已经实现；新增命令时必须同时添加帮助文本、退出码测试和文档契约测试。

## 8. 通用质量门

任务完成前执行当前仓库已存在的通用命令：

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
git diff --check
git status --short
```

各任务列出的集成或端到端命令是额外门。若某个任务负责创建该命令，必须先在根 `package.json` 中实现稳定脚本，再运行它。命令不存在、没有实际执行测试或只打印占位成功，均视为失败。

安装只在任务授权时执行：

```bash
corepack pnpm install --frozen-lockfile
```

`--offline` 仅用于依赖缓存已预热的复验，不是新环境默认条件。不得为了安装成功删除或重写 lockfile。

## 9. AC 与证据

每个任务直接映射 `docs/ACCEPTANCE.md` 的正式 `AC-*` 编号和 PRD 的 `FR/NFR`；任务内部如需细分测试，只能使用不会冒充新产品要求的 case id。实现者报告至少包含：

- AC 编号；
- 实现文件或导出符号；
- 测试文件与测试名称；
- 实际运行命令；
- 退出码与关键计数；
- 未验证项和原因。

覆盖率是质量证据，不替代功能、失败路径、安全或跨运行时验收。没有在报告中的 base/head 上实际运行的命令不得写成 `PASS`。

建议审查者使用以下状态：

- `NOT_STARTED`
- `IMPLEMENTED_UNVERIFIED`
- `VERIFIED_LOCAL`
- `VERIFIED_STAGING`
- `ACCEPTED`
- `BLOCKED`

本地 Worker/D1 测试只能得到 `VERIFIED_LOCAL`，不能替代 staging 证据。

## 10. 云端副作用门

T-002 至 T-012 均禁止真实云端副作用。允许生成配置、计划、fixture 和 dry-run 输出，但必须能证明没有创建、迁移、部署、发布或删除任何远程资源。

T-013 分为两个边界：

1. 普通编码助手只准备和本地验证 runbook、检查器及脱敏证据模板；
2. 真实 staging smoke 只能在用户明确给出账号、目标、时间窗口、允许动作和 cleanup 授权后，由人工云端操作者单独执行；Claude Code、普通 coding agent 和本文件中的实现调用模板都不得执行 Stage B，即使本机已有登录态或 authorization marker。

授权不得从“继续”“完成发布准备”或已有本地登录状态推断。真实 token 只能从环境、密钥链或平台 secret 读取，不能出现在命令行参数、提交文件、日志或报告中。

## 11. 全局停止条件

出现任一情况立即停止并返回 `BLOCKED`：

- 权威文档冲突或公共契约缺失；
- 前置任务未验收；
- base SHA、仓库根或目标路径不明确；
- 任务范围与工作区既有改动重叠；
- 需要未批准的依赖、网络、路径或外部写操作；
- 必须弱化类型、安全、测试、覆盖率或数据完整性；
- 输出、替换、迁移或删除目标不能证明处于允许边界；
- 需要真实凭据、Cloudflare 操作、npm publish、Git push/tag 或不可恢复动作但没有逐项授权；
- 验证命令失败、未运行、flaky 或只被 mock 掩盖；
- 日志或错误可能泄露 token、未发布正文、SQL 或内部堆栈。

`BLOCKED` 不是失败规避。报告必须给出已经完成的安全检查、精确阻塞条款、最小待决问题和不超过三个可选方案。

## 12. 调用模板

调用任意编码助手时使用下面的最小指令，并替换任务编号：

```text
在 Mallok 仓库执行且只执行 docs/tasks/T-00X.md。
先完整阅读 CLAUDE.md、docs/CLAUDE_CODE.md 及任务列出的权威文档。
当前 active task 是 docs/tasks/T-00X.md；旧任务和旧 prompt 只作历史背景。
先做只读预检，发现停止条件就返回 BLOCKED。
不得扩大允许路径、依赖、网络或外部副作用范围，不得提交或部署。
实现后运行任务规定的全部验证，并按任务模板报告真实结果。
```

## 13. 结构化交付报告

```markdown
# T-00X implementation report

- Status: PASS | PARTIAL | BLOCKED
- Base SHA:
- Working tree before:
- Working tree after:

## AC evidence
| AC | Implementation | Test | Command | Result |
|---|---|---|---|---|

## Changed files
- path — reason

## Commands actually run
- command — exit code — summary

## Dependencies and network
- added/changed dependencies, exact versions, license
- network access actually used, or `none`

## Deviations
- none, or exact approved deviation and authority

## Remaining risks
- verified limitation; do not hide untested behavior

## Blocker
- exact conflicting clauses or missing authorization, when applicable
```

任何“应该通过”“理论上可用”或未执行命令的推测必须放在 Remaining risks，不能写进 AC evidence 的 Result。
