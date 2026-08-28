# Mallok 0.1 Cloudflare 数据发布契约

- 状态：Proposed 0.1 provider contract；公共 OAuth client、scope、desktop callback 和 `workers.dev` 实测通过后才能转为 Accepted
- Runtime protocol：`1`
- Bundle format：`1`

Cloudflare 是 canonical `PublishBundle` 的一个 sink，不是第二个渲染 runtime。首次 provision 安装 generic Worker、D1 和 R2；后续 publish 只上传 bundle 数据。Worker 不读取项目文件、不解析 Markdown、不执行模板，也不包含站点专用代码。

## 1. 资源与 binding

每个站点在用户自己的 Cloudflare account 中拥有一组独占资源：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `MALLOK_DB` | D1 binding | bundle manifest、预渲染 route body、current pointer |
| `MALLOK_BLOBS` | R2 binding | 内容寻址 asset |
| `MALLOK_SITE_ID` | plain Worker var | 固定 project `siteId` |
| `MALLOK_SITE_PUBLISH_TOKEN` | Worker secret | 只授权本网站 bundle publish API |

0.1 不使用 Pages、KV、Durable Objects、Queues、R2 public bucket、custom Worker code 或多租户 Mallok control plane。所有公开 bytes 经 generic Worker 返回。

资源名由 `siteId` 的稳定短摘要构成，但名字不证明 ownership。若同名资源已经存在，provision 必须停止；只有显式 `cloudflare connect` 在核对 account、binding、site id、runtime protocol 后才能采用。

## 2. Generic Worker

Worker binary/JavaScript、D1 schema 和 capability contract 嵌入 Mallok executable。首次 provision 上传一次；普通 publish 永不上传或激活 Worker version。

公共读取：

```text
GET|HEAD /assets/<64-lower-hex>.<allowed-ext>
  -> validate exact path
  -> exact D1 lookup proves key was activated into mallok_public_asset
  -> R2 GET assets/<hash>.<ext>
  -> immutable response or 404

GET|HEAD <other-canonical-path>
  -> one D1 statement joins mallok_site.current_bundle_hash to mallok_route
  -> return stored status/content-type/body/ETag
  -> missing: return current bundle /404.html body with status 404
```

除管理 publish prefix 外只接受 GET/HEAD；其他 method 返回 405。Worker 对 page body 不做 interpolation、sanitize、HTML rewrite、feed generation 或 asset discovery。

route response 使用 stored `body_sha256` 生成强 ETag，默认 `Cache-Control: public, max-age=0, must-revalidate`。内容寻址 asset 使用 `public, max-age=31536000, immutable` 和固定 `nosniff`。0.1 不承诺特定 CDN 全网刷新秒数。

## 3. D1 数据模型

0.1 只有站点 bundle snapshot，不保存 document、Markdown、content revision、idempotency response 或 provider-call journal。

```sql
CREATE TABLE mallok_site (
  site_id TEXT PRIMARY KEY,
  provision_id TEXT NOT NULL UNIQUE,
  current_bundle_hash TEXT,
  previous_bundle_hash TEXT,
  runtime_schema_version INTEGER NOT NULL CHECK (runtime_schema_version = 1),
  updated_at TEXT NOT NULL
);

CREATE TABLE mallok_bundle (
  site_id TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('staging', 'ready')),
  manifest_json TEXT NOT NULL,
  route_count INTEGER NOT NULL,
  asset_count INTEGER NOT NULL,
  total_route_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  PRIMARY KEY (site_id, bundle_hash),
  FOREIGN KEY (site_id) REFERENCES mallok_site(site_id)
);

CREATE TABLE mallok_bundle_asset (
  site_id TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  verified_at TEXT,
  PRIMARY KEY (site_id, bundle_hash, asset_key),
  FOREIGN KEY (site_id, bundle_hash)
    REFERENCES mallok_bundle(site_id, bundle_hash)
    ON DELETE CASCADE
);

CREATE TABLE mallok_public_asset (
  site_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  first_activated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, asset_key),
  FOREIGN KEY (site_id) REFERENCES mallok_site(site_id)
);

CREATE TABLE mallok_route (
  site_id TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL CHECK (status IN (200, 404)),
  content_type TEXT NOT NULL,
  cache_policy TEXT NOT NULL CHECK (cache_policy IN ('page', 'feed', 'not-found')),
  body_sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  body BLOB,
  PRIMARY KEY (site_id, bundle_hash, path),
  FOREIGN KEY (site_id, bundle_hash)
    REFERENCES mallok_bundle(site_id, bundle_hash)
    ON DELETE CASCADE
);
```

