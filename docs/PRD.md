# Mallok 产品需求文档

- 状态：MVP 基线草案
- 版本：0.1.0
- 日期：2026-08-26
- 产品域名：`mallok.dev`

## 1. 产品定义

Mallok 是面向开发者和小型内容团队的内容网站引擎。用户用 Markdown 创作文章，以 D1 作为线上发布投影，用可替换主题生成网站，并通过一个 CLI 部署为纯静态站或 Cloudflare Worker + D1 动态站。

Mallok 的目标不是复制 Astro 的组件生态，而是提供一条更窄、更可控的链路：

```text
内容来源 -> 统一内容模型 -> Markdown/数据处理 -> 主题渲染 -> 静态文件或 Worker 响应 -> 部署
```

## 2. 需要解决的问题

现有脚手架通常把内容、模板、云平台和部署脚本耦合在一起：

- 换主题时必须理解框架内部约定；
- 静态内容和数据库内容使用两套渲染逻辑；
- 一键部署脚本容易把密钥写进仓库；
- 内容 API 缺少明确的校验、转义和版本边界；
- 对简单内容站而言，完整前端框架带来不必要的运行时和升级成本。

Mallok 要把这些边界变成明确、可测试的产品契约。

## 3. 目标用户

### 3.1 独立开发者

希望快速建立博客、文档站、新闻站或产品内容站，并保留对 HTML、CSS、路由和部署的控制权。

### 3.2 小型内容团队

开发者负责主题和部署，编辑通过 Markdown、CLI，未来通过 GUI 更新文章。

### 3.3 主题作者

希望围绕稳定的内容模型开发可复用主题，不需要依赖某个前端组件框架。

## 4. 核心用户任务

1. 五分钟内创建一个可预览的站点。
2. 添加一篇 Markdown 文章并看到本地页面更新。
3. 替换主题，而不迁移文章数据。
4. 构建一个无需服务端的静态目录。
5. 切换到 D1 模式，让已发布文章无需重新构建即可更新。
6. 用一条部署命令完成构建、检查、迁移提示和 Worker 发布。
7. 在失败时得到可执行的诊断，而不是底层堆栈。

## 5. 产品原则

### 5.1 一个内容模型，两个诚实的运行模式

“纯静态”与“数据库更新后立即生效”不能同时成立。Mallok 明确提供两个目标：

| 模式 | 内容来源 | 页面生成时机 | D1 更新后 | 运行成本 |
|---|---|---|---|---|
| `static` | 本地 Markdown | 构建时 | 不读取 D1；必须重新构建/部署 | 最低 |
| `cloudflare` | D1 发布投影，静态资源来自构建产物 | 发布时编译内容，请求时套用主题 | cache-busted 下一请求可见；普通 URL 最迟 60 秒 | Worker + D1 |

两个模式共享 `ContentEntry`、Markdown 管道、路由规则和 Theme API。

双模式是 Mallok 的产品路线，不是首个代码阶段同时交付的承诺。Phase 1 先形成 static alpha 来验证 compiler、路由和主题；Phase 2 再形成 Cloudflare alpha；只有 Phase 3 的跨模式、安全和真实部署门通过后，才称为 MVP 发布候选。Theme API 在发布候选前属于 experimental。

### 5.1.1 内容真相模型

MVP 中 Markdown/Git 是作者源，D1 是线上发布投影，不是第二个可以随意编辑的主库：

- `mallok publish` 读取本地 Markdown、执行同一套校验和编译，再创建不可变 revision；
- D1 保存源 Markdown、已清洗的编译结果、内容 hash、compiler version 和当前发布指针；
- 相同 artifact hash 重复发布是幂等操作；artifact hash 覆盖规范化源、frontmatter、compiler/schema version 和影响输出的编译选项；
- 更新创建新 revision，不原地覆盖历史；
- 同一 id 修改 slug 是同一文档的新 revision；MVP 中旧 slug 变为 404，不自动创建 redirect；
- 下线必须执行显式 `mallok unpublish`，删除本地文件不会自动删除线上内容；
- MVP 不允许 GUI 或其他客户端绕过发布 API 直接写 D1。

未来 GUI 如果成为独立作者源，必须先通过新的 ADR 决定“写回 Git”还是将 D1 升级为主源，不能静默形成双向同步。

### 5.2 默认输出服务器渲染 HTML

默认主题不依赖客户端 JavaScript。交互增强可以由主题显式添加，但不是内核要求。

### 5.3 安全优先于模板自由度

