# Mallok 测试策略

- 状态：0.1 基线（首次编写）
- 日期：2026-08-28
- 地位：定义测试分层、每层的工具与职责、覆盖率门与证据要求。**「跑过了」不是证据，命令加退出码才是。**

## 1. 原则

1. **测行为，不测实现。** 断言公开契约（HTTP 响应、渲染出的 HTTP、导出的文件），不断言私有函数被调用了几次。
2. **契约在文档里，测试是文档的可执行版本。** 每条硬性规则（`CONTENT_FORMAT §9`、`ARCHITECTURE §5` 的四条不可让步规则）都必须有对应测试。
3. **不可复现的测试等于没有测试。** 渲染是确定性的，所以快照可用；任何依赖时间、随机数、网络的测试必须显式注入。
4. **`docs/CONVENTIONS.md` 的事实纪律同样适用于测试**：平台行为要么实测，要么标为未验证，不靠假设。

## 2. 分层

| 层 | 工具 | 跑在哪 | 测什么 |
| --- | --- | --- | --- |
| 单元 | `vitest` | Node | `src/core/` 的纯函数、`src/db/` 的 SQL 构造 |
| 属性 / 恶意语料 | `fast-check` | Node | 净化、路径归一化、frontmatter 解析 |
| Worker 集成 | `@cloudflare/vitest-pool-workers` | **真实 workerd** | 路由、缓存、迁移、管理 API、插件路由 |
| 后台组件 | `@testing-library/preact` + `happy-dom` | Node | 表单生成器、编辑器、媒体上传 |
| 端到端 | `playwright` | 浏览器 + `wrangler dev` | 向导、发布闭环、询盘提交 |
| 无障碍 | `@axe-core/playwright` | 同上 | 后台与官方主题 |
| 性能 | `@lhci/cli` | 自定义域 | `SEO_PERFORMANCE.md §7` 的门 |

工具选择来自 `TECH_STACK §10`，此处不重复论证。

**Worker 集成测试必须跑在真实 workerd 里**，不接受用 Node 模拟 Cloudflare 全局对象——那样测不出 `caches.default`、D1 batch、限流绑定的真实语义。

## 3. 当前基线

Task 01 已建立并通过：

```
6 test files, 44 tests
  test/core/fragment.test.ts      第一阶段渲染、净化、缓存键
  test/core/frontmatter.test.ts   YAML 拆分与错误
  test/core/hash.test.ts          sha256 与稳定序列化
  test/core/liquid.test.ts        受限模板引擎、转义、raw 过滤器
  test/core/paths.test.ts         公开路径构造与解析
  test/worker/flow.test.ts        workerd 内：启动并发、缓存命中/未命中、
                                  发布→渲染、草稿/定时、重定向、净化、
                                  错误卫生、spike 探针
```

命令：`pnpm test`，退出码 0。

## 4. 必须有测试的硬性契约

以下不是「建议覆盖」，是**过不了就不算完成**：

### 4.1 渲染确定性（`ARCHITECTURE §5`）

- 同一份 Markdown + 同一管线版本 + 同一主题版本 → **逐字节相同的 HTML**；
- 渲染函数不读时间、随机数、请求特征；
- `beforeRender` 钩子是纯函数；
- 连续渲染同一输入 100 次，输出全部相同。

### 4.2 导入导出往返（`CONTENT_FORMAT §9`）

七条断言逐条对应一个测试：

1. 导出 → 导入到空站 → 导出：`index*.md` 与 `images/`、`files/` 逐字节相同，`id`/`translation_group`/`created_at` 不变；
2. 手写文章包 → 导入 → 导出：`index*.md` 逐字节相同；
3. 别名 frontmatter（Astro/Hugo 形态）：派生正确，原文不变；
4. 两个包各含同名 `images/cover.jpg` 但内容不同：各自渲染正确、各自还原；
5. 引用缺失文件的包：导入成功、状态可见、导出原样保留引用；
6. 重复导入未修改的包：**D1 无写入、无缓存清除**；
7. 恶意语料：按规则拒绝或净化，不崩溃、不泄露。

### 4.3 缓存正确性（`ARCHITECTURE §6`）

- 首次请求 `MISS`，二次 `HIT`；
- 草稿与未到期的定时内容**永不写入缓存**；
- `/_mallok/*` 全部 `private, no-store`；
- 保存后受影响的标签被清除；
- 片段缓存键覆盖全部输入：改 assets、改媒体域名、改插件设置都导致失效。

### 4.4 安全（`SECURITY.md`）

- 净化移除 `<script>`、`on*`、`javascript:`；
- 相对路径拒绝 `..`、绝对路径、协议相对路径；
- 错误响应不含 SQL、bucket 名、database id、堆栈；
- 未认证请求得到 401，且 401 与 404 的时序不泄露资源是否存在；
- 密钥永不出现在返回体或日志里。

