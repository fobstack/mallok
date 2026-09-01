# Mallok 站点在 Cloudflare 里的资源规划

- 状态：0.1 基线
- 日期：2026-08-28
- 地位：回答「一个 Mallok 站点在 Cloudflare 账号里到底有哪些东西、叫什么名字、谁在什么时候建、怎么备份和删除」。`mallok create`、Deploy 按钮和首次启动向导都必须按本文执行，不得各自发明命名或建资源的顺序。

## 1. 一句话原则

**一个站点 = 一组自己的资源（Worker、D1、R2、域名、Cron、Turnstile、密钥），站点之间不共享任何资源，只共享账号的配额。** 站点可以被完整地备份、导出、删除，不影响同账号里的其他站点。

## 2. 账号拓扑

| 账号 | 里面放什么 | 计划 | 说明 |
| --- | --- | --- | --- |
| 产品负责人的站群账号 | 自己运营的全部外贸站 | Workers Paid（5 美元/月） | 免费配额是账号级共用的，多个站互相挤；Paid 后请求按月池化，数量不再是瓶颈 |
| 每个客户自己的账号 | 该客户的一个或几个站 | Free 起步 | 这就是产品模型：Mallok 不托管，客户的站在客户的账号里，天然隔离 |
| Mallok 官网账号 | 官网（自己跑在 Mallok 上）、文档、Deploy 按钮的源仓库 | Free 或 Paid | 与站群分开，避免官网流量和站群共用配额 |

一个账号能装几个站，由下面这些**账号级**上限决定（官方文档，2026-08-28 核对）：

| 上限 | Free | Paid | 对站点数量的含义 |
| --- | --- | --- | --- |
| Worker 请求 | 10 万/天，**全账号共用**，超出返回 1027 | 1000 万/月共用，超出 0.3 美元/百万 | Free 下一个站被扫会拖垮其他站 |
| Cron Triggers | 5/账号 | 250/账号 | 每站 1 个 → Free 最多 **5 个站** |
| D1 数据库数 | 10/账号，单库 500 MB，总 5 GB | 50,000/账号，单库 10 GB | Free 最多 10 个站 |
| Turnstile widget | 20/账号 | 企业版不限 | 每站 1 个 → 20 个站 |
| Worker 数 | 100/账号 | 500/账号 | 不构成瓶颈 |
| R2 | 10 GB-月/账号免费 | 之后 0.015 美元/GB-月 | 图片多的站群早于其他项触顶 |

结论：**Free 账号规划 5 个站以内**（Cron 是第一个触顶的），超过就升 Paid；Paid 账号的瓶颈是流量与存储，不是数量。

## 3. 一个站点的资源清单

以站点 slug `titaniumseller`、域名 `titaniumseller.com` 为例：

| 资源 | 名称 | 绑定名 / 位置 | 谁创建 | 备注 |
| --- | --- | --- | --- | --- |
| Worker | `mallok-titaniumseller` | — | CLI / Deploy 按钮 | 一个 Worker 承担公开站、后台、API、cron |
| Static Assets | 随 Worker 上传，目录 `dist/assets/` | `ASSETS` | 构建产物 | 后台 SPA 在 `_mallok/app/`，主题资源在 `theme/<id>/<version>/`；请求免费不计入 |
| D1 | `mallok-titaniumseller-db` | `DB` | CLI / Deploy 按钮 | 内容、片段缓存、询盘等全部表 |
| R2 桶 | `mallok-titaniumseller-media` | `MEDIA` | CLI / Deploy 按钮 | 媒体与主题静态资源 |
| R2 自定义域 | `media.titaniumseller.com` | — | CLI（OAuth）或向导（token） | 图片直出，不经 Worker；未配置时退回 `/media/*` 代理 |
| Worker 自定义域 | `titaniumseller.com`、`www.titaniumseller.com` | wrangler `routes[].custom_domain: true` | CLI / 向导 | Cloudflare 自动建 DNS 记录与证书；目标主机名不能已有 CNAME |
| Cron Trigger | `* * * * *` | wrangler `triggers.crons` | 随 Worker 部署 | 每站只此一个 |
| 限流绑定 | 命名空间 id 每站唯一 | `RATE_LIMITER` | 随 Worker 部署 | 询盘等插件路由防刷 |
| Turnstile widget | `mallok-titaniumseller` | 站点密钥存 `plugin_state` | CLI（OAuth）或用户在仪表盘创建后粘贴 | 主机名填 `titaniumseller.com`、`www.titaniumseller.com` |
| Worker secret | `MALLOK_SECRET` | secret | CLI 生成；按钮路径见 §7 | 随机 32 字节，签发 session、加密第三方密钥、签名预览链接 |
| Worker secret | `CF_API_TOKEN` | secret | 用户在仪表盘创建后由 CLI/向导写入 | Zone 级：Cache Purge、DNS 编辑；账号级：R2 编辑（仅用于挂自定义域） |
| Worker secret | `CF_ZONE_ID` | secret | CLI / 向导 | 绑定域名后写入 |
| Worker vars | `MALLOK_SITE=titaniumseller` | `vars` | 配置文件 | 只放非敏感值 |
| DNS 记录 | `@`、`www` → Worker；`media` → R2；`resend._domainkey` TXT、`send` MX/TXT、`_dmarc` TXT | zone | 前两项自动；邮件三项由向导写入 | 域名的 nameserver 必须托管在 Cloudflare |
| 可观测 | Workers Logs | wrangler `observability.enabled` | 配置文件 | 免费额度需核实，见 §11 |

