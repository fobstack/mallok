# Mallok Studio-first 测试、证据与质量门

- 状态：Accepted for Studio-first 0.1
- 适用阶段：Task 01–05

## 1. 当前事实与原则

仓库当前尚无产品代码、测试 runner、安装包或稳定脚本。本文冻结的是**验证类别、证据门和测试语义**，不是已存在命令。任何类别在实际 test path 和可执行入口注册前都是 `NOT_AVAILABLE`，不得用空脚本、截图、人工口述或另一个类别的成功冒充通过。

每项证据必须形成：

```text
AC -> implementation symbol/path -> test case/path -> actual command -> exit code/result -> environment -> verified SHA
```

自动化证明行为可重复，真人测试证明目标用户能完成任务；两者不能互相替代。local/recording Cloudflare 证明编排，只有经授权 staging 才证明真实公网发布。

## 2. 证据状态

只允许：

- `NOT_AVAILABLE`：实现或稳定验证入口尚不存在；
- `NOT_RUN`：入口存在但未在候选 SHA 运行；
- `FAILED`：已运行且不满足门；
- `VERIFIED_LOCAL`：本地/recording 证据通过；
- `VERIFIED_STAGING`：获授权真实 staging 证据通过；
- `VERIFIED_HUMAN`：规定画像的真人任务证据通过；
- `ACCEPTED`：负责人已检查全部适用证据并接受。

报告不得使用“应该通过”“理论可用”或没有绑定 SHA 的 `PASS`。

## 3. 精确验证类别

| ID | 必须证明什么 |
| --- | --- |
| `DOCS` | Markdown 链接/围栏、权威关系、AC/task 映射和未实现事实一致 |
| `STATIC` | type/lint/schema/API 边界与禁止依赖扫描 |
| `UNIT` | domain/application service 正常、边界和失败行为 |
| `COMPONENT` | Studio 控件、表单、状态、错误和 keyboard/focus 行为 |
| `FLOW-LOCAL` | 从 Studio 建站、编辑、保存、重开、预览的真实 UI 流程 |
| `FLOW-EXPORT` | 三模板、图片、SEO、静态导出和导出恢复流程 |
| `CLOUD-CONTRACT` | recording provider 下计划、确认、权限、ownership、零未授权写入 |
| `FLOW-FIRST-PUBLISH` | 授权 staging 的首次 Cloudflare 发布、health、公开 GET 与 cleanup |
| `FLOW-UPDATE` | 授权 staging 的更新、下线、公开一致性和资源闭合 |
| `RECOVERY` | fault injection、幂等重试、应用重启恢复和上一版本恢复 |
| `SECURITY` | XSS/URL/path/SQL/secret/credential/updater/template/remote ownership corpus |
| `DETERMINISM` | 相同输入跨根目录/时间/枚举顺序输出 bytes/hash 一致 |
| `A11Y-STUDIO` | Studio keyboard、focus、label、读屏、zoom/reflow、motion 与对比度 |
| `A11Y-SITE` | 三个官方模板的语义、键盘、landmark、对比度和 HTML 重解析 |
| `SEO-SITE` | compiler-owned head、canonical、robots、sitemap/shards、内部链接、preview/404 indexability 与确定性 |
| `PAGESPEED-LOCAL` | 固定 Chrome/Lighthouse 多次 cold run、官方模板资源预算与原始本地报告 |
| `PAGESPEED-STAGING` | 真实公开 URL 的多次 PSI lab、CrUX API 可用性/field data 与候选 SHA 证据 |
| `PACKAGE` | 自包含发行物、签名/来源、清单、fresh install、upgrade/uninstall 边界 |
| `PERFORMANCE` | 启动、预览、导出、发布和 Worker 的固定环境统计 |
| `USABILITY` | 规定画像真人完成率、用时、求助、误操作和恢复证据 |
| `RELEASE` | 同一 clean candidate SHA 汇总所有适用类别且无 P0/P1 |

第一个实现对应类别的任务必须同时创建稳定验证入口和 registry，记录该 ID 展开的实际命令与 test path。后续任务只能扩展覆盖，不能让同一 ID 静默改成更弱测试。命令不存在、没有测试、只打印成功或依赖人工预置隐藏步骤均失败。

## 4. 每任务最小类别矩阵

| Task | 必须通过的类别 |
| --- | --- |
| `01-walking-skeleton` | `DOCS`、`STATIC`、`UNIT`、`COMPONENT`、`FLOW-LOCAL`、`A11Y-STUDIO` |
| `02-local-product` | 上述全部 + `FLOW-EXPORT`、`SECURITY`、`DETERMINISM`、`A11Y-SITE`、`SEO-SITE`、`PAGESPEED-LOCAL` |
| `03-cloudflare-publish` | 上述适用项 + `CLOUD-CONTRACT`、`SEO-SITE`；真实发布只能以单独授权的 `FLOW-FIRST-PUBLISH` 标记 |
| `04-update-recovery` | 上述适用项 + `FLOW-UPDATE`、`RECOVERY`、`SEO-SITE`、D1/HTTP 安全子集 |
| `05-release` | 全部适用类别，尤其 `PACKAGE`、`PERFORMANCE`、`USABILITY`、`RELEASE` |

