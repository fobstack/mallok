# Mallok 0.1 验收标准

- 状态：0.1 基线（首次编写）
- 日期：2026-08-28
- 地位：定义「0.1 完成了」的唯一判据。**每一条都是可观察的行为，不是工程里程碑。** 证据格式与状态取值见 `TESTING.md §6`。

## 1. 发布门

0.1 只有一个验收对象：**一个真实的外贸 B2B 站在 Mallok 上跑起来并收到询盘**（`PRODUCT_VISION §2.1`）。

`PRODUCT_VISION §8` 的九步「成功画面」是发布门。**九步全部通过才叫 0.1**，任何单项工程里程碑都不能单独宣布发布：

> 只完成渲染内核、只完成 CLI、只有本地能跑，或者收不到询盘，都不等于完成 0.1。

## 2. 编号体系

```
AC-<组>-<序号>
```

| 组 | 范围 |
| --- | --- |
| `AC-DEPLOY` | 部署与首次启动向导 |
| `AC-CONTENT` | 内容录入、编辑、发布、多语言 |
| `AC-MEDIA` | 媒体上传与图片输出 |
| `AC-THEME` | 主题安装、切换、配置 |
| `AC-PLUGIN` | 插件开关与询盘链路 |
| `AC-SEO` | SEO 输出与性能门 |
| `AC-EXPORT` | 导入导出与不锁定 |
| `AC-CLI` | 命令行 |
| `AC-INV` | 跨阶段不变量（每个任务都要复验） |

状态取值：

| 状态 | 含义 |
| --- | --- |
| `VERIFIED_LOCAL` | 本地有可复现的证据（自动化测试，或本文注明的手工步骤） |
| `VERIFIED_HUMAN` | 已在真实 Cloudflare 账号上由人验过 |
| `NOT_AVAILABLE` | 尚无证据 |

**2026-08-30 逐条盘点见 §14。** 结论：76 条里 48 条 `VERIFIED_LOCAL`、28 条 `NOT_AVAILABLE`，**0 条 `VERIFIED_HUMAN`**——因为还没有在真实账号上跑过任何东西（§12 阻塞项 1）。

## 3. AC-DEPLOY

| ID | 验收 | 对应 |
| --- | --- | --- |
| `AC-DEPLOY-01` | `npx mallok create` 在一个干净的 Cloudflare 账号上创建全部资源并部署成功，打印可访问的 `.workers.dev` 地址 | 成功画面 1 |
| `AC-DEPLOY-02` | Deploy to Cloudflare 按钮走通一次，资源自动创建，`MALLOK_SECRET` 按 `CLOUDFLARE_RESOURCES.md §7` 的方案之一落地 | 成功画面 1 |
| `AC-DEPLOY-03` | 首次启动向导七步全部可完成，完成后 `/_mallok/setup` 返回 404 | 成功画面 1 |
| `AC-DEPLOY-04` | 绑定自定义域后站点正常服务，且**缓存命中**（`x-mallok-cache: HIT`） | 成功画面 2 |
| `AC-DEPLOY-05` | 未绑定自定义域时，向导明确提示缓存尚未生效，且 `robots.txt` 输出 `Disallow: /` | `ADMIN.md §5`、`SEO_PERFORMANCE.md §10` |
| `AC-DEPLOY-06` | 未配置 `CF_API_TOKEN` 时站点照常工作，`cache_ttl` 降为 60 秒并在后台常驻提示 | `CLOUDFLARE_RESOURCES.md §6` |
| `AC-DEPLOY-07` | 十个并发首请求全部 200，`migration` 表恰好一行，锁已释放 | `ARCHITECTURE §18` item 8 |
| `AC-DEPLOY-08` | 升级 Worker 版本后站点不中断，schema 自动迁移，旧版本在迁移期间仍能服务 | `ARCHITECTURE §15` |

## 4. AC-CONTENT

