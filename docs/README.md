# Mallok 文档

Mallok 是一个开源、Cloudflare 原生的内容网站产品：内容以 Markdown 存在 D1，改完即时生效，不需要构建，内容随时可以带走。

## 当前文档

按顺序阅读：

| 文档 | 内容 |
| --- | --- |
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | 产品定义、用户、承诺、竞争定位、非目标、已知风险 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系统组成、请求路径、渲染管线、缓存策略、数据模型、主题与插件机制、安全边界 |
| [TECH_STACK.md](TECH_STACK.md) | 运行时、依赖分层与硬规则、依赖 gate、明确禁止项 |

## 计划中的文档

以下尚未编写，将在方向确认后补齐：

`PRD` · `DATA_MODEL` · `THEME_FORMAT` · `PLUGIN_API` · `ADMIN` · `CLI` · `SEO_PERFORMANCE` · `SECURITY` · `TESTING` · `ACCEPTANCE` · `IMPLEMENTATION_PLAN` 与 `tasks/*`

## 状态

- 实现状态：`NOT_STARTED`
- 发行状态：`NOT_AVAILABLE`
- 计划仓库：`JasonYv/mallok`（尚未创建）
- 许可证：倾向 MIT 加独立商标政策，待最终确认

此前的「macOS 桌面 Studio + 构建期预渲染」方案已整体废弃，保存在 Git 提交 `2e775cb`，仅供追溯。
