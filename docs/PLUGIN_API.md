# Mallok 插件 API

- 状态：0.1 基线（首次编写）
- 日期：2026-08-28
- 地位：插件的唯一契约。官方插件与第三方插件用同一套机制，没有私有接口。本文的边界描述必须与后台界面上的措辞一致——**不得暗示存在沙箱**。

## 1. 一句话定义

**插件是真正的 JavaScript/TypeScript 代码，通过声明式的 `plugin.json` 接入五个钩子和六种能力。它跑在用户自己的 Cloudflare 账号里，拥有 Worker 的全部权限。**

## 2. 诚实的边界（必须原样反映到界面上）

**官方插件与第三方插件走同一条路**：源码进 `src/plugins/`，构建期打包进 Worker。区别只在谁写的、谁负责。

| 操作 | 怎么生效 | 谁做 |
| --- | --- | --- |
| 安装 / 更新 / 移除插件 | 改源码 + 重新部署 | 技术人员 |
| 启用 / 停用已装的插件 | 后台开关，**即时生效** | 运营 |
| 改设置与密钥 | 后台表单，**即时生效** | 运营 |

开关只决定要不要跑，不改变打进产物的是什么代码——这是它能即时生效的原因，也是它和「安装」的根本区别。

**界面不得把安装插件做成「点一下就装好」的样子**——它做不到，假装能做会在用户第一次装插件时暴露。正确的界面是：告诉用户需要改源码并触发一次构建，并给出具体步骤。

### 2.1 安全模型

插件是**可信代码**（`ARCHITECTURE §14`）。它能读写整个数据库、调用任何外部服务、读取所有 secret。**没有沙箱，也不会有。** 风险边界与 WordPress 插件一致：用户为自己安装的东西负责。

文档与界面必须直说这一点。掩盖它比没有沙箱更危险。

## 3. 包结构

```text
src/plugins/inquiry/
├── plugin.json           # 声明：钩子、路由、设置、密钥、迁移、面板、注入的客户端 JS
├── migrations/
│   └── 0001_inquiry.sql  # 表名必须以 p_inquiry_ 开头
├── emails/               # 可选：邮件模板（Liquid，走同一个受限引擎）
│   ├── notify.en.liquid
│   └── autoreply.en.liquid
└── index.ts              # 实现，只导出 plugin.json 声明过的符号
```

## 4. `plugin.json`

```jsonc
{
  "id": "inquiry",                   // [a-z][a-z0-9-]*，也是表前缀与路由前缀
  "name": "Inquiry form",
  "version": "1.0.0",
  "description": "Product inquiry form with spam protection and email delivery.",
  "official": true,                  // 仅用于界面上区分来源，不影响打包方式
  "pluginApi": 1,                    // 本文契约版本

  "hooks": ["afterRender", "onContentSave", "scheduled"],

  "routes": [
    {
      "path": "submit",              // 实际路径 /_mallok/p/inquiry/submit
      "method": "POST",
      "cache": false,                // 默认 false；true 时必须给 ttl
      "turnstile": true,             // 核心代做服务端 siteverify
      "rateLimit": { "key": "ip", "limit": 5, "period": 60 }
    }
  ],

  "settings": {                      // 明文存 plugin_state.settings
    "recipient":     { "type": "string",  "label": "Recipient email", "required": true },
    "from_address":  { "type": "string",  "label": "From address",    "required": true },
    "autoreply":     { "type": "boolean", "label": "Send auto-reply", "default": true },
    "block_countries": { "type": "string[]", "label": "Blocked countries" }
  },

  "secrets": {                       // AES-GCM 加密存 plugin_state.secrets
    "resend_api_key": { "label": "Resend API key", "required": true }
  },

  "migrations": ["migrations/0001_inquiry.sql"],

  "panels": [ /* §7.5 */ ],

  "affectsFragmentCache": false,     // 见 §9
  "clientScripts": [
    { "src": "https://challenges.cloudflare.com/turnstile/v0/api.js",
      "purpose": "Turnstile bot protection", "bytes": 0 }
  ]
}
```

`settings` 的字段类型与 `THEME_FORMAT.md §5.2` 的表一致（不含 `image` / `file` / `reference`）。校验用 zod，schema 由 `plugin.json` 生成。

## 5. 钩子

0.1 开放五个（`ARCHITECTURE §12`）。每个钩子都是 `index.ts` 的一个具名导出。