| ID | 验收 | 对应 |
| --- | --- | --- |
| `AC-CONTENT-01` | 在后台录入 10 个产品（含参数表与图片）并发布 | 成功画面 4 |
| `AC-CONTENT-02` | 发布一篇新闻，**数秒内**在公开 URL 上看到 | 成功画面 4、`PRODUCT_VISION §5.1` |
| `AC-CONTENT-03` | 启用第二种语言，为一个产品创建翻译版本，两个版本各有正确的 URL | 成功画面 5 |
| `AC-CONTENT-04` | 两个语言版本各自输出正确的 `hreflang`，含 `x-default` | 成功画面 5 |
| `AC-CONTENT-05` | 草稿不出现在公开 URL、不进缓存、不进 sitemap | `ARCHITECTURE §6.4` |
| `AC-CONTENT-06` | 定时发布到期后由 cron 自动发布并清缓存 | `ARCHITECTURE §6.5` |
| `AC-CONTENT-07` | 改 slug 后旧 URL 301 到新 URL | `ARCHITECTURE §7` |
| `AC-CONTENT-08` | 打开一篇内容再关闭，`markdown` 逐字节不变 | `ADMIN.md §6.2` |
| `AC-CONTENT-09` | 超 2 MB 的正文保存失败并给出明确错误，不静默截断 | `DATA_MODEL §2.2` |
| `AC-CONTENT-10` | 第一阶段超 CPU 预算时存为草稿并返回明确错误，**不静默失败** | `ARCHITECTURE §5` |
| `AC-CONTENT-11` | 引用缺失文件的内容可以保存、可以发布，后台显示「缺 N 张图」 | `CONTENT_FORMAT §4` |

## 5. AC-MEDIA

| ID | 验收 | 对应 |
| --- | --- | --- |
| `AC-MEDIA-01` | 后台上传图片，浏览器端转 WebP 并生成多宽度变体，Worker 不处理图片 | `ARCHITECTURE §8` |
| `AC-MEDIA-02` | 相同文件重复上传不重复存储（sha 去重） | `ARCHITECTURE §8` |
| `AC-MEDIA-03` | 正文图片输出带 `srcset`、`sizes`、`width`、`height`、`loading`、`decoding` | `SEO_PERFORMANCE.md §9` |
| `AC-MEDIA-04` | 媒体经 R2 自定义域直出，不计入 Worker 请求数 | `ARCHITECTURE §8` |
| `AC-MEDIA-05` | 非白名单类型被拒绝，按嗅探类型而非扩展名判断；svg 被拒绝 | `SECURITY.md §6` |
| `AC-MEDIA-06` | `ref_count` 归零的媒体进入「未使用」，7 天后由 cron 回收 | `DATA_MODEL §4` |

## 6. AC-THEME

| ID | 验收 | 对应 |
| --- | --- | --- |
| `AC-THEME-01` | 把主题目录放进 `src/themes/`、改一行导出、部署，站点即用新主题渲染 | `THEME_FORMAT.md §12` |
| `AC-THEME-02` | 换主题后**所有 URL 不变、内容 id 不变、媒体不变** | 成功画面 6 |
| `AC-THEME-03` | 后台按 `theme.json` 自动生成配置项表单，改完**即时生效**，主题作者不写后台代码 | `ADMIN.md §7`、`§4.1` |
| `AC-THEME-04` | 主题不支持某内容类型时，该类型降级到 `page` 布局，内容与 URL 不丢失 | `THEME_FORMAT.md §5.3` |
| `AC-THEME-05` | 含未声明 `<script>` 或 `on*=` 的主题**构建失败**，错误指出是哪个文件 | `THEME_FORMAT.md §9` |
| `AC-THEME-06` | 五个官方主题（`atelier`、`journal`、`gazette`、`manual`、`folio`）的客户端 JS 均为 **0 B**，唯一 `<script>` 是 JSON-LD 数据块 | `PRODUCT_VISION §5.6`；`test/core/themes.test.ts` 对每个主题的每个布局逐一断言 |
| `AC-THEME-07` | 主题资源经 Static Assets 直出，路径带版本、`immutable`、`nosniff` | `THEME_FORMAT.md §3.2` |
| `AC-THEME-08` | 后台没有任何主题上传或切换入口，且明确说明换主题需要重新部署 | `ADMIN.md §4.1` |

## 7. AC-PLUGIN

| ID | 验收 | 对应 |
| --- | --- | --- |
| `AC-PLUGIN-01` | 已装的 `inquiry` 插件用开关启用/停用、改设置与密钥，**均即时生效** | `PRODUCT_VISION §5.8` |
| `AC-PLUGIN-02` | 买家从产品页提交询盘，站主**几秒内收到邮件**（Reply-To 为买家邮箱） | 成功画面 8 |
| `AC-PLUGIN-03` | 买家收到自动回执，语言与提交页面一致 | 成功画面 8 |
| `AC-PLUGIN-04` | 后台询盘面板可看列表、看详情、标记垃圾、导出 CSV | 成功画面 8 |
| `AC-PLUGIN-05` | Turnstile、蜜罐、限流三层防护生效，且询盘提交在 Free 的 CPU 与子请求预算内 | `ARCHITECTURE §13`、`§18` item 9 |
| `AC-PLUGIN-06` | 邮件发送失败时由 cron 重试，状态在后台可见 | `ARCHITECTURE §13` |
| `AC-PLUGIN-07` | 界面如实说明**安装 / 更新 / 移除插件需要重新部署**，且后台没有上传入口 | `PLUGIN_API.md §2` |

