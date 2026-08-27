# Mallok 开发文档导航

这套文档是 Mallok 从零实现的权威入口。当前主分支只有产品与工程契约，**尚未集成可发布实现**；开发者或编码助手必须先阅读 [项目状态](STATUS.md)，不能把计划中的命令误当成已存在能力。

## 推荐阅读顺序

1. [项目状态](STATUS.md)：现在完成了什么、还没做什么、哪些决策未关闭。
2. [产品需求](PRD.md)：目标用户、范围、功能和非功能要求。
3. [术语表](GLOSSARY.md)：作者源、发布投影、revision、artifact 等统一含义。
4. [技术架构](ARCHITECTURE.md)：包边界、数据流、双运行模式和核心约束。
5. 领域契约：
   - [配置与内容契约](CONTENT_CONFIG.md)
   - [主题 API](THEME_API.md)
   - [CLI 契约](CLI.md)
   - [静态构建契约](BUILD.md)
   - [HTTP 发布 API](HTTP_API.md)
   - [D1 数据库契约](DATABASE.md)
   - [Cloudflare 与部署](CLOUDFLARE.md)
   - [版本与兼容性](VERSIONING.md)
6. 工程质量：
   - [安全模型](SECURITY.md)
   - [测试策略](TESTING.md)
   - [运维与发布](OPERATIONS.md)
   - [本地开发指南](DEVELOPMENT.md)
7. [实施计划](IMPLEMENTATION_PLAN.md)、[验收标准](ACCEPTANCE.md) 与 [需求追踪矩阵](TRACEABILITY.md)。
8. [Claude Code 执行手册](CLAUDE_CODE.md) 和 `docs/tasks/` 中当前阶段任务。

机器可读契约位于：

- [`schemas/mallok-config.schema.json`](schemas/mallok-config.schema.json)
- [`schemas/build-manifest.schema.json`](schemas/build-manifest.schema.json)
- [`schemas/asset-manifest.schema.json`](schemas/asset-manifest.schema.json)
- [`schemas/candidate-inventory.schema.json`](schemas/candidate-inventory.schema.json)
- [`schemas/deployment-state.schema.json`](schemas/deployment-state.schema.json)
- [`schemas/deployment-attempt.schema.json`](schemas/deployment-attempt.schema.json)
- [`schemas/deploy-plan.schema.json`](schemas/deploy-plan.schema.json)
- [`schemas/staging-authorization.schema.json`](schemas/staging-authorization.schema.json)
- [`schemas/staging-ownership.schema.json`](schemas/staging-ownership.schema.json)
- [`schemas/release-evidence.schema.json`](schemas/release-evidence.schema.json)
- [`openapi.yaml`](openapi.yaml)

## 文档权威关系

不同文档负责不同问题，不允许实现者在冲突时自行挑选有利版本：

1. 新的、状态为 `Accepted` 的 ADR 只在明确写出的范围内取代旧决策；
2. `PRD.md` 决定产品范围和用户承诺，领域 reference 决定各自字段、接口、状态机和错误行为；两者领域不同，不能互相偷改；
3. `SECURITY.md` 的安全下限不可由任务或实现降低；
4. `ARCHITECTURE.md` 解释模块关系和跨领域不变量，不重复发明字段级协议；
5. `ACCEPTANCE.md` 决定完成证据，但不能暗中新增产品能力；
6. `IMPLEMENTATION_PLAN.md` 决定开发顺序；
7. 单个 `docs/tasks/T-*.md` 只能收窄阶段范围，不能推翻以上文档；`.claude/**` 和聊天不属于规范。

若两份高层文档不可同时满足，应停止实现，先修改文档并新增或更新 ADR。不能靠代码注释、测试快照或编码助手的推断改变公共契约。

## 需求追踪规则

- 产品需求使用 `FR-*`、`NFR-*` 编号；
- 验收项使用 `AC-*` 编号；
- 架构决策使用 `ADR-*`；
- 实现任务使用 `T-*`；
- 审查发现使用 `REV-*`。

每个阶段任务必须列出本轮覆盖的 `FR/AC`、允许改动路径、依赖白名单、验证命令和停止条件。每项公共行为至少有一个可重复的自动化证据；真实云端副作用只能由人工授权的 staging 验收覆盖。

## 文档状态词

- `Draft`：可讨论，不授权实现公共契约；
- `Accepted`：当前实现必须遵循；
- `Experimental`：可以实现和试用，但不保证兼容；
- `Deprecated`：仍兼容，但不得继续扩大使用；
- `Superseded`：已被新文档取代。

## 更新要求

公共接口、数据格式、安全边界或运行模式变化时，同一个变更必须同步更新：

1. 对应领域契约；
2. ADR（若属于跨模块或不可逆决策）；
3. 验收标准和测试矩阵；
4. 迁移或兼容说明；
5. 受影响的阶段任务。

只改代码、不改契约，不算完成。