实现必须额外约束 canonical UUID/hash/time/path、manifest canonical JSON、body UTF-8 与 `length(body)=bytes`。`body` 在 staging manifest 创建时为空，上传成功后只允许从 NULL 填为匹配 hash 的 bytes；相同 bytes 重传 no-op，不允许覆盖为不同值。

finalize request 携带客户端开始发布时观察到的 `expectedCurrentBundleHash`，它是 activate 时唯一的并发 guard，但不属于 canonical bundle 或持久化 bundle identity。0.1 没有 document CAS、lease、heartbeat、deployment fence 或长事务。

预算：最多 2,000 routes；单 route body 512 KiB；全部 route body 32 MiB；单 asset 25 MiB；项目 media 最多 900；每 bundle 总 asset 最多 1,000；canonical manifest 最多 1,048,576 UTF-8 bytes；单 route/asset logical path 最多 512 UTF-8 bytes。超限在本地 compile 和 Worker publish 两端都拒绝。publish API 单次最多处理 32 个 route/asset item，大 bundle 必须分块；不得在一次 Worker invocation 中对 1,000 个 R2 key 做 HEAD。

## 4. R2 asset 模型

R2 key 与公开 URL 固定为 `assets/<sha256>.<canonical-extension>`。0.1 extension/MIME 只允许 `css`、`png`、`jpg`、`webp`、`avif`、`gif`、`woff2` 及 [ARCHITECTURE.md](ARCHITECTURE.md) 的精确映射。上传端和 Worker 都计算/校验 SHA-256、bytes 和 MIME allowlist。

- 新 object 只能用 R2 conditional create 写入：`onlyIf` 语义必须等价于 `If-None-Match: *`，PUT 同时携带 exact SHA-256 checksum 和 canonical `Content-Type`；禁止先 HEAD 再无条件 PUT；
- conditional create 成功后，以返回值或一次 HEAD 复核 `checksums.sha256`、`size` 和 `httpMetadata.contentType`，全部相同才可把 D1 asset row 标为 verified；
- precondition failed、timeout 或响应未知时只做 HEAD：key 已存在且 checksum/bytes/MIME 全同即成功 no-op；缺失则安全重试 conditional create；任一 metadata 缺失或不同返回 `ASSET_HASH_COLLISION_OR_CORRUPTION`；
- 上传中断：重传相同 key；
- public GET 不接受 query 改变 asset identity；
- 0.1 不自动删除 R2 object。

不自动 GC 是有意边界：内容寻址 object 不变且可被旧缓存页面引用，保留它们可以删除 asset closure fence、危险远程 delete 和回滚竞态。0.1 把 Mallok bucket 的 `assets/` prefix 视为 append-only 运维前提：provision/connect 必须检查并拒绝会自动删除该 prefix 的 lifecycle rule，界面明确提示不要手工删除。D1 pointer 切换是原子的，R2 与 D1 不是跨服务事务；若 health 发现 current bundle 的 asset 缺失，修复路径是从本地 hash 已复核 bundle 重新上传 exact key，不改 pointer。未来 GC 必须先扫描所有保留 bundle 和明确 retention，再单独授权。

## 5. 一次性 provision