## 8. AC-SEO

| ID | 验收 | 对应 |
| --- | --- | --- |
| `AC-SEO-01` | `/sitemap.xml` 输出全部已发布内容，含 hreflang 与 `x-default`，超 5000 条自动分页 | `SEO_PERFORMANCE.md §3` |
| `AC-SEO-02` | `/feed.xml` 按语言输出有效 RSS | `SEO_PERFORMANCE.md §2` |
| `AC-SEO-03` | 每页输出正确的 canonical、OG、Twitter Card | `SEO_PERFORMANCE.md §6` |
| `AC-SEO-04` | JSON-LD 输出 Organization / Article / Product / FAQPage，且 `<` 已转义 | `SEO_PERFORMANCE.md §5` |
| `AC-SEO-05` | Lighthouse 移动端 SEO **每次 100** | `SEO_PERFORMANCE.md §7`（待确认） |
| `AC-SEO-06` | Lighthouse 移动端 Performance 中位 ≥ 95、单次 ≥ 90 | `SEO_PERFORMANCE.md §7`（待确认） |
| `AC-SEO-07` | 页面体积与图片预算达标 | `SEO_PERFORMANCE.md §7`（待确认） |

## 9. AC-EXPORT

| ID | 验收 | 对应 |
| --- | --- | --- |
| `AC-EXPORT-01` | 一键导出全部内容与询盘，产出 `CONTENT_FORMAT §5` 的目录 | 成功画面 9 |
| `AC-EXPORT-02` | `CONTENT_FORMAT §9` 的七条往返一致性断言全部通过 | `CONTENT_FORMAT §9` |
| `AC-EXPORT-03` | 导出的 `index*.md` 逐字节等于 D1 里的 `markdown` | `CONTENT_FORMAT §8` |
| `AC-EXPORT-04` | 导出包**不含**任何密钥、会话、token、`render_cache` | `CONTENT_FORMAT §8` |
| `AC-EXPORT-05` | 导出的目录能被 Astro 或 Hugo 直接读取（人工验证一次） | `PRODUCT_VISION §5.2` |

## 10. AC-CLI

| ID | 验收 | 对应 |
| --- | --- | --- |
| `AC-CLI-01` | `mallok publish <dir>` 把本地文章包（含 `images/`）批量发布进站点 | 成功画面 7 |
| `AC-CLI-02` | 重复发布未修改的目录是空操作：**不写 D1、不清缓存** | `CONTENT_FORMAT §7.2` |
| `AC-CLI-03` | `mallok preview` 本地渲染结果与线上**逐字节一致** | `ARCHITECTURE §5` |
| `AC-CLI-04` | CLI 没有后台没有的能力，反之亦然 | `TECH_STACK §8` |
| `AC-CLI-05` | 缺图被报告，`--fail-on-missing` 在 CI 中生效 | `CLI.md §6.6` |

## 11. AC-INV：跨阶段不变量

**每个任务结束前都要复验这几条**，不是只在最后查一次：

| ID | 不变量 | 当前状态 |
| --- | --- | --- |
| `AC-INV-01` | `src/core/` 不 import 任何 Cloudflare 或 Node API，`tsc -p src/core/tsconfig.json` 通过 | `VERIFIED_LOCAL` |
| `AC-INV-02` | 同一输入渲染出逐字节相同的 HTML | `VERIFIED_LOCAL` |
| `AC-INV-03` | `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size` 全绿 | `VERIFIED_LOCAL` |
| `AC-INV-04` | Worker 打包 gzip 体积在 Free 3 MB 之内 | `VERIFIED_LOCAL`（2026-08-30：229.2 KiB，7.5%） |
| `AC-INV-05` | 单页冷渲染是 1 次 D1 batch，查询数 ≤ 3，行读有界 | `NOT_AVAILABLE`——**实测 2 次 batch**（最重的页面也是 2 次），措辞需修订，见 §14.2 |
| `AC-INV-06` | 列表页不解析正文、不查 `render_cache`、不执行 `COUNT(*)` | `VERIFIED_LOCAL`（`listPublished` 只取标量列、`LIMIT n+1`） |
| `AC-INV-07` | 错误响应不泄露 SQL、bucket 名、id 或堆栈 | `VERIFIED_LOCAL` |
| `AC-INV-08` | 访客页面客户端 JS 为 0 B（询盘页的 Turnstile 除外） | `VERIFIED_LOCAL`（`test/core/themes.test.ts` 对五个主题的每个布局断言除 JSON-LD 外无 `<script>`） |
| `AC-INV-09` | 改内容、改设置、改主题配置项、开关插件，**均不需要构建或部署** | `VERIFIED_LOCAL` |
| `AC-INV-10` | 换主题、装插件**确实需要部署**，且界面如实这么说——不做成假的一键操作 | `NOT_AVAILABLE` |