| 钩子 | 时机 | 计入谁的 CPU | 典型用途 |
| --- | --- | --- | --- |
| `onRequest` | 请求进入，**缓存查询之前** | 访客请求 | 重定向、访问控制 |
| `beforeRender` | 第一阶段，拿到 mdast 之后 | **保存请求** | 短代码、自定义语法 |
| `afterRender` | 完整 HTML 生成之后 | 访客请求（未命中缓存时） | 注入 meta、结构化数据、表单片段 |
| `onContentSave` | 内容保存时 | 保存请求 | 校验、自动摘要、通知外部 |
| `scheduled` | 每分钟 cron 内 | cron 调度 | 重试、同步、清理 |

### 5.1 `onRequest`

```ts
export async function onRequest(
  request: Request,
  ctx: PluginRequestContext,
): Promise<Response | undefined>;
```

返回 `Response` 则短路整个请求；返回 `undefined` 继续。**它在缓存查询之前运行，所以每个访客请求都会付它的 CPU 代价**，包括本该由缓存直接返回的那些。写得重会直接毁掉「缓存命中路径近乎零成本」这条设计目标（`ARCHITECTURE §2`）。后台在启用带 `onRequest` 的插件时必须提示这一点。

### 5.2 `beforeRender`

```ts
import type { Root as MdastRoot } from 'mdast';

export function beforeRender(
  tree: MdastRoot,
  ctx: { readonly frontmatter: Readonly<Record<string, unknown>> },
): void | Promise<void>;
```

签名即 `src/core/fragment.ts` 的 `BeforeRenderHook`。它操作 **mdast**（remark 的 AST）——这是选用 unified 而非 `marked` / `markdown-it` 的唯一理由（`TECH_STACK §4`）。

**必须是纯函数**：`(AST, frontmatter, 插件设置)` 之外的任何输入都禁止。不得读时间、随机数、请求特征、数据库。理由是 `ARCHITECTURE §5` 的确定性规则——同样输入必须产出逐字节相同的 HTML，否则片段缓存与回归测试都不成立。

> **契约版本警告**：`beforeRender` 的参数类型绑定在 remark 的 mdast 上。若将来核心更换 Markdown 引擎（`TASK-01 §6` 的遗留决策），这个签名必然破坏，届时必须提 `pluginApi` 到 2，不做静默兼容。0.1 按 unified/mdast 定契约。

### 5.3 `afterRender`

```ts
export async function afterRender(
  html: string,
  ctx: PluginRenderContext,
): Promise<string>;
```

拿到完整页面 HTML，返回修改后的 HTML。注入的内容**由插件自己负责转义**——核心的净化发生在第一阶段，这里已经过了。插件是可信代码，所以这是它的责任，但文档要说清楚。

### 5.4 `onContentSave`

```ts
export async function onContentSave(
  content: ContentDraft,
  ctx: PluginContext,
): Promise<ContentDraft | void>;
```

返回修改后的草稿则采用，返回 `void` 则不改。抛错会让保存失败并把错误信息返回给调用者——**这是插件拒绝一次保存的正当方式**，比静默改写好。

### 5.5 `scheduled`

```ts
export async function scheduled(ctx: PluginContext): Promise<void>;
```

在站点唯一的 cron（`* * * * *`）里执行。所有插件的 `scheduled` **共享一次调度的 10 ms CPU 预算**（Free）。因此插件必须自己分批：一次处理少量、把剩下的留给下一分钟，不要试图一次做完。

## 6. 上下文对象

```ts
interface PluginContext {
  readonly db: D1Database;
  readonly media: R2Bucket;
  /** 本插件在 plugin_state.settings 里的值，已按 schema 校验。 */
  readonly settings: Readonly<Record<string, unknown>>;
  /** 已解密的 secret。绝不进日志、绝不进返回体。 */
  readonly secrets: Readonly<Record<string, string>>;
  readonly site: SiteSettings;
  /** 核心提供，见 §7.6。 */
  readonly sendEmail: (message: EmailMessage) => Promise<void>;
  /** 排队一个 job（§7.4）。 */
  readonly enqueue: (type: string, payload: unknown, runAt?: Date) => Promise<string>;
  /** 按标签清缓存，自动合并去抖。 */
  readonly purgeTags: (tags: readonly string[]) => Promise<void>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
}
```

