# Mallok 安全边界

- 状态：0.1 基线（首次编写）
- 日期：2026-08-28
- 地位：定义信任级别、凭据处理、认证机制与净化规则。**本文描述的是 0.1 实际做到的事，不是安全愿景。** 做不到的必须写进 §12「明确不防」，而不是含糊带过。

## 1. 信任级别

来自 `ARCHITECTURE §14`，是所有设计的出发点：

| 主体 | 信任级别 | 边界 |
| --- | --- | --- |
| 访客提交（询盘表单） | **不可信** | zod 校验、Turnstile、限流、参数化 SQL、邮件模板转义 |
| 内容 Markdown 正文 | **不可信**（即使管理员写的） | 生成片段时白名单净化 |
| 主题 | **半可信** | 受限模板引擎，无代码执行 |
| 插件 | **可信** | 用户主动启用/安装，**无沙箱** |
| 管理 API 调用者 | 需认证 | session 或有作用域的 token |

「内容即使管理员写的也不可信」不是形式主义：管理员会粘贴外部来源的 Markdown，AI 内容管线会自动写入，导入器会吃第三方导出的文件。

## 2. 凭据

### 2.1 三个 Worker secret

**Cloudflare 自身的凭据只进 Worker secret，绝不进 D1**（`CLAUDE.md` 工程边界）：

| secret | 用途 | 权限范围 |
| --- | --- | --- |
| `MALLOK_SECRET` | 签发 session、加密第三方密钥、签名预览链接、`ip_hash` 加盐 | 随机 32 字节 |
| `CF_API_TOKEN` | 清缓存、向导写 DNS | Zone 级 Cache Purge + DNS 编辑；账号级 R2 编辑（仅挂自定义域用） |
| `CF_ZONE_ID` | 同上 | — |

`CF_API_TOKEN` 未配置时站点照常工作，只是没有主动清缓存（`CLOUDFLARE_RESOURCES.md §6`）——**这是诚实的降级，不是故障**。

### 2.2 第三方密钥存 D1

Resend key 这类第三方服务密钥**加密后存 D1**，以便后台配置（`DATA_MODEL §2.7`）。格式规定如下，实现不得自行发挥：

```
key      = HKDF-SHA256(MALLOK_SECRET, salt = "mallok.plugin.secret.v1",
                       info = "<plugin_id>:<secret_name>", length = 32)
iv       = 12 随机字节，每次写入重新生成
payload  = AES-GCM-256(key, iv, plaintext)          // tag 附在密文尾部
stored   = base64(iv || payload)
```

- 每个 `(plugin_id, secret_name)` 派生独立的密钥，一个泄露不牵连其他；
- IV 每次写入随机，**不复用**；
- 管理 API 只返回「已设置 / 未设置」，**永不回显值**（`PLUGIN_API.md §7.3`）；
- 支持轮换：写入新值即覆盖。

### 2.3 `MALLOK_SECRET` 轮换

轮换会使全部 session 失效并让已存的第三方密钥无法解密。因此：

- 后台提供「轮换」操作时，必须先用旧 secret 解密全部第三方密钥、用新 secret 重新加密、再切换；
- Deploy 按钮路径下若走了「实例密钥存 `site` 表」的降级方案（`CLOUDFLARE_RESOURCES.md §7`），后台必须常驻提示「安全性低于 Worker secret」，且用户在仪表盘补上真 secret 后自动执行上述重加密。

### 2.4 绝不外泄

任何凭据不进日志、不进返回体、不进导出包（`CONTENT_FORMAT §8`）、不进错误信息。

## 3. 管理员认证

### 3.1 密码

- 用 **WebCrypto 原生 PBKDF2-SHA256** 派生（`ARCHITECTURE §14`）。不用 Argon2 或 bcrypt 的 WASM 实现——10 ms CPU 限制下跑不动，且会撑大 Worker 体积；
- 参数存 `admin_user.password_params`（`{iterations, salt}`），**每个用户独立 salt，≥ 16 随机字节**；
- 迭代数由 `TASK-01 §4.4` 的实测决定（`ARCHITECTURE §18` item 5）。