不建的东西：KV、Queues、Durable Objects、Cloudflare Images、Pages 项目、第二个 Worker。

## 4. 命名规范

- **slug**：`[a-z0-9-]`，3–30 字符，不以 `-` 开头结尾；默认取域名去掉 TLD（`titaniumseller.com` → `titaniumseller`），冲突时用户改。**slug 创建后不改**，它出现在所有资源名里。
- 所有资源名以 `mallok-` 为前缀，后缀固定：Worker 无后缀，D1 `-db`，R2 `-media`，Turnstile 同 Worker 名。这样在仪表盘里搜 `mallok-` 能一眼看全，也不会和账号里别的东西撞名。
- 绑定名固定为 `DB`、`MEDIA`、`ASSETS`、`RATE_LIMITER`，代码只认绑定名，从不引用资源名或 id。
- 限流命名空间 id：`1000 + 站点在登记表中的序号`，保证账号内唯一。
- 媒体子域固定用 `media.<域名>`；用户要改必须在向导里显式改，改后 `site.media_base_url` 同步。

## 5. wrangler 配置模板

每个站点一份配置文件，由 `mallok create` 生成到 `.mallok/sites/<slug>.jsonc`（已在 `.gitignore`），部署时 `wrangler deploy -c .mallok/sites/<slug>.jsonc`：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "mallok-titaniumseller",
  "main": "dist/worker/index.js",
  "compatibility_date": "2026-08-01",
  "workers_dev": true,                               // 保留作预览；缓存不在此生效
  "routes": [
    { "pattern": "titaniumseller.com", "custom_domain": true },
    { "pattern": "www.titaniumseller.com", "custom_domain": true }
  ],
  "assets": {
    "directory": "./dist/assets",                    // 内含 _mallok/app/**，命中即直接返回，不进 Worker
    "binding": "ASSETS",
    "not_found_handling": "none"                     // 未命中的一律交给 Worker
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "mallok-titaniumseller-db", "database_id": "<创建后填入>" }
  ],
  "r2_buckets": [
    { "binding": "MEDIA", "bucket_name": "mallok-titaniumseller-media" }
  ],
  "triggers": { "crons": ["* * * * *"] },
  "ratelimits": [
    { "name": "RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } }
  ],
  "vars": { "MALLOK_SITE": "titaniumseller" },
  "observability": { "enabled": true }
}
```

三条说明：静态资源目录放后台 SPA（`_mallok/app/**`）与主题资源（`theme/<id>/<version>/**`），这两个前缀都是保留的，内容类型不得拿它们当 base；`not_found_handling: "none"` 让未命中的请求落到 Worker，公开页面因此不受影响；`workers_dev` 保持开启是为了让向导在绑定域名前就能打开，绑定后可以在设置里关掉。

## 6. `mallok create` 的创建顺序

1. `wrangler login`（OAuth）。CLI 路径全程用 OAuth 身份，不要求用户手动创建 token。
2. 收集：slug、域名（可稍后）、默认语言、Starter。校验 slug 与账号内资源名不冲突。
3. 创建 D1 `mallok-<slug>-db`，取得 `database_id`。
4. 创建 R2 桶 `mallok-<slug>-media`。
5. 生成 `MALLOK_SECRET`（32 字节随机）。
6. 生成 `.mallok/sites/<slug>.jsonc`，把站点登记进 `.mallok/sites.json`（分配限流命名空间序号）。
7. 构建 Worker 与后台 SPA，`wrangler deploy`。
8. `wrangler secret put MALLOK_SECRET`。
9. 若给了域名：配置里已含 `custom_domain` 路由，部署时自动建 DNS 与证书；随后挂 R2 自定义域 `media.<域名>`；创建 Turnstile widget（主机名为该域名）并把密钥写入 D1；提示用户在仪表盘创建 `CF_API_TOKEN`（列出精确权限）后 `wrangler secret put`。
10. 打开 `https://mallok-<slug>.<账号>.workers.dev/_mallok/setup`（或域名），向导接手：管理员、公司信息、邮件、DNS 记录、Starter 应用。schema 迁移由 Worker 在第一次请求时自行执行，CLI 不跑迁移。

`CF_API_TOKEN` 未配置时站点照常工作，只是没有主动清缓存：向导把 `site.cache_ttl` 临时设为 60 秒，页面最多一分钟更新，并在后台显示「配置 token 后恢复即时生效」。这是诚实的降级，不是故障。

## 7. Deploy 按钮路径的差异

公开仓库根目录的 `wrangler.jsonc` 提供默认值：`name: mallok-site`、`mallok-site-db`、`mallok-site-media`、cron、限流、assets。官方文档要求「源仓库包含每个绑定的资源名与 id 默认值」，按钮会按这份配置自动创建 D1 与 R2 并接入 Workers Builds；用户在设置页可改 Worker 名与资源名。

> **2026-08-30 更正（已查官方文档）**：按钮流程**有**设置 secret 的入口。`package.json` 的 `cloudflare.bindings` 可以为每个绑定写一段 Markdown 说明，按钮在交互式部署时按此提示用户填写；同时它会自动识别并预填 `package.json` 里的 build 与 deploy 脚本（缺省 `npx wrangler deploy`）。本仓库已按此配置：`cloudflare.bindings` 里写了 `MALLOK_SECRET`（必填）、`CF_API_TOKEN` 与 `CF_ZONE_ID`（选填）的说明。按钮本身**不需要任何配置文件**，只要一个指向公开仓库的 URL。
>
> 下面两条退路仍然保留，因为用户可能跳过填写：`scripts/ensure-secret.mjs` 在 deploy 脚本里兜底生成一次（已存在则绝不轮换——轮换会让所有会话失效、已加密的插件密钥无法解密）。

原文（已过时）：`MALLOK_SECRET` 在此路径下按以下顺序解决，**具体可行性列入 spike**：

1. `package.json` 的 `deploy` 脚本在 Workers Builds 里执行：若 `wrangler secret list` 中没有 `MALLOK_SECRET`，生成一个并 `wrangler secret put`；已存在则不动，避免每次构建轮换导致会话与加密数据失效。
2. 若构建环境的权限不允许，Worker 首次启动时生成一个实例密钥存入 `site` 表并在后台明确提示「安全性低于 Worker secret，请在仪表盘 Variables and Secrets 里添加 `MALLOK_SECRET`」；添加后 Worker 自动切换并重新加密已存的第三方密钥。

其余差异：自定义域、R2 自定义域、Turnstile 在此路径下由向导用 `CF_API_TOKEN` 完成或给出仪表盘步骤；升级 Mallok 是在 GitHub 上同步 fork；安装第三方插件是改配置文件后自动构建。

## 8. 环境

0.1 只有两个环境：

- **本地**：`wrangler dev -c .mallok/sites/<slug>.jsonc --local`，D1 与 R2 用本地模拟，状态在 `.wrangler/`（已忽略）；cron 用 `--test-scheduled` 触发；`.dev.vars` 放本地 secret（已忽略）。
- **生产**：上面那一套资源。

不设 staging。需要试新版本时，用 `mallok create --slug <slug>-next` 建一个完整的第二个站，导入导出把内容搬过去；这比在同一套资源上做半个 staging 干净得多。`.workers.dev` 不是环境，它只是同一个生产 Worker 的无缓存入口。

## 9. 站群登记

`mallok create` 维护 `.mallok/sites.json`：

```json
{
  "sites": [
    { "slug": "titaniumseller", "domain": "titaniumseller.com", "account_id": "…", "database_id": "…", "ratelimit_ns": 1001, "created_at": "2026-08-28T05:00:00Z" }
  ]
}
```

站群建议放进一个**私有**仓库 `mallok-sites`，内容是 `sites.json` 与每站的 `wrangler.jsonc`、Starter 覆盖项、主题选项；**不放任何 secret**。产品仓库保持公开，站群仓库只引用产品仓库的版本号。这样「升级站群」就是改一个版本号、循环执行 `wrangler deploy`。

## 10. 备份与删除

**备份**（升级前必做，后台会提示）：后台或 CLI 一键导出（CONTENT_FORMAT §5，含内容、图片、询盘）；另加 `wrangler d1 export mallok-<slug>-db --output backup.sql` 做数据库级备份；R2 用 `wrangler r2 object get` 或 rclone 同步一份。导出目录就是一个能直接搬去别处的站，这是「不锁定」的落地。

**删除**按顺序，且每一步幂等：

1. 后台确认已导出；
2. 删除 Worker 自定义域与 R2 自定义域（否则域名被占着）；
3. 删除 Worker（cron、限流绑定随之消失）；
4. 删除 D1；
5. 清空并删除 R2 桶（非空桶删不掉）；
6. 删除 Turnstile widget；
7. 删除 `CF_API_TOKEN`（仪表盘）；
8. 清理向导写入的 DNS 记录（`media`、Resend 相关）；
9. 从 `.mallok/sites.json` 移除。

`mallok destroy <slug>` 按此顺序执行并在每步打印结果，任何一步失败停下来说明，不跳过。

## 11. 待验证

- Deploy 按钮路径下 Workers Builds 能否执行 `wrangler secret list/put`（§7 第 1 条）。
- 用 `CF_API_TOKEN` 挂 R2 自定义域所需的最小权限集。
- 限流绑定 `namespace_id` 是否要求账号内唯一（本文按唯一规划）。
- Workers Logs 在 Free 计划的免费额度与保留期。
- Turnstile widget 通过 API 创建所需的 token 权限（CLI 走 OAuth 时是否已覆盖）。