Studio 的“连接并发布”用例是唯一会调用 account-level Cloudflare API 的常规 0.1 路径；高级 CLI 可调用同一用例：

1. 读取并验证 project/siteId；
2. 在系统浏览器启动 Cloudflare Authorization Code + PKCE S256，用户选择 account 并同意最小 scopes；
3. 读取 account plan/limits，检查 `workers.dev` account subdomain 和 Mallok bucket lifecycle。若 account 还没有 subdomain，Studio 用普通语言要求用户选择可用名称、展示会影响该 account 的公开地址并确认；不把用户赶到 Dashboard；
4. 在任何 create 前生成 `provisionId` 和 `.mallok/provision.json` intent；准备 32-byte CSPRNG site publish token：有 OS credential store 时先安全保存；没有时要求高级操作者预先通过 `MALLOK_SITE_PUBLISH_TOKEN` 环境提供，绝不生成一个无法恢复的 token；
5. 创建 D1，立即原子写 receipt，应用 schema 并插入唯一 `mallok_site(site_id, provision_id)` row；
6. 创建 private R2 bucket，立即原子写 receipt，再写入内容固定的 `_mallok/ownership-v1.json` marker；
7. 上传 embedded generic Worker，绑定 D1/R2/site id/provision id，立即原子写 receipt；
8. 写入 Worker secret，显式启用该 script 的 `workers.dev` subdomain；
9. 调用 capability/health 与匿名公开 GET，确认 runtime/schema/site/provision id 和 origin；
10. 把非敏感 resource id、Worker origin、protocol 写入 `.mallok/state.json`，将 receipt 标记为 complete。

每步完成后才进入下一步。部分失败不自动删除已创建资源；命令输出已完成步骤和安全重试方式。重跑只能复用 receipt 中 account/site/provision/resource id 与 D1 row、R2 marker、Worker var/binding 全部一致的资源；不能按名字接管未知对象。receipt 是为创建崩溃恢复的有限记录，不扩展成通用 provider-call journal 或部署状态机。

OAuth account credential 不用于后续 bundle publish，用户可在 provision 后从 Cloudflare 撤销授权。resource 删除、DNS、custom domain 和 account billing 不属于 Mallok 0.1 自动化。

## 6. Bundle publish API

管理 prefix 固定为 `/__mallok/publish/v1/`，所有响应 `Cache-Control: no-store`。它使用 site publish token，不接受 Cloudflare account token。

协议阶段：

### 6.1 Capability 与 base

binary 先读取 capability/status，核对 `siteId`、runtime protocol、bundle format、预算和 current bundle hash。任何不兼容在上传前失败。

### 6.2 D1 staging manifest

binary 提交 canonical manifest 和 `bundleHash`。Worker 验证：

- manifest hash、siteId、format、origin、排序和预算；
- 每个 route path/status/content type/body hash；
- 每个 asset key 与 manifest/URL/hash 一致；此阶段不要求新 asset 已存在 R2；
- `/`、`/404.html`、RSS、root sitemap、robots 必需 route 存在且无冲突；root sitemap 为 index 时，manifest 中全部 `/sitemaps/<4-digit>.xml` shard 必须存在、同源、集合闭合且不含孤儿 shard。

随后分块创建或复用同 hash 的 `staging` bundle、body 为 NULL 的 route rows 和 `verified=0` 的 asset rows。相同 bundle/manifest 重传 no-op；相同 hash 不同 manifest fail closed。每次 API 最多接受 32 项，客户端根据 status 补齐未完成分块。

### 6.3 Asset ensure

binary 以最多 32 个 item 的分块请求处理 asset。每项必须先存在于已校验 manifest，并严格执行 §4 的 conditional create/HEAD 协议；无论 object 原先存在、刚创建还是 PUT 结果未知，都只有在 checksum/bytes/MIME 被复核后才将对应 `mallok_bundle_asset.verified` 置 1。任一项失败不修改 current pointer，重试只处理未 verified 项。