Task 03/04 的普通实现会话默认只运行 local/recording 类别。Cloudflare 凭据存在不等于授权；没有逐项授权时 staging 类别保持 `NOT_RUN`，不能改名为 local verified。

## 5. Studio 与本地流程测试

### 5.1 Walking skeleton

真实 UI 自动化至少覆盖：

- 从首次启动创建项目、取消、重复名称、只读/无权限目录和中途失败；
- 选择模板、填写站点信息、编辑标题/正文、保存和重开；
- 编辑后内嵌预览更新，构建失败保留最后成功预览；
- app 重复启动只复用一个 backend并打开新 capability；tab 关闭、显式退出、5 分钟 idle、活跃操作与 stale rendezvous 恢复不留下未授权或无界后台进程；
- 默认流程没有 shell、代码配置、账号或网络依赖；
- Studio 与无 UI composition root 对同一 use case 产生相同领域结果。

### 5.2 完整本地产品

- 三模板创建/切换，内容、永久 ID、SEO 和图片引用不丢失；
- 图片格式/compressed bytes/宽高/channel/frame/decoded pixels 边界、同名、缺失、symlink/junction、路径越界和替换 race；签名 app 在无全局 libvips 的机器覆盖五种批准静态格式、动画拒绝、metadata bomb、三段 WebP profile 和输出重解码；
- 字段错误保留输入并聚焦到可修复控件；
- 自动保存、最后 backend ack sequence、应用内安全退出、browser tab 关闭、进程强杀、陈旧恢复文件、并发打开与项目重开；
- 静态导出 exact file set、首页/文章/404/RSS/sitemap、零默认 client JS；
- SEO head、charset 前 1024 bytes、preview/404 noindex、robots、root sitemap 与 shards、canonical 集合，以及 root-relative/trailing-slash/draft/slug-change broken-link gate；
- 受管图片只输出 published 实际引用项，作者原图不变；正文/cover alt 必填，外部/动画图片阻断，优化后 width/height/loading/fetchpriority 与 bytes gate 正确；
- 在 export sidecar 的每次 phase write、output→backup、staging→output 和 backup delete 前后杀进程，单独断言首次导出的 `prepared + no output/backup + staging=new` 与更新导出的 `prepared + output missing + backup=old + staging=new`，再按 marker/nonce/inventory 矩阵恢复；tamper、symlink、丢 marker、多 marker 和 basename mismatch 时零自动 rename/delete；
- `.mallok-backup.tar.gz` 对 file/directory 正常集，以及 link/device/FIFO/socket、PAX/GNU path、duplicate/NFC+case collision、truncated、entry/bytes/ratio/hash 边界与 `+1` 语料 fail closed；失败不触及最终目标；
- 导出故障保留旧产物，且 UI 不把导出说成公网发布。

Studio 流程测试必须使用真实可访问控件和 composition root；只调用 store/reducer 或比较截图不能冒充流程完成。

## 6. 安全测试

`SECURITY` 至少保留并扩展以下 corpus：

- Markdown/raw HTML、mXSS、HTML/attribute/URL/script context；输出经 HTML5 parser 重解析；0.1 无 JSON-LD script，任何模板/正文 script 都必须被拒绝；
- path traversal、percent/double decode、UNC/drive/device、symlink/junction、项目边界和原子替换；
- SQL injection、prepared statement、`expectedCurrentBundleHash` guard、bundle/route hash、payload/aggregate 上限；
- credential 不进入项目、配置、argv、process list、日志、错误、诊断导出、snapshot 或 Git history；
- Studio bridge/IPC 只暴露批准 use case，网页内容不能调用任意文件、shell 或系统 API；
- 内置模板来源与完整性可验证，0.1 不加载未批准远程可执行模板；
- 安装包、更新 metadata 和下载产物的签名/来源验证 fail closed；
- Cloudflare redirect/origin allowlist、最小权限、ownership 和 cleanup；未知目标不 adopt/delete；
- 错误 UI 不显示 token、SQL、堆栈、绝对 home path 或未发布正文。

安全 bug 必须先有最小失败回归；不允许用字符串黑名单、禁用测试或扩大权限绕过。

## 7. Cloudflare、原子性与故障注入

### 7.1 Recording contract