> **必须诚实处理的已知问题**：本地基准（`TASK-01 §3.3`）显示 Free 计划 10 ms 预算下大约只能跑 5 万次迭代，**低于 OWASP 2023 建议的 60 万次**。真实账号数字出来后：
> - 若确认如此，产品必须在文档与后台明说这一点，并给出两条加固路径：用 Cloudflare Access 保护 `/_mallok/*`，或升级 Workers Paid 后提高迭代数；
> - **不得**假装 5 万次等同于行业标准，也不得悄悄降低要求。
>
> 迭代数可升级：登录成功时若发现存储的迭代数低于当前配置，用新参数重新派生并写回。

### 3.2 Session

- 登录后签发随机 token 写 cookie，D1 里只存 `sha256(token)`（`DATA_MODEL §2.8`）——**cookie 本身不落库**；
- cookie 属性：`HttpOnly; Secure; SameSite=Strict; Path=/_mallok`；
- 默认有效期 14 天，`expires_at` 过期由 cron 清理；
- 登出即删行。

### 3.3 CSRF

所有写操作要求 CSRF token（`ARCHITECTURE §14`）：

- token 随 session 生成，存 `session.csrf`；
- 通过 `X-Mallok-CSRF` 头提交，与 session 里的值做常量时间比较；
- **Bearer token 认证的请求豁免 CSRF**——它们不带 cookie，不受 CSRF 影响。

### 3.4 API token

- 后台生成，明文只显示一次，D1 存 `sha256(token)`（`DATA_MODEL §2.8`）；
- 有作用域：`content:write`、`media:write`、`export`、`settings:write`；
- 可撤销（`revoked_at`），记录 `last_used_at`；
- 前缀 `mlk_live_` 便于密钥扫描器识别。

### 3.5 常量时间比较

token 与 CSRF 的比较必须常量时间。当前实现（`src/worker/http.ts` 的 `bearerMatches`）先 SHA-256 再用 `crypto.subtle.timingSafeEqual`，这个模式是正确的，新代码沿用。

### 3.6 首次启动向导

`/_mallok/setup` 在 `site.setup_completed_at` 非空后**永久返回 404**（`ARCHITECTURE §15`）。这是硬门：一个还开着的向导等于一个无认证的管理员创建接口。

## 4. 内容净化

- 净化在**生成片段时**进行，使用 `rehype-sanitize` 的白名单模式（`ARCHITECTURE §5`）；
- **不改动 Markdown 原文**——D1 里的 `markdown` 必须可原样导出（`CONTENT_FORMAT §8`）；
- 移除：`<script>`、事件属性（`on*`）、`javascript:` 链接、`<style>`、`<iframe>`、`<object>`、`<embed>`、`<form>`；
- 允许的 `img` 属性在默认白名单基础上扩展了 `srcSet`、`sizes`、`width`、`height`、`loading`、`decoding`（`src/core/fragment.ts`），因为这些是核心自己加的。

> **0.1 待决**：Task 01 的实现**整体剥掉**内联 HTML 而不是净化后保留，因为 `rehype-raw` 不在批准的依赖清单里（`TASK-01 §2` 第 3 条）。保留内联 HTML 需要引入一个 parse5 基础的 HTML 解析器，有体积代价。这是与 Markdown 引擎绑定的决策，**由产品负责人在 Task 02 前一并决定**。`CONTENT_FORMAT §3.4` 承诺「允许内联 HTML，但按白名单净化」，因此若最终选择继续剥掉，**必须改 `CONTENT_FORMAT §3.4` 的措辞**，不能让文档说一套代码做一套。

## 5. 相对路径

`CONTENT_FORMAT §4` 第 2 条是安全规则不只是格式规则：只允许 `images/` 与 `files/` 两个前缀，**不允许 `..`、绝对路径、`file:`、协议相对路径**。

`normalizeRelativePath`（`src/core/assets.ts`）是唯一入口，管理 API 已经在用它拒绝非法路径。

## 6. 上传

- **按嗅探出的真实类型校验，不看扩展名**（`ARCHITECTURE §14`）；
- 只接受 `CONTENT_FORMAT §4.1` 的白名单；
- **svg 0.1 不接受**——svg 可以携带脚本，安全地净化 svg 需要另一套白名单，0.1 不做；
- `files/` 的附件原样存储，以 `Content-Disposition: attachment` 直出，**绝不以 inline 方式渲染**；
- R2 key 是内容寻址的，上传者无法控制路径。

## 7. 插件路由

