# ADR-0003：内容、主题与密钥的安全边界

- 状态：Accepted for MVP
- 日期：2026-08-26

## 决策

- 主题与配置是项目拥有者执行的可信代码，不承诺沙箱隔离。
- Markdown、frontmatter、D1 中的作者字段和发布 API 输入一律视为不可信数据；`body_html` 只有在由服务端 compiler 生成且 row mapper 校验 compiler/schema 标记后才恢复为受控 `SafeHtml`。
- MVP 固定移除原始 Markdown HTML，不提供开启选项；所有内容 HTML 经过 sanitizer。
- 模板普通插值默认转义；原始输出只接受 `SafeHtml`。
- generic `html` template 不接受 literal `script`、`style` 或 HTML comment；JSON-LD 与外部脚本只能通过返回完整元素的专用 helper，避免自研不完整 HTML raw-text tokenizer。
- 管理 token 仅来自 secret/环境/交互输入，不进入仓库。
- D1 只使用参数化 statement。
- D1 中的 `body_html` 只能由服务端 compiler/sanitizer 生成并与 compiler/schema version、artifact hash 一起保存；直接控制台修改属于不受支持的数据库篡改。
- D1 row 还必须携带 sanitizer profile、compile options 与单一 `artifact_format_version`；该字段同时版本化 artifact envelope 与 row codec。未知 format/profile fail closed，不在公开请求时重编译。
- 所有读写路径都必须证明位于项目允许边界内。

## 原因

这一边界既避免宣称无法兑现的第三方代码沙箱，也阻断内容系统最常见的存储型 XSS、SQL 注入、路径穿越与密钥泄露链路。