`AC-INV-09` 是产品的立身之本（`PRODUCT_VISION §5.1`）。**任何让它不成立的设计一律否决**，无论其他方面多有吸引力。

`AC-INV-10` 是它的另一半：需要部署的事就说需要部署。把「不需要构建」扩大成「什么都不需要构建」会在用户第一次换主题时崩塌，代价比一开始就说清楚大得多。

## 12. 阻塞项

这些不解决就无法宣布 0.1，但它们不是代码问题：

| # | 项 | 归属 |
| --- | --- | --- |
| 1 | `ARCHITECTURE §18` 的九项实测（`TASK-01 §4`） | 产品负责人执行 |
| 2 | Markdown 引擎决策（`TASK-01 §6`） | 产品负责人 |
| 3 | 内联 HTML 保留与否（`SECURITY.md §4`） | 产品负责人，与 #2 一并 |
| 4 | `SEO_PERFORMANCE.md §7` 的性能数字确认 | 产品负责人 |
| 5 | 许可证最终确定（`PRODUCT_VISION §12`） | `JasonYv`，实现者不得代选 |
| 6 | 仓库 `JasonYv/mallok` 创建与远端归属核验 | 产品负责人 |

## 13. 不属于 0.1

以下出现在需求里就是范围蔓延（`PRODUCT_VISION §10`）：Mallok 托管、账号体系、计费、多租户、购物车、支付、会员、评论、在线协作编辑、内容修订历史界面、字段级翻译、自动语言跳转、WordPress 导入器、产品 CSV/Excel 导入、可视化编辑器、AI 自动翻译。

## 14. 逐条盘点（2026-08-30）

Task 17 的产出。每条给状态与**证据**——证据是可复跑的测试文件、可复现的手工步骤，或明写「没有」。没有证据的一律 `NOT_AVAILABLE`，不给「应该可以」。

**总计（2026-08-30 收口后）：76 条中 56 条 `VERIFIED_LOCAL`、20 条 `NOT_AVAILABLE`、0 条 `VERIFIED_HUMAN`。**

**剩下的 20 条全部卡在真实账号或产品负责人裁决**——本地已经没有还能诚实关掉的了。

盘点当天又补齐了四条：`AC-EXPORT-01`（导出含 `inquiries.csv`，且后台有一键导出按钮）、`AC-EXPORT-04`（有测试断言导出里没有密钥、会话、`render_cache`）、`AC-CLI-03`（`mallok preview` 接线，见下方说明）、`AC-CLI-04` 的 `--create-only`（服务端强制，重复创建返回 409）。

零条 `VERIFIED_HUMAN` 是本次盘点最重要的一句话：**从未在真实 Cloudflare 账号上运行过任何东西**。所有「本地已验证」都是在 workerd 模拟环境或 `wrangler dev` 里跑出来的。

### 14.1 按组的状态

| 组 | VERIFIED_LOCAL | NOT_AVAILABLE | 主要缺口 |
| --- | --- | --- | --- |
| `AC-DEPLOY` (8) | 4 | 4 | 其余全部需要真实账号（`AC-DEPLOY-02` 的按钮与绑定说明已就位，但按钮本身没点过） |
| `AC-CONTENT` (11) | 9 | 2 | CPU 预算错误路径、cron 定时发布需真实环境 |
| `AC-MEDIA` (6) | 4 | 2 | R2 自定义域、7 天回收窗口 |
| `AC-THEME` (8) | 7 | 1 | 主题构建期脚本检查未测 |
| `AC-PLUGIN` (7) | 5 | 2 | 真实 Resend 投递、真实 Turnstile |
| `AC-SEO` (7) | 4 | 3 | Lighthouse 三条全部未跑 |
| `AC-EXPORT` (5) | 4 | 1 | Astro/Hugo 直读未人工验证 |
| `AC-CLI` (5) | 5 | 0 | 见下方 `AC-CLI-03` 的措辞说明 |
| `AC-INV` (10) | 8 | 2 | 见 §14.2 |