### 6.4 Route body upload

每个 body PUT 到 exact bundle/path。Worker 在写 D1 前验证长度、SHA-256、UTF-8（文本类型）和 manifest metadata。已存在相同 body no-op；不同 body 拒绝。

### 6.5 Atomic activate

finalize request 另携带本次操作开始时观察到的 `expectedCurrentBundleHash`。Worker 不在 finalize 中对全部 R2 key 再做一次 HEAD；它使用 staging 阶段已分块写入的 verified rows，并依赖 0.1 append-only asset 前提。D1 执行一个有序 transactional batch：

1. 一条条件 `UPDATE mallok_bundle ... SET state='ready'` 只在 route count 精确、所有 route body 非 NULL 且 bytes/hash 匹配、asset count 精确且没有 `verified=0` row 时命中；它不写 `activated_at`；
2. 一条条件 `UPDATE mallok_site` 只在目标 bundle 已 `ready`、`(current_bundle_hash IS :expected OR current_bundle_hash IS :target)`，且 target asset 与任何既有 `mallok_public_asset` 同 key metadata 无冲突时切换 pointer。首次切换把旧 current 写入 `previous_bundle_hash`；current 已是 target 的重放保持 previous 不变。SQLite `IS` 是本协议要求的 NULL-safe 比较，首次发布的 expected 为 `NULL`；
3. 只有在 site current 已是 target 时，后续语句才写 bundle `activated_at`，并把 target 的 verified asset metadata 以 immutable insert 写入 `mallok_public_asset`。同 transaction 中的 pointer guard 已再次证明既有同 key metadata 完全一致，因此 `ON CONFLICT DO NOTHING` 只表示 exact no-op，不能掩盖冲突；
4. Worker 检查全部 statement 的 result/`rows_written`。完整性未命中返回 `BUNDLE_INCOMPLETE`；pointer 未命中且 current 不是 target 返回 `PUBLISH_BASE_CHANGED`；current 已是 target 是响应丢失重试的成功 no-op。

候选 bundle 在 base conflict 时可留为完整 `ready` 但不是 current；它不对访客可见。真正的访客原子性由单条条件 pointer `UPDATE` 提供，不依赖 Worker JavaScript 在 SELECT 与 UPDATE 之间保持交互式事务。Task 03 必须在锁定的 D1 版本上验证 `IS`、batch 回滚和 result metadata 的实际行为。

v1 条件语句形状冻结如下（实现可以只改 placeholder 语法和显式 alias，不能拆成 JS `SELECT → 判断 → 无条件 UPDATE`）：