### 4.5 迁移（`DATA_MODEL §2.10`）

- 并发冷启动只应用一次迁移，锁最终释放；
- 迁移只做追加式变更；
- 迁移失败不让站点不可用。

### 4.6 D1 读写预算（`DATA_MODEL §3`）

- 单页冷渲染的 D1 调用是 **1 次 batch**；
- 列表页**不查 `render_cache`、不读 `markdown`**；
- 分页**不执行 `COUNT(*)`**。

这三条用查询计数断言，不靠人工审查。

## 5. 覆盖率门

| 目录 | 行覆盖 | 分支覆盖 |
| --- | --- | --- |
| `src/core/` | ≥ 90% | ≥ 85% |
| `src/db/` | ≥ 90% | ≥ 85% |
| `src/worker/` | ≥ 85% | ≥ 80% |
| `src/plugins/` | ≥ 85% | ≥ 80% |
| `src/admin/` | ≥ 75% | ≥ 70% |
| `src/cli/` | ≥ 80% | ≥ 75% |

净化、路径解析、认证、加密这四个模块的分支覆盖 **≥ 90%**，不接受例外。

覆盖率是下限不是目标。90% 覆盖率的烂测试仍然是烂测试。

## 6. 证据格式

任务完成报告里，每条验收项必须给出可复制的证据：

```
AC-XX-YY  一句话说明验收什么
  实现    src/worker/public.ts:42  handlePublic()
  测试    test/worker/flow.test.ts:118  "serves a cache HIT on the second request"
  命令    pnpm test
  退出码  0
  环境    Node 22.22.2 / workerd (vitest-pool-workers 0.22.0) / macOS 24.6.0
```

状态只允许七种，**不允许「应该通过」这类措辞**：

| 状态 | 含义 |
| --- | --- |
| `NOT_AVAILABLE` | 该验收项还没有可测的实现 |
| `NOT_RUN` | 有实现有测试，但本次没跑 |
| `FAILED` | 跑了，失败 |
| `VERIFIED_LOCAL` | 本地跑通，有命令和退出码 |
| `VERIFIED_STAGING` | 在真实 Cloudflare 账号上跑通 |
| `VERIFIED_HUMAN` | 需要人工判断的项（如「邮件真的收到了」） |
| `ACCEPTED` | 产品负责人已确认 |

**平台行为类的结论只能是 `VERIFIED_STAGING` 或 `VERIFIED_HUMAN`**——本地 `wrangler dev` 的 Cache API 能用，不说明 `.workers.dev` 能用（`ARCHITECTURE §18` item 1）。

## 7. 需要真实账号的验证

工具替代不了的（`TECH_STACK §10`）：

| 项 | 怎么测 |
| --- | --- |
| Worker CPU 时间（含保存请求） | Workers Logs / `wrangler tail --format=json` |
| 打包体积 | `pnpm bundle:size` + `wrangler` 的 Total Upload |
| 缓存命中率与清除延迟 | 真实账号计时 |
| 部署三条路径 | 各走一遍 |
| 一次真实的询盘邮件收发 | 人工确认收件箱 |

`TASK-01 §4` 是这类验证的第一批，结论写回 `ARCHITECTURE §18`。

## 8. 测试数据

- 固定语料放 `test/fixtures/`，包括一组真实的外贸内容（产品、分类、新闻各若干）；
- 恶意语料单独放 `test/fixtures/hostile/`，见 `SECURITY.md §14` 的清单；
- **不用随机生成的内容做快照测试**——快照必须稳定；
- 时间一律注入，不调 `Date.now()`。

## 9. CI

每个任务结束前必须全绿（`docs/CONVENTIONS.md` 代码风格）：

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size
```

端到端与 Lighthouse 因为需要浏览器和自定义域，不进这条链，单独跑并在任务报告里给证据。

## 10. 明确不做

- 不做变异测试；
- 不做视觉回归测试（截图对比在跨平台上噪音太大）；
- 不为 `src/core/` 之外的东西追求 100% 覆盖；
- 不写只为提高覆盖率数字、不断言行为的测试；
- 不在测试里连真实的 Resend 或 Turnstile——用假的 HTTP 层，真实调用留给 `VERIFIED_HUMAN` 那一类。
  实现方式（2026-08-29 实测）：`@cloudflare/vitest-pool-workers` 0.22 起 `cloudflare:test` 不再导出 `fetchMock`，官方迁移指引是直接 mock `globalThis.fetch` 或改用 MSW；本仓库用前者（`SELF` 与测试同 isolate，Worker 的子请求会命中桩），避免新增依赖。
