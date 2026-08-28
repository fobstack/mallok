# Mallok 文档导航

状态：`Accepted product baseline`
适用版本：计划中的 Mallok 0.1
代码状态：尚未实现

Mallok 是一个 Studio-first 的内容建站产品，不是一个新的前端组件框架。默认用户只需完成四件事：创建站点、选择模板、编辑内容、发布网站。

## 先读这些

1. [产品愿景](PRODUCT_VISION.md)：为什么做、为谁做、什么叫比 Astro 更简单。
2. [产品战略](PRODUCT_STRATEGY.md)：市场楔子、产品阶梯、开源商业模型与护城河。
3. [产品需求](PRD.md)：0.1 范围、非目标与量化结果。
4. [产品体验](EXPERIENCE.md)：Studio 页面、用户旅程、状态和错误体验。
5. [对比协议](COMPARISON_PROTOCOL.md)：比较性产品声称的预注册任务和证据规则。
6. [技术架构](ARCHITECTURE.md)：单一编译管线、PublishBundle 与模块边界。
7. [技术栈](TECH_STACK.md)：已批准 runtime、Studio、编辑器、compiler 和测试依赖。
8. [搜索与页面性能](SEO_PERFORMANCE.md)：sitemap、technical SEO、受管图片和 PageSpeed/Lighthouse 门。
9. [实施计划](IMPLEMENTATION_PLAN.md)：五个纵向交付阶段。
10. [验收标准](ACCEPTANCE.md)：什么证据才算完成。
11. [当前状态](STATUS.md)：现在能做什么、仍缺什么。

## 领域文档

- [项目格式](PROJECT_FORMAT.md)：站点数据、Markdown 和媒体目录。
- [内容编辑器](EDITOR.md)：可视编辑、Markdown 真相、无损导入与自动保存。
- [模板格式](TEMPLATE_FORMAT.md)：声明式模板和可配置设计能力。
- [模板视觉](TEMPLATE_VISUALS.md)：Journal、Docs、Company 的视觉角色、响应式与验收范围。
- [搜索与页面性能](SEO_PERFORMANCE.md)：compiler-owned SEO 输出、sitemap/robots、图片优化与真实性能证据。
- [CLI](CLI.md)：高级用户与自动化入口。
- [Cloudflare 发布](CLOUDFLARE.md)：用户自有账号上的托管模型。
- [发行方式](DISTRIBUTION.md)：自包含 Studio、平台和升级策略。
- [安全模型](SECURITY.md)
- [测试策略](TESTING.md)
- [运行与恢复](OPERATIONS.md)
- [开发约定](DEVELOPMENT.md)
- [版本规则](VERSIONING.md)
- [术语表](GLOSSARY.md)
- [需求追踪](TRACEABILITY.md)

## 架构决策

- [DEC-001：Studio-first](decisions/001-studio-first.md)
- [DEC-002：单一 PublishBundle](decisions/002-publish-bundle.md)
- [DEC-003：声明式模板](decisions/003-declarative-templates.md)

## 实施任务

任务按用户价值纵向切分，必须依次完成：

1. [Walking skeleton](tasks/01-walking-skeleton.md)
2. [完整本地产品](tasks/02-local-product.md)
3. [首次公网发布](tasks/03-cloudflare-publish.md)
4. [持续更新与恢复](tasks/04-update-recovery.md)
5. [0.1 发行](tasks/05-release.md)

## 权威顺序

发生冲突时按以下顺序处理：

1. 产品愿景；
2. 产品战略；
3. PRD 与体验/编辑器契约；
4. 产品决策文件；
5. 安全下限；
6. 领域文档与架构；
7. 验收标准与需求追踪；
8. 实施计划；
9. 单个任务。

任务只能收窄范围，不能擅自改变产品。工程决策若要改变 Studio-first、四对象、0 终端/配置或数据可携带性，必须先修订并重新接受产品基线。旧 CLI-first 基线保存在 Git 提交 `8c0c892`，已被当前文档取代。
