# Mallok 文档

Mallok 是一个开源、Cloudflare 原生的内容网站产品：内容以 Markdown 存在 D1，改完即时生效，不需要构建，内容随时可以带走。首个垂直是外贸 B2B 企业站。

## 设计文档

按顺序阅读。前六份是产品与架构的合同，后面是各子系统的契约。

| 文档 | 内容 |
| --- | --- |
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | 产品定义、首个垂直、用户、承诺、0.1 交付、成本阶梯、成功画面、路线图、非目标、已知风险 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 硬约束、系统组成、请求路径、两阶段渲染、三层缓存、内容模型、媒体、多语言、主题、Starter、插件能力、询盘链路、安全边界、部署与迁移、待验证事项 |
| [TECH_STACK.md](TECH_STACK.md) | 运行时、四层依赖与硬规则、外部服务接入、后台、CLI、依赖 gate、明确禁止项、外部依据 |
| [CONTENT_FORMAT.md](CONTENT_FORMAT.md) | 文章包格式、相对路径规则、frontmatter 通用字段、导入导出契约、缺图状态 |
| [DATA_MODEL.md](DATA_MODEL.md) | 0.1 D1 表结构草案、索引、约束、迁移与垃圾回收规则 |
| [CLOUDFLARE_RESOURCES.md](CLOUDFLARE_RESOURCES.md) | 账号拓扑与配额、每个站点的资源清单与命名、wrangler 模板、创建顺序、Deploy 按钮差异、环境、站群登记、备份与删除 |

## 子系统契约

| 文档 | 内容 |
| --- | --- |
| [THEME_FORMAT.md](THEME_FORMAT.md) | 主题包结构、`theme.json`、内容类型与字段 schema、视图契约、受限 Liquid、语言包、安装与切换语义 |
| [PLUGIN_API.md](PLUGIN_API.md) | `plugin.json`、五个钩子、六种能力、上下文对象、生命周期、体积预算、官方 `inquiry` 插件 |
| [ADMIN.md](ADMIN.md) | 后台信息架构、首次启动向导、内容编辑器、schema 驱动的表单生成器、媒体库、质量门 |
| [CLI.md](CLI.md) | 命令、参数、认证、幂等规则、退出码、错误信息规则 |
| [SEO_PERFORMANCE.md](SEO_PERFORMANCE.md) | 核心内建的 SEO 输出、hreflang、结构化数据、性能预算与测量方式 |
| [SECURITY.md](SECURITY.md) | 信任级别、凭据处理与加密格式、认证、净化、上传校验、错误卫生、**明确不防的东西** |

## 过程文档

| 文档 | 内容 |
| --- | --- |
| [TESTING.md](TESTING.md) | 测试分层、硬性契约的测试清单、覆盖率门、证据格式与状态取值 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 0.1 的发布门、按组编号的验收标准、跨阶段不变量、阻塞项 |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Task 02–17 的任务序列、两道门、依赖图、每个任务的完成定义 |
| [tasks/TASK-01.md](tasks/TASK-01.md) | Walking skeleton：已实现范围、spike 捷径、本地基准数据、真实账号实测步骤与结果表（英文） |
| [tasks/TASK-02.md](tasks/TASK-02.md) | 认证与管理 API：API 面、决策记录、证据链、未完成项与已知风险（英文） |
| [tasks/TASK-03.md](tasks/TASK-03.md) | 媒体：内容寻址存储、类型嗅探、变体、引用计数与回收、响应式图片输出（英文） |
| [tasks/TASK-04.md](tasks/TASK-04.md) | 主题即源码：构建期校验、文本模块打包、Static Assets、字段 schema、类型降级（英文） |
| [tasks/TASK-05.md](tasks/TASK-05.md) | SEO 端点：sitemap/RSS/robots、host 级 noindex、Product JSON-LD、片段缓存回收（英文） |
| [tasks/TASK-06.md](tasks/TASK-06.md) | 多语言：翻译组、每语言页面与 hreflang、切换默认语言的批量重写与重定向（英文） |

## 计划中的文档

上述设计文档的英文版（`CONTRIBUTING.md` 要求仓库内一切文字用英文，`docs/` 暂为中文，英文版补齐后以英文为准）；以及 `tasks/TASK-02.md` 起的后续任务文档。

## 状态

- 实现状态：Task 01–06 代码完成，四套官方主题就位（**Task 01 的真实账号实测仍待做**）
- 设计状态：已按 2026-08-29 的决定修订完毕——**主题与插件属于构建期，内容与设置属于运行时**
- 发行状态：`NOT_AVAILABLE`
- 计划仓库：`JasonYv/mallok`（尚未创建）
- 许可证：倾向 MIT 加独立商标政策，待最终确认

## 未解的门

第 1 项挡住 Task 05、16；第 2 项挡住 Task 07：

1. **`ARCHITECTURE.md §18` 的九项实测**——按 `tasks/TASK-01.md §4` 在真实 Cloudflare 账号上执行；
2. **内联 HTML 保留与否**（是否引入 `rehype-raw`）——见 `tasks/TASK-01.md §6`、`SECURITY.md §4`。

Markdown 引擎决策已于 2026-08-29 拍板：**保持 unified**，理由与代价见
`tasks/TASK-01.md §6`。

此前的「macOS 桌面 Studio + 构建期预渲染」方案已整体废弃，保存在 Git 提交 `2e775cb`，仅供追溯。
