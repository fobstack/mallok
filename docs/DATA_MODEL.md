# Mallok 0.1 数据模型（草案）

- 状态：0.1 草案。表与字段是合同，DDL 细节（类型选择、索引名）允许在 Task 01 spike 后调整，但调整必须先改本文。
- 日期：2026-08-28
- 约定：所有时间为 ISO 8601 UTC 文本；所有 JSON 列在读写边界用 zod 校验；所有 SQL 手写、参数化绑定，集中在 `src/db/`；不使用 ORM。

## 1. 表一览

| 表 | 行数量级 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| `site` | 1 | 后台、向导 | 每次冷渲染 |
| `content` | 10² – 10⁴ | 后台、CLI、cron | 每次冷渲染、列表 |
| `render_cache` | ≈ `content` | 保存路径、冷渲染补建 | 每次冷渲染 |
| `media` | 10² – 10⁵ | 上传、GC | 渲染（经 `assets`）、媒体库 |
| `redirect` | 10¹ – 10³ | 改 slug、导入 | 404 时 |
| `plugin_state` | 个位数 | 后台 | 冷渲染、插件路由 |
| `admin_user`、`session`、`api_token` | 个位数 / 10¹ | 认证 | 管理 API |
| `job` | 10¹ – 10³ | 保存路径、插件 | cron |
| `migration`、`migration_lock` | 10¹ / 1 | 冷启动 | 冷启动 |
| `p_<plugin>_*` | 插件自定 | 插件 | 插件 |

## 2. DDL

### 2.1 `site`