recording provider 精确记录 read/mutation、目标、顺序、operation identity/`bundleHash` 和脱敏结果。覆盖：

- 未确认、取消、认证失败、目标冲突和 ownership 不明时 mutation=0；
- 相同计划重复执行不无界创建资源；
- 每个远程步骤前后的中断与应用重启；
- partial create/deploy 的真实下一步与不误删；
- UI 状态由持久证据和只读复核派生，不由进度条猜测。

### 7.2 Publish/update 原子性

对 publish/unpublish 逐点故障注入：编译、R2 conditional create/HEAD、D1 staging manifest、route body 上传、完整性检查、public-asset metadata guard、inactive-capacity/cleanup、`expectedCurrentBundleHash` guard、current bundle 切换和 response loss。必须证明：

- 任一步失败都不让访客读到半 bundle，current 只能是旧完整 bundle 或新完整 bundle；
- 相同 `bundleHash`/manifest/body 安全重放，不同 bytes 复用相同 hash 必须 fail closed；
- R2 precondition fail、timeout/unknown、missing checksum、bytes/MIME mismatch 永不触发覆盖；只有 exact object 才把 verified 置 1，finalize 再次拒绝既有 public metadata 冲突；
- base 已变化时拒绝静默覆盖；结果未知先观察 current/staging 再补齐或 finalize，不生成新的 bundle 身份；
- 新图片部署失败时内容 pointer 不切换；
- HTML、robots、root sitemap/shards 和内部链接随同一个 current bundle 原子切换；任何注入点都不能让新页面配旧 sitemap，unpublish 后 canonical URL 必须同时从 sitemap 消失；
- staging/ready-but-never-activated asset 的公开 GET 返回 404；activate 后返回 exact bytes，曾激活 asset 在 R2 append-only/registry 规则下保持可读；
- current/previous pointer 在首次发布、普通更新、恢复和 response-loss 重放中保持精确，base conflict 不写伪 `activated_at` 或 public asset；
- inactive bundle 的 8/9、64 MiB±1、24h±1、7d±1、同 hash 重试、每请求最多一组清理和 prospective switch 都使用可注入 provider clock 验证；容量失败时 pointer 与新 candidate row 均不变；
- 上一版本恢复只使用本地保留且 hash 复核通过的旧 bundle 作为明确 target；失败不破坏当前已知正常版本。

### 7.3 授权 staging

真实 Cloudflare 流程仅由人工操作者在限时、绑定 candidate SHA、账号、资源名和 cleanup 范围的授权下运行。preflight 证明目标 fresh；每个创建结果先持久化 ownership，再进入下一远程动作；只删除本次 manifest 能证明创建的资源。授权过期、结果未知或 ownership 不完整时保留资源并返回人工处置，不能猜测删除。

## 8. 确定性与跨模式

固定内容、模板、站点数据、工具链和 `asOf`，在不同绝对根、mtime、时区和目录枚举顺序下比较：

- 规范 Markdown/项目数据；
- route、静态文件清单与全部 bytes/hash；
- RSS、sitemap/shards、robots 与 compiler-owned SEO head；
- embedded preview 与公开 Worker 的业务 DOM；
- PublishBundle manifest、bundle hash 和发布摘要。

只允许排除 request ID、平台时间和经过批准的运行时 header；不能排除正文或业务结构。

## 9. 可访问性与真人任务

### 9.1 Studio 可访问性

自动化与人工共同验证：逻辑阅读/Tab 顺序、可见 focus、键盘完成主路径、控件 name/role/state、错误关联、状态变化通告、200% zoom/reflow、44×44 CSS px 目标风险、对比度与 reduced motion。不能从截图宣称读屏或键盘通过。

### 9.2 官方站点模板

三个模板分别验证语义 heading、landmark、skip link、键盘、focus、图片 alt、表单 label、颜色对比、zoom/reflow，并使用 axe/HTML validator 作为补充。用户内容不能保证完全合规，但 Mallok 生成结构不能制造已知 critical/serious 问题。

### 9.3 0.1 真人门

至少 10 名没有 Node、终端和前端框架经验、此前未使用 Mallok 的参与者：

- 至少 9/10 完成下载安装后的创建→选模板→编辑→预览，中位时间不超过 3 分钟；
- 至少 9/10 从无 Cloudflare 账号但可使用邮箱/浏览器的状态完成注册、邮箱验证、条款、连接授权和首次公网发布，中位时间不超过 10 分钟；网络等待全部计入，已有账号样本另列且不能替代；
- 对已写好文章，从进入编辑到公网显示新内容最多 3 个显式动作；
- 五类恢复场景中至少四类仅依赖界面提示完成或到达正确的人工升级状态；
- 至少 9/10 在 2 分钟内完成一次三模板间的切换，且测试站点内容与 URL 保留率 100%；
- 记录完成率、用时、求助、误操作、手工配置、放弃点和系统环境；维护者不得代操作。

