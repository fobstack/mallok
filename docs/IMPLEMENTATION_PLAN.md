# Mallok 0.1 实施计划

- 状态：0.1 基线（首次编写）
- 日期：2026-08-29
- 地位：把 `PRODUCT_VISION §6` 的交付清单拆成有依赖顺序的任务。每个任务一个可演示闭环加测试证据（`docs/CONVENTIONS.md` 工作规则）。**本文是顺序的合同，不是工期承诺——这里不写时间估算。**

## 1. 现状

| | 状态 |
| --- | --- |
| Task 01 walking skeleton | 代码完成，本地全绿 |
| Task 02 认证与管理 API | **已完成**，本地全绿 |
| Task 03 媒体 | **服务端已完成**；浏览器端转换留到 Task 11 |
| Task 04 主题格式 | **已完成**（按构建期模型重做） |
| Task 06 多语言 | **已完成** |
| Task 05 SEO 端点 | **已完成**（清缓存实测写回除外） |
| Task 07 插件运行时 | **已完成** |
| Task 08 `inquiry` 插件 | **已完成**；对 `ARCHITECTURE §13` 的三处偏差待批（`tasks/TASK-08.md §4`） |
| Task 09 外贸主题 | **已完成**，交付为 `atelier` 2.1（六种内容类型） |
| Task 10–12 后台 | **已完成**：骨架与表单生成器、三栏编辑器与媒体库、插件面板与诊断页 |
| Task 13 导入导出 | **已完成**；`CONTENT_FORMAT §9` 七条往返断言全部通过 |
| Task 14 CLI | **内容命令已完成**（publish / import / export / media push）；`create`、`destroy`、`preview` 命令未接 |
| Task 15 Starter 与向导 | **已完成**；`ACTIVE_THEME` 改为 `atelier`，向导四步（媒体域名与邮件步骤待 Task 16） |
| Task 16 部署入口 | **代码完成、未经真实账号验证**；`create` / `destroy` 已实现并有单元测试，未在真实 Cloudflare 账号上跑过 |
| Task 17 验收收口 | **部分完成**：76 条 AC 逐条取证（48 本地已验 / 28 无证据 / **0 真实账号已验**），见 `ACCEPTANCE.md §14` |
| 主题 ×5 | **已完成**：设计稿经产品负责人评审后 1:1 落地（atelier/gazette/manual/folio + journal） |
| `ARCHITECTURE §18` 九项实测 | **未做**（`TASK-01 §4` 待产品负责人执行） |
| 设计文档 | 全部就位（本文是最后一份） |
| 已实现 | 渲染内核、schema 与自迁移、公开路径与边缘缓存、完整认证与管理 API、媒体存储与响应式图片输出、SEO 端点、多语言、插件运行时与 `inquiry` 插件、五个官方主题、完整后台 SPA |
| 未开始 | 无（全部任务已推进；剩余的是门 A 实测、产品负责人裁决项与英文文档） |

## 2. 两道门

**在这两道门通过之前，Task 02 之后的任务不得开工：**

| 门 | 内容 | 谁来解 |
| --- | --- | --- |
| **门 A** | `ARCHITECTURE §18` 的九项实测完成并写回 | 产品负责人执行 `TASK-01 §4` |
| ~~**门 B**~~ | ~~Markdown 引擎决策~~ **已定（2026-08-29）：保持 unified**，理由与代价见 `TASK-01 §6` | 已解 |
| **门 B'** | 内联 HTML 保留与否（是否引入 `rehype-raw`） | 产品负责人（`SECURITY.md §4`） |

门 A 卡住的是：PBKDF2 迭代数（Task 02）、清缓存方案 A/B（Task 05）、内容长度上限（Task 03）、自定义域是否硬前提（Task 14）。

门 B 已解：`beforeRender` 的公开签名按 mdast 固定（`PLUGIN_API.md §5.2`）。
门 B' 只卡净化面与 `CONTENT_FORMAT §3.4` 的措辞（是否引入 `rehype-raw`）；插件运行时与它正交，Task 07/08 已在门 B' 未解的情况下完成，不含内联 HTML 相关改动。

> 门 A 未过时可以做的：Task 02、03、04、06 —— **均已完成**。剩下不受门 A 影响的只有 Task 10/11 的后台骨架与编辑器。

