# Mallok CLI

状态：`Accepted for 0.1`
角色：高级入口，不是普通用户的主路径

## 原则

- 直接运行 `mallok` 打开 Studio。
- CLI 与 Studio 调用同一 application service，不复制业务规则。
- 每个有副作用的命令先校验、再展示结果；远端写入支持 `--dry-run`。
- 人类输出写 stdout/stderr；`--json` 输出稳定机器格式。
- 默认不显示 Worker、D1、R2、revision、manifest 等内部术语。

## 0.1 命令

```text
mallok                         打开最近站点或开始中心
mallok open [project]          打开指定站点的 Studio
mallok create <directory>      创建空站点数据目录
mallok check [project]         校验项目、内容、模板与媒体
mallok content import <path...> 将 Markdown/媒体导入指定站点
mallok content export [project] 导出可携带 Markdown、媒体与站点元数据
mallok preview [project]       启动同一预览能力并输出本地 URL
mallok export [project]        导出完整静态站点
mallok publish [project]       发布到已连接的 Cloudflare 站点
mallok restore [project]       恢复最近一个本地可用发布版本
mallok doctor [project]        检查本机、凭据和远端连通性
mallok version check           高级：显式检查是否有新版本
mallok cloudflare connect      高级：重新授权并恢复非敏感连接状态
mallok cloudflare upgrade      高级：显式升级通用 Worker/Schema
```

普通用户通过 Studio完成同样动作，不需要记命令。

## 通用参数

```text
--project <path>    显式项目目录
--json              JSON 输出；不得夹杂进度文本
--dry-run           只生成计划，不产生远端写入
--yes               非交互确认，仅允许 CI 使用
--verbose           显示内部诊断信息，但仍不得显示秘密
--output <path>     content/static export 的显式目标
--no-open           preview 不自动打开浏览器，仅输出 URL
```

`content import` 先生成逐文件计划并在写入前处理 ID/slug/media 冲突；`content export` 不包含 `.mallok`、credential 或远端状态。`preview` 使用与 Studio 相同的 preview use case 和 loopback 安全边界，直到收到正常终止信号；它不是第二套 dev server。

## 退出码

- `0`：完成或确定性 no-op。
- `2`：用户输入或项目内容无效。
- `3`：本地环境或凭据缺失。
- `4`：网络或 Cloudflare 暂时不可用。
- `5`：发布没有完成为“已验证成功”；JSON 必须用 `remoteStatus: unchanged|switched-unverified|unknown` 说明已知线上影响，不得默认旧版本未变。
- `10`：Mallok 内部错误。

## 稳定错误码

- `PROJECT_INVALID`
- `CONTENT_INVALID`
- `TEMPLATE_INVALID`
- `MEDIA_INVALID`
- `BACKUP_INVALID`
- `EXPORT_RECOVERY_REQUIRED`
- `CREDENTIALS_MISSING`
- `HOST_UNREACHABLE`
- `PUBLISH_FAILED`
- `PUBLISH_STAGING_CAPACITY_EXCEEDED`
- `PUBLIC_VERIFY_FAILED`
- `REMOTE_STATUS_UNKNOWN`
- `RESTORE_UNAVAILABLE`
- `INTERNAL_ERROR`

面向用户的错误必须包含“发生了什么、线上是否受影响、下一步做什么”。JSON 模式至少返回 `ok`、`code`、`message`、`hint` 和可选 `details`。

## 不在 0.1

- 创建或运行任意组件代码；
- 插件安装；
- 多云 target 选择；
- D1/Worker/Wrangler 直通命令；
- 包管理器式模板依赖；
- 在 CLI 中维护另一套配置或内容真相。
