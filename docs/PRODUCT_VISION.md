# Mallok 产品愿景与竞争边界

- 状态：Accepted long-term product direction
- 日期：2026-08-27
- 计划公开维护者：`JasonYv`
- 计划 GitHub 仓库：`github.com/JasonYv/mallok`（当前本地未配置 remote；远端是否已经创建未核实，不得描述为已发布）

## 1. 北极星

Mallok 的长期目标，是让**第一次做内容网站的人**也能从模板出发，完成站点创建、内容编辑、预览、发布和故障恢复，而不必先理解组件框架、路由器、bundler、数据库、Cloudflare binding 或部署状态机。

这不是“复制一个更小的 Astro”。Mallok 要在一个收窄任务上成为更好的产品：

> 对博客、新闻、文档和中小企业内容站，把“选模板 → 填内容 → 预览 → 发布 → 持续更新”做成一条默认完整、安全、可恢复的路径。

“更好、更轻、更容易”在取得证据前是产品目标，不是已经成立的事实。公开文案只能说“为这条路径而设计”；只有通过本文件第 5 节的同条件工程基准和真人任务测试后，才能作比较性结论。

## 2. 为什么不能只写“全面优于 Astro”

截至 2026-08-27，Astro 官方文档已经提供：

- [`create astro` 安装向导和模板入口](https://docs.astro.build/en/install-and-setup/)；
- [默认静态、通过 adapter 按需渲染](https://docs.astro.build/en/guides/on-demand-rendering/)；
- [build-time 与 live content collections](https://docs.astro.build/en/guides/content-collections/)；
- [默认不向静态组件发送客户端 JavaScript](https://docs.astro.build/en/concepts/islands/)。

因此 Mallok 不能把“零客户端 JS”“能读 Markdown”“能动态渲染”单独当成胜负依据。Astro 的优势是通用框架能力和生态；Mallok 的机会是把内容、模板、发布投影、诊断和部署恢复整合为一个意见明确的产品，让默认用户少做技术选择。

Mallok 只比较下面这条窄路径，不声称替代 Astro 的组件、integration、多框架或通用应用能力。

## 3. 用户分层

### 3.1 当前 MVP 操作者

会安装 Node.js、使用终端和编辑 Markdown 的独立开发者或技术型站点负责人。他们先验证 Mallok 的内容内核、CLI、static target、D1 更新和可恢复部署链路。

CLI-first 是交付顺序，也是稳定的自动化接口；它不是长期大众体验的终点。

### 3.2 长期核心用户

不会前端框架、Node.js、Git 或 Cloudflare 配置的内容创作者、小微企业站主和团队编辑。他们应通过 Mallok Studio 或后续受控引导入口：

1. 选择模板；
2. 填写站点名称、域名和基础信息；
3. 编写或导入内容；
4. 预览并发布；
5. 在失败时按人类可理解的建议恢复。

这些用户不应看到 ESM Theme API、D1 revision、CAS、Wrangler 或 deployment fence。内部安全复杂度由 Mallok 吸收，但不得通过隐藏失败、跳过确认或弱化恢复证据来制造“简单”。

### 3.3 高级用户与供给者

开发者、主题作者和自动化系统可以继续使用 CLI、Markdown/Git、Theme API 与管理 API。可视化入口和 CLI 是同一 application/domain service 的平级 adapter；Studio 不得 shell out 到 CLI，也不得另造业务真相。

## 4. 产品承诺

1. **默认路径完整**：基础站点不要求用户手写框架组件、路由、SQL、adapter 或 Wrangler 配置。
2. **逐层暴露复杂度**：普通用户先看到模板、内容和发布；高级配置在需要时才出现。
3. **同一项目，两种诚实输出**：static 内容变化需要重建；D1 内容更新无需重新部署 Worker，不混淆两者。
4. **访客端轻量**：官方默认主题客户端 JavaScript 为 0 B；未来 Studio 的复杂度不能泄漏到公开站点。
5. **可退出、可审计**：Markdown/Git、静态输出和内容导出保持可迁移，用户不被 GUI 锁死。
6. **错误可恢复**：计划、确认、幂等和恢复证据保留；“一键”只能描述已经把失败路径也闭合的操作。
7. **模板不是组件生态**：最终用户选择页面模板；主题作者才接触 experimental ESM Theme API。

## 5. “更轻、更容易”的证据门

### 5.1 当前 MVP developer path

- 已安装声明版本 Node/pnpm 的首次用户中，至少 8/10 在 10 分钟内、无维护者代操作完成空目录到本地预览；目标中位数低于 5 分钟；
- 基础 happy path 不手改 Mallok config、主题代码、SQL 或 Wrangler 文件；
- 从已经准备好的 Markdown 到成功 static output 最多 3 次 Mallok CLI 调用；
- 官方主题公开页面客户端 JavaScript 为 0 B；
- 固定 1000 篇 fixture 的工程性能目标沿用 `PRD.md` 与 `TESTING.md`，不能用单次最佳值宣传。

这些数据只证明 developer path，不证明非技术用户可用。

### 5.2 Phase 4 non-technical path

在不少于 10 名没有 Node、终端和前端框架经验的目标用户中：

- 至少 8/10 在 10 分钟内完成“选择模板 → 创建站点 → 本地/托管预览”，且不打开终端或代码配置；
- 至少 8/10 在 20 分钟内完成首次公开发布；测试环境必须明确包含账号注册、授权和网络时间；
- 对已经写好的文章，从进入编辑界面到公开 URL 最多 3 个显式用户动作；写作时间不计入；
- 端口占用、非法 slug、缺站点 URL、认证缺失和部署中断五类错误中，至少 4 类可仅按界面提示恢复，无需搜索内部文档；
- 记录完成率、完成时间、求助次数、手工配置次数和误操作，不用自动化 E2E 冒充真人可用性。

“任何人都能用”“零门槛”等绝对表述永久禁用，有限样本无法证明这类命题。完成上述测试后，也只能公开陈述受测画像、样本量、测试条件、完成率和完成时间，例如“10 名无终端经验参与者中有 8 名在 10 分钟内完成预览”。

### 5.3 与 Astro 的可复现对比

本节只是未来比较协议的最低输入清单，不是现成 benchmark，也不能单独支持“Mallok 比 Astro 更轻、更容易”的总括结论。作任何比较性宣传前，必须另行批准一份版本化 benchmark protocol，并冻结：

- developer 与 non-technical 两类 persona 各自的任务、成功条件和双方最佳官方支持路径；非技术路径不得用 Mallok Studio 对比 Astro CLI，必须纳入测试时 Astro 官方提供的浏览器模板/预览入口；
- 等价内容、页面、主题功能、部署目标和托管前置条件；双方不能通过删减功能取得优势；
- 机器、操作系统、运行时、网络、缓存冷热、锁定版本、重复次数、统计方法和异常值处理；
- 每个主要指标、优势阈值、允许退化阈值，以及负责复核原始 evidence artifact 的角色；
- 可公开复跑的 fixture、脚本、原始结果、失败样本和未通过项目。

在该协议获批并执行前，只能发布某个具体指标及其完整测试条件，不能发布总括比较。协议获批后至少记录：

- cold install 时间、下载/解包体积、direct/transitive dependency 数；
- cold/warm build、峰值 RSS；
- 最终 HTML/CSS/JS bytes 与客户端 JavaScript；
- 从空目录到预览/发布所需命令、手工配置和阅读文档页数；
- 内容更新到公开可见所需的 build/deploy 次数。

如果只在某项获胜，文案只能陈述该项。只有预先冻结的主要资源指标和真人任务成功率都达到协议阈值，且没有超过阈值的关键退化时，才可以说 Mallok 在该协议覆盖的内容建站路径和受测条件下“比 Astro 更轻、更容易”；不得外推为全面产品结论。

## 6. 阶段事实

- Phase 1–3：先交付开发者可验证的 core、CLI、static、D1、发布和部署闭环；
- Phase 4：Mallok Studio 是长期核心产品阶段，不是可有可无的装饰层；需要新的浏览器身份、权限、作者真相、托管与威胁模型 PRD/ADR；
- 当前仓库没有实现，本地也未配置 Git remote；远端仓库是否存在及其控制权尚未核实，项目尚未公开发布。确认并绑定 `JasonYv/mallok`、选择许可证并完成发布门后，才可称为公开开源项目。

## 7. 不做的事

- 不把 Mallok 宣传成适用于所有 Web 应用的 Astro 替代品；
- 不构建 React/Vue/Svelte 组件兼容层来追逐生态规模；
- 不用“傻瓜”作为正式用户称谓；使用“第一次建站的人”或“非技术内容创作者”；
- 不为了看起来一键而隐藏付费、权限、数据删除或不可恢复副作用。
