# Mallok 安全规范与威胁模型

- 状态：Accepted for MVP
- 适用阶段：全部

## 1. 保护目标

Mallok MVP 优先保护：

1. 访客浏览器不执行文章作者注入的脚本；
2. 发布者不能通过 API 越权覆盖新 revision 或写任意 SQL/path；
3. 构建/部署不能写出项目边界或删除源码；
4. token/云凭据不进入 Git、日志、错误响应或命令行参数；
5. 静态与动态模式对同一内容采用同一安全编译语义；
6. 数据库中被篡改或版本未知的 HTML 不被伪装成 `SafeHtml`。

MVP 不保护项目所有者免受其主动安装的恶意 npm 依赖、主题或配置代码。主题与配置是可信代码执行边界，文档不得宣传为沙箱。

## 2. 信任边界

| 输入 | 信任级别 | 处理 |
| --- | --- | --- |
| Mallok 发布包与 migration | 可信发布物 | lock、签名/来源审计 |
| 项目配置与本地主题代码 | 项目所有者可信代码 | 明示可执行，不做沙箱承诺 |
| Markdown/frontmatter/data | 不可信内容 | schema、compiler、sanitize、escape |
| HTTP path/query/header/body | 不可信网络输入 | 限额、严格 parse、认证、参数化 |
| D1 row/body_html | 不可信持久化 bytes | row codec + profile/version/hash 校验 |
| public/theme 二进制文件 | 不可信 bytes | path/MIME/size/hash，不执行 |
| Cloudflare/Wrangler 输出 | 外部系统数据 | redaction、schema 校验、最小记录 |

## 3. 内容与 XSS

- Markdown raw HTML node 固定为“移除”，不是可选的 escape/保留模式；
- GFM 输出必须经过固定 sanitizer allowlist；scheme 匹配大小写不敏感；
- sanitizer 默认删除 event attributes、style、iframe/object/embed、form、meta refresh、srcdoc、srcset/imagesrcset 和危险 URL；
- 外部链接是否添加 `rel` 是 theme UX 决策，但 target `_blank` 时 helper 强制 `rel="noopener noreferrer"`；
- `SafeHtml` 是运行时不可伪造对象，只能由 sanitizer、HTML document builder、`jsonScript`/`externalScript` 等封闭 helper 创建；`externalScript` 还只接受 manifest-backed、不可由通用 URL 升级的 `SafeAssetUrl`；
- D1 `body_html` 只有受控 row codec 校验完整版本/profile/hash 后才能恢复；公开 API 不导出 string → SafeHtml；
- template `html` helper 禁止 script/style/comment raw-text 文法，详情以 [THEME_API.md](THEME_API.md) 为准。
- `jsonScript` 只把最终标签间精确文本作为私有 contribution 随 `SafeHtml` 传播；异步 adapter serializer 用 Web Crypto 从其 UTF-8 bytes 计算并只读导出排序后的 hash sources，禁止主题/Worker 注册任意 contribution/hash 或扫描 HTML 猜测 script 边界；

安全测试不能只断言恶意字符串“不存在”。输出要用 HTML5 parser 重解析并遍历 DOM，覆盖 mXSS、script/style raw text、comment、NUL、实体、大小写 scheme、SVG/MathML integration point、JSON-LD `</script>` 和分块输入。

## 4. SQL 与持久化

- 所有值使用 D1 prepared statement bind；表/列/order 只能来自固定代码枚举；
- publish/unpublish 使用数据库约束、CAS guard 与 transactional batch；
- revision 不可变；只允许追加和 pointer 变更；
- idempotency key 与 request hash 绑定；同 key 不同请求返回冲突；
- API 不接受客户端提交 body_html、artifactHash 或 server timestamp 作为权威；
- row codec 校验 UUID、数值范围、JSON purity、hash 长度、compiler/schema/sanitize/codec profile；
- dynamic publish 在写入前执行 source/body/row UTF-8 byte 上限，D1 trigger 原子执行总 payload ledger；不得用 JavaScript string length 代替字节数；
- 未知 profile 返回安全 503/`PUBLISHED_REVISION_INCOMPATIBLE`，不在访客请求时重新编译 Markdown；
- migration 永不拼接用户输入，不回显完整 row。

## 5. 认证与 secret

- 管理 API 只接受 `Authorization: Bearer <token>`；不接受 query/cookie/form token；
- token 只接受 `hex:` 或 `b64u:` 两种带前缀 canonical 编码；运行时 decode 后要求 32–128 raw bytes，再 re-encode 并要求完全相同，拒绝 padding、非 canonical 尾位和空白；官方生成器固定使用 CSPRNG 32 raw bytes，不能把运行时格式校验伪装成熵估算，也不增加任意字符串黑名单；
- server token 只在 Worker secret 中；本地只在 gitignored `.dev.vars` 或进程环境；CI 的 local tests/content API 若需要 token只能用平台 secret store，MVP CI不得执行 Cloudflare基础设施 mutation；
- CLI 不提供 `--token`，不写 shell history；
- 首次 deploy 的 `--secrets-file` 必须位于项目外、是当前用户拥有的普通非 symlink `0600` 文件，且只能以无 BOM UTF-8 单行保存 `MALLOK_ADMIN_TOKEN=<canonical-token>`；Mallok 不复制、不打印、不删除用户文件；
- 比较前把两边编码成固定长度 digest，再 constant-time compare；格式/长度不合法也走近似一致失败路径；
- 管理 endpoint 不配置 secret 时 fail closed；
- 认证失败不区分“文档存在与否”，不记录 token；
- 不配置 CORS；浏览器 GUI 不直接复用长期 CLI bearer token。

