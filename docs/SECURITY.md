# Mallok 0.1 安全规范与威胁模型

- 状态：Accepted 0.1 security baseline
- 适用范围：binary、数据项目、loopback Studio、compiler、PublishBundle、static/Cloudflare sink

## 1. 保护目标

Mallok 0.1 优先保护：

1. 作者 Markdown、frontmatter、media 和模板数据不能在访客浏览器执行脚本；
2. Studio 不能被外部网站通过 loopback CSRF/跨源请求驱动；
3. 项目读写和 static export 不能越界、覆盖源码或跟随恶意 link；
4. bundle publish 只能切换到完整、hash 一致的预渲染 snapshot；
5. Cloudflare account/site credential 不进入站点、Git、browser storage、argv 或日志；
6. Worker 不根据访客输入执行 compiler、模板或作者代码；
7. 失败后线上只可见旧完整 bundle 或新完整 bundle，不可见 staging 半状态。

非目标：已完全控制本机用户、Mallok binary、Cloudflare account或site publish token的攻击者；用户访问的第三方普通 HTTPS 链接；Cloudflare 自身平台失陷。发生这些情况时不得声称 Mallok 仍能保护站点管理员。0.1 公开内容不允许第三方图片，因而第三方图片不再是性能/隐私豁免项。

## 2. 信任边界

| 输入/组件 | 信任 | 处理 |
| --- | --- | --- |
| 官方签名 binary、内置模板、generic Worker | 可信发布物 | checksum/signature、release provenance、embedded hash |
| `mallok.json`、Markdown/frontmatter | 不可信作者数据 | strict parse、schema、预算、escape/sanitize |
| `media/` bytes | 不可信文件 | no-follow、magic/type/size/hash、不可执行 MIME |
| `.mallok/` cache/state | 不可信可再生状态 | 使用前重算 hash/重查 provider；绝不作为 credential |
| Studio browser request | 不可信 loopback network input | session capability、Origin/Host、body/method限制 |
| 声明式模板 context | 不可信数据进入可信内置模板 | typed value、默认 escape、无 raw filter |
| PublishBundle | 不可信传输数据 | canonical manifest、逐 body/asset hash、预算、完整性验证 |
| Cloudflare API/Worker response | 外部系统数据 | strict response schema、redaction、超时/大小限制 |
| D1/R2 | 受Cloudflare account权限保护的运行状态 | 写入时验证site/bundle/path/hash/MIME；account失陷不在保护范围 |

0.1 不执行站点提供的 JavaScript、ESM theme、plugin、Wasm、shell command 或 package lifecycle script。

## 3. Loopback Studio

Studio backend 只绑定 `127.0.0.1` 的 OS-assigned ephemeral port；0.1 不绑定 IPv6。禁止固定端口扫描、`0.0.0.0`、LAN 自动发现和 remote tunnel。单实例 rendezvous 使用用户私有 Unix socket并验证 peer UID/version；它只触发打开新的单次 browser capability，不能绕过 Studio session 检查或传递 credential。

启动时生成至少 32-byte CSPRNG session capability。自动打开浏览器时 capability 只放在 URL fragment；内置前端读取后立即 `history.replaceState` 清除，并在后续请求的 `X-Mallok-Studio-Session` header 中发送。不得放 query、cookie、localStorage、日志或错误页面。

backend 必须：

- 只接受 exact loopback Host 和本次进程 Origin；
- 不配置 permissive CORS；所有 state-changing request 同时验证 session header、Origin、method 和 JSON Content-Type；
- auth/parse 顺序在读取大 body 前拒绝无效请求；
- 每次启动使用新 capability，关闭后立即失效；
- Studio assets 全部嵌入 binary，CSP 禁止 remote script/style、inline script和frame；
- 不把 Cloudflare API/site publish token、绝对 home path或环境变量返回给浏览器；
- browser 只提交业务输入，filesystem和Cloudflare操作由 application service执行；
- 文件外部变化以 hash conflict展示，不能覆盖用户编辑。

Studio 前端发生 XSS 时 session capability 可能失守，因此前端自身仍按不可信内容渲染：正文 preview放入 sandboxed、无 same-origin/script 权限的 frame，普通 UI使用 text node，不用不受控 `innerHTML`。

## 4. 内容、模板与 XSS

