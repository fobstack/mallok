# Task 02：完整本地产品

- 状态：`BLOCKED_BY_01`
- 依赖：Task 01 在同一可追溯主线上被接受
- 用户可见退出结果：离线完成三模板建站、图片、SEO、预览、静态导出，并能从异常退出中恢复
- 验收映射：`AC-02-01` 至 `AC-02-10`，以及适用的 `AC-X-*`

## 1. 目标

把 walking skeleton 补成无需云端也有完整价值的本地产品。普通用户能够在 Studio 中制作一个真实内容站并导出可部署的静态目录；导出失败不能破坏上一次成功结果，界面也不能把静态导出误称为“已上线”。

## 2. 依赖

- Task 01 的 Studio/application/persistence/preview 边界没有未解决 P0/P1；
- `journal`、`docs`、`company` 三个官方模板的视觉范围以 [TEMPLATE_VISUALS.md](../TEMPLATE_VISUALS.md) 为准，声明式 manifest 和设置字段以 [TEMPLATE_FORMAT.md](../TEMPLATE_FORMAT.md) 为准；
- 图片支持格式、compressed/decoded/frame 上限、项目资产目录和引用规则已接受；`sharp` 与 `tar-stream` 只可在本任务的 dependency-only gate 锁 exact version 后使用；
- SEO 字段、route/slug、compiler-owned head、RSS/sitemap/robots/404、受管图片和 PageSpeed 输出要求已按 `SEO_PERFORMANCE.md` 接受；
- 静态导出目录选择、覆盖确认与 ARCHITECTURE 定义的 marker → staging → backup → promote → crash recovery 策略已接受。

## 3. 范围

### 三个官方模板

- 提供 `journal`、`docs`、`company` 三个随产品分发且完整性可验证的声明式模板；
- 同一项目可切换模板，正文、稳定文档 ID、URL/slug、SEO 和图片引用不变化；
- 用户只编辑已冻结的 Logo、accent color、sans/serif font 和 compact/comfortable density；非法值在控件处解释，不发明其他布局选项。

### 内容、图片与 SEO

- 站点库按 `PROJECT_FORMAT.md` 的身份规则支持重命名、复制、备份、恢复和移入系统废纸篓；删除前明确已发布网站不会被自动下线；
- Studio 支持新建/编辑文章和页面，以及标题、slug、摘要、发布日期、SEO title/description；
- 可视编辑器完成 [EDITOR.md](../EDITOR.md) 的 0.1 节点，支持单篇 Markdown 导入/导出、visual/source 无损往返和 unsupported syntax 回退；
- 站点设置完成名称、描述、Logo、语言和最多 8 项导航；内容列表可按 title/slug/tag 在本地过滤；内容可明确标为 draft/published，`publishedAt` 只是发布日期，draft 可预览但不进入导出/publish bundle，0.1 不做定时发布；
- 导入批准的本地静态图片，复制到项目拥有的资产目录并生成稳定引用；只把 published route 实际引用的图片送入 bundle；
- 在导入和编译两端读取 metadata，拒绝危险格式、compressed bytes、宽高/channel/单帧 pixel 超限、frame count ≠1、metadata 缺失/溢出/截断、路径越界、symlink/junction、缺失文件和替换 race；失败不留下悬空引用；
- 按固定 sharp/libvips 三段 profile 自动定向、转换 sRGB、移除 metadata、缩小并编码至多一个 WebP；重新解码验证 ≤512 KiB、尺寸、MIME/hash，作者原图不变；动画与外部内容图片阻断；
- 正文图片 alt、cover/coverAlt 配对与关键 SEO 缺失在发布/导出前以普通语言定位；缺失/空 alt 阻断，站内重复 metadata 只警告并保留用户输入；compiler 统一生成 head、sitemap/分片、robots 和 canonical，不让模板复制逻辑；
- 三模板 home/page/article 运行 `SEO_PERFORMANCE.md` 的 45 次固定 Lighthouse mobile gate并保存原始报告。

### 静态导出与本地恢复

- 同一 PublishBundle 生成首页、文章/页面、404、RSS、sitemap 和全部资源；默认站点不含客户端 JavaScript；
- 导出先写入任务拥有的临时目录，完整校验后按 `ARCHITECTURE.md` 的 sidecar owner/nonce/exact basename/phase/inventory 执行 crash-safe backup/promote；取消、失败或在任一 marker/rename/delete 点强制终止后，下次启动只能自动恢复一份 hash 可证的完整旧/新导出，多义状态不自动破坏任何目录；
- 站点备份固定输出 `.mallok-backup.tar.gz`；streaming reader 只在 sibling staging 自行创建已验证的普通目录/文件，拒绝 link/device/PAX path/collision/bomb，全部清单和 hash 通过后才 promote 到空目标；
- 自动保存、显式保存、应用内安全退出、browser tab 关闭、进程强杀、最后 ack sequence 恢复、陈旧恢复文件、并发打开和重开项目均有明确状态；
- 本地创建、编辑、预览、导出在断网环境完整可用；
- 为新增验证类别登记真实 runner、test path 和命令。