`account_id`、`database_id` 不是认证 secret，但属于环境标识，默认只写 gitignored state。任何 credential-like 字符串都纳入 secret scan。

## 6. 请求防护

- publish JSON body 在读取/解析前硬限制 2 MiB；unpublish 必须为空 body，GET/HEAD 不接受 body；
- 只接受准确的 `application/json`（可带 UTF-8 charset）；压缩 request body MVP 不支持；
- JSON 必须是 UTF-8、单一 object、无 duplicate semantic fields，拒绝非 JSON number；
- path segment 先验证原始 URL 中的 percent encoding，再 decode 一次；拒绝 encoded slash/backslash/NUL/dot segment；Worker-managed canonical dynamic route 除唯一合法 `__mallok_rev` 外的 query、以及 redirect candidate 的任何 query在 D1/redirect 前拒绝；asset-first 静态资源 query 由平台处理且不查 D1，unknown-after-miss 的 query 不改变主题 404；
- method、Content-Type、Authorization、Idempotency-Key、If-Match 按 [HTTP_API.md](HTTP_API.md)；
- 错误 envelope 不含 stack、SQL、绝对 home path、token、完整 Markdown 或 frontmatter data；
- admin response 和所有 auth error 使用 `Cache-Control: no-store`。

MVP 不内置分布式 rate limiter。高熵 token 只能降低凭据被猜中的概率，仍建议生产操作者按自身威胁与流量在 Cloudflare 配置 WAF/rate limiting；该建议不是 Mallok RC 验收门，也不能被写成内核已有能力。若未来要把它升级为强制要求，必须先冻结可检查的规则、套餐前提与自动/人工证据。

## 7. 文件系统与构建

- 所有 managed roots 双向不重叠；`.git`、项目根、home、filesystem root 永远保留；
- 不跟随 content/theme/public symlink 或 junction；
- output 写入仅消费 route planner token，不消费用户拼接 path；
- 不以 `rm -rf` 清理未解析变量、glob 或宽目录；
- stage 完整校验后才替换 output，失败保留旧版本或明确 recovery paths；
- preview 只提供 output 内普通文件，防止 traversal、double decode、encoded separator 和 symlink；
- 文件大小、总量、深度和数量设上限，避免 zip-bomb 式本地资源耗尽。

## 8. Cloudflare 与部署

- deploy/provision 默认计划优先，实际动作必须明确确认；
- `--yes` 不跳过 doctor/schema/boundary；
- Mallok 不隐式创建 secret、清空数据库、删除资源或修改 DNS；
- 所有 D1 命令显式 local/remote；
- 生成配置与 state gitignore；
- MVP CI 不持有 Cloudflare infrastructure mutation token；plan/dry-run/local tests 无真实凭据。未来启用 CI deploy前必须提供加密 durable recovery evidence store，并继续使用最小 scoped token、staging/production分离；
- deploy 日志对 Authorization、token-like key、account/database/deploy id 做分级 redaction；用于恢复的非敏感 id 只在用户本地详细日志中显示。

## 9. 依赖与供应链

- 只使用 lockfile，CI `pnpm install --frozen-lockfile`；
- 新 direct dependency 必须记录用途、license、维护状态、运行时边界和替代方案；
- 不因缺包自研 Markdown/YAML/HTML parser 或 sanitizer；
- `pnpm audit --prod` 结果按可利用性评估，不能仅以“有 advisory”或“0 advisory”替代人工判断；
- 发布前检查 packlist、license、provenance 能力和 npm 2FA；
- 生命周期脚本按依赖逐项审核；生成项目不默认运行来源不明脚本。

## 10. 日志与隐私

结构化日志 allowlist：timestamp、requestId、route template、method、status、durationMs、Mallok error code、document id、revision id 的短摘要。禁止：Authorization、cookie、request body、source Markdown、frontmatter data、SQL、环境变量、完整 IP。

默认无遥测。未来遥测必须 opt-in、单独 ADR 和数据保留说明。

## 11. 安全验证门

发布候选前必须通过：

- secret scan 与 Git history scan；
- Markdown/HTML/URL/JSON/mXSS corpus；
- API auth/body/CAS/idempotency/SQL injection；
- path traversal/symlink/junction/TOCTOU 定向测试；
- D1 row tamper 与未知 codec profile；
- 依赖/pack/license 审计；
- static 与 Worker CSP/header/DOM 对比；
- 人工复核所有 `set:html` 类原始输出通道（Mallok 内不应存在未受控等价物）。

任何真实 secret 进入 Git、任意作者输入进入 script/style raw text、任意 path 可越界、或 CAS 故障留下半发布状态，均为发布阻断。

## 12. 漏洞响应

公开发布前在 `SECURITY.md` 根文件声明私下报告渠道、支持版本和响应目标。安全修复涉及 compiler/sanitizer profile 时必须：

1. 提升 profile/version；
2. 保留明确兼容 decoder 或阻止不兼容 row；
3. 提供重发布/迁移说明；
4. 增加回归 fixture；
5. 不在请求时静默重编译旧 Markdown。
