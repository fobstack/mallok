# Mallok Studio-first 0.1 验收标准

- 状态：Normative
- 日期：2026-08-27

本文件定义 0.1 的可验证用户结果。字段、协议和安全细节仍由对应 reference 负责，但任何底层测试都不能替代 Studio 主路径。仓库当前尚无实现或稳定脚本；以下 AC 全部为 `NOT_STARTED`，只有在同一 verified SHA 上运行真实证据后才能改变状态。

旧 CLI-first 任务使用的 `AC-1A-*`、`AC-1B-*`、`AC-1C-*`、`AC-2A-*`、`AC-2B-*`、`AC-2C-*` 和 `AC-3-*` 不再是活动路线的完成定义；其历史含义只存在于 Git 历史或归档，不得拿旧结果冒充本文件的新 AC。

## 0. 文档与事实门

- **AC-00-01**：README、产品愿景、产品战略、PRD、架构、实施计划、测试、状态和五个活动任务对“Studio 是 MVP、默认 0 终端/0 配置、CLI 是次级 adapter”无冲突。
- **AC-00-02**：活动任务只有 `01` 至 `05`；当前任务目录不存在 `T-*` 活动文件，Git 历史或归档中的旧任务不能被编码助手误选。
- **AC-00-03**：尚未实现的界面、脚本、安装包、托管连接或公开仓库不被描述为已存在或已验证。
- **AC-00-04**：分发形态、首发平台、项目格式、模板信任边界和 Cloudflare 授权路径在进入受影响任务前有 accepted 决策；实现者不需要自行猜测公共行为。

## 1. Task 01：Studio walking skeleton

- **AC-01-01**：从 Studio 首屏可以创建新站点；默认流程不打开终端、不要求账号、不要求安装 Node/pnpm，也不要求编辑配置文件。
- **AC-01-02**：创建向导的四个显式决定固定为站点名称、用途、模板和本地保存位置；语言根据系统推断并可稍后修改，描述在创建后编辑。完成后得到可再次打开的本地项目；取消或失败不留下冒充有效项目的半状态。
- **AC-01-03**：用户能在 Studio 编辑示例文章的标题与正文，保存后规范 Markdown/项目数据与界面内容一致；重开项目后内容不丢失。
- **AC-01-04**：Studio 内嵌预览显示首页和文章页，编辑成功后可见更新；失败保留最后成功预览并给出可执行提示。
- **AC-01-05**：同一 create/edit/preview application service 可脱离 Studio UI 直接测试；UI 不启动 CLI 子进程，不读取或格式化领域内部状态。
- **AC-01-06**：主路径界面不出现 Node、pnpm、Git、D1、Wrangler、binding、migration、CAS 或 deployment fence 等前置术语。
- **AC-01-07**：正文默认以可视方式编辑并保存为规范 Markdown；visual → source 往返不改变受支持语义，遇到可安全保留但不受支持的节点时进入 source mode 而不静默丢失。

## 2. Task 02：完整本地产品

- **AC-02-01**：三个官方模板都能从同一内容创建站点，切换模板不修改或丢失正文、永久文档 ID 和 SEO 数据。
- **AC-02-02**：用户能导入本地常见静态图片、在文章中选择并预览；非法格式、动画、compressed/decoded 上限、尺寸/frame metadata、路径越界、symlink/junction 和缺失资源被安全拒绝且不破坏项目；签名发行物不依赖本机全局 libvips。
- **AC-02-03**：站点级 title/description/language 与文章 slug/summary/cover/coverAlt/publishedAt/SEO title/description 可在 Studio 编辑，字段错误定位到具体控件并保留用户输入。
- **AC-02-04**：一键静态导出生成首页、文章、404、RSS、sitemap 和资产；输出确定、无默认客户端 JavaScript；`ARCHITECTURE.md` 的 sidecar/nonce/phase/inventory 协议在每个崩溃点只自动保留或恢复一份 hash 可证的旧/新目录，任何多义状态 fail closed。
- **AC-02-05**：自动保存、显式保存、应用内安全退出、browser tab 直接关闭、进程强杀、异常恢复和项目重开均有测试；只能把 backend 已 ack 的 sequence 称为已保存，恢复不得覆盖更新的磁盘内容，未 ack 输入不得被虚假宣称为零丢失。
- **AC-02-06**：本地完整流程在无网络条件下可完成；“导出成功”不会被文案或状态误称为“已发布到公网”。
- **AC-02-07**：站点库可按 `PROJECT_FORMAT.md` 的身份规则重命名、复制、备份、恢复和移入废纸篓；站点的名称/描述/Logo/语言/导航与内容的草稿/发布字段可在 Studio 编辑，内容列表可按 title/slug/tag 本地过滤，危险动作不误删公开站点或其他本地目录。
- **AC-02-08**：支持单篇 Markdown 导入/导出与 `.mallok-backup.tar.gz` 站点备份恢复；streaming restore 对 entry type/path、PAX/GNU path、duplicate/case collision、count/bytes/ratio/hash 做边界与 `+1` 反例，失败不触及目标；受支持的 visual/source 语义往返稳定，不支持语法、raw HTML、重名 ID/slug 和缺失图片都给出定位且不破坏项目。
- **AC-02-09**：三个模板对同一 published fixture 生成完全相同的 canonical URL 集合；每个 200 HTML page 满足 compiler-owned head 合同且 charset 完整位于前 1024 bytes，preview/404 noindex，robots 指向有效 root sitemap，sitemap 与可索引页面集合 exact 相等；canonical root-relative 内链、slug 改写、draft/broken link、最大合法 origin、1,900 content、XML 特殊字符和 480 KiB 分片边界均有确定性回归。
- **AC-02-10**：published 内容只使用受管静态图片且正文/cover alt 非空；PNG/JPEG/WebP/AVIF/单帧 GIF 经固定三段 WebP profile 产生至多一个 ≤512 KiB asset，LCP 候选 ≤200 KiB，HTML 尺寸/loading/fetchpriority 正确，作者原图不变，未引用 media 不进 bundle；外部/动画图片和三段后仍超限的图片阻断。每页只引用一个最终 CSS，raw HTML ≤256 KiB、deterministic gzip CSS ≤32 KiB、确定性 critical budget ≤500 KiB。三模板的 home/page/article 在固定 Chrome/Lighthouse mobile 环境各 5 次顺序 cold run，Performance 中位数 ≥95、每次 ≥90，Accessibility/Best Practices 每次 ≥95、SEO 每次 100。