## 3. 任务序列

### 阶段一：基础设施

**Task 02 — 认证与管理 API 正式化** ✅ **已完成（2026-08-29，见 `tasks/TASK-02.md`）**
替换 Task 01 的 spike 捷径（`Bearer MALLOK_SECRET`）。
- `admin_user`、`session`、`api_token` 的完整实现；PBKDF2 派生（迭代数由门 A 决定，支持登录时自动升级）；session cookie 与 CSRF；有作用域的 Bearer token。
- 管理 API 从两个端点扩到完整 CRUD：内容列表/详情/保存/删除、设置读写、健康与用量。
- 闭环：登录 → 创建 token → 用 token 从命令行发布 → 撤销 token 后失效。
- 依赖：无（PBKDF2 参数依赖门 A，当前取 50 000 并可在登录时自动升级）。契约：`SECURITY.md §3`。

**Task 03 — 媒体** ✅ **服务端已完成（2026-08-29，见 `tasks/TASK-03.md`）**
- `media` 表的完整读写、R2 内容寻址、变体、`ref_count` 与 GC。
- 浏览器端上传管线（Canvas 转 WebP + 多宽度变体 + sha 去重）。**顺延到 Task 11**——它属于 `src/admin/`，该目录在 Task 10 之前不存在；两端共享的规则已落在 `src/core/media.ts` 并有测试。
- 图片输出属性（`srcset`/`sizes`/`width`/`height`/`loading`/`decoding`），首屏图 `eager`。
- 上传校验按嗅探类型，svg 拒绝。
- 闭环：上传一张图 → 在内容里引用 → 公开页面输出正确的响应式图片。
- 依赖：Task 02。契约：`ARCHITECTURE §8`、`SEO_PERFORMANCE.md §9`、`SECURITY.md §6`。

**Task 04 — 主题格式** ✅ **已完成（2026-08-29，见 `tasks/TASK-04.md`）**
- `theme.json` 的 `kinds[].fields` 字段类型全集、`themeApi` 版本检查。
- 校验在**构建期**执行（`scripts/build-themes.mjs`），不通过就构建失败。
- 主题模板作为文本模块打进产物；`assets/` 复制到 Static Assets 的 `theme/<id>/<version>/`，附 `_headers` 设 `immutable` 与 `nosniff`。
- 删除：`theme`/`theme_file` 两张表、`site.theme_id`、zip 读取器、上传/切换/卸载端点、`/themes/*` 代理、`fflate` 依赖。
- `GET /_mallok/api/theme` 供后台预览与表单生成使用（只读）。
- 闭环：改 `src/themes/index.ts` 的 `ACTIVE_THEME` → 构建部署 → 站点换了主题，URL 与内容一行未动。

### 阶段二：公开输出

**Task 05 — SEO 端点与缓存收口** ✅ **已完成（2026-08-29，见 `tasks/TASK-05.md`；门 A 的实测写回除外）**
- `/sitemap.xml`（分页 + hreflang）、`/feed.xml`、`/robots.txt`。
- canonical、OG、Twitter Card、JSON-LD 四类。
- `redirect` 表的完整读写与改 slug 自动写入。
- **落地门 A 选定的清缓存方案**（`ARCHITECTURE §6.2` 的 A 或 B）。
- 闭环：发布内容 → sitemap 与 feed 立即包含它 → 改 slug → 旧 URL 301。
- 依赖：门 A、Task 04。契约：`SEO_PERFORMANCE.md`。

**Task 06 — 多语言完整** ✅ **已完成（2026-08-29，见 `tasks/TASK-06.md`）**
- 启用多语言、`translation_group` 的完整管理、语言切换器上下文。
- 改 `default_locale` 的批量路径重算与重定向（需明确确认的操作）。
- 各语言的列表页、首页、feed 分别缓存。
- 闭环：为一篇内容创建第二语言版本 → 两个 URL 各自正确 → hreflang 互指 → 切换默认语言后旧 URL 重定向。
- 依赖：无（原计划写的 Task 05 依赖只涉及 feed，已拆出留给 Task 05）。契约：`ARCHITECTURE §9`。

### 阶段三：产品能力

