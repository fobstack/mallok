# Mallok 测试、证据与质量门

- 状态：Accepted for MVP
- 适用阶段：全部

## 1. 原则

测试结果只对被测 commit、锁文件、工具版本和环境有效。覆盖率达标不等于需求通过；“命令曾经通过”不等于当前工作区通过；本地 Cloudflare 模拟不等于真实 staging。

每个需求必须有：requirement id → task → implementation → test id/path → command → evidence → verified SHA。见 [TRACEABILITY.md](TRACEABILITY.md)。

## 2. 固定环境

- 主 CI：Node `22.22.2`、pnpm `11.1.3`；
- 兼容 CI：最新 Node 24；
- macOS 与 Linux 至少各有一次 Phase 3 演练；
- Windows 运行是 best effort，但所有 path/UNC/设备名/大小写语义必须有平台无关单测；
- Cloudflare 工具版本见 [VERSIONING.md](VERSIONING.md)；
- 测试 timezone=`UTC`、locale=`en-US`，所有 fixture clock 显式传入。

## 3. 稳定脚本

Phase 0 文档规定以下最终脚本名；对应实现出现前状态为 `NOT_STARTED`，不能因为命令不存在而宣称失败或通过：

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm test:integration
pnpm test:e2e:static
pnpm test:e2e:dev
pnpm test:e2e:cloudflare-local
pnpm test:e2e:publish-local
pnpm test:e2e:publish-cli-local
pnpm test:e2e:deploy-dry-run
pnpm test:security
pnpm test:determinism
pnpm test:cross-runtime
pnpm pack:check:core
pnpm pack:check
pnpm licenses:check
pnpm audit --prod
```

`pack:check:core` 从 T-001 起只验证 `@mallok/core` tarball；完整 `pack:check` 到 T-012 才覆盖全部发布包与 CLI。最终 `pnpm verify` 按上述顺序运行除真实 staging 外的全部适用门，但用完整 `pack:check` 覆盖 core，不重复运行 `pack:check:core`。脚本内部不得依赖全局 `mallok`、`wrangler` 或隐式网络。

## 4. 测试层级

### 4.1 单元

- content/config/YAML/canonical JSON；
- route/output path；
- Markdown/sanitizer/HTML helper/URL/JSON script；
- theme context 与 feed；
- repository/query/sort/hash/row codec；
- CLI parse、exit code、JSON envelope；
- API schema、auth、ETag/idempotency/CAS 状态机。

### 4.2 集成

- 文件扫描、symlink/junction 与聚合诊断；
- stage/manifest/recoverable output replace；
- build/asset manifest 的 unique-by-url、稳定顺序、files↔assets 完整投影，以及 config schema 声明的 realpath/managed-root/symlink runtime 反例；
- asset discovery 的 20 MiB/200 MiB、10,000 files/20,000 entries、32 segments、1,024 path bytes/255 segment bytes 精确边界与各自 `+1` 反例；
- theme Node/Worker bundle；
- CLI 子进程 stdout/stderr/signal；
- D1 migration、prepared statement、transactional batch、row tamper、0001 bootstrap deployment barrier；
- D1 256 KiB source、1 MiB body、1,500,000-byte row 与 256 MiB payload ledger 边界；ledger trigger 的成功、超限和整批回滚；
- `payload_bytes` 伪造较小值、删除 `mallok_state`、缺 singleton 时 insert 的 SQL fail-closed；
- metadata-only summary SQL 不选择 source/body/data/template/asset refs；同 statement 的 ordered tag projection 与 canonical `tags_json` 完全相同，缺/多/空洞/乱序 fail closed；100 行 aggregate ≤2 MiB，超限映射 503；
- 10,000 published pointer 上限 trigger：满额 update 允许、新 insert 原子拒绝、unpublish 后可再 insert；
- 管理 list/get 单 statement snapshot、created/updated/republished/unpublished/no-op/replay 的系统时间矩阵；
- remote D1 closed classification：pristine/unmigrated first deploy 按 migration 后复验继续；partial/unknown/nonempty incompatible 状态在任何 remote mutation 前阻断；
- deployment fence：publish-before-acquire 会进入随后 closure，acquire-before-publish 原子 503且零写；preflight expire/takeover、旧 id 不能 renew/enter external、external/releasing 不自动过期、错误 id 不能 resolve、first-deploy bootstrap claim；`ready → migration_started → migration_complete → version_upload_started → version_ready → activation_started → activation_complete`每个崩溃点都存在唯一安全下一步；host/Worker 时钟偏移不影响 D1-clock 判断；
- deploy/rollback evidence：31字符version tag符合四份完整hash的冻结短指纹算法，provider canonical lowercase version/deployment UUID、version/activation messages与operation/logical attempt逐字节一致，candidate inventory覆盖snapshot exact set，显式target version closure；`deployment-attempt.schema.json`覆盖`version-upload|version-observation|activation`、`deploy|rollback`及每个物理调用唯一providerCallId。测试固定`<6位sequence>-<provider-call-id>.request|result.json`：request先durable、result只在terminal后exclusive create、两者不可变。version-observation还须覆盖provider分页穷尽、`observedMatchingVersionIds`去重升序、非空时providerVersionId=min、空时省略、101项不截断且fail closed。其余覆盖message长度、短tag碰撞、缺/截断/孤立result、错lock、重复sequence/call id、providerCall A→B→A、同attempt重复upload生成0/1/多个匹配version并按UUID确定性选择，以及同target重复activation；聚合反例必须证明同一version attempt无法在upload/observation间改变purpose、四hash、tag或message，同一activation attempt无法改变purpose、四hash、tag、message或target，任何漂移都在provider调用前阻断；
- deploy recovery：upload 不得激活流量，target UUID 必须先写 D1 `version_ready` 后才可 activation；组合式 `wrangler deploy` 在 recording port 中必须被拒绝。覆盖首发在upload前/后、target持久化前/后、activation前/后崩溃，首发secret resume、首发terminal-failed同锁repair、normal同锁retarget和满足/不满足前提的abort-to-baseline；initial abort、第三方active version、migration不兼容、证据缺失均保持barrier；
- deploy no-op：D1不得有bootstrap/external/releasing或D1-clock仍有效的preflight，provider current version/deployment、version/activation messages、四hash、三份exact-bytes evidence、migration set和authenticated health全部匹配；逐项删除/篡改都不得返回COMPLETE，也不得绕过active barrier；另测过期normal preflight不被误判为active；
- state-loss recovery：doctor remote 只读输出 adopt 指引；`provision --adopt-database-id` 的 plan/apply、账号/名称/分类错误、确认与原子 state 写入，全部证明远端 mutation=0；
- Worker router、`html_handling:none` config snapshot 与 ASSETS fallback；canonical dynamic route 的随机/重复 query 和 redirect candidate 的任何 query 在 D1/redirect/显式 `env.ASSETS.fetch` 前拒绝；asset-first 静态资源 query 不查 D1，unknown-after-miss query 保持主题 404。

### 4.3 E2E

- static：空目录 `init → new/build → preview GET`；
- cloudflare-local：migration → seed/publish → public GET → update/unpublish；
- cross-runtime：相同 fixture/theme/clock 的 DOM/feed/asset URL；
- staging：只有明确授权的 Phase 3 临时环境，证据与 cleanup 独立记录。

## 5. 标准 fixture

`examples/basic-blog` 固定：

- `asOf=2026-08-27T00:00:00.000Z`；
- 8 篇内容：已发布带日期、无日期、同日期 tie、future、draft、Unicode 文本、合法外链、合法 `/assets/`；
- 反例目录包含重复 id/slug、非法 YAML、raw HTML、危险 URL、缺 asset、路径攻击；
- 一个基础 universal theme；
- public/theme asset 各至少 2 个；
- expected routes、canonical JSON、DOM selectors、RSS、sitemap 和 manifest golden。

Golden update 必须单独 review，说明是需求变化还是 bug 修复，不能用批量更新隐藏差异。

## 6. 安全测试

`test:security` 至少覆盖：

- HTML5 reparse 后 DOM 中无未授权 script、inline executable script、event/style/srcdoc/危险 URL；仅允许 helper 生成的 JSON-LD script，与 manifest-backed `SafeAssetUrl` 生成的 self-hosted external script；generic SafeUrl/string/remote URL 传给 externalScript 必须拒绝；
- generic `html` 对 raw-text/comment/scriptx/stylex、大小写、跨多个模板静态片段、NUL/entity/SVG/MathML mXSS 变体 fail closed；不得用测试倒逼自研简化 tokenizer；
- JSON-LD `</script>`、`<!--`、`]]>`、U+2028/U+2029，以及最终标签间 UTF-8 bytes → SHA-256 → 标准 Base64 CSP source 的 golden/伪造拒绝；
- uppercase/mixed scheme、控制字符、协议相对 URL、srcset；
- sparse array、额外 array key、symbol、getter、Proxy、cycle、深度/大小限制；
- SQL injection、重复 JSON/headers、body 限额前置拒绝；
- auth timing 的统计 smoke（不宣称形式化 constant-time）；
- 管理 token 的 `hex:`/`b64u:` canonical decode/re-encode、32/128 raw-byte 边界，以及 31/129 bytes、padding、uppercase hex、非 canonical Base64 尾位、空白和未知前缀拒绝；
- path traversal、double decode、UNC/drive/device name、symlink/junction 与 replace race；
- site/content feed metadata 的 XML 1.0 invalid control、lone surrogate、U+FFFE/U+FFFF 拒绝；RSS/Sitemap exact element order、optional fields、English GMT date、escaping、LF/final-LF byte golden；
- secret fixture、日志/错误 redaction 和 Git history scan；
- 篡改 D1 HTML/hash/profile 的 fail-closed 行为。
- payload_bytes 欺骗、缺/删 state singleton、row/source/body 边界和 ledger 超限的 fail-closed 行为；
- revision asset refs 篡改/超过 100 项、候选部署删除 URL 的 current asset closure 阻断，以及同 URL bytes/hash 变化允许部署的回归。

所有安全 bug 都必须先有可失败的最小回归，再修复；不允许只加字符串黑名单。

## 7. D1 原子性故障注入

publish/unpublish 逐点模拟：认证后、编译后、deployment trigger、revision insert 前/后、pointer update 前/后、version bump、idempotency response 写入和 batch 返回丢失。

不变量：

- CAS 失败没有新 pointer/version；
- batch 内任一步失败，revision/pointer/version/idempotency 全部回滚；
- 客户端没收到响应但 server 已提交时，相同 key/body 重试返回已保存响应；
- 同 key/different hash 为 409；
- unpublish 后 re-publish 相同 artifact 恢复 pointer 并 bump version，不被误判成 published no-op。
- active deployment fence 下新 mutation 全部零写；同 key 已保存 replay 不运行 mutation gate。

## 8. 确定性

`test:determinism` 在两个不同绝对根目录复制 fixture，改变 mtime、文件创建顺序、process timezone 和目录枚举顺序，以同一 `asOf` 构建。比较：

- route/file 列表；
- 所有 output bytes/hash；
- canonical JSON、source/artifact/input hash；
- RSS/sitemap；
- manifest（排除其本机存放位置）。

系统时钟、随机值或绝对 path 进入产物即失败。

## 9. 跨运行时 DOM 比较

使用 HTML5 parser 解析，不用正则。固定 selectors：`html[lang]`、head title/canonical/description/OG、nav links、main article/list、time、tags、JSON-LD canonical JSON、asset URLs。只允许排除 HTTP header/request id/ETag；不能排除业务 DOM。

RSS/sitemap 按 XML namespace-aware parser 比较节点和值，同时保留另一个 byte-determinism 测试。

## 10. 覆盖率和静态门

- `@mallok/core`：lines/statements/functions ≥ 90%，branches ≥ 85%；
- 其他包：lines/statements/functions ≥ 85%，branches ≥ 80%；
- auth、CAS、row codec、path boundary、HTML/URL helper 关键模块 branches ≥ 90%；
- TypeScript strict，无未说明 `any`、`@ts-ignore`；
- lint/typecheck/test/build 都必须独立退出 0。

覆盖率阈值写在根配置和本文件，不从临时 prompt 读取。

## 11. 性能与可访问性

工程基线机器：Apple M2、8 CPU、16 GiB、Node 22.22.2，warm pnpm store，fixture 1000 篇每篇 10 KiB Markdown、100 个总资源 10 MiB，重复 5 次取中位数：

- clean static build 目标 ≤ 10 秒；
- 单文章编译 p95 ≤ 50 ms；
- local Worker 已预热文章响应 p95 ≤ 100 ms（不代表公网）；
- peak RSS 目标 ≤ 512 MiB。

官方 theme 用 axe-core + keyboard/manual landmarks 检查 WCAG 2.2 AA 目标。Lighthouse 分数只作观测，不作为任意用户内容的保证。

## 12. Pack 与依赖

T-001 的 `pack:check:core` 在临时目录只执行下列第 1～4 项且目标仅为 `@mallok/core`。T-012 的完整 `pack:check` 在临时目录：

1. `pnpm pack` 各发布包；
2. 检查 packlist 无源码 secret/测试/`.tsbuildinfo`；
3. 安装 tarball；
4. Node ESM import 与 TypeScript consumer 编译；
5. 运行 `mallok --version/help`；
6. 禁止通过 workspace symlink 假通过。

license check 输出 direct/transitive licenses；不兼容或未知 license 阻止发布。

## 13. 证据格式

每次 phase verification 保存 `.mallok/evidence/<task>/<sha>.json`（gitignore）及脱敏摘要到任务报告：

```json
{
  "schemaVersion": "1",
  "task": "T-003",
  "sha": "<git-sha>",
  "environment": {"node":"22.22.2","pnpm":"11.1.3","os":"darwin-arm64"},
  "commands": [{"command":"pnpm test:cross-runtime","exitCode":0,"durationMs":1234}],
  "verifiedAt": "2026-08-27T00:00:00.000Z"
}
```

未实际运行的命令标记 `NOT_RUN`，不能根据另一个实现者的文字声称 `VERIFIED`。

T-012 是 release candidate 的特殊闭合格式：文件固定为 `.mallok/evidence/T-012/<candidate-sha>.json`，包含 `status:"accepted"`、全部 gate/artifact hash、实际 network origins、经人工审核的 `cloudflareApiOrigins` 与 reviewer，并且不包含自身 digest；字段和不可覆盖规则以 `tasks/T-012.md` 第 7.1 节为准。T-013 只对该文件 exact bytes 计算 hash，不能解析后重写。
