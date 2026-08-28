# 运行与恢复

状态：`Accepted for 0.1`

## 用户看到的状态

- 未发布
- 有未发布更改
- 正在发布
- 已发布
- 提交前失败，线上版本未改变
- 已切换但公开验证失败
- 线上状态待确认
- 可以恢复上一版本

默认界面不展示内部步骤。详细诊断可在“高级详情”中导出，导出前必须脱敏。

## 发布不变量

1. 本地校验失败时不产生远端写入。
2. 资产先上传，路由后暂存，最后一次原子提交版本。
3. 原子提交前的任何失败都不得改变线上 current version。
4. 提交成功后公开健康检查失败，Studio 必须明确显示实际状态，并提供重试或恢复上一版本。
5. 重试同一个 bundle 是幂等操作。
6. 恢复通过重新发布本地保存的上一个完整 PublishBundle 完成，不依赖远端文档 revision 历史。

## 本地状态

`.mallok/` 保存自动恢复草稿、最近成功 bundles、发布结果和不含秘密的诊断。它默认不进入 Git。至少保留当前和上一个成功 bundle；清理不得删除恢复正在引用的版本。远端 D1 同样完整保留 current 与 previous；非 pointer bundle 受 8 个/64 MiB、staging 24 小时、never-activated ready 7 天的固定容量与机会式清理规则约束。R2 内容寻址资产和已公开 asset registry 在 0.1 不自动删除。

## 故障分类

- 内容/模板问题：指向具体内容与修复入口。
- 凭据/权限问题：打开重新连接流程，不要求用户复制内部 ID。
- 网络/Cloudflare 暂时失败：安全重试，线上不变。
- 发布提交后检查失败：显示已提交版本与检查结果，允许恢复。
- 本地数据损坏：优先从自动保存或可导出 Markdown 恢复。

## 诊断与隐私

- 日志不得包含 token、Authorization、cookie、完整本机用户名路径或正文内容。
- 请求 ID、bundle version、站点本地 ID和阶段耗时可以记录。
- 默认日志在本机，用户主动导出后才可发送给维护者。

## 搜索与页面性能证据

- 每个 release candidate 都保存同一 candidate SHA 的 technical SEO、sitemap、Lighthouse 与真实 staging PageSpeed Insights 证据，精确协议见 `SEO_PERFORMANCE.md`；单次最好分数不得代替规定的多次样本。
- 发布后的匿名 smoke 必须验证 homepage、代表性 page/article、404、robots、root sitemap、全部 sitemap shard、canonical 集合和一个受管图片；smoke 不等于搜索引擎已经抓取或收录。
- 新站点可能没有足够 CrUX field data。无数据时记录 `FIELD_DATA_UNAVAILABLE`，不得伪造为 0、通过或失败；有数据后按 URL/origin、mobile/desktop 分开保存第 75 百分位的 LCP、INP、CLS。
- Search Console 验证、提交和排名监控不是 0.1 自动发布步骤。Mallok 生成并公开 sitemap，但不代用户取得搜索平台所有权。
- 用户内容或官方模板导致资源预算失败时，线上 current bundle 保持不变；错误必须定位到页面和资源。Lighthouse/PSI 工具、Chrome 或评分模型升级时建立新基线，不把不同版本分数直接混算。
