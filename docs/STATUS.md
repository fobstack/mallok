# Mallok 项目状态

- 日期：2026-08-27
- 当前里程碑：Phase 0 文档基线
- 主分支实现状态：尚未集成 Phase 1A 代码
- 公共 API 稳定性：未发布、无兼容承诺
- 计划 GitHub 维护者/仓库：`JasonYv` / `github.com/JasonYv/mallok`（本地尚无 remote，未公开发布）

## 已完成

- MVP 技术定位、静态/D1 双运行模式和作者源/发布投影边界；
- 长期产品北极星已确认：在内容建站窄路径上追求比通用框架更轻、更容易，Studio 是长期核心入口；比较优势仍待工程基准与真人任务验证；
- 包边界、内容模型、主题方向、D1 revision 模型和部署原则；
- MVP 阶段划分、通用验收门和首批 ADR；
- 可供实现者执行的领域 reference、机器 schema、验收追踪与 T-001 至 T-013 任务规范。

## Phase 0 静态验收证据

以下结果仅证明文档与机器契约的静态一致性，不代表任何产品代码已经实现：

- 10 份 JSON Schema 均可由 Ajv 2020 编译；9 类 `x-mallok-*` 扩展已被显式识别；
- OpenAPI YAML 可解析，222 个内部 `$ref` 均可解析，13 个正则表达式均可编译；
- `DATABASE.md` 的 D1 schema 可由 SQLite 完整解析；bootstrap → preflight → external → version upload → version ready → activation 的状态向量通过，重复 logical attempt 与大写 provider UUID 反例被拒绝；
- 44 份 Markdown（包括 active implementation prompt）的本地链接均存在、代码围栏平衡；PRD 中 15 个 FR、5 个 NFR 与 86 个 AC 已纳入追踪/任务体系，其中 6 个 `AC-0-*` 由本 Phase 文档门验收；
- credential-shaped literal 扫描无命中，`git diff --check` 通过；
- 技术协议旧基线 `147c5d40b9c822c6c2a34ca1399a3225f8dd122a` 的独立终审为 `0 P0 / 0 P1`；本轮产品定位修订必须在 clean commit 后另以该提交 SHA 绑定审查结论，不沿用旧结论；
- 本轮没有运行依赖安装、build、test、dev、Claude Code、Cloudflare 登录或任何远程写入。代码级验收只能从 T-001 开始逐任务产生。

## 未完成

- pnpm workspace 与任何 npm 包；
- `@mallok/core`、CLI、主题、静态构建器；
- Cloudflare Worker、D1 migration、发布 API；
- dev/preview、provision/deploy；
- 官网、GUI、可视化编辑器；
- `JasonYv/mallok` 远端存在性/控制权核实与本地 remote 绑定、npm 发布、真实 Cloudflare 部署和正式安全审计。

计划中的 `mallok ...` 命令和 TypeScript 接口都是目标契约，不代表仓库当前可运行。

## 当前实施入口

从 [T-001 Phase 1A](tasks/T-001-phase-1a.md) 开始。完成并验收后，按 [实施计划](IMPLEMENTATION_PLAN.md) 的 `T-002` 至 `T-013` 依赖推进。不得并行实现尚未稳定的上层功能，例如在核心 HTML/内容契约未完成时提前写 GUI 或远程发布。

## 尚待产品负责人决定

| 决策 | 最迟时间 | 当前默认 |
| --- | --- | --- |
| 开源许可证 | Phase 3 发布候选前 | 暂不写许可证 |
| npm scope/包所有权 | **T-001 开始前（阻断）** | `@mallok/core`、`@mallok/cli`、`create-mallok` 为暂定名；2026-08-27 registry exact package 均未注册，但这不证明 `@mallok` scope 可由当前账号取得。若无法控制 `@mallok`，必须在产生源码 import 前统一改名 |
| GitHub 公开仓库 | Phase 3 发布候选前 | 目标已定为 `JasonYv/mallok`；当前未配置 remote，不得写成已发布。GitHub 所有权与 npm scope 是两项独立核验 |
| 中文品牌名 | 官网/GUI 视觉设计前 | 仅使用 Mallok |
| 首个官方主题视觉方向 | Phase 1B 主题视觉实现前 | 只实现无品牌的结构基线；正式视觉需先比较 3 个方向 |
| GUI 身份与托管模式 | Phase 4 前 | 当前 MVP 不实现 GUI；Studio 的长期核心地位已确定，具体认证/托管仍待新 PRD/ADR |
| 是否长期支持 Windows | Phase 3 前 | 路径安全必须测，人工体验尽力支持 |

## 明确不继承的状态

其他临时 worktree、聊天输出、未提交代码或编码助手会话都不是主分支事实。只有主分支已提交文件与本状态页列出的里程碑可作为下一阶段输入。