```sql
UPDATE mallok_bundle AS b
SET state = 'ready'
WHERE b.site_id = :site
  AND b.bundle_hash = :target
  AND b.state IN ('staging', 'ready')
  AND b.route_count = (
    SELECT COUNT(*) FROM mallok_route r
    WHERE r.site_id = b.site_id AND r.bundle_hash = b.bundle_hash
  )
  AND NOT EXISTS (
    SELECT 1 FROM mallok_route r
    WHERE r.site_id = b.site_id AND r.bundle_hash = b.bundle_hash
      AND (r.body IS NULL OR length(r.body) <> r.bytes)
  )
  AND b.asset_count = (
    SELECT COUNT(*) FROM mallok_bundle_asset a
    WHERE a.site_id = b.site_id AND a.bundle_hash = b.bundle_hash
  )
  AND NOT EXISTS (
    SELECT 1 FROM mallok_bundle_asset a
    WHERE a.site_id = b.site_id AND a.bundle_hash = b.bundle_hash
      AND a.verified <> 1
  );

UPDATE mallok_site AS s
SET previous_bundle_hash = CASE
      WHEN s.current_bundle_hash IS :target THEN s.previous_bundle_hash
      ELSE s.current_bundle_hash
    END,
    current_bundle_hash = :target,
    updated_at = CASE
      WHEN s.current_bundle_hash IS :target THEN s.updated_at
      ELSE :now
    END
WHERE s.site_id = :site
  AND (s.current_bundle_hash IS :expected OR s.current_bundle_hash IS :target)
  AND EXISTS (
    SELECT 1 FROM mallok_bundle b
    WHERE b.site_id = s.site_id
      AND b.bundle_hash = :target
      AND b.state = 'ready'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM mallok_bundle_asset a
    JOIN mallok_public_asset p
      ON p.site_id = a.site_id
     AND p.asset_key = a.asset_key
    WHERE a.site_id = s.site_id
      AND a.bundle_hash = :target
      AND (
        p.sha256 <> a.sha256
        OR p.bytes <> a.bytes
        OR p.content_type <> a.content_type
      )
  )
RETURNING current_bundle_hash, previous_bundle_hash;

UPDATE mallok_bundle AS b
SET activated_at = COALESCE(b.activated_at, :now)
WHERE b.site_id = :site
  AND b.bundle_hash = :target
  AND EXISTS (
    SELECT 1 FROM mallok_site s
    WHERE s.site_id = b.site_id
      AND s.current_bundle_hash IS :target
  );

INSERT INTO mallok_public_asset (
  site_id, asset_key, sha256, bytes, content_type, first_activated_at
)
SELECT a.site_id, a.asset_key, a.sha256, a.bytes, a.content_type, :now
FROM mallok_bundle_asset a
JOIN mallok_site s ON s.site_id = a.site_id
WHERE a.site_id = :site
  AND a.bundle_hash = :target
  AND a.verified = 1
  AND s.current_bundle_hash IS :target
ON CONFLICT(site_id, asset_key) DO NOTHING;
```

manifest/body/asset row 在 staging 后是不可变的；除了把 NULL body 补成已验证 bytes、把 asset `verified` 从 0 设为 1 和改变 bundle state/首次 activated time 外不得 UPDATE。`mallok_public_asset` 只允许 exact insert，不允许覆盖。asset ensure 与 pointer 条件 UPDATE 都必须把同 key 的既有 public metadata 纳入 hash/bytes/MIME 一致性校验，前者给出早期错误，后者关闭 ensure→finalize 之间的竞态。因此 SQL 无需在 finalize 中重算 R2 bytes 的 SHA-256；hash 已由 conditional R2 write/HEAD、verified row 和不可变 metadata 绑定。

guard 不匹配返回 `PUBLISH_BASE_CHANGED`，不会切换 current。客户端重新读取 current、向用户展示竞争结果，再决定是否基于新 current 重试；不得静默 last-write-wins。

若 current 已等于目标 bundleHash，finalize 返回成功 no-op。没有 request journal：asset key、bundle hash、route primary key 和原子 current pointer本身提供重试幂等性。

## 7. 故障恢复

| 故障点 | 可观察事实 | 恢复 |
| --- | --- | --- |
| asset upload 前/中断 | key 缺失或完整存在 | 重传相同 hash |
| staging manifest 中断 | current 未改变 | 重提相同 manifest |
| 部分 route 上传 | NULL body 仍存在 | 只补缺失 route |
| finalize 前进程退出 | current 仍为 base | 重做 finalize |
| finalize response 丢失 | status current 可能是新 hash | 查询；相同即成功，否则重试 |
| base 被另一 publish 改变 | guard 失败 | 重新读取并要求用户决定 |
| `.mallok/state.json` 丢失 | 远端仍有 siteId/capability | 重新授权 Cloudflare 后执行 `connect` 重建非敏感 state |
| publish token 丢失 | 无法写 bundle | 重新授权 Cloudflare 后显式 rotate Worker secret；旧 token 失效 |

staging/ready-but-never-activated bundle 永不影响访客；R2 中提前上传的 object 只有在 finalize 把 metadata 写入 `mallok_public_asset` 后才可由 public route 读取。已公开 asset URL 在 0.1 不承诺撤回，unpublish 只移除页面引用。