**Task 07 — 插件运行时** ✅ **已完成（2026-08-29，见 `tasks/TASK-07.md`）**
- 五个钩子的调度、`plugin.json` 校验（构建期）、插件迁移器、路由分发。
- 六种能力：数据表、路由（含 zod/Turnstile/限流）、设置与加密密钥、`scheduled`、声明式面板的 API 侧、`sendEmail`。
- `affectsFragmentCache` 的校验与缓存键接入。
- 闭环：一个最小示例插件建表、注册路由、写设置、被开关控制、即时生效。**安装它需要重新部署，界面如实这么说。**
- 依赖：**门 B**、Task 02。契约：`PLUGIN_API.md`。

**Task 08 — `inquiry` 询盘插件** ✅ **已完成（2026-08-29，见 `tasks/TASK-08.md`；对 `ARCHITECTURE §13` 的偏差待批，见其 §4）**
- 完整链路（`ARCHITECTURE §13`）：表单片段注入、提交路由、蜜罐与耗时检测、Turnstile、限流、落库、两条 job、Resend 发送与重试、感谢页。
- 后台面板声明（列表、详情、标记、CSV 导出）。
- 邮件模板（按 locale，走受限 Liquid）。
- 闭环：**从产品页提交一次询盘，站主收到邮件，买家收到回执，后台能看到并导出。** 这是 0.1 的核心验收。
- 依赖：Task 07、Task 06。契约：`PLUGIN_API.md §11`。

**Task 09 — 外贸主题（交付为 `atelier`，见 `THEME_FORMAT §14` 的定名说明）** ✅ **已完成（2026-08-29，见 `tasks/TASK-09.md`）**
- 六种内容类型的布局与字段 schema：`page`、`article`、`product`、`category`、`case`、`faq`。
- 零客户端 JS，纯 CSS 的移动导航与图集。
- `en` / `zh` 语言包，询盘表单片段位。
- 闭环：用 `trade` 主题渲染一套完整的外贸站页面，通过 `SEO_PERFORMANCE.md §7` 的门。
- 依赖：Task 04、Task 08（询盘 CTA 位）。契约：`THEME_FORMAT.md §14`。

### 阶段四：界面

**Task 10 — 后台骨架与表单生成器** ✅ **已完成（2026-08-30，见 `tasks/TASK-10.md`）**
- Preact + signals + 路由 + Static Assets 承载（`_mallok/app/`）。
- **schema 驱动的表单生成器**（`ADMIN.md §7`）——四处共用，是后台唯一值得单独设计的组件。
- 登录、四个顶层区域的壳、设置页。
- 闭环：登录 → 改站点设置 → 改主题配置项 → 都通过同一个生成器。
- 依赖：Task 02、Task 04。契约：`ADMIN.md`。

**Task 11 — 后台内容编辑器与媒体库** ✅ **已完成（2026-08-30，见 `tasks/TASK-11.md`）**
- 三栏编辑器（字段表单 + CodeMirror + 实时预览）。
- 预览复用 `src/core/`，与线上逐字节一致。
- 媒体库、上传界面、媒体选择器、缺图提示。
- 多语言切换与翻译组管理。
- 闭环：**不碰终端，从零录入一个产品（含图）并发布，几秒后在公开 URL 看到。**
- 依赖：Task 10、Task 03、Task 06。契约：`ADMIN.md §6`、`§8`。

**Task 12 — 后台插件面板与外观页** ✅ **已完成（2026-08-30，见 `tasks/TASK-12.md`）**
- 按 `plugin.json` 的 `panels` 渲染表格面板、筛选、详情、actions。
- 外观页：当前主题信息 + 配置项表单 + 如实展示 `clientScripts` + 「换主题需重新部署」说明（`ADMIN.md §4.1`）。**没有上传与切换入口。**
- 用量与诊断页，含「需要部署 / 不需要部署」对照表。
- 闭环：在后台看到询盘列表、标记、导出 CSV；改主题配置项即时生效。
- 依赖：Task 10、Task 08、Task 09。契约：`ADMIN.md §9`、`§10`、`§11`。

### 阶段五：进出与部署