## 4. 非目标

- Cloudflare 账号连接、公网发布、D1 更新或自定义域名；
- R2、在线媒体库、多宽度 `srcset`、手工裁剪、动画/视频优化或图片 CDN；
- 第三方模板市场、任意模板 JavaScript、插件生态；
- 多人协作、云同步、公开站点全文搜索、电商或 analytics；
- 自包含发行包的最终签名与升级测试。

## 5. 可测试验收

- `AC-02-01`：三模板创建/切换对同一内容保持文档 ID、正文、slug、SEO 和图片引用。
- `AC-02-02`：正常静态图片可导入/预览；五种格式的 metadata、8192/8193 边界、40,000,000/40,000,001 pixels、1/2 frame、channel、截断/溢出、bytes、路径、链接和 race 安全语料 fail closed；签名 app 在无全局 libvips 的干净机器运行。
- `AC-02-03`：全部批准 SEO 字段可编辑，错误定位控件且不丢输入。
- `AC-02-04`：三个模板都生成 exact expected file set；相同输入输出 bytes/hash 相同，无默认客户端 JavaScript；对 `prepared|backup-created|promoted` 的每个 marker update/rename/delete 前后杀进程，显式覆盖“首次导出 prepared+无 output”和“更新导出 prepared+backup 已创建但 phase 未更新”，恢复结果满足冻结矩阵，mismatch 时零自动 rename/delete。
- `AC-02-05`：保存、安全退出、tab 直接关闭、进程强杀、陈旧临时状态、并发打开和重开恢复的故障注入证明最后 ack 内容可恢复且不覆盖更新数据；未 ack 输入不得被报告为已保存。
- `AC-02-06`：断网端到端流程通过；所有文案严格区分“导出完成”和“已发布”。
- `AC-02-07`：站点库操作、复制身份隔离、备份/恢复、废纸篓、全部批准设置、内容列表过滤、导航与 draft/published 选择的正常/取消/失败路径均有端到端和路径安全证据。
- `AC-02-08`：Markdown 导入/导出、visual/source 往返、unsupported/raw HTML、重名 ID/slug、缺图、1,900/1,901 content，以及 `.mallok-backup.tar.gz` 的 entry/type/path/PAX/duplicate/NFC+case/bytes/ratio/hash 边界均有回归，任一失败不破坏原项目或目标目录。
- `AC-02-09`：三个模板共享 exact canonical URL 集合与 SEO head；charset 完整位于前 1024 bytes，preview/404 noindex；canonical root-relative 内链、slug 改写、draft/broken link、robots/root sitemap/shards/XML 集合在最大 origin、1,900 content、480 KiB 边界和特殊字符下闭合且确定。
- `AC-02-10`：受管图片三段优化、正文/cover alt、LCP 候选 ≤200 KiB、动画/外部拒绝、未引用排除、HTML 性能属性、单一最终 CSS、raw HTML/CSS/critical budget 与 45 次 Lighthouse gate 全部满足 `SEO_PERFORMANCE.md`。
- 适用 `AC-X-*`：HTML/URL/path、错误、确定性和共享 application service 有证据。

## 6. 精确验证类别

必须保持 Task 01 类别通过，并新增/扩展：`DOCS`、`STATIC`、`UNIT`、`COMPONENT`、`FLOW-LOCAL`、`FLOW-EXPORT`、`SECURITY`、`DETERMINISM`、`A11Y-STUDIO`、`A11Y-SITE`、`SEO-SITE`、`PAGESPEED-LOCAL`。

每个类别必须对应实际 test path、命令、退出码、环境和 verified SHA。只测试 compiler 不能替代 Studio 导出流程；截图不能替代键盘、读屏或 HTML5 重解析检查。

## 7. 停止条件

- 任一本地主路径需要网络、账号、终端、外部 runtime 或手写配置；
- 模板切换改变内容/URL 或模板需要执行任意第三方代码；
- 图片能越过项目边界、进入绝对路径，或失败后留下悬空/未归属资产；
- `sharp` 原生依赖或 streaming tar reader 不能随 Tier-1 standalone app 正确打包/签名，或需要全局 libvips/shell `tar`/直接不可信 extraction；
- 静态导出与 Studio preview 使用不同业务编译管线；
- 导出覆盖发生在完整校验之前，无法证明失败后旧结果仍可用；
- crash 恢复可能覆盖更晚的用户保存，或并发打开没有可理解处理；
- UI 把本地文件路径说成已发布公网 URL；
- 需要未批准依赖、网络、远程 mutation 或任务外路径。

## 8. 完成报告

除通用任务报告外，附三模板矩阵、图片/路径安全 corpus、静态文件清单与 hash 对比、断网流程、crash/恢复故障矩阵、Studio/站点可访问性结果。全部证据独立接受后才能进入 Task 03。