0.1 不引入 cron，但 D1 staging 不是无界历史。`inactive bundle` 精确定义为 hash 同时不等于 `mallok_site.current_bundle_hash` 与 `previous_bundle_hash` 的 bundle；target 在 activate 前也属于 inactive。硬上限为每站点最多 `8` 个 inactive bundle、其 `total_route_bytes` 合计最多 `67,108,864` bytes。创建一个新的 distinct staging target 前，Worker 先把候选 count/route bytes 纳入预算；重提已经存在的同 hash target 不重复计数。超限且一次有界清理后仍不能容纳时，在写入新 bundle/route/asset row 前返回 `PUBLISH_STAGING_CAPACITY_EXCEEDED`，并给出当前 count/bytes 与最早可清理时间；不得部分创建第 9 个候选。

机会式清理只在已鉴权 status/publish 请求中运行，每个请求至多删除一个完整 bundle：

- `staging` 且 `created_at` 已满 24 小时；
- 从未 activate 的 `ready` 且 `created_at` 已满 7 天；
- 曾 activate 但已退出 current/previous 的更旧 `ready`，立即可清理，因为 0.1 的远端恢复承诺恰好是 current + previous。

候选按上述资格时间、`created_at`、`bundle_hash` 稳定排序取最早一项。删除语句必须在同一语句再次证明目标不是 current、previous 或本次 target，然后删除整个 `mallok_bundle` row，依靠 cascade 一起删除 route 和 asset-verification rows；不得只删 route、不得删除 R2 object 或 `mallok_public_asset`。finalize 在 pointer UPDATE 前还要计算切换后的 prospective inactive count/route bytes（target 离开 inactive、旧 previous 进入 inactive）；必要时按同一规则最多清理一个既有 eligible bundle，仍超限就返回同一容量错误且 pointer 不变。远端始终完整保留 current 和紧邻 previous；更旧 bundle 不是用户可浏览的 revision history。恢复上一版本时，客户端仍从本地 hash 已复核的 canonical bundle 发起发布；远端若已完整保留则 no-op/activate，若已整组清理则重新 staging/upload。

## 8. Credential

### 8.1 Cloudflare OAuth grant

- 默认 Studio 使用 Mallok 的公共 Cloudflare OAuth client、Authorization Code flow 和 PKCE S256；desktop/public client 不嵌入 client secret；
- OAuth publisher domain 必须是经验证的 `mallok.dev`，client visibility、client ID、exact redirect URI 和 scope IDs 作为签名发行 metadata 嵌入；
- 每次授权生成新的 `state`、PKCE verifier/challenge；callback 必须同时验证 exact redirect、state 和 code，且只由本次 loopback Studio 进程接收；
- access/refresh credential 只进入 OS credential store 与 backend 内存，用于 provision、connect、credential rotate 和显式 runtime upgrade；Studio 浏览器只看到“已连接”的账户摘要；
- 用户可以在 Cloudflare 撤销授权；授权失效只阻止 account-level 操作，不影响已部署站点和已有 site publish token；
- exact OAuth scopes/redirect 必须在 Task 03 provider spike 中用真实公共 client 验证。若 Cloudflare 不接受选定 desktop callback，Task 03 阻断并修改协议；不得把复制 raw token 当作新手回退；
- 高级 CI 可以从 `MALLOK_CLOUDFLARE_API_TOKEN` 环境提供最小 scoped API token，但该路径不属于 Studio 或易用性验收；禁止 Global API Key；
- OAuth/API credential 不写 project、`.mallok`、browser storage、argv、log 或 crash report。

### 8.2 Site publish token