`PluginRequestContext` 额外有 `request`、`url`、`locale`；`PluginRenderContext` 额外有 `content`、`page`、`locale`。

**`ctx.db` 是完整的 D1 绑定**，插件能读写任何表。核心不做表级隔离——那会给人虚假的安全感。约定是：插件只碰自己 `p_<id>_` 前缀的表，读核心表可以，写核心表要有充分理由。

## 7. 六种能力

### 7.1 数据表

插件自带 SQL 迁移，**表名必须以 `p_<plugin_id>_` 开头**，迁移 id 以 `plugin:<plugin_id>:` 开头（`DATA_MODEL §2.11`）。由核心的迁移器与核心迁移一起执行、一起记进 `migration` 表、共用 `migration_lock`。

迁移规则同核心（`DATA_MODEL §2.10`）：**只允许追加式变更**（新表、带默认值的新列、新索引），不允许在同一版本内删列或改列语义。理由是迁移期间旧版本 Worker 仍在服务。

禁用插件**不删表**。卸载插件时后台明确询问「是否一并删除数据」，默认不删。

### 7.2 路由

`/_mallok/p/<plugin_id>/<path>`，由 `plugin.json` 的 `routes` 声明。核心代做：

- body 解析（`application/json` 与 `application/x-www-form-urlencoded`）；
- 按 schema 的 zod 校验；
- Turnstile 服务端 `siteverify`（`turnstile: true` 时）；
- 限流（Workers 限流绑定 `RATE_LIMITER`）。

```ts
export const routes = {
  async submit(input: SubmitInput, ctx: PluginRequestContext): Promise<Response> { … },
};
```

限流绑定**按数据中心计数、最终一致**（`TECH_STACK §5`）。只用于防刷，**不得**用于计费、配额或任何要求精确的场景。

路由默认 `Cache-Control: private, no-store`。声明 `cache: true` 的路由必须同时给 `ttl`，且核心会拒绝为带 `turnstile` 或 `rateLimit` 的路由启用缓存。

### 7.3 设置与密钥

- `settings`：明文存 `plugin_state.settings`，后台按 schema 生成表单。
- `secrets`：用 `MALLOK_SECRET` 经 HKDF 派生的密钥做 **AES-GCM** 加密后存 `plugin_state.secrets`，IV 每次写入随机（`DATA_MODEL §2.7`）。
- 插件可选声明 `checkSecrets`（2026-08-30 新增）：按密钥名给出一个只读的校验函数，后台在密钥旁给一个「Test」按钮。**核心分不清一个 Resend key 是好是坏，插件分得清。** 校验必须是只读或可安全重复的；**返回的只有结论，密钥值永远不出 Worker**。

**管理 API 只返回「已设置 / 未设置」，永不回显密钥值。** 支持轮换：写入新值即覆盖。`SECURITY.md` 定义具体的派生与编码格式。

### 7.4 定时任务

`scheduled` 钩子 + 核心的 `job` 表。`ctx.enqueue(type, payload, runAt)` 写一条 `job`，`type` 自动加 `plugin:<id>:` 前缀。失败按指数退避重试，超过 `max_attempts`（默认 5）置 `failed` 并在后台可见。

### 7.5 声明式后台面板

**插件不带任何前端代码。** 它声明面板，后台 SPA 统一渲染。

```jsonc
"panels": [
  {
    "id": "inquiries",
    "label": "Inquiries",
    "type": "table",
    "table": "p_inquiry_inquiry",
    "columns": [
      { "field": "created_at", "label": "Received", "type": "datetime", "sortable": true },
      { "field": "name",       "label": "Name" },
      { "field": "email",      "label": "Email",   "type": "email" },
      { "field": "country",    "label": "Country" },
      { "field": "status",     "label": "Status",  "type": "badge" }
    ],
    "filters": [
      { "field": "status", "type": "select", "choices": ["new", "replied", "spam"] },
      { "field": "created_at", "type": "daterange" }
    ],
    "detail": ["message", "company", "phone", "source_path", "user_agent"],
    "actions": [
      { "id": "mark_replied", "label": "Mark replied" },
      { "id": "mark_spam",    "label": "Mark spam" },
      { "id": "export_csv",   "label": "Export CSV", "type": "download" }
    ]
  }
]
```

`actions` 里声明的 id 对应 `index.ts` 的导出：

