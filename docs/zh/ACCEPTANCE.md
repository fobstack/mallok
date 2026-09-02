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
| `VERIFIED_LOCAL` | **能指出 `文件:行号` 的自动化断言。** 手工走一遍不算——`TESTING §1` 第 3 条：不可复现的测试等于没有测试 |
| `VERIFIED_HUMAN` | 已在真实 Cloudflare 账号上由人验过 |
| `NOT_RUN` | 有实现，但没有可复现的证据 |
| `PENDING_DECISION` | 实现没问题，**是条目本身写错了**，等产品负责人裁决。卡住它的是我们，不是平台 |
| `NOT_AVAILABLE` | 需要真实账号或外部服务，本地无从取证 |

**每条的状态与证据写在下面各组的表里，总数是从表里数出来的，不是写上去的。**
这是 2026-09-01 重核后的结构改动：此前只有 `AC-INV` 一组带状态列，其余 57 条没有，
总数只能手工维护，于是漂成了三个互相矛盾的数字（详见 §14.0）。

## 3. AC-DEPLOY

| ID | 验收 | 状态 | 证据 / 对应 |
| --- | --- | --- | --- |
| `AC-DEPLOY-01` | `npx mallok create` 在一个干净的 Cloudflare 账号上创建全部资源并部署成功，打印可访问的 `.workers.dev` 地址 | `NOT_AVAILABLE` | 需真实账号。命名与顺序有单元测试（`test/cli/provision.test.ts`），但命令从未执行过 |
| `AC-DEPLOY-02` | Deploy to Cloudflare 按钮走通一次，资源自动创建，`MALLOK_SECRET` 按 `CLOUDFLARE_RESOURCES.md §7` 的方案之一落地 | `NOT_AVAILABLE` | 需公开仓库与真实账号。按钮从未点过 |
| `AC-DEPLOY-03` | 首次启动向导七步全部可完成，完成后 `/_mallok/setup` 返回 404 | `PENDING_DECISION` | 实现是**四步**，媒体域名与 Resend/DNS 两步需账号级 token（`TASK-16.md §6`）。四步部分有证据：`test/worker/setup.test.ts:53`、`:81`、`:181`。要么补齐两步，要么改条目 —— 见 §14.2 |
| `AC-DEPLOY-04` | 绑定自定义域后站点正常服务，且**缓存命中**（`x-mallok-cache: HIT`） | `NOT_AVAILABLE` | 需自定义域。`ARCHITECTURE §18` item 1 |
| `AC-DEPLOY-05` | 未绑定自定义域时，向导明确提示缓存尚未生效，且 `robots.txt` 输出 `Disallow: /` | `VERIFIED_LOCAL` | `test/worker/seo.test.ts:152`、`:161` |
| `AC-DEPLOY-06` | 未配置 `CF_API_TOKEN` 时站点照常工作，`cache_ttl` 降为 60 秒并在后台常驻提示 | `VERIFIED_LOCAL` | `test/worker/setup.test.ts:81`、`test/worker/cache-admin.test.ts:94`、`test/worker/setup.test.ts:35` |
| `AC-DEPLOY-07a` | 并发首请求在 workerd 里只应用一次迁移，锁最终释放 | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:42` |
| `AC-DEPLOY-07b` | 同上，在真实基础设施上成立 | `NOT_AVAILABLE` | 平台行为，`TESTING §6`。`ARCHITECTURE §18` item 8 |
| `AC-DEPLOY-08` | 升级 Worker 版本后站点不中断，schema 自动迁移，旧版本在迁移期间仍能服务 | `NOT_AVAILABLE` | 需真实账号上的两次部署 |

## 4. AC-CONTENT

| ID | 验收 | 状态 | 证据 / 对应 |
| --- | --- | --- | --- |
| `AC-CONTENT-01` | 在后台录入 10 个产品（含参数表与图片）并发布 | `NOT_RUN` | 只在 `wrangler dev` 里手工走过（原 §14.3「手工验证」）。**没有自动化断言，不可复现** |
| `AC-CONTENT-02a` | 保存内容时确实按标签发出清缓存请求 | `VERIFIED_LOCAL` | `test/worker/cache-admin.test.ts:94` |
| `AC-CONTENT-02b` | 发布一篇新闻，**数秒内**在公开 URL 上看到 | `NOT_AVAILABLE` | 依赖真实 Purge API 的生效延迟，`ARCHITECTURE §18` item 3 |
| `AC-CONTENT-03` | 启用第二种语言，为一个产品创建翻译版本，两个版本各有正确的 URL | `VERIFIED_LOCAL` | `test/worker/locale.test.ts:69`、`:107` |
| `AC-CONTENT-04` | 两个语言版本各自输出正确的 `hreflang`，含 `x-default` | `VERIFIED_LOCAL` | `test/worker/locale.test.ts:134`、`:271` |
| `AC-CONTENT-05` | 草稿不出现在公开 URL、不进缓存、不进 sitemap | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:213`、`test/worker/seo.test.ts:92` |
| `AC-CONTENT-06a` | 到期内容被 `publishDue` 改状态并触发清缓存 | `VERIFIED_LOCAL` | `test/core/paths.test.ts`（`schedules a future date and publishes a past one`）、`src/worker/scheduled.ts` |
| `AC-CONTENT-06b` | Cron Trigger 在真实环境按分钟触发上述流程 | `NOT_AVAILABLE` | 平台行为，需真实账号 |
| `AC-CONTENT-07` | 改 slug 后旧 URL 301 到新 URL | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:234` |
| `AC-CONTENT-08` | 打开一篇内容再关闭，`markdown` 逐字节不变 | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:269`、`test/worker/roundtrip.test.ts:140` |
| `AC-CONTENT-09` | 超 2 MB 的正文保存失败并给出明确错误，不静默截断 | `VERIFIED_LOCAL` | `src/worker/admin-content.ts:38`、`test/worker/roundtrip.test.ts:289`（`handles hostile content without crashing or leaking`，正文含 2 MB+ 用例） |
| `AC-CONTENT-10` | 第一阶段超 CPU 预算时存为草稿并返回明确错误，**不静默失败** | `NOT_AVAILABLE` | 需真实 CPU 计量，`ARCHITECTURE §18` item 2 |
| `AC-CONTENT-11` | 引用缺失文件的内容可以保存、可以发布，后台显示「缺 N 张图」 | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts:228`、`test/cli/scan.test.ts:78` |

## 5. AC-MEDIA

| ID | 验收 | 状态 | 证据 / 对应 |
| --- | --- | --- | --- |
| `AC-MEDIA-01` | 后台上传图片，浏览器端转 WebP 并生成多宽度变体，Worker 不处理图片 | `VERIFIED_LOCAL` | `test/worker/media.test.ts:142`、`test/admin/media.test.ts` |
| `AC-MEDIA-02` | 相同文件重复上传不重复存储（sha 去重） | `VERIFIED_LOCAL` | `test/worker/media.test.ts:111` |
| `AC-MEDIA-03` | 正文图片输出带 `srcset`、`sizes`、`width`、`height`、`loading`、`decoding` | `VERIFIED_LOCAL` | `test/core/fragment.test.ts:69`、`test/worker/media.test.ts:176` |
| `AC-MEDIA-04` | 媒体经 R2 自定义域直出，不计入 Worker 请求数 | `NOT_AVAILABLE` | 需 R2 自定义域，`ARCHITECTURE §18` item 6 |
| `AC-MEDIA-05` | 非白名单类型被拒绝，按嗅探类型而非扩展名判断；svg 被拒绝 | `VERIFIED_LOCAL` | `test/worker/media.test.ts:125`、`test/core/media.test.ts`（`rejects SVG`、`ignores a lying extension`） |
| `AC-MEDIA-06a` | `ref_count` 归零的媒体进入「未使用」，宽限期内不回收 | `VERIFIED_LOCAL` | `test/worker/media.test.ts:254`、`:279` |
| `AC-MEDIA-06b` | cron 在真实环境按 7 天窗口执行回收 | `NOT_AVAILABLE` | 平台行为，需真实账号 |

## 6. AC-THEME

| ID | 验收 | 状态 | 证据 / 对应 |
| --- | --- | --- | --- |
| `AC-THEME-01` | 把主题目录放进 `src/themes/`、改一行导出、部署，站点即用新主题渲染 | `VERIFIED_LOCAL` | `test/core/themes.test.ts`（`renders every layout it declares`） |
| `AC-THEME-02` | 换主题后**所有 URL 不变、内容 id 不变、媒体不变** | `VERIFIED_LOCAL` | `test/worker/locale.test.ts:259` |
| `AC-THEME-03` | 后台按 `theme.json` 自动生成配置项表单，改完**即时生效**，主题作者不写后台 | `VERIFIED_LOCAL` | `test/admin/form.test.ts:51`、`test/worker/plugins.test.ts:115` |
| `AC-THEME-04` | 主题不支持某内容类型时，该类型降级到 `page` 布局，内容与 URL 不丢失 | `VERIFIED_LOCAL` | `test/core/theme-package.test.ts:96` |
| `AC-THEME-05` | 含未声明 `<script>` 或 `on*=` 的主题**构建失败**，错误指出是哪个文件 | `VERIFIED_LOCAL` | `test/core/theme-package.test.ts:121`、`:132`。**2026-09-01 更正**：原 §14.1 说这条「未测」，是错的 |
| `AC-THEME-06` | 五个官方主题（`atelier`、`journal`、`gazette`、`manual`、`folio`）的客户端 JS 均为 **0 B** | `VERIFIED_LOCAL` | `test/core/themes.test.ts`、`test/cli/build.test.ts:195` |
| `AC-THEME-07` | 主题资源经 Static Assets 直出，路径带版本、`immutable`、`nosniff` | `VERIFIED_LOCAL` | `test/core/media.test.ts:126`、`test/core/themes.test.ts`（`links the stylesheet to Static Assets`） |
| `AC-THEME-08` | 后台没有任何主题上传或切换入口，且明确说明换主题需要重新部署 | `NOT_RUN` | 界面文案，无自动化断言。这是 THEME 组真正的缺口 |

## 7. AC-PLUGIN

| ID | 验收 | 状态 | 证据 / 对应 |
| --- | --- | --- | --- |
| `AC-PLUGIN-01` | 已装的 `inquiry` 插件用开关启用/停用、改设置与密钥，**均即时生效** | `VERIFIED_LOCAL` | `test/worker/plugins.test.ts:60`、`:115` |
| `AC-PLUGIN-02a` | 提交被校验、入库，并排入通知站主的 job（Reply-To 为买家邮箱） | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts`（`accepts a valid submission, stores it and queues both emails`） |
| `AC-PLUGIN-02b` | 站主**几秒内真的收到邮件** | `NOT_AVAILABLE` | 需真实 Resend，测试里是桩 |
| `AC-PLUGIN-03a` | 自动回执按提交页语言选模板并排入 job | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts`（`renders an operator Liquid template for the autoreply`） |
| `AC-PLUGIN-03b` | 买家**真的收到**回执 | `NOT_AVAILABLE` | 需真实 Resend |
| `AC-PLUGIN-04` | 后台询盘面板可看列表、看详情、标记垃圾、导出 CSV | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts:359`、`:385` |
| `AC-PLUGIN-05a` | 蜜罐、限流、服务端 Turnstile 校验三层在代码路径上生效 | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts`（`silently drops a submission that filled the honeypot`、`verifies Turnstile server-side once a secret is configured`） |
| `AC-PLUGIN-05b` | 真实 Turnstile 下有效，且提交在 Free 的 CPU 与子请求预算内 | `NOT_AVAILABLE` | 需真实 Turnstile 与 CPU 计量，`ARCHITECTURE §18` item 9 |
| `AC-PLUGIN-06` | 邮件发送失败时由 cron 重试，状态在后台可见 | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts:339` |
| `AC-PLUGIN-07` | 界面如实说明**安装 / 更新 / 移除插件需要重新部署**，且后台没有上传入口 | `NOT_RUN` | 界面文案，无自动化断言 |