内容值默认转义；Markdown 原始 HTML默认关闭；只有经过可信清洗的 HTML 才能进入原始输出通道。

### 5.4 CLI 是第一产品界面

GUI 复用 CLI 和内容 API 的能力，不拥有独立业务逻辑。内核、CLI 和远程内容更新达到稳定验收后才开始 GUI。

## 6. MVP 范围

### 6.1 P0：必须交付

- pnpm + TypeScript ESM monorepo。
- `mallok init` 创建最小站点。
- `mallok new article` 生成带稳定 UUID 的文章文件。
- 从目录加载 Markdown 与 YAML frontmatter。
- 统一并校验文章模型。
- 支持草稿、发布日期、slug、标签、摘要和主题模板名。
- GFM Markdown 渲染；原始 HTML 默认关闭；输出清洗。
- 可替换的 Theme API 和一个官方基础主题。
- 生成首页、文章页、404、RSS、sitemap 和静态资源。
- `mallok dev`、`build`、`preview`、`doctor`。
- 构建结果可重复，错误有稳定错误码。
- Cloudflare Worker 适配器和 D1 repository。
- D1 migration 与文章修订记录。
- 带 Bearer token、revision 和乐观锁的最小发布 API。
- `mallok publish` 和 `mallok unpublish` 安全更新动态站。
- Cloudflare 模式的首页、RSS 和 sitemap 从同一 D1 发布投影动态生成。
- `mallok deploy` 在本地验证后调用项目内 Wrangler；默认 dry-run 确认，实际部署需显式确认参数。
- 单元、集成和至少一条端到端构建测试。
- 不把任何密钥或云资源 ID 写入可提交的模板文件。
- 动态发布阶段只接受绝对 HTTPS 图片 URL或已随站点部署的 `/assets/` 路径；引用新的本地二进制图片时必须阻止 publish 并提示先部署资源。R2 上传属于 P1。

### 6.2 P1：MVP 后

- Mallok Studio 可视化编辑器。
- 草稿预览链接和多人角色权限。
- 图片上传与 R2 媒体库。
- 主题脚手架、主题市场和在线预览。
- 增量静态构建与更细粒度缓存失效。
- Webhook、Git 内容源和其他数据库适配器。
- 多语言、内容集合和自定义字段 schema。

### 6.3 明确不做

- 通用前端组件框架。
- 在模板中实现 React/Vue/Svelte 兼容层。
- 多租户 SaaS 控制面。
- 自建账号、支付、团队计费。
- 自研 Markdown 语法解析器或 YAML 解析器。
- 运行不受信任的远程主题代码。
- 承诺静态站在 D1 更新后自动变化。

## 7. 功能需求

### FR-001 项目初始化

`mallok init <dir>` 必须生成可立即构建的项目，包含配置、示例文章、基础主题、公开资源和必要脚本。目标目录非空时默认拒绝覆盖。

### FR-002 配置加载

MVP 使用 `mallok.config.mjs`。配置必须支持站点元数据、内容目录、主题入口、输出目录和目标运行模式。未知字段应给出警告，非法字段应阻止构建。

### FR-003 Markdown 内容加载

系统递归加载内容目录中的 `.md` 文件，解析 frontmatter，并规范化为 `ContentEntry`。每篇文章必须有由 `mallok new` 或 starter 生成的不可变 UUID `id`；slug 可以变化但不代表身份。重复 id、重复 slug、越界路径、非法日期和缺失标题必须报告具体文件。文件 mtime 不得成为内容字段或构建输入。

### FR-004 发布过滤

生产构建默认排除 `draft: true` 或发布时间晚于显式构建时钟 `asOf` 的文章。CLI 默认在构建开始时固定一次 `asOf`，测试使用固定值；开发模式可以显式包含草稿。

### FR-005 路由

默认文章路径为 `/articles/<slug>/`。MVP slug 固定为单个小写 ASCII kebab-case URL 段，不允许 `..`、斜杠、空段、百分号、Windows 保留设备名或编码后的路径穿越。完整路由只能由 route planner 生成，不能把 slug 直接拼接为文件系统路径。

### FR-006 Markdown 渲染

支持 CommonMark 与 GFM 常用语法。原始 HTML 默认作为文本处理或移除。链接协议只允许安全列表，外部链接策略由主题决定。

### FR-007 主题

主题接收只读的渲染上下文并返回 HTML 文档。主题至少实现首页、文章页和 404；RSS 与 sitemap 由核心生成。内容值必须默认转义。跨静态/Worker 共用的主题不得读取 Node builtin、ambient environment、网络、系统时间或随机数；时间和站点数据只能来自 context。

