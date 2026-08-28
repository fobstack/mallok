# DEC-002：单一 PublishBundle

状态：`Accepted`

## 决定

Mallok 只有一条内容与模板编译管线。它生成完整、确定性的 `PublishBundle`；静态导出和 Cloudflare 发布只是两个 sink。

## 原因

静态模式和 D1 动态模式若各自渲染，会产生双运行时、双缓存语义和长期兼容成本。预渲染 bundle 既能直接写静态目录，也能存入 D1/R2，让内容更新不需要重新部署 Worker。

## 后果

- Worker 请求时不编译 Markdown、不执行模板。
- 两种输出必须对同一 compiler/bundle contract 进行语义一致性测试；给定相同 canonical origin 时必须消费 exact same bundle，origin 不同时 bundle identity 自然不同。
- 内容和模板变化产生新 bundle；通用 Worker 通常不变。
- 发布协议可以聚焦“上传、暂存、原子切换”，不需要文档 revision 系统和 Worker 部署协调器。
