# Mallok 开发者指南

- 状态：Accepted process
- 适用阶段：全部

## 1. 当前事实

文档基线阶段主分支可能尚无 `package.json` 或实现。因此本文中的脚本是目标开发契约；只有对应 task 合入并在当前 SHA 运行后才算可用。项目状态以 [STATUS.md](STATUS.md) 为准。

## 2. 文档权威顺序

发生冲突时：

1. accepted ADR 只在明确声明范围内取代旧决策；
2. `docs/PRODUCT_VISION.md` 负责长期目标用户、竞争边界和比较声明证据门，但不能把未来愿景变成当前已交付范围；
3. `docs/PRD.md` 负责当前产品范围，各字段级 reference 负责自己的接口/schema/状态机；若两者冲突必须停止，不能按顺序挑一个；
4. `docs/SECURITY.md` 是不可降低的安全下限；
5. `docs/ARCHITECTURE.md` 负责模块关系与跨领域不变量；
6. `docs/ACCEPTANCE.md`、`TRACEABILITY.md` 负责证据；
7. active `docs/tasks/T-xxx.md` 只可缩小范围，不能改变上层 contract；
8. 实现代码和工具 prompt。

`.claude/**`、聊天、临时 worktree、实现者记忆和未提交文件不是产品契约。发现两份同级 reference 冲突时停止并先修文档/ADR。

## 3. Bootstrap（实现完成后的目标）

```bash
corepack enable
corepack prepare pnpm@11.1.3 --activate
pnpm install --frozen-lockfile
pnpm verify
```

新依赖需要联网时必须在当前任务明示的独立依赖审批阶段，或在独立 dependency task 中审核并更新 lockfile。功能 task 若明确授权新增依赖，必须先产生 `dependency-only first diff`：只含 package manifest、lockfile 和包管理器必需的最小注册元数据；独立 reviewer 核对精确版本、license、engines、transitive/lifecycle 风险、网络记录与 lockfile diff 并批准后，才能开始功能编码。不得把未审查的依赖变化夹进功能 diff。日常复验使用 frozen lock；离线 install 只在 cache 已预热时使用，不作为新开发者前提。

## 4. Monorepo 边界

```text
packages/core         Web API only；模型、compiler、safe HTML、theme contract、route/feed
packages/cli          Node FS/process/server/config/build/dev/命令
packages/cloudflare   Worker、D1、HTTP、Wrangler config/deploy adapter
packages/create-mallok  npm create 入口，只组合已发布模板
examples/basic-blog   golden E2E fixture，不是第二套实现
```

依赖方向：`cli -> core`、`cloudflare -> core`、`create-mallok -> templates/cli contract`。core 不反向依赖 adapter；cli 不直接导入 cloudflare 内部 D1 类型，而通过公开 adapter API。

## 5. 编码约定

- TypeScript strict、ESM-only、源码相对 import 使用 `.js` extension；
- 公共类型不可暴露平台私有类型；
- 函数参数优先只读、返回值深冻结且不冻结 caller-owned object；
- I/O、clock、random、network 通过端口注入；
- 不从文件 mtime 或隐式 locale 推导业务数据；
- user-facing error 使用稳定 Mallok code；可修复时提供 hint；内部 cause 不序列化到 API；
- SQL 只使用 prepared statement；path 只消费已验证 segment/route token；HTML 只用安全 helper；
- 不为“以后也许需要”添加 adapter、plugin hook 或公共 API；
- 不提交 dist、coverage、`.mallok`、`.env`、`.dev.vars`、Cloudflare ids 或真实 evidence。

## 6. 变更流程

1. 选择一个 task；确认前置 task 和 base SHA；
2. 确认工作区没有与允许路径重叠的未知修改；
3. 只读复述 requirement/AC、将改文件和非目标；
4. 在独立 branch/worktree 做最小实现；
5. 为每个 AC 写正常/边界/失败测试；
6. 运行 task 精确命令；
7. 独立 reviewer 检查 diff 和重跑命令；
8. findings 用 `REV-xxx` 定向修复；
9. protected docs/lock/exports 无漂移后合入；
10. 实现 diff 验收后，由 reviewer/负责人在实现 diff 之外的独立 docs-only 变更中更新 `TRACEABILITY.md`/`STATUS.md`；实现者不得因 task 禁止 `docs/**` 而越界，reviewer 也不能把未跑证据标为 verified。

公共 contract、依赖白名单、migration、安全 profile 或 phase scope 变化必须先改文档；破坏性决策需要 ADR。

## 7. Task 合同

每个 `docs/tasks/T-xxx.md` 必须含：

- 状态、base SHA/前置 task；
- 目标与明确非目标；
- authoritative requirement/AC；
- 允许和禁止路径；
- direct dependency 精确白名单；
- 网络、云、Git、secret 权限；
- 交付接口与 fixture；
- 精确验证命令和阈值；
- `BLOCKED` 条件；
- 结构化报告格式。

实现者不能因为 task 未提到某 reference 就违反上层 contract。

## 8. 依赖审批

提案需记录：包名/精确版本、runtime/dev、用途、为何标准库/已有依赖不够、license、engines、维护/安全信号、包体和 Worker 兼容。批准后只能由包管理器生成 lockfile，不手改。功能 task 内的依赖审批必须使用 `dependency-only first diff` gate；只有 reviewer 对该独立 diff 明确批准后，后续功能 diff 才能以它为基线。

成熟 parser/sanitizer/bundler 优先于自研；这不等于引入站点框架。禁止 Astro/Next/Nuxt/Gatsby/Eleventy/Remix/SvelteKit 等框架依赖。

## 9. Review 优先级

- P0：凭据泄露、RCE/XSS/SQL/path 越界、数据破坏、发布原子性失效、需求方向错误；
- P1：核心功能错误、公共 contract 不兼容、无法部署/恢复、重要测试缺口；
- P2：边界质量、可维护性、性能回退、文档漂移；
- P3：非阻断风格/命名。

每条 finding 包含 `REV-ID | priority | AC | file:line | reproduction/evidence | expected minimal fix`。不要用“全面优化”代替可验证问题。

## 10. 禁止自动动作

没有用户明确授权时，任何实现者都不得：

- 创建/迁移/删除真实云资源；
- 部署 Worker、设置 secret、修改 DNS；
- npm publish、Git push、merge 或清理他人 worktree；
- 将 staging/local 证据冒充 production；
- 用跳过测试、降低阈值、手写 sanitizer 或扩大权限绕过 blocker。

## 11. Definition of Done

一个 task 只有在允许范围内代码和测试完成、所有精确命令在同一 SHA 独立通过、无 P0/P1 finding、protected files 未越界、实现者报告完成，并由 reviewer/负责人在实现 diff 外完成 `TRACEABILITY.md`/`STATUS.md` 更新后，才是 `VERIFIED_LOCAL`。只有发布负责人确认用户场景和必要 staging 证据后才可 `ACCEPTED`。