## 8. AC-SEO

| ID | 验收 | 状态 | 证据 / 对应 |
| --- | --- | --- | --- |
| `AC-SEO-01a` | `/sitemap.xml` 输出全部已发布内容，含 hreflang 与 `x-default` | `VERIFIED_LOCAL` | `test/worker/seo.test.ts:92`、`carries hreflang alternates and x-default in the sitemap` |
| `AC-SEO-01b` | 超 5000 条自动分页为 `/sitemap-<n>.xml` 并输出 index | `NOT_RUN` | 实现存在，无针对分页的断言 |
| `AC-SEO-02` | `/feed.xml` 按语言输出有效 RSS | `VERIFIED_LOCAL` | `test/worker/seo.test.ts:128` |
| `AC-SEO-03` | 每页输出正确的 canonical、OG、Twitter Card | `VERIFIED_LOCAL` | `test/core/view.test.ts`（`never overrides a canonical field the author wrote`、`fills canonical fields from the aliases other tools use`） |
| `AC-SEO-04` | JSON-LD 输出 Organization / Article / Product / FAQPage，且 `<` 已转义为 `\u003c` | `VERIFIED_LOCAL` | `test/core/view.test.ts:117`、`:144`、`still emits Article and Product` |
| `AC-SEO-05` | Lighthouse 移动端 SEO **每次 100** | `NOT_AVAILABLE` | 需自定义域且缓存命中，`SEO_PERFORMANCE §12` |
| `AC-SEO-06` | Lighthouse 移动端 Performance 中位 ≥ 95、单次 ≥ 90 | `NOT_AVAILABLE` | 同上 |
| `AC-SEO-07` | 页面体积与图片预算达标 | `NOT_AVAILABLE` | 预算数字本身还待产品负责人确认（`SEO_PERFORMANCE §7`） |