核心为每个插件路由代做（`PLUGIN_API.md §7.2`）：

1. body 解析与大小上限；
2. zod 校验；
3. Turnstile 服务端 `siteverify`（声明 `turnstile: true` 时）；
4. 限流（`RATE_LIMITER` 绑定）。

限流绑定**按数据中心计数、最终一致**（`TECH_STACK §5`）。只用于防刷，**不得**用于任何要求精确的场景。

询盘链路额外有蜜罐字段与提交耗时检测（`ARCHITECTURE §13`）——这两个不需要 JS，对无脚本的爬虫也有效。

## 8. SQL

- 全部手写、**参数化绑定**，集中在 `src/db/`（`TECH_STACK §7`）；
- 不使用 ORM，也不做字符串拼接；
- 插件表名前缀 `p_<plugin_id>_` 由核心迁移器校验。

## 9. 错误卫生

**永远不向客户端泄露 SQL、bucket 名、database id、绑定名或堆栈**（`CONTRIBUTING.md`）。

- 客户端得到的是稳定的错误码与一句人话；
- 详情写成结构化 JSON 日志一行（`src/worker/index.ts` 已按此实现）；
- 日志本身也不得包含凭据或完整的用户提交内容。

## 10. 草稿预览

- 链接由 `MALLOK_SECRET` 签名（HMAC），带过期时间（`ARCHITECTURE §14`）；
- 响应 `Cache-Control: private, no-store` 且带 `noindex`；
- **永不写入边缘缓存**（`ARCHITECTURE §6.4`）。

## 11. 个人数据

询盘表存买家的姓名、邮箱、公司、电话（`DATA_MODEL §2.11`）。

- IP **不明文存储**，只存 `ip_hash = sha256(ip || MALLOK_SECRET)`，且只用于去重与限流；
- 询盘数据进入站点整体导出，站主可随时带走或删除；
- Mallok 自身不收集、不上传任何数据到 Mallok 的服务器——**Mallok 没有服务器**（`PRODUCT_VISION §5.3`）；
- 站主对这些数据的合规责任由站主承担，文档要说明但产品不代为承诺 GDPR 合规。

## 12. 明确不防（必须如实告知）

诚实地列出边界，比暗示有防护更安全：

1. **插件没有沙箱。** 插件是可信代码，拥有 Worker 全部权限，能读所有 secret、读写所有表。风险边界与 WordPress 插件一致。
2. **主题能输出误导性 HTML。** 它不能执行代码，但能画一个假的登录框。安装第三方主题前后台会提示。
3. **不防管理员自己。** 0.1 只有一个管理员，没有角色权限、没有操作审计。
4. **不防 Cloudflare 账号被攻破。** 一切都在用户自己的账号里，账号安全由用户负责（建议开双因素）。
5. **限流是尽力而为。** 按数据中心计数、最终一致，分布式攻击可以绕过。真正的防护是 Cloudflare 自身的 WAF 与 Bot 管理。
6. **不防内容作者上传恶意附件。** `files/` 的内容原样存储，只做类型嗅探；下载者自负。
7. **PBKDF2 强度可能低于行业建议**（见 §3.1），实测后如实说明。

## 13. 供应链

- 生产依赖用**精确版本**，不用浮动 tag（`TECH_STACK §11`）；
- 新依赖走 `TECH_STACK §11` 的 gate：精确版本、锁文件、许可证、安装脚本、传递依赖数、体积、所属层；
- **运行时动态 `import` 远程代码或任何形式的 `eval` 一律禁止**（`TECH_STACK §12`）；
- 不引入任何服务商 SDK 进 Worker，一律 `fetch`。

## 14. 恶意语料测试（硬性）

`CONTENT_FORMAT §9` 第 7 条已经把它列为往返一致性的必过项。测试语料至少覆盖：

`..` 路径、绝对路径、`javascript:` 链接、`data:` 链接、内联 `<script>`、事件属性、超 2 MB 正文、畸形 YAML（alias、自定义 tag、重复 key）、超长单行、深嵌套列表、Unicode 方向控制字符、HTML 实体绕过、svg 伪装成 png。

用 `fast-check` 做属性测试（`TECH_STACK §10`）：**任意输入下，渲染要么产出净化后的 HTML，要么抛出明确错误——不崩溃、不泄露、不产生未转义输出。**
