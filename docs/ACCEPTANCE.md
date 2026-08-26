# Mallok MVP 验收标准

本文定义“完成”的证据。命令会随实现阶段逐步生效。

## 1. 通用质量门

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- 所有命令退出码为 0；
- git 中没有 `.env`、`.dev.vars`、token、account id 或真实 database id；
- 没有未解释的 `any`、`@ts-ignore`、跳过测试或仅为通过测试的硬编码；
- 包导出在干净安装后可解析；
- 错误消息包含稳定 code；当调用者可以修复时必须包含下一步建议。

## 2. Phase 1A

- `@mallok/core` 在依赖图中不包含 Node/Cloudflare API；
- 合法 Markdown 进入统一模型并渲染为 `SafeHtml`；
- 缺失/非法 UUID id、非法日期、超限或非 JSON data 返回对应错误码；默认 tags/template/status 与文档一致；
- `<script>`、事件属性、`javascript:` URL 无法从 Markdown 进入输出；
- 普通模板插值转义 `<`, `>`, `&`, `"`, `'`；
- `html` 在属性、动态 tag、script/style 上下文拒绝未包装插值；`safeUrl` 拒绝危险协议；
- JSON-LD 中的 `</script>` 不能关闭 script 元素；
- 非法和重复 slug 返回指定错误码；
- 给定固定 clock，发布过滤和 route plan 可重复；
- Windows 与 POSIX 风格恶意相对路径在纯词法 route planner 中均不能越界；真实文件系统与 symlink 边界留在 Phase 1B；
- core 分支覆盖率不低于阶段 prompt 定义的阈值。

## 3. Phase 1B

临时目录执行：

```bash
pnpm mallok init .mallok/e2e/demo
pnpm --dir .mallok/e2e/demo mallok build
```

验证：

- `dist/index.html`；
- `dist/articles/hello-mallok/index.html`；
- `dist/404.html`；
- `dist/rss.xml`；
- `dist/sitemap.xml`；
- 主题 CSS 和公开资源；
- HTML 中没有默认客户端脚本；
- 给定相同 fixture、主题、版本和固定 `asOf`，连续两次构建的文件清单和内容 hash 相同；
- 内容错误时，上次成功的 `dist` 保持不变。
- `realpath`、symlink/junction 越界和原子替换失败测试不能写到允许边界外。

## 4. Phase 1C

- 默认监听 `127.0.0.1`；
- 修改文章、主题和配置均触发对应更新；
- 构建错误可见且不会终止 watcher；
- preview 阻止 `../` 和编码路径穿越；
- 未知文件返回主题 404。

## 5. Phase 2A

- migration 可在全新本地 D1 上执行；
- 公开列表只返回已发布且到期内容；
- 参数化查询测试覆盖引号、Unicode 和注入 payload；
- 使用固定 fixture/theme/clock，静态与动态输出对 `title`、canonical、正文、导航和 JSON-LD 做归一化 DOM 比较，只排除明确列出的 revision/ETag 元数据；
- 静态资源不触发 D1 查询；
- 不存在、草稿和未来文章统一返回 404。
- 动态首页、RSS 和 sitemap 与同一 published revision 集合一致，unpublish 后不再出现对应 URL。

## 6. Phase 2B

- 无 token、错误 token、缺失 token 全部拒绝；
- 未设置 server secret 时管理 API 关闭；
- 超限 body 在解析前拒绝；
- create/update 通过单个原子领域操作产生不可变 revision 并切换发布指针；故障注入不得留下已发布的半状态；
- 同一 artifact hash 重复 publish 为 no-op；相同 source 在 compiler/schema version 变化后必须产生新 artifact revision；
- 过期的预期版本返回冲突且不覆盖新 revision；
- 同一 id 修改 slug 保留 revision 历史，新 slug 返回 200，旧 slug 在 MVP 中返回 404；
- 冲突不会静默覆盖；
- 响应、日志和异常中没有 token 或文章草稿全文；
- publish 成功后的 cache-busted 首次 GET 返回新 revision/ETag；普通文章、首页、RSS 和 sitemap 最迟 60 秒内一致；
- 存储型 XSS 与 JSON-LD script breakout 回归测试通过。

## 7. Phase 2C

- dry-run 不创建、迁移或部署任何云资源；
- `provision` 与 `deploy` 的计划、状态和失败恢复信息分离；
- 实际动作前显示 Worker、数据库、迁移和资源目标；
- 非交互环境缺少确认标志时失败；
- Wrangler 使用项目依赖版本；
- secret 通过 Wrangler secret 或外部环境提供，不写入配置；
- 部署失败保留可诊断输出，但过滤敏感值。

## 8. 文档验收

Phase 3 发布候选时，在一台没有 Mallok 全局安装的新环境中，仅阅读 README 和文档即可：

1. 初始化；
2. 写文章；
3. 换主题；
4. 构建静态站；
5. 配置本地 D1；
6. 完成部署 dry-run；
7. 安全更新一篇文章。

真实发布候选还要在经用户授权的临时 Cloudflare staging 环境完成 provision、migration、deploy、health、publish、公开读取和清理。普通 CI 只运行 dry-run；没有凭据时此项保持未验收。