```sql
CREATE TABLE site (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  name             TEXT NOT NULL,
  tagline          TEXT,
  default_locale   TEXT NOT NULL,                 -- 'en'
  locales          TEXT NOT NULL,                 -- JSON: ["en","de","zh"]
  kinds            TEXT NOT NULL,                 -- JSON: {"product":{"base":"products"},"article":{"base":"news"},...}
  theme_options    TEXT NOT NULL DEFAULT '{}',    -- JSON，按当前构建里主题的 options schema 校验
  nav              TEXT NOT NULL DEFAULT '{}',    -- JSON: {"en":[{"label":"Products","to":"/products"}],...}
  seo              TEXT NOT NULL DEFAULT '{}',    -- JSON: 默认 title 模板、OG 图、Organization JSON-LD 字段
  domain           TEXT,                          -- 已绑定的自定义域，未绑定为 NULL
  media_base_url   TEXT,                          -- 'https://media.example.com'，NULL 时走 /media/ 代理
  cache_ttl        INTEGER NOT NULL DEFAULT 3600, -- 秒
  max_image_edge   INTEGER DEFAULT 2560,          -- NULL = 保留原件
  content_rev      INTEGER NOT NULL DEFAULT 0,    -- 仅 ARCHITECTURE §6.3 退路使用
  setup_completed_at TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

### 2.2 `content`

```sql
CREATE TABLE content (
  id                TEXT PRIMARY KEY,             -- UUID v4，永不变
  kind              TEXT NOT NULL,                -- 'page' | 'article' | 主题声明的类型
  locale            TEXT NOT NULL,
  translation_group TEXT NOT NULL,                -- UUID，同一内容的各语言版本共享
  slug              TEXT NOT NULL,
  path              TEXT NOT NULL,                -- 完整公开路径，含语言前缀：'/de/products/gr5-bar'
  title             TEXT NOT NULL,
  description       TEXT,                         -- 派生或 frontmatter 提供；列表页只用它，不碰正文
  frontmatter       TEXT NOT NULL,                -- JSON，导入别名已归一化（CONTENT_FORMAT §3.3）
  markdown          TEXT NOT NULL,                -- index.md 完整原文（含 frontmatter 块）
  markdown_sha256   TEXT NOT NULL,
  assets            TEXT NOT NULL DEFAULT '{}',   -- JSON: {"images/hero.jpg":"<sha256>", "files/x.pdf":"<sha256>"}
  cover_sha256      TEXT,                         -- 封面的 sha，方便列表页不解析 assets
  status            TEXT NOT NULL CHECK (status IN ('draft','scheduled','published')),
  published_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  rev               INTEGER NOT NULL DEFAULT 1,
  UNIQUE (path),
  UNIQUE (translation_group, locale),
  UNIQUE (kind, locale, slug)
);
CREATE INDEX content_list  ON content (kind, locale, status, published_at DESC);
CREATE INDEX content_group ON content (translation_group);
```

约束与说明：

- `markdown` 长度在保存时校验 ≤ 2 MB（D1 行上限），超出返回明确错误。
- `path` 由 `site.kinds[kind].base` + `locale` 前缀 + `slug` 计算；`page` 类型无 base。`path` 变化时写一条 `redirect`。
- 更改 `site.default_locale` 会重算全部 `path` 并写重定向，这是一个明确的、需要确认的批量操作。
- `cover_sha256` 是 `assets[frontmatter.cover]` 的冗余副本，保存时同步，让列表页一行读出封面。

### 2.3 `render_cache`

```sql
CREATE TABLE render_cache (
  cache_key        TEXT PRIMARY KEY,              -- sha256(markdown_sha256 || pipeline_version || plugin_hash)
  content_id       TEXT NOT NULL,
  html             TEXT NOT NULL,                 -- 净化后的正文片段，相对路径尚未替换
  meta             TEXT NOT NULL,                 -- JSON: {headings, excerpt, reading_time, refs:["images/hero.jpg",...]}
  pipeline_version TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX render_cache_content ON render_cache (content_id);
```

- 保存路径在同一个 D1 batch 内写 `content` 与 `render_cache`。
- 冷渲染按 `cache_key` 取一行；缺失则现场生成并回写。
- `pipeline_version` 或插件集合变化后旧行不再命中，由 cron 按 `created_at` 清理；也允许后台「清空片段缓存」整表删除。

### 2.4 `media`

```sql
CREATE TABLE media (
  sha256             TEXT PRIMARY KEY,            -- 原图（或已缩放原图）的 sha256，也是 R2 key 的主体
  kind               TEXT NOT NULL CHECK (kind IN ('image','file')),
  mime               TEXT NOT NULL,               -- 嗅探得到的真实类型
  ext                TEXT NOT NULL,
  bytes              INTEGER NOT NULL,
  width              INTEGER,
  height             INTEGER,
  variants           TEXT NOT NULL DEFAULT '[]',  -- JSON: [480,960,1440,1920] 已生成的 WebP 宽度
  original_name      TEXT NOT NULL,               -- 首次上传时的文件名，用于媒体库与导出 media/
  alt                TEXT,                        -- 默认 alt，可被正文里的 alt 覆盖
  ref_count          INTEGER NOT NULL DEFAULT 0,  -- 被多少条 content.assets 引用
  unreferenced_since TEXT,                        -- ref_count 归零的时间，GC 依据
  created_at         TEXT NOT NULL
);
```

R2 key：原件 `media/<sha256>.<ext>`；变体 `media/<sha256>_<width>.webp`。主题静态资源不进 R2，见 §2.5。

引用计数在保存内容时于同一 batch 内更新：对比新旧 `assets` 的 sha 集合，增的 `+1`、减的 `-1`；归零时写 `unreferenced_since`。cron 删除 `unreferenced_since` 早于 7 天的媒体（D1 行与 R2 对象一起删）。后台「未使用的媒体」列表就是 `ref_count = 0`。

### 2.5 主题不占表

主题的模板、语言包与清单随构建打进产物，静态资源随构建进 Static Assets（`ARCHITECTURE §10`），因此**数据库里没有主题表**。唯一与主题相关的持久化数据是 `site.theme_options`——用户给主题开放的配置项设的值。

这是 0.1 的一次简化：早期草案让主题以 zip 上传、模板存 D1、`site.theme_id` 指向当前主题。改成构建期之后，冷渲染少一次查询，运行时少一个安装事务，Worker 里也不再需要解压缩。

### 2.6 `redirect`

```sql
CREATE TABLE redirect (
  from_path  TEXT PRIMARY KEY,
  to_path    TEXT NOT NULL,
  status     INTEGER NOT NULL DEFAULT 301,
  content_id TEXT,                                -- 由改 slug 自动生成时指向该内容，随内容删除而清理
  created_at TEXT NOT NULL
);
```

只在主查询未命中（404 前）查一次；命中则返回重定向并缓存。

### 2.7 `plugin_state`

```sql
CREATE TABLE plugin_state (
  plugin_id  TEXT PRIMARY KEY,                    -- 'inquiry'
  enabled    INTEGER NOT NULL DEFAULT 0,
  version    TEXT NOT NULL,
  settings   TEXT NOT NULL DEFAULT '{}',          -- JSON，按 plugin.json 的 settings schema 校验
  secrets    TEXT NOT NULL DEFAULT '{}',          -- JSON: {"resend_api_key":"<base64(iv||ciphertext||tag)>"}
  updated_at TEXT NOT NULL
);
```

`secrets` 的每个值用 `MALLOK_SECRET` 经 HKDF 派生的密钥做 AES-GCM 加密，IV 随机、每次写入更新；管理 API 只返回「已设置 / 未设置」，永不回显。冷渲染读一次全表（行数 = 插件数），得到启用集合与设置哈希（进入 `render_cache` 键）。

### 2.8 `admin_user`、`session`、`api_token`

```sql
CREATE TABLE admin_user (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,                  -- PBKDF2-SHA256 派生结果（base64）
  password_params TEXT NOT NULL,                  -- JSON: {iterations, salt}，迭代数由 spike 确定
  created_at      TEXT NOT NULL
);
CREATE TABLE session (
  id         TEXT PRIMARY KEY,                    -- sha256(cookie token)，cookie 本身不落库
  user_id    TEXT NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE api_token (
  id           TEXT PRIMARY KEY,                  -- sha256(token)
  name         TEXT NOT NULL,                     -- 'ci-publisher'
  scopes       TEXT NOT NULL,                     -- JSON: ["content:write","media:write","export"]
  last_used_at TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);
```

0.1 只有一个管理员，但表结构不做单行假设。

### 2.9 `job`

```sql
CREATE TABLE job (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,                     -- 'publish' | 'email' | 'purge' | 'gc' | 'plugin:<id>:<name>'
  payload      TEXT NOT NULL,                     -- JSON
  run_at       TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error   TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX job_due ON job (status, run_at);
```

cron 每分钟取 `status = 'pending' AND run_at <= now` 的前 N 条（N 由 10 ms 预算决定，spike 确定），逐条执行；失败按指数退避改写 `run_at`，超过 `max_attempts` 置 `failed` 并在后台显示。`done` 的行保留 7 天后清理。

### 2.10 `migration`、`migration_lock`

```sql
CREATE TABLE migration (
  id         TEXT PRIMARY KEY,                    -- '0001_init' | 'plugin:inquiry:0001_inquiry'
  applied_at TEXT NOT NULL
);
CREATE TABLE migration_lock (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  locked_by TEXT,
  locked_at TEXT
);
```

冷启动流程：读 `migration` 得到已应用集合；有缺失则 `UPDATE migration_lock SET locked_by = ?, locked_at = ? WHERE locked_by IS NULL OR locked_at < now - 60s`，影响行数为 1 者获得锁，其余等待并重读。迁移只允许**追加式**变更（新表、新列带默认值、新索引），不允许在同一版本内删列或改列语义，保证旧版本 Worker 在迁移期间仍能服务。

### 2.11 插件表示例：`p_inquiry_inquiry`

```sql
CREATE TABLE p_inquiry_inquiry (
  id               TEXT PRIMARY KEY,
  content_id       TEXT,                          -- 来源产品/页面，可为 NULL（联系页）
  locale           TEXT NOT NULL,
  source_path      TEXT NOT NULL,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  company          TEXT,
  phone            TEXT,                          -- 电话或 WhatsApp
  country          TEXT,                          -- request.cf.country
  message          TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('new','replied','spam')),
  notify_job_id    TEXT,                          -- 通知站主的 job
  autoreply_job_id TEXT,                          -- 买家回执的 job
  user_agent       TEXT,
  ip_hash          TEXT,                          -- sha256(ip || MALLOK_SECRET)，只用于去重与限流
  created_at       TEXT NOT NULL
);
CREATE INDEX p_inquiry_inquiry_list ON p_inquiry_inquiry (status, created_at DESC);
```

插件表必须以 `p_<plugin_id>_` 为前缀，迁移 id 以 `plugin:<plugin_id>:` 为前缀，由核心迁移器统一执行。

## 3. 读写预算

D1 免费档按行读写计费且超额当天不可用，因此每类请求的行读必须有界：

| 请求 | 查询 | 行读上限 |
| --- | --- | --- |
| 单页冷渲染 | `site`、`content` by path、`render_cache` by key、`plugin_state` 全表 | ≈ 1 + 1 + 1 + 插件数 |
| 关联内容（任意内容页，2026-08-29 Task 09 落地） | 每个 `reference` 字段 1 行、每个反向关联 `LIMIT 24`、同类推荐 `LIMIT 6`，一次 batch，语句数上限 8 + 1 | 有界；产品页实际为 1 + 6 |
| 封面图解析 | `media` 按 `sha256 IN (…)`，一次查询 | ≤ 当页条数 |
| 列表页 | `content` 按 `content_list` 索引 `LIMIT n+1` | n+1（默认 21） |
| 首页 | 若干个有界列表（主题声明，每个 `LIMIT ≤ 12`） | ≤ 50 |
| sitemap | `content` 已发布行，`LIMIT 5000` 分页 | 有界，长缓存 |
| 404 | `redirect` 1 行 | 1 |
| 保存内容 | 读旧行 1、写 `content` 1、写 `render_cache` 1、更新 `media.ref_count` ≤ 引用数、写 `job` ≤ 3 | 小常数 |
| cron 一轮 | `job` 取 N 行 + 各自处理 | N × 小常数 |

反向关联（`json_extract(frontmatter, '$.<字段>') = ?`）走 `content_list` 索引的 `kind + locale + status` 前缀，因此**扫描量是该语言下该类型的已发布条数**，不是全表；返回行数由 `LIMIT` 有界。对一个几十到几百条的外贸目录这是可接受的，且只发生在冷渲染。**若某站的单一类型超过约两千条，这里需要一个针对该字段的表达式索引**——0.1 不做，因为索引要按主题声明的字段名生成，属于运行时建索引，与「主题是构建期的」相冲突。

两条硬规则：**分页不做 `COUNT(*)`**，用 `LIMIT n+1` 判断是否有下一页，避免行读随内容量线性增长；**列表与首页只读 `content` 的标量列与 `cover_sha256`，不读 `markdown`，不查 `render_cache`。**

## 4. 垃圾回收

| 对象 | 条件 | 执行者 |
| --- | --- | --- |
| `media` 与 R2 对象 | `ref_count = 0` 且 `unreferenced_since` 早于 7 天 | cron |
| `render_cache` | `pipeline_version` 不是当前版本，或 `content_id` 已不存在 | cron；后台可整表清空 |
| `session` | `expires_at` 已过 | cron |
| `job` | `done` 超过 7 天 | cron |
| `redirect` | 关联 `content_id` 已删除且超过 90 天 | cron |

## 5. 待 spike 确认

- D1 是否默认启用外键约束（本文的 `REFERENCES` 依赖它；若不启用，改为应用层维护）。
- `job` 每轮处理条数 N 在 10 ms 预算内的实测值。
- `render_cache.html` 的典型大小与 D1 行上限、读带宽的关系。