### FR-008 静态构建

`mallok build --target static` 输出可直接托管的目录。相同内容、配置、主题、Mallok 版本和 `asOf` 应产生内容相同的文件。构建失败时不得留下半完成的正式输出目录。

### FR-009 本地开发

`mallok dev` 监听内容、主题、配置和公开资源变化，完成重建并刷新浏览器。默认只监听 loopback，不暴露到局域网。

### FR-010 D1 发布投影

D1 模式保存不可变文章 revision 和当前发布指针。公开查询只返回 `published` 且发布时间有效的文章，所有 SQL 使用绑定参数。更新必须携带预期版本，冲突不得静默覆盖。

### FR-011 动态渲染

Cloudflare Worker 根据请求从 D1 获取经过 Mallok compiler 生成的 `CompiledEntry`，再使用与静态模式相同的 Theme API 返回完整 HTML；请求路径不重新解析 Markdown。发布服务端必须重新校验和编译源 Markdown，不能信任 CLI 上传的 HTML。首页、`/rss.xml` 和 `/sitemap.xml` 也从同一发布投影生成。不存在和未发布内容返回一致的 404 页面。

### FR-012 内容更新 API

发布 API 必须验证 Bearer token、Content-Type、请求体大小、幂等键、预期版本和字段 schema。对外是一次原子 `publishRevision` 领域操作：编译、创建不可变 revision、校验预期版本、切换发布指针和增加版本必须整体成功或整体失败。响应不得包含密钥、SQL 或内部堆栈。

### FR-013 内容发布 CLI

`mallok publish` 默认显示新增、更新、跳过和冲突数量；只有显式确认或 `--yes` 才执行远程写入。它必须拒绝尚未部署的本地图片引用。`mallok unpublish` 必须二次确认。token 只从环境变量、系统密钥链或交互输入读取。

### FR-014 部署

`mallok provision` 负责规划和创建 D1 等云资源；`mallok deploy` 只迁移已绑定资源并发布 Worker/静态资源。两者都先执行 doctor 和计划；不可逆或计费动作必须展示目标并要求显式确认。首次引导可以串联两个命令，但日志和恢复点必须保持分离。

### FR-015 诊断

`mallok doctor` 检查 Node、包管理器、配置、内容、主题、输出权限以及目标适配器所需条件。每个问题提供修复建议。

## 8. 非功能需求

### NFR-001 性能

- 1000 篇普通文章的干净静态构建目标：开发机上不超过 10 秒；该数字是工程目标，不是发布承诺。
- 默认页面零客户端 JavaScript。
- Worker 单篇文章渲染不执行无界查询。
- 动态公开响应携带 revision id/ETag；publish 成功后的 cache-busted 首次读取必须返回新 revision，普通 URL 最迟 60 秒内一致。

### NFR-002 安全

- 对 Markdown XSS、模板插值、JSON-LD `</script>` 逃逸、SQL 注入、路径穿越和密钥泄露建立回归测试。
- 管理端响应统一 `Cache-Control: no-store`。
- 仓库 secret scan 不得发现真实凭据。

### NFR-003 兼容性

- Node.js 22 及以上。
- macOS、Linux；Windows 在 MVP 中作为尽力支持，并通过路径单元测试覆盖。
- Cloudflare Workers 当前 Module Worker 模式。

### NFR-004 可维护性

- TypeScript strict。
- 核心模块分支覆盖目标 80%。
- 公共契约使用语义化版本；破坏性变更必须有 ADR 和迁移说明。

### NFR-005 可访问性

官方基础主题目标达到 WCAG 2.2 AA 的结构、对比度和键盘可用性要求。

## 9. 成功指标

MVP 发布判断以任务成功率为主，不以 GitHub star 为主：

- 新用户从空目录到本地页面的中位时间小于 5 分钟。
- 新增 Markdown 到构建成功不超过 3 个命令。
- 官方示例在静态和 D1 两种模式的渲染快照一致。
- P0 安全回归测试全部通过。
- 文档中的全新环境演练可以无隐含步骤完成。

## 10. 待产品负责人决定

- 开源许可证：MIT 或 Apache-2.0。
- 中文正式品牌名使用“码洛克”还是只保留 Mallok。
- 首个官方主题的视觉方向。
- GUI 的身份认证方案与托管模式。

这些决策不阻塞内核阶段，但许可证必须在公开发布前确定，视觉方向必须在 GUI 或官网开发前确定。