**Task 13 — 导入导出** ✅ **已完成（2026-08-30，见 `tasks/TASK-13.md`）**
- 导出：`CONTENT_FORMAT §5` 的完整目录、`mallok.json`、`site.json`、`redirects.csv`、`inquiries.csv`。
- 导入：三种布局识别、别名归一化、身份与冲突、幂等、分批。
- **`CONTENT_FORMAT §9` 的七条往返一致性断言全部通过**——这是硬性项。
- 闭环：导出 → 导入到空站 → 再导出 → 逐字节一致。
- 依赖：Task 03、Task 06。契约：`CONTENT_FORMAT §7`、`§8`、`§9`。

**Task 14 — CLI** ✅ **内容命令已完成（2026-08-30，见 `tasks/TASK-14.md`）；`create` / `destroy` 属 Task 16**
- `publish` / `import` / `export` / `preview` / `media push`。
- `sharp` 图片管线，与浏览器端同规格。
- 退出码、`--json`、缺图报告、`image-slots.json`。
- 闭环：`mallok publish ./articles` 把一个含图的目录批量发布；重复执行是空操作。
- 依赖：Task 13。契约：`CLI.md`。

**Task 15 — Starter 与首次启动向导** ✅ **已完成（2026-08-30，见 `tasks/TASK-15.md`）；向导为四步，媒体域名与邮件两步待 Task 16**
- `trade-b2b` Starter：主题 + 示例内容 + 设置预设 + 预启用插件。
- 向导七步，完成后永久关闭。
- Starter 应用后分解回四个对象。
- 闭环：全新部署 → 走完向导 → 得到一个有首页、产品、关于、联系页的可用外贸站。
- 依赖：Task 12、Task 09。契约：`ARCHITECTURE §11`、`§15`、`ADMIN.md §5`。

**Task 16 — 部署入口** ⚠️ **代码完成、未经真实账号验证（2026-08-30，见 `tasks/TASK-16.md`）**
- `mallok create`（`CLOUDFLARE_RESOURCES.md §6` 的十步）、`mallok destroy`（§10 的九步）。
- Deploy to Cloudflare 按钮路径与 `MALLOK_SECRET` 方案。
- 站群登记 `.mallok/sites.json`。
- 闭环：在一个干净账号上 `npx mallok create` 一路到向导。
- 依赖：门 A、Task 15。契约：`CLOUDFLARE_RESOURCES.md`。

**Task 17 — 验收收口** ⚠️ **部分完成（2026-08-30，见 `tasks/TASK-17.md`）：76 条逐条取证已做；Lighthouse/axe、spike 删除、英文文档均待前置条件**
- `ACCEPTANCE.md` 全部 AC 逐条取证。
- Lighthouse、axe、体积预算。
- 删除 `src/worker/spike.ts` 及其路由。
- 文档英文版（`CONTRIBUTING.md` 要求 `docs/` 补英文）。
- 依赖：全部。

## 4. 依赖图

```
门A ─┬─────────────────────────────► Task 05 ──► Task 06 ──┐
     └────────────────────────────► Task 16              │
门B ──────────────► Task 07 ──► Task 08 ──┐               │
                                          ▼               ▼
Task 02 ──► Task 03 ──► Task 04 ──────► Task 09      Task 13 ──► Task 14
   │           │           │               │               │
   └───────────┴───────────┴──► Task 10 ──► Task 11 ──► Task 12 ──► Task 15 ──► Task 16 ──► Task 17
```

## 5. 每个任务的完成定义

沿用通用 DoD 加本项目的加项：

1. 实现了任务描述的全部范围，被砍的部分显式说明；
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size` 全绿；
3. 新增逻辑有测试，覆盖率达 `TESTING.md §5` 的门；
4. `AC-INV-01..09` 全部复验（`ACCEPTANCE.md §11`）；
5. 本任务覆盖的 AC 按 `TESTING.md §6` 的格式给出证据；
6. 无 `TODO` 占位、无注释掉的死代码、无调试打印；
7. 报告：变更文件、验证结果、未完成项、已知风险。

## 6. 不做的事

- 不为「以后可能需要」提前抽象（`ARCHITECTURE §17`）；
- 不在任务里「顺便完善」无关部分（`docs/CONVENTIONS.md` 工作规则）；
- 不跳过门 A、门 B 去抢进度；
- 不合并任务——一个任务一个可演示闭环是刻意的，它保证每一步都能被验收，而不是最后一次性交付一堆无法验证的代码。
