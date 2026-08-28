# 术语表

## 用户术语

- **站点（Site）**：用户拥有的一个可携带网站项目。
- **模板（Template）**：控制站点外观和页面结构的声明式设计包。
- **内容（Content）**：页面、文章、站点信息和媒体。
- **发布（Publish）**：把当前预览版本安全地变成公网版本。
- **Studio**：Mallok 的本地可视化主产品。
- **恢复上一版本（Restore）**：把最近一个成功发布的本地快照重新发布。

## 内部术语

- **ProjectSnapshot**：一次确定读取后得到的站点、内容、模板和媒体输入。
- **PublishBundle**：唯一编译管线生成的完整可发布结果，包含路由响应、feeds、元数据和内容寻址资产。
- **RouteManifestEntry**：某个 URL 路径对应的最终状态码、内容类型、缓存策略和响应体 hash。
- **AssetManifestEntry**：由内容 hash 标识的不可变媒体或模板资源及其 MIME/长度元数据。
- **bundleHash**：由 canonical PublishBundle manifest 计算出的版本身份。
- **Technical SEO contract**：Mallok 对 canonical、head、robots、sitemap、状态码、内部链接和抓取集合定义的可自动验证输出合同；不等于搜索收录或排名保证。
- **Mallok PageSpeed Gate**：锁定 Chrome/Lighthouse/PSI 环境、多次采样并对官方模板设定的产品质量门；不是 Google 颁发的认证。
- **CrUX field data**：Chrome User Experience Report 汇总的真实用户历史数据；新站或低流量站可能没有足够样本。
- **Sink**：消费同一 PublishBundle 的输出端；0.1 只有静态目录与 Cloudflare。
- **Provision**：第一次连接 Cloudflare 时创建通用 Worker、D1 和 R2 的内部过程。
- **Activate**：在全部路由和资产准备成功后，用并发 guard 把新 `bundleHash` 切成线上 current 的 D1 原子动作。

内部术语可以出现在诊断详情，不得成为默认用户流程的前置知识。