### 14.2 三条需要产品负责人裁决的

**1. `AC-INV-05` 的措辞与实测不符。** 条目要求「1 次 D1 batch、查询数 ≤ 3」。实测（`test/worker/budget.test.ts`，冷渲染、绕过缓存）：

| 页面 | D1 调用 | 组成 |
| --- | --- | --- |
| 普通文章页（无媒体、无关联） | **2** | `batch(5)` + `batch(1)` |
| 产品页（有分类关联、有同类推荐、有图片引用） | **2** | `batch(5)` + `batch(3)` |

有已解析媒体的页面再加 1 次（`loadMediaBySha`），关联条目带封面时再加 1 次，上限 4。

**为什么做不到 1 次 batch**：关联内容与媒体都依赖第一次 batch 返回的 content 行（slug、kind、frontmatter、assets），所以它们必然是第二个往返。这不是实现偷懒，是数据依赖。

建议把条目改成「**冷渲染的 D1 往返 ≤ 4 次，每次查询数常数级，行读有界**」，实测数字写进 `ARCHITECTURE §4`。**但这是架构不变量，由产品负责人改。**

**2. `AC-DEPLOY-03` 说向导七步，实现是四步。** 媒体域名与 Resend/DNS 两步需要账号级 Cloudflare API token，属 Task 16 未做的部分（`TASK-16.md §6`）；两者都能在设置里补做，没有功能不可达。要么补齐两步，要么把条目改成四步加「其余在设置里完成」。

**3. `AC-CLI-03` 的「逐字节一致」需要一句限定。** `mallok preview` 与线上跑的是**同一个** `renderFragment` / `renderPage`，所以给定相同输入产出相同字节。但预览是离线的，没有媒体表，因此图片仍是相对路径（`images/hero.png`），线上是 R2 URL。**正文与结构逐字节一致，媒体 URL 必然不同**——建议条目改成「同一份 Markdown 在两处产出相同的正文片段」。

**4. `src/worker/spike.ts` 还在。** Task 17 要求删掉它。**没有删**：它是 `TASK-01 §4` 那九项实测的量具，而实测还没做（§12 阻塞项 1）。先删量具再测量是本末倒置。测完再删。

### 14.3 证据索引

| 证据类型 | 文件 |
| --- | --- |
| 往返一致性（`AC-EXPORT-02`，七条） | `test/worker/roundtrip.test.ts` |
| 零客户端 JS（`AC-THEME-06`、`AC-INV-08`） | `test/core/themes.test.ts` |
| 询盘全链路（`AC-PLUGIN-01..06`，邮件与 Turnstile 用桩） | `test/worker/inquiry.test.ts` |
| 插件即时生效与密钥加密（`AC-PLUGIN-01`） | `test/worker/plugins.test.ts` |
| 向导与 Starter（`AC-DEPLOY-03` 的四步部分） | `test/worker/setup.test.ts` |
| SEO 端点（`AC-SEO-01..04`） | `test/worker/seo.test.ts`、`test/core/view.test.ts` |
| 多语言与 hreflang（`AC-CONTENT-03/04/07`） | `test/worker/locale.test.ts` |
| 媒体去重与类型嗅探（`AC-MEDIA-02/05`） | `test/worker/media.test.ts` |
| 关联内容与冷渲染预算（`AC-INV-05`） | `test/worker/relations.test.ts`、`test/worker/budget.test.ts` |
| CLI 参数、站点解析、扫描（`AC-CLI-01/02/05`） | `test/cli/*.test.ts` |
| 源文本不被改写（`AC-CONTENT-08`、`AC-EXPORT-03`） | `test/core/frontmatter.test.ts`、`test/worker/roundtrip.test.ts` |
| 手工验证（`wrangler dev`，步骤见各 TASK 文档 §5） | 后台三栏编辑器、插件面板、CLI publish/export/import 往返、Starter 安装 |

### 14.4 需要真实账号才能推进的（§12 阻塞项 1 的具体清单）

`AC-DEPLOY-01/02/04/07/08`、`AC-CONTENT-02`（数秒可见依赖清缓存）、`AC-CONTENT-06`（cron）、`AC-CONTENT-10`（CPU 预算）、`AC-MEDIA-04`（R2 自定义域）、`AC-MEDIA-06`（7 天窗口）、`AC-PLUGIN-02/03`（真实 Resend）、`AC-PLUGIN-05`（真实 Turnstile 与 CPU 预算）、`AC-SEO-05/06/07`（Lighthouse）、`AC-INV-04` 的真实 Total Upload 口径。