```ts
export const actions = {
  async mark_replied(ids: readonly string[], ctx: PluginContext): Promise<void> { … },
  async export_csv(query: PanelQuery, ctx: PluginContext): Promise<Response> { … },
};
```

询盘列表与将来的订单列表都是这种面板。**这个机制的存在是为了让插件永远不需要写 React/Preact 代码**——一旦插件能塞前端代码进后台，后台的体积预算和安全边界就都没了。

### 7.6 发邮件

```ts
interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
}
```

0.1 唯一实现是 Resend，直接 `fetch` 其 HTTP API，**不引入 SDK**（`TECH_STACK §5`）。发送记录与失败重试由核心的 `job` 表承担。

`sendEmail` 是**内部函数边界，不是 provider 抽象层**（`ARCHITECTURE §17`）。0.1 不为「以后可能换邮件服务商」做适配器。

邮件模板放 `emails/<name>.<locale>.liquid`，走与主题相同的受限引擎，因此**买家填的内容在邮件里也是默认转义的**。

## 8. 生命周期

| 阶段 | 怎么做 |
| --- | --- |
| 发现 | 编译期静态导入，注册表在 `src/plugins/index.ts` |
| 迁移 | Worker 冷启动时随核心迁移一起执行 |
| 启用 | `plugin_state.enabled = 1`，即时生效 |
| 禁用 | `enabled = 0`，钩子与路由立即不再生效，**表与数据保留** |
| 移除 | 从仓库删掉 + 重新部署；后台询问是否一并删数据，默认不删 |

**动态 `import` 与远程加载一律禁止**（`TECH_STACK §12`）。插件注册表是编译期常量。

## 9. 缓存与插件

插件通过 `affectsFragmentCache` 声明它是否影响第一阶段输出：

- 声明 `beforeRender` 钩子的插件**必须**为 `true`；
- `true` 时，该插件的 id、version 与 settings 进入 `render_cache` 的缓存键（`src/worker/render.ts` 的 `pluginHash`），改设置即失效全部片段；
- `false` 且只有 `afterRender` 的插件不进片段键，但**必须清边缘缓存**——启用/禁用/改设置时核心自动清 `site` 标签。

声明错误会导致改了设置却看到旧内容。安装校验时核心检查「声明了 `beforeRender` 却写 `affectsFragmentCache: false`」并拒绝。

## 10. 体积预算

官方插件预打包的前提是总体积装得下（`ARCHITECTURE §12`）。规则：

1. 每新增一个插件，提交里必须附 `pnpm bundle:size` 的前后对比。
2. 插件不得引入渲染层已有能力的第二套实现（第二个 Markdown 解析器、第二个校验库）。
3. 插件不得引入任何服务商 SDK，一律 `fetch`。
4. 当前基线：Worker gzip 202.65 KiB（`wrangler` Total Upload 口径），Free 上限 3 MB。

## 11. 官方插件

0.1 只有一个（`PRODUCT_VISION §6`）：

**`inquiry`（询盘）** —— 0.1 验收的核心。链路见 `ARCHITECTURE §13`：

```
产品页原生 <form>（隐藏 content_id、locale；蜜罐字段；Turnstile widget）
  → POST /_mallok/p/inquiry/submit
  → zod 校验 → 蜜罐与提交耗时检测 → Turnstile 验证 → 限流
  → 写 p_inquiry_inquiry（含 request.cf.country、UA、ip_hash）
  → 两条 job：通知站主（Reply-To = 买家邮箱）、买家自动回执（按 locale 选模板）
  → 立即尝试发送，失败由 cron 重试
  → 302 到该语言的感谢页（可缓存）
```

它是 0.1 唯一被允许注入客户端 JavaScript 的东西（Turnstile 脚本，`PRODUCT_VISION §5.6`）。

## 12. 明确不做

- 不做插件沙箱，也不假装有；
- 不做插件市场运行时、不做远程安装、不做在线上传安装（1.0 的方向，届时也是源码集市）；
- 不允许插件注入前端代码进后台（只能声明式面板）；
- 不允许插件注册 Liquid 过滤器或标签（那会突破主题的安全边界）；
- 不允许插件新增 Cron Trigger（每站只有一个）；
- 不为插件提供 KV、Queues、Durable Objects（`TECH_STACK §12`）；
- 不做插件之间的依赖声明与版本求解（0.1 只有一个官方插件，做这个是过早抽象）。
