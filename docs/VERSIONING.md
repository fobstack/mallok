# 版本与兼容

状态：`Accepted for 0.1`

## 产品版本

- Mallok 使用语义化版本。
- 0.x 可快速演进，但项目升级不能静默丢内容、URL 或媒体。
- Studio、CLI、项目格式、内置 Worker 和模板随同一个 Mallok 版本发布。

## 独立版本轴

- `projectFormatVersion`：站点目录结构与字段。
- `templateFormatVersion`：声明式模板能力。
- `bundleFormatVersion`：PublishBundle 序列化与远端存储格式。
- `workerProtocolVersion`：Studio publisher 与通用 Worker 的协议。

0.1 每条轴从 `1` 开始。读取未知更高版本必须停止并提示升级，不能猜测降级。

## 迁移规则

- 打开旧项目时先备份，再生成可预览的迁移计划。
- 破坏性迁移必须用户确认；失败保持原目录可打开。
- 模板更新不得改变内容 ID、slug 或既有 URL。
- Worker 协议不兼容时，普通发布 fail closed；Studio 展示独立的“更新网站托管”计划和影响，用户明确确认后调用共享 `upgradeCloudflareRuntime` use case，成功后才重新发布。
- 最近一个成功 PublishBundle 至少跨一个 Mallok 次版本可恢复。

## 不冻结的公共面

0.1 不承诺 JavaScript library API、插件 API、任意主题代码 API、数据库直接访问 API 或多云 provider API。