- 32-byte CSPRNG，base64url 无 padding canonical encoding；
- server 只存 Worker secret；
- client 优先存 OS credential store，key 为 `siteId + Worker origin`；平台无 credential store 时必须由 `MALLOK_SITE_PUBLISH_TOKEN` 环境提供，不回退到 plaintext project file；
- Studio browser 不能读取 token；loopback backend 只返回 publish plan/result；
- 比较使用固定长度 digest 和 constant-time compare；
- token 只授权该 site 的 bundle staging/activate/status，不授权 account API、resource delete、DNS 或 Worker code upload。

## 9. Public request 安全

- raw path 在 decode 前拒绝 malformed percent、encoded slash/backslash、NUL/control 和 dot segment；只 decode 一次；
- route lookup 使用 prepared statement 和 exact normalized path；不拼 SQL；
- asset path必须匹配 exact hash+extension grammar；只有 `mallok_public_asset` 中存在的已激活 key 才进入 R2 GET，R2 metadata MIME 必须与 registry 和 extension allowlist一致；
- public endpoint 无 CORS、目录列表、source map、Markdown 或 manifest debug 输出；
- HTML 响应固定发送 `Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`、`X-Content-Type-Options: nosniff` 和 `Referrer-Policy: strict-origin-when-cross-origin`；feed/asset 也发送 `nosniff`；
- HEAD 与 GET header相同且无 body；
- D1/R2 error 返回稳定 503/404，不泄露 SQL、bucket/database id；
- publish endpoint auth 在读取大 body 前完成，并实施单请求/总 bundle预算。

publish 后 public smoke 至少读取 homepage、一个 page、一个 article、404、robots、root sitemap、所有 sitemap shard 和一个受管图片：验证 status/content type/cache/CSP/nosniff、canonical origin、sitemap 与 HTML canonical 集合、robots sitemap URL、asset bytes/hash，并保存给 Task 05 PageSpeed/SEO runner 使用的实际公开 URL。smoke 证明协议闭合，不代替 Search Console 收录或 PSI/CrUX 证据。

## 10. Runtime upgrade

generic Worker 或 D1 schema 升级只能用用户明确确认的 `upgradeCloudflareRuntime` application use case：先读取 capability、展示目标/影响，验证当前 bundle 仍被新 runtime 支持，再执行向前兼容 migration 和 Worker 替换。Studio 在“发布 → 网站托管”提供该动作，高级 CLI 的 `mallok cloudflare upgrade` 调用同一 use case。升级失败不得改变 current bundle。

普通 `publish` 遇到 protocol不兼容只报告 `CLOUDFLARE_RUNTIME_UPGRADE_REQUIRED`，绝不顺手升级。0.1 不自动 downgrade；升级前需保留旧 Worker release id和D1备份/导出指引，但不引入 Mallok 自建 deployment fence或provider-call journal。

## 11. 外部能力依据

- Cloudflare 官方支持第三方 OAuth 2.0 Authorization Code flow，并为 browser/mobile/desktop/CLI public client 指定 PKCE S256、无需 client secret：[Create your OAuth client](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)。
- 用户可以在授权页选择 account、查看 scopes，并在 Cloudflare 中撤销授权：[Authorizing an application](https://developers.cloudflare.com/fundamentals/oauth/authorizing-an-application/)。
- D1 `batch()` 按顺序执行语句，失败时回滚整批，是 0.1 atomic activate 实现必须验证的候选机制：[D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)。
- D1 单 row/string/BLOB 上限为 2,000,000 bytes，Free 计划每 Worker invocation 的 D1 查询数也有更低上限：[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)。
- Workers Free 计划每 invocation 的 external/internal-service subrequest 有界，因此 publish 必须分块：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。
- R2 Workers API 支持 conditional `put`、checksums、HEAD/object metadata，是 §4 create-only 与复核协议的候选能力：[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。
- Worker script 要在 `workers.dev` 公开可访问，必须有 account subdomain 并显式启用 script subdomain：[Worker subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/)。

这些链接证明平台提供相关能力，不证明 Mallok 已实现或已通过 staging；Task 03/04 仍必须用锁定版本和真实账号验证。