- Markdown raw HTML固定移除，无配置开关；
- CommonMark/GFM output经过固定 sanitizer allowlist；移除 event attribute、style、script、iframe/object/embed、form、meta refresh、srcdoc、srcset/imagesrcset和危险 URL；compiler 后续只为受管图片注入自己生成的 width/height/loading/fetchpriority；
- scheme匹配大小写不敏感并在实体/控制字符规范化后执行；
- 声明式模板的普通输出按 HTML text/attribute/URL context自动 escape；
- 唯一 HTML fragment入口是 compiler mint 的 sanitized Markdown body和内置 serializer；没有 `raw|safe` filter；
- 模板禁止 script、inline style、事件属性、动态 include、JS/plugin和网络；
- config design token经过类型校验后才进入生成 CSS variable，用户 string不直接拼进 CSS；
- 最终 document用 HTML5 parser重解析，覆盖 mXSS、raw-text/comment、SVG/MathML integration、NUL/entity和JSON breakout corpus；
- Cloudflare Worker 对 public HTML 固定发送 `default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` CSP header。0.1 公开模板无 script/JSON-LD，因此不需要 script hash/nonce机制。通用 static export 在 HTML 内嵌 meta CSP 的可支持部分（不包含无法由 meta 强制的 `frame-ancestors`）；是否禁止 framing 取决于最终静态托管商的 HTTP header，Mallok 在导出报告中提示，不宣称跨托管商保证。

外部 HTTPS 图片不由 Mallok抓取，避免 SSRF；preview/source import 可以定位并警告，但 publish/static export 阻断并要求用户下载后作为受管 media 导入。普通外部 HTTPS 超链接不受此限制。

## 5. 文件系统与项目数据

- 所有输入使用 project-root-relative token，realpath后必须仍位于对应 managed root；
- content/media不跟随 symlink、junction、special file或项目外hardlink；
- `.mallok-backup.tar.gz` 通过批准的 streaming tar reader 在任务拥有的 sibling staging 中处理；每个 effective header/path 在创建文件前验证 closed top-level、entry type、entry count/bytes/hash、规范 relative path 和 compression ratio；拒绝 absolute/parent path、symlink/hardlink/device/FIFO/socket、危险 PAX/GNU path、duplicate/NFC/case-fold collision 和 archive bomb，失败不触及最终目标目录；
- 拒绝absolute/drive/UNC/backslash/percent/NUL/control/empty/dot/device path；
- source、`.git`、project root、home和filesystem root永远不可作为递归删除/替换目标；
- 写入使用同目录temporary file、flush、atomic rename和expected old hash；
- static export只消费compiler产生的route/asset token，在output同父目录staging后执行 crash-safe backup/promote；恢复 sidecar 使用 `ARCHITECTURE.md` 固定的 owner、128-bit nonce、exact basename、phase 与新旧 inventory hash，任一 mismatch 时不自动 rename/delete；不谎称可用单次 rename 跨平台原子替换非空目录；
- `.mallok` cache使用前复核manifest和每个body/asset hash；cache corruption只能导致重建，不能改变作者数据；
- 单文件、文件数、总bytes、目录深度和render iteration均有固定预算；
- 图片除 compressed bytes 外还按批准 decoder metadata 限制宽高、channel、frame count 和 decoded pixels；动画、缺失/溢出/截断 metadata 与 decoder warning fail closed，禁止 `unlimited` 解码。优化后的 WebP 还要重新解码核对尺寸、单帧、MIME、bytes 和 hash，不能信任 encoder 返回 metadata。

## 6. PublishBundle 完整性

manifest使用唯一canonical JSON serializer；`bundleHash`绑定所有route/asset metadata，metadata再绑定exact bytes hash。sink必须逐项验证：

- `bundleHash == SHA-256(canonicalManifestBytes)`；
- route body和asset body的SHA-256、bytes、content type匹配manifest；
- route/asset排序、唯一性、必需route、path namespace无冲突；
- asset URL含对应content hash，existing key不能被不同bytes覆盖；
- manifest中无absolute local path、credential、Markdown source、build host或ambient timestamp。

static和Cloudflare sink不得重渲染或“修复”不合法bundle。不合法即拒绝。

## 7. Cloudflare 发布与持久化