## 3. Task 03：首个 Cloudflare 公网发布

- **AC-03-01**：首次发布前，Studio 用普通语言展示托管商、账号/站点目标、将创建或修改的资源类别、默认 URL、权限与可能费用；用户明确确认前远程 mutation 为 0。
- **AC-03-02**：账号连接不要求用户复制 token、创建 `.dev.vars`、运行 Wrangler 或手写 Cloudflare ID；credential 只进入批准的系统安全存储，不进入项目、日志、错误、argv 或证据。
- **AC-03-03**：授权 staging 中，从未发布项目到公网 URL 的主路径由 Studio 完成；成功状态必须经过部署结果校验、health 和匿名 public smoke。smoke 覆盖 homepage、代表性 page/article、404、robots、root sitemap、全部 sitemap shard 和一个受管图片，并核对 status、content type、cache/CSP/nosniff、canonical/sitemap 集合与 asset bytes/hash；不能根据命令返回或本地文件猜测。
- **AC-03-04**：发布中断、认证失效、名称冲突、权限不足、资源部分创建和公网 smoke 失败都有准确状态；不能显示虚假成功，也不能自动删除 ownership 不明资源。
- **AC-03-05**：用户取消、关闭窗口或网络失败后可以安全重开项目并继续、重试或查看下一步；重复执行不会无界创建资源。
- **AC-03-06**：本任务只支持一个批准的 Cloudflare 路径和平台默认 URL；不要求自定义域名、多云或 Mallok 托管账号。

## 4. Task 04：更新、原子发布与恢复

- **AC-04-01**：编辑已发布文章后，Studio 显示变更摘要并通过同一 publish application service 生成不可变 PublishBundle；成功后公网正文、canonical、内部链接和 sitemap 同步更新，下线后 URL 从 sitemap 消失，不要求重新部署 Worker，也不要求用户理解 D1。
- **AC-04-02**：publish/unpublish 使用 `bundleHash`、不可变 staging rows、完整 HTML/robots/sitemap/asset 校验、`expectedCurrentBundleHash` guard、finalize 时 public-asset metadata 冲突 guard 和 D1 current bundle 原子切换；故障注入不留下对访客可见的半 bundle、错误 pointer、虚假版本或跨版本抓取集合。
- **AC-04-03**：请求结果未知时，Studio 查询远端 current bundle 并安全补齐/重放同一个 `bundleHash`；重复点击、响应丢失和应用重启不会创造不同内容、静默覆盖并发更新，且 inactive bundle 始终受 `8` 个/`64 MiB`、24 小时/7 天与每请求最多清理一组的确定边界约束；容量不足稳定失败且不创建第 9 个候选。
- **AC-04-04**：文章引用的新本地图片由发布编排先完成必要资产闭合；R2 只用 conditional create，已存在/响应未知只在 HEAD 的 checksum/bytes/MIME exact 时 no-op；资产失败或冲突时内容 pointer 不切换，用户得到可重试提示。
- **AC-04-05**：用户能从本地保留且 hash 已复核的上一个成功 PublishBundle 发起一次明确恢复发布；恢复前显示影响范围，恢复失败保持当前正常版本或进入明确的“需要处理”状态。
- **AC-04-06**：发布中与恢复中的用户文案只使用“发布更改、重试、恢复上一版本、需要处理”等产品语言；技术详情可展开或导出，但不是继续操作的前提。
- **AC-04-07**：真实 staging 覆盖首次发布、普通更新、下线、响应丢失重试、应用重启恢复和上一版本恢复，并保存脱敏证据与 ownership-based cleanup。
- **AC-04-08**：Studio 显示最近成功/失败/待确认发布记录；协议不兼容时普通发布阻断，只有用户明确确认的“更新网站托管”才调用共享 runtime-upgrade use case，失败不改变 current bundle。

