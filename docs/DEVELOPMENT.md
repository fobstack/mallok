# 本地开发约定

状态：`Accepted for implementation`

## 仓库形态

Mallok 0.1 是一个仓库、一个版本、一个产品。首次实现不得建立 workspace 或拆分可独立发布的 core/cli/cloudflare 包。

活动目录固定为：

```text
src/
  domain/                 纯类型、不变量、错误码
  application/            Studio 与 CLI 共用 use cases
  compiler/               内容与模板到 PublishBundle
  templates/              三个内置模板及解释器
  adapters/
    project-fs/           项目目录、原子写入、快照
    studio-http/          loopback Studio adapter
    cli/                  高级命令行 adapter
    static-export/        PublishBundle 到目录
    cloudflare/           OAuth、provision 与 bundle publish
  embedded/
    studio/               编译后的 Studio 前端资源
    cloudflare-worker/    通用 Worker 与 D1 schema
  main.ts                 唯一 composition root
test/
  unit/
  integration/
  e2e/
```

## 依赖规则

- 首次任务锁定 Bun 与全部直接依赖的精确版本并提交 lockfile。
- 优先使用维护活跃的 Markdown、HTML sanitizer、Liquid、Schema 和 SQLite/D1 客户端库。
- 新增直接依赖必须写明用途、替代方案、安全面和体积影响。
- 不允许为了“以后可能需要”引入框架、ORM、状态机或插件系统。

## 分层规则

- `application/` 不读取 argv、TTY、DOM 或 Cloudflare 全局对象。
- `adapters/studio-http/` 和 `adapters/cli/` 只做输入、展示和调用用例。
- `compiler/` 与 `templates/` 生成确定性 PublishBundle，不知道发布商。
- static/Cloudflare adapter 只消费 `PublishBundle`；sink 不重新编译内容。
- `adapters/cloudflare/` 不向其他目录泄漏 D1/R2/Cloudflare SDK 类型。

## 代码与测试

- TypeScript strict，禁止隐式 `any`。
- 用户可修复错误使用稳定错误码和清晰提示。
- 相同输入、模板版本和时钟必须生成相同 bundle hash。
- 内容、路径、URL、HTML 和凭据边界都必须有失败测试。
- 每个任务完成前至少运行格式检查、lint、typecheck、unit、integration 和该阶段 e2e；精确脚本由任务 01 建立后冻结。

## Git 与发布

- 保存用户既有改动，不做无关重构。
- 生成物、凭据、项目私有状态和测试云资源不得进入 Git。
- 编码助手不得 commit、push、部署或发布包，除非产品负责人明确授权。
