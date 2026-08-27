# ADR-0005：版本化 D1 发布投影与原子 pointer 操作

- 状态：Accepted for MVP
- 日期：2026-08-27

## 背景

Markdown/Git 是作者真相，D1 需要同时支持无需重建更新、历史 revision、安全 HTML 恢复、并发发布与重试。直接 upsert 一张文章表会丢历史；把 CLI 编译 HTML直接写库会绕过服务端安全边界；先查再写的多请求序列会产生半发布状态。

## 决策

- D1 保存 document identity、不可变 revision 和可删除的 current published pointer；
- revision 保存 source、规范化内容字段、body_html、source/artifact hash、content/compiler/sanitizer/compile-options，以及同时标识 artifact envelope/row codec 的单一 format version；
- `decodeCompiledEntry` 在 core 内校验 profile/hash 后 mint `SafeHtml`，不导出 string → SafeHtml；
- publish/unpublish 以 expected document version 做 CAS，并用 D1 transaction-safe batch + constraint/guard 把 revision、pointer、version、idempotency response 作为一个领域操作；
- 当前 pointer 已指向相同 artifact 才是 no-op；unpublish 后相同 artifact re-publish 必须恢复 pointer 并 bump version；
- `publishedAt/content_published_at` 是作者排期，nullable；`activated_at` 是 pointer 系统事件时间，nonnull；
- 未知 codec/profile fail closed，不在访客请求时重编译 Markdown。

## 后果

数据和实现更复杂，但发布可以审计、恢复并安全重试。数据库 schema、状态机和 wire contract 分别由 `DATABASE.md` 与 `HTTP_API.md` 固定；破坏性 profile 变化遵循 `VERSIONING.md` 的滚动升级规则。