## 5. Task 05：自包含 0.1 发行

- **AC-05-01**：在一台未安装 Node、pnpm、Git、Wrangler 或 Mallok 的受支持干净机器上，用户通过批准的发行物安装/打开 Studio，并完成本地创建、编辑、预览与静态导出。
- **AC-05-02**：发行物包含运行所需依赖且有可验证来源、签名/平台信任、版本、许可证和内容清单；不包含测试、源码秘密、开发路径、用户内容或本地 evidence。
- **AC-05-03**：升级保留用户项目并执行向前兼容检查；降级、卸载和不兼容项目给出诚实边界，不删除用户内容。
- **AC-05-04**：不少于 10 名没有 Node、终端和前端框架经验的目标用户中，至少 9/10 完成创建到预览，中位时间不超过 3 分钟，且全程不打开终端或代码配置。
- **AC-05-05**：同一画像至少 9/10 从“没有 Cloudflare 账号但可使用邮箱和系统浏览器”开始，完成账号注册、邮箱验证、条款、连接授权和首次公网发布，中位时间不超过 10 分钟；全部网络等待计入，并记录求助、误操作与手工配置次数。已有账号样本单独报告，不能替代该门。
- **AC-05-06**：对已写好的文章，从进入编辑界面到公开 URL 显示新内容最多 3 个显式用户动作；端口/本地服务异常、非法 slug、认证缺失、发布中断、恢复失败五类错误至少四类能仅按界面提示处理。
- **AC-05-07**：Studio 与三个官方站点模板通过适用的键盘、focus、label、读屏、缩放/reflow、对比度和 reduced-motion 检查；自动化结果不能替代人工核验。
- **AC-05-08**：候选 SHA 的 docs、static、unit、component、local/cloud flow、security、recovery、package、accessibility、performance 和 usability 适用门全部有真实证据，且无 P0/P1 finding。
- **AC-05-09**：同一候选版本在不少于 30 次受控 staging 单篇更新中公开可见时间 P95 不超过 60 秒；至少 9/10 目标用户在 2 分钟内完成模板切换且内容/URL 保留率 100%；由三个连续小版本组成的升级矩阵中至少 95% 项目自动完成，人工干预中位数为 0。
- **AC-05-10**：真实 Cloudflare staging 的三个官方模板各至少覆盖 homepage 与 article；每 URL 进行 3 次顺序 PageSpeed Insights mobile lab，Performance 中位数 ≥90，Accessibility/Best Practices ≥95、SEO 100；CrUX 缺失记录 `FIELD_DATA_UNAVAILABLE` 而不是伪造通过，若已有足够 field data 则按 mobile/desktop 第 75 百分位分别报告 LCP/INP/CLS。

## 6. 跨阶段不变量

- **AC-X-01**：Studio、CLI/自动化 adapter 和测试 composition root 调用同一 application/domain service；任何 adapter 都不能拥有独立业务真相。
- **AC-X-02**：内容、路径、HTML/URL、SQL、secret、远程 ownership 和恢复边界不因“简化 UI”而降低；所有危险输入和故障路径 fail closed。
- **AC-X-03**：同一项目、内容、模板、时钟和工具链产生确定输出；系统时间、随机值、绝对路径和机器登录状态不进入发布物。
- **AC-X-04**：每个用户可修复错误都有稳定内部 code、普通语言消息和具体下一步；默认界面不显示 token、SQL、堆栈、绝对路径或未发布正文。
- **AC-X-05**：每个任务的证据绑定 base/head SHA、实际命令、退出码、测试路径、环境和未验证项；类别或覆盖率不能替代用户流程结果。
- **AC-X-06**：0.1 对外列出的高级 CLI 命令逐个调用与 Studio 相同 application use case，具有稳定 JSON/退出码合同；禁用或删除 CLI adapter 时 Studio 仍能完成全部默认流程。

## 7. 竞争声称门（不阻塞 0.1 产品发布）

- **AC-C-01**：在同内容、同页面、同图片、同托管结果和锁定版本下，按 `COMPARISON_PROTOCOL.md` 对 Mallok 与 Astro 进行预注册、随机交叉任务测试，公开任务、环境、原始结果和失败样本。
- **AC-C-02**：同一批受测站点在 30/90 天记录人工维护时间、依赖/配置修改、失败与求助，达到 PRD 阈值后才可对外宣称“在该内容站路径上更易维护”。
- **AC-C-03**：未达到 `AC-C-01..02` 前，对外文案只能把“比 Astro 更简单、更少维护”表述为明确产品目标，不得伪装成已验证事实。