## 10. 覆盖率与静态门

- core/application service：lines/statements/functions 目标 ≥90%，branches ≥85%；
- Studio/provider/package adapter：lines/statements/functions 目标 ≥85%，branches ≥80%；
- auth、publish atomicity、credential、path、HTML/URL、project recovery 关键模块 branches ≥90%；
- TypeScript strict，无未说明 `any`、`@ts-ignore`、skip、only 或硬编码成功分支；
- UI 覆盖率不能替代 `COMPONENT`/`FLOW-*`，总覆盖率也不能替代安全 corpus。

阈值必须在根配置与本文件一致；修改阈值属于独立审查的产品质量变更。

## 11. 性能门

固定并报告机器、OS、发行物版本、cold/warm、重复次数、中位数与 p95。0.1 至少观察并冻结发布前目标：

- cold Studio 启动到可操作；
- 8 篇标准项目编辑到 preview 更新；
- 1000 篇 × 10 KiB fixture 的静态导出；
- 单文章编译与 local warm Worker 响应；
- Studio、导出和 Worker peak RSS；
- 首次发布与内容更新的本地处理时间，网络等待单列。

PRD 已冻结的端到端产品门必须硬判：不少于 30 次授权 staging 单篇更新的公开可见时间 P95 ≤60 秒；10 人模板切换按 §9.3 判定；连续三个小版本的固定项目升级矩阵成功率 ≥95%、人工干预中位数 0。其余低层启动、编译、内存和 Worker 指标在 Task 01 注册固定环境与测量协议前只记录数据，不得临时选择最好一次或编造阈值。公开比较必须遵循 `PRODUCT_VISION.md`、`PRODUCT_STRATEGY.md` 与 PRD §11.2 的同条件协议。

### 11.1 Mallok PageSpeed Gate

本门的数字是 Mallok 产品预算，不是 Google 认证。Task 02 锁定 Chrome/Lighthouse/OS/CPU/server headers/mobile config，对 `journal|docs|company × home|page|article` 共 9 个公开 publish fixture 每页顺序执行 5 次 cold run，禁止并发：

- Performance 中位数 ≥95，任一次 ≥90；
- Accessibility 与 Best Practices 每次 ≥95；
- SEO 每次 100；
- client JavaScript 0 B、第三方请求 0、remote font/script/style 0、raw HTML ≤256 KiB、deterministic gzip CSS ≤32 KiB、首屏受管图片 ≤200 KiB、确定性 critical budget 与 browser 初始无滚动传输均 ≤500 KiB；后者按 cold cache、mobile viewport、`load` 后 2 秒的 navigation/resource `transferSize` 求和并保存原始记录；
- 45 份原始报告、代表性中位报告、benchmark index、版本、配置、环境和 candidate SHA 全部保存。

Task 05 的 `PAGESPEED-STAGING` 在真实 Cloudflare staging 对每个模板的 homepage/article 每 URL 顺序执行 3 次 PSI mobile，Performance 中位数 ≥90，其他类别沿用本节门。PSI lab 与 CrUX field 分开；没有足够 field data 记录 `FIELD_DATA_UNAVAILABLE`。有数据时按 mobile/desktop 第 75 百分位报告 LCP ≤2.5s、INP ≤200ms、CLS ≤0.1。单次最好分数、另一工具版本或旧候选结果不能替代。

## 12. 自包含发行物

`PACKAGE` 在支持平台的干净机器验证：

1. 通过正式发行物安装或打开；
2. 机器无 Node、pnpm、Git、Wrangler、全局 Mallok；
3. 创建、编辑、预览、静态导出可离线完成；
4. 发行物清单无 test、fixture、coverage、secret、本机路径、用户内容或内部 prompt；
5. 签名/来源、版本、许可证、升级、降级提示与卸载边界可核验；
6. 发布凭据只从系统安全存储取得；
7. npm 包或 CLI consumer 测试只能证明高级入口，不能替代 Studio fresh-install。

## 13. 证据与报告

每个任务报告至少包含：

```markdown
- Status / Base SHA / Head SHA
- User-visible result
- AC -> implementation -> test path -> verification category -> actual command/result
- Supported OS/runtime and exact test environment
- Dependencies, licenses and network actually used
- Local/recording/staging/human evidence clearly separated
- Accessibility checks and unverified assistive technology
- Changed files and allowed-path audit
- Deviations / remaining risks / blocker
```

自动 evidence 只能由真实 runner 生成并绑定 clean SHA；人工 usability/a11y 记录需去标识化。未运行项目明确写 `NOT_RUN`，不可从另一提交、另一平台或旧 CLI-first task 继承结论。