- Cloudflare OAuth account credential 只用于显式 provision/connect/rotate/upgrade，site publish token 只用于单站点 bundle 数据；
- publish endpoint在读取body前验证Bearer token，所有response `no-store`；token格式/长度固定并constant-time compare；
- 所有D1值使用prepared statement；table/column/order来自固定代码；
- R2 asset只用 `If-None-Match:*` 等价的 conditional create + SHA-256 checksum 写入；precondition/timeout 后 HEAD 证明 checksum/bytes/MIME exact 才算 no-op，永不无条件覆盖；
- 只有原子 activate 后写入不可变 public-asset registry 的 key 才能由公开 Worker 读取，staging 不泄露未发布 asset；
- activate只在route完整、asset存在、bundle/runtime兼容、既有 public-asset metadata 无冲突且 prospective inactive-bundle 容量不超限后，用一个D1 transaction切换current pointer；
- current-base guard失败不得last-write-wins；
- content-addressedPUT和bundle/path primary key提供幂等重试，不维护request journal；
- public Worker只按exact normalized path读取pre-renderedbody；unknown/malformed storage数据返回安全503/404，不当作HTML输出；
- 0.1不自动删除R2、D1 database、bucket、Worker、DNS或unknown resource。

详细协议见 [CLOUDFLARE.md](CLOUDFLARE.md)。

## 8. Credential

- `MALLOK_CLOUDFLARE_API_TOKEN`、`MALLOK_SITE_PUBLISH_TOKEN` 不得作为 CLI option；
- Studio 默认通过 Cloudflare 公共 OAuth client + Authorization Code with PKCE 获取 account credential；必须验证 `state`、PKCE、exact redirect 与 publisher domain，不在 binary 嵌入 client secret；
- Studio browser 不接收 Cloudflare account 或 site publish token；OAuth callback/code exchange 与 credential store 只在 backend 完成，site token 只由 backend credential adapter 读取；
- site token优先存OS credential store；无安全credential store的平台只能使用process environment，不写plaintext fallback；
- project、`.mallok`、static output、bundle、log、crash report和shell completion不得含secret；
- provider resource id不是认证secret，但仍只写gitignored state并在log中缩短/脱敏；
- auth失败不区分site/bundle存在性，不记录header；
- rotate 需要有效 OAuth account grant 或高级环境 API token，生成新 site token 并使旧 token 失效；
- Studio browser永远不直接调用Cloudflare API或远端publish endpoint。

## 9. 请求与滥用边界

- Studio、publish API和public Worker各自使用closed method/path/content-type allowlist；
- request body在parse前限制bytes；JSON拒绝duplicate key、非UTF-8、非object和非有限数；
- raw path在decode前校验，最多decode一次；encoded slash/backslash/dot/NUL失败；
- upload采用流式byte limit，不把超大body完整缓冲；
- timeout/cancel后不得继续后台提交D1 current switch；
- error envelope不含stack、SQL、credential、完整content、provider response或absolute path；
- 0.1不内置分布式rate limiter。生产用户可在Cloudflare设置WAF/rate limit；高熵token不是滥用防护替代品。若实际攻击数据证明需要，后续再冻结可测试的内置策略。

## 10. 供应链与二进制

- source repository使用精确lockfile；新增direct dependency记录用途、license、维护/安全信号和binary体积影响；
- 不自研Markdown/YAML/HTML parser、sanitizer、crypto或TLS；
- release binary、embedded Studio/template/Worker、checksum、SBOM和source tag绑定同一版本；
- macOS artifact签名/notarize；其他平台按 [DISTRIBUTION.md](DISTRIBUTION.md) 提供签名/checksum；
- 0.1无自动更新器、安装期script或远程plugin/template下载；
- CI对secret/history、dependency/license、binary strings和archive content扫描；
- binary不读取站点package manager文件，也不执行项目命令。

## 11. 日志与隐私

默认无遥测。结构化日志allowlist：时间、binary版本、稳定error code、operation、duration、route template、bundle hash短摘要、HTTP status和非敏感计数。

禁止：Authorization、cookie、session capability、secret、环境变量、source Markdown、frontmatter、完整HTML、SQL、完整provider id/response、absolute home path和IP。debug模式也不得放宽credential/content边界。

## 12. 发布阻断安全门

0.1发布前至少验证：

- Markdown/URL/template/HTML5 mXSS corpus；
- loopback Host/Origin/session/CSRF和sandbox preview；
- path traversal、symlink/junction、atomic write/output recovery；
- canonical bundle、hash collision/tamper、route/asset冲突；
- R2/D1 publish每个中断点与竞争base；
- auth/body/SQL/path fuzz和secret redaction；
- static与Cloudflare返回同一bundle body hash；
- 无Bun/Node/package manager机器的signed binary smoke；
- dependency、license、SBOM、secret/history和binary-content scan。

任意作者输入可执行脚本、任意loopback跨源写、任意path越界、secret进入项目/日志、不同asset bytes覆盖同hash key，或current切到不完整bundle，均为发布阻断。
