# 需求追踪

状态：`Accepted for 0.1`

| PRD 需求 | 用户结果 | 主要契约 | 任务 | 验收 |
| --- | --- | --- | --- | --- |
| FR-01 | 无终端启动与新建 | PRD / EXPERIENCE / DISTRIBUTION | 01, 05 | AC-01-01..02, AC-05-01, AC-05-04 |
| FR-02 | 本地站点、重开与安全升级 | PROJECT_FORMAT / VERSIONING | 01, 02, 05 | AC-01-02..03, AC-02-05..07, AC-05-03 |
| FR-03 | 三模板预览/切换，内容和 URL 不丢 | TEMPLATE_FORMAT / TEMPLATE_VISUALS | 01, 02 | AC-01-02..04, AC-02-01 |
| FR-04 | 可视编辑、Markdown 导入导出、图片、列表过滤与草稿 | EDITOR / PROJECT_FORMAT | 01, 02 | AC-01-03, AC-01-07, AC-02-02..03, AC-02-07..08 |
| FR-05 | 响应式本地预览 | EXPERIENCE / ARCHITECTURE | 01, 02 | AC-01-04, AC-02-01, AC-02-06 |
| FR-06 | 引导授权并得到首个公网 URL | CLOUDFLARE / SECURITY | 03 | AC-03-01..06 |
| FR-07 | 单一“发布更改”动作更新内容 | ARCHITECTURE / CLOUDFLARE | 04 | AC-04-01..04, AC-04-07 |
| FR-08 | 发布历史、结果未知恢复和上一版本恢复 | OPERATIONS / CLOUDFLARE | 04 | AC-04-03..08 |
| FR-09 | 导出完整静态站，不假称已上线 | ARCHITECTURE / SECURITY | 02 | AC-02-04..06 |
| FR-10 | 高级 CLI 与 Studio 共享产品能力 | CLI / ARCHITECTURE | 05 | AC-X-01, AC-X-06 |
| FR-11 | 数据备份、Markdown 导出、不锁定 | PROJECT_FORMAT / EDITOR | 02, 05 | AC-02-07..08, AC-05-03 |
| FR-12 | 自动 sitemap/robots、technical SEO、受管图片与页面性能 | SEO_PERFORMANCE / TEMPLATE_FORMAT / ARCHITECTURE | 02..05 | AC-02-09..10, AC-03-03, AC-04-01..02, AC-05-08, AC-05-10 |
| NFR-易用 | 默认 0 命令、0 配置编辑 | EXPERIENCE | 01..05 | AC-01-01, AC-01-06, AC-05-04..06 |
| NFR-安全 | 内容、模板、凭据、路径与发布 fail closed | SECURITY | 01..05 | AC-X-02..05 |
| NFR-可携带 | 站点是数据，无每站依赖 | PROJECT_FORMAT / DISTRIBUTION | 01, 02, 05 | AC-01-03, AC-02-04..08, AC-05-01..03 |
| NFR-可访问 | Studio 与官方站点可键盘/读屏/缩放 | EXPERIENCE / TESTING | 01..05 | AC-05-07, AC-X-04 |
| NFR-搜索 | canonical/head、sitemap/robots、抓取集合确定且一致 | SEO_PERFORMANCE | 02..05 | AC-02-09, AC-03-03, AC-04-01..02, AC-05-08 |
| NFR-页面性能 | 官方模板和受管资源通过 Mallok PageSpeed Gate | SEO_PERFORMANCE / TESTING | 02, 05 | AC-02-10, AC-05-08, AC-05-10 |
| NFR-更简单 | 绝对产品门 | PRD §11.1 | 05 | AC-05-04..06, AC-05-09 |
| NFR-竞争声称 | 在受测内容站路径上比 Astro 更简单、更少维护 | PRODUCT_VISION / PRODUCT_STRATEGY / PRD §11.2 | post-release claim gate | AC-C-01..03 |

验收编号的详细定义以 `ACCEPTANCE.md` 为准。本表只负责追踪，不新增行为。`AC-C-*` 是对外比较声称门，不会因 30/90 天跟踪周期阻塞 0.1 产品发布；它只阻止未经证明的比较宣传。