## 9. AC-EXPORT

| ID | 验收 | 状态 | 证据 / 对应 |
| --- | --- | --- | --- |
| `AC-EXPORT-01` | 一键导出全部内容与询盘，产出 `CONTENT_FORMAT §5` 的目录 | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts:378`、`test/worker/inquiry.test.ts:385` |
| `AC-EXPORT-02` | `CONTENT_FORMAT §9` 的七条往返一致性断言全部通过 | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts` 全文 |
| `AC-EXPORT-03` | 导出的 `index*.md` 逐字节等于 D1 里的 `markdown` | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts:140`、`:378` |
| `AC-EXPORT-04` | 导出包**不含**任何密钥、会话、token、`render_cache` | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts:359` |
| `AC-EXPORT-05` | 导出的目录能被 Astro 或 Hugo 直接读取（人工验证一次） | `NOT_RUN` | 导入方向的别名有测试（`roundtrip.test.ts:173`），**反方向从未人工验证** |

## 10. AC-CLI

| ID | 验收 | 状态 | 证据 / 对应 |
| --- | --- | --- | --- |
| `AC-CLI-01` | `mallok publish <dir>` 把本地文章包（含 `images/`）批量发布进站点 | `VERIFIED_LOCAL` | `test/cli/scan.test.ts`（`reads a bundle with its translations and assets`）、`test/worker/flow.test.ts:204` |
| `AC-CLI-02` | 重复发布未修改的目录是空操作：**不写 D1、不清缓存** | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:204`、`test/worker/roundtrip.test.ts:249` |
| `AC-CLI-03` | `mallok preview` 本地渲染结果与线上**逐字节一致** | `PENDING_DECISION` | 正文与结构确实逐字节一致（同一个 `renderFragment`/`renderPage`），但预览离线、无媒体表，图片仍是相对路径。措辞需加限定 —— 见 §14.2 |
| `AC-CLI-04` | CLI 没有后台没有的能力，反之亦然 | `VERIFIED_LOCAL` | 结构性：两者走同一套管理 API（`src/cli/client.ts`），无 CLI 专属端点 |
| `AC-CLI-05` | 缺图被报告，`--fail-on-missing` 在 CI 中生效 | `VERIFIED_LOCAL` | `test/cli/scan.test.ts:78`、`treats a referenced file that is absent as missing, not an error` |

## 11. AC-INV：跨阶段不变量

**每个任务结束前都要复验这几条**，不是只在最后查一次：

| ID | 不变量 | 当前状态 |
| --- | --- | --- |
| `AC-INV-01` | `src/core/` 不 import 任何 Cloudflare 或 Node API，`tsc -p src/core/tsconfig.json` 通过 | `VERIFIED_LOCAL` |
| `AC-INV-02` | 同一输入渲染出逐字节相同的 HTML | `VERIFIED_LOCAL` |
| `AC-INV-03` | `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size` 全绿 | `VERIFIED_LOCAL` |
| `AC-INV-04` | Worker 打包 gzip 体积在 Free 3 MB 之内 | `VERIFIED_LOCAL`（2026-08-30：229.2 KiB，7.5%） |
| `AC-INV-05` | 单页冷渲染是 1 次 D1 batch，查询数 ≤ 3，行读有界 | `PENDING_DECISION`——**实测 2 次 batch**（最重的页面也是 2 次），措辞需修订，见 §14.2。证据：`test/worker/budget.test.ts` |
| `AC-INV-06` | 列表页不解析正文、不查 `render_cache`、不执行 `COUNT(*)` | `VERIFIED_LOCAL`（`listPublished` 只取标量列、`LIMIT n+1`） |
| `AC-INV-07` | 错误响应不泄露 SQL、bucket 名、id 或堆栈 | `VERIFIED_LOCAL` |
| `AC-INV-08` | 访客页面客户端 JS 为 0 B（询盘页的 Turnstile 除外） | `VERIFIED_LOCAL`（`test/core/themes.test.ts` 对五个主题的每个布局断言除 JSON-LD 外无 `<script>`） |
| `AC-INV-09` | 改内容、改设置、改主题配置项、开关插件，**均不需要构建或部署** | `VERIFIED_LOCAL` |
| `AC-INV-10` | 换主题、装插件**确实需要部署**，且界面如实这么说——不做成假的一键操作 | `NOT_RUN`——界面文案，无自动化断言；与 `AC-THEME-08`、`AC-PLUGIN-07` 同一缺口 |

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

## 14. 逐条盘点

### 14.0 2026-09-01 重核：为什么要重核

本节此前公布过**三个互相矛盾的总数**：

| 出处 | 说法 |
| --- | --- |
| §2 结论句 | 76 条 = 48 `VERIFIED_LOCAL` + 28 `NOT_AVAILABLE` |
| §14 标题下 | 76 条 = 56 `VERIFIED_LOCAL` + 20 `NOT_AVAILABLE` |
| §14.1 分组表 | 67 条 = 50 `VERIFIED_LOCAL` + 17 `NOT_AVAILABLE` |

**根因不是谁算错了，是结构问题**：当时只有 `AC-INV` 一组的定义表带状态列，
其余 57 条没有。总数只能手工维护，于是必然漂移。

**总数原本就是 67**，两种独立方法都得这个数：唯一 `AC-` 编号计数 = 67；
§14.1 分组表求和 = 67。「76」应是 67 的笔误，出现了两次。

重核做了四件事：

1. **给每条加状态列与证据指针**（`文件:行号`）。总数从此是**数出来的**，不是写上去的。
2. **拆开「一半能测、一半测不了」的条目**。原来它们整条算无证据，
   已经做完的工作被隐形了。拆成 `-a` / `-b`，编号不重排，旧引用不失效。
3. **加 `NOT_RUN` 与 `PENDING_DECISION` 两档**。前者是「有实现但没有可复现证据」
   （手工走过一遍不算，`TESTING §1` 第 3 条）；后者是「条目本身写错了，等裁决」——
   把它和 `NOT_AVAILABLE` 分开，才看得出**卡住它的是我们，不是平台**。
4. **修了两处错**：`AC-THEME-05` 原记「构建期脚本检查未测」，实际有
   `test/core/theme-package.test.ts:121`、`:132`；`AC-DEPLOY-07` 原被 §14.1 记为已验、
   又被 §14.4 记为需真实账号，现拆成 `-07a`（workerd 里已验）与 `-07b`（平台行为）。

### 14.1 按组的状态（数字来自各组定义表）

拆分后共 **75 行**（67 条原始验收，其中 8 条各拆成两半）：

| 组 | 行数 | `VERIFIED_LOCAL` | `NOT_RUN` | `PENDING_DECISION` | `NOT_AVAILABLE` |
| --- | --- | --- | --- | --- | --- |
| `AC-DEPLOY` | 9 | 3 | 0 | 1 | 5 |
| `AC-CONTENT` | 13 | 9 | 1 | 0 | 3 |
| `AC-MEDIA` | 7 | 5 | 0 | 0 | 2 |
| `AC-THEME` | 8 | 7 | 1 | 0 | 0 |
| `AC-PLUGIN` | 10 | 6 | 1 | 0 | 3 |
| `AC-SEO` | 8 | 4 | 1 | 0 | 3 |
| `AC-EXPORT` | 5 | 4 | 1 | 0 | 0 |
| `AC-CLI` | 5 | 4 | 0 | 1 | 0 |
| `AC-INV` | 10 | 8 | 1 | 1 | 0 |
| **合计** | **75** | **50** | **6** | **3** | **16** |

**`VERIFIED_HUMAN` 仍然是 0。** 这是本节最重要的一句话，重核没有改变它：
**从未在真实 Cloudflare 账号上运行过任何东西。** 所有「本地已验」都是在
workerd 模拟环境或 `wrangler dev` 里跑出来的。

### 14.1.1 六条 `NOT_RUN` 是什么

有实现、但没有可复现的断言。它们不需要真实账号，**写个测试就能关掉**：

| 条目 | 缺什么 |
| --- | --- |
| `AC-CONTENT-01` | 「后台录入 10 个产品」只手工走过 |
| `AC-THEME-08`、`AC-PLUGIN-07`、`AC-INV-10` | 界面文案断言：后台没有上传入口，且如实说明需重新部署 |
| `AC-SEO-01b` | sitemap 超 5000 条的分页 |
| `AC-EXPORT-05` | 导出目录被 Astro/Hugo 直读，人工验证一次 |

### 14.2 待产品负责人裁决的（三条 `PENDING_DECISION`，外加一项范围说明）

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

**2026-09-01 重生成。** 旧版本手写了一份清单，与 §14.1 的分组数在九组里有六组
对不上——两份都是手工维护的，各自漂了。现在这份就是各组定义表里状态为
`NOT_AVAILABLE` 的全部条目，共 **16** 条：

| 组 | 条目 | 卡在哪 |
| --- | --- | --- |
| `AC-DEPLOY` | `01`、`02`、`04`、`07b`、`08` | 真实账号：建资源、Deploy 按钮、自定义域缓存、并发迁移、滚动升级 |
| `AC-CONTENT` | `02b`、`06b`、`10` | 清缓存生效延迟、cron 真实触发、CPU 预算 |
| `AC-MEDIA` | `04`、`06b` | R2 自定义域、cron 回收 |
| `AC-PLUGIN` | `02b`、`03b`、`05b` | 真实 Resend 投递、真实 Turnstile 与 CPU 预算 |
| `AC-SEO` | `05`、`06`、`07` | Lighthouse 三条（需自定义域且缓存命中） |

`AC-THEME`、`AC-EXPORT`、`AC-CLI`、`AC-INV` 四组**没有**需要真实账号的条目——
它们剩下的缺口是 `NOT_RUN`（补个测试就行）或 `PENDING_DECISION`（等裁决）。

对照 `ARCHITECTURE §18` 的九项实测：跑完那九项，上表 16 条里的 15 条可以关掉；
剩下 `AC-DEPLOY-02`（Deploy 按钮）另需一个公开仓库。
