# Mallok 术语表

| 术语 | 定义 |
| --- | --- |
| 作者源（author source） | 人实际编辑且可审计恢复的源。MVP 中是 Git 中的 Markdown/frontmatter。 |
| 发布投影（published projection） | 面向线上读取优化的数据副本。MVP 动态模式中是 D1，不允许绕过发布服务直接编辑。 |
| `ContentInput` | 从 frontmatter 与 Markdown 正文得到、尚未规范化的结构化输入。 |
| `ContentEntry` | 校验、默认值、日期、换行和 JSON data 都规范化后的作者内容。 |
| `CompiledEntry` | `ContentEntry` 经固定 Markdown/sanitizer 管道编译后的发布对象，包含 `SafeHtml` 和 hash。 |
| document | 一篇内容的稳定身份，由不可变 lowercase canonical UUID v4 `id` 标识；改 slug 仍是同一 document。 |
| revision | document 的不可变历史版本。更新创建新 revision，不修改旧行。 |
| published pointer | 指向某 document 当前公开 revision 的唯一指针；unpublish 删除指针，不删历史。 |
| effective time / `publishedAt` | 作者可选的内容生效时间；缺失表示立即可见，未来值在 `asOf` 前不可见。D1 中对应 nullable `content_published_at`。 |
| activation time / `activatedAt` | 系统把某 revision 切为公开 pointer 的事件时间，始终存在；不参与作者排期语义。 |
| `sourceHash` | 规范化 `ContentEntry` 的 canonical JSON 做 SHA-256 后的小写十六进制值。 |
| `artifactHash` | 覆盖 `sourceHash`、compiler/schema version 与所有影响输出选项的 SHA-256。 |
| compiler version | Markdown 到发布产物的行为版本；行为变化必须导致新 artifact。 |
| schema version | 内容/序列化契约版本；不兼容字段语义变化时递增。 |
| row codec | 负责在 D1 row 与 `CompiledEntry` 之间严格编码/解码的受控接口；由同一个 `artifact_format_version` 版本化，校验 format/profile/hash 后才能恢复 `SafeHtml`。 |
| `SafeHtml` | 由 Mallok 受控编译器或模板 helper 创建的运行时不透明 HTML 值；普通字符串不能伪造。 |
| Theme API | 受信任本地 ESM 主题实现的 experimental 渲染接口。不是不受信任代码沙箱。 |
| static target | 构建时读取 Markdown，输出可独立托管的完整目录；内容变化必须重建。 |
| cloudflare target | Worker 请求时从 D1 读取 `CompiledEntry` 并套主题；内容发布不重新部署 Worker。 |
| `asOf` | 一次构建或请求集合判断使用的显式 UTC 时间基准。相同输入可重复必须包含相同 `asOf`。 |
| route plan | URL 到安全相对输出路径的确定性映射，不直接把 slug 拼成文件系统路径。 |
| project root | 经 `realpath` 确认的站点根目录；所有配置、内容、主题、公开资源和输出边界相对它判断。 |
| dry-run | 只校验并输出计划，不创建资源、不迁移远端数据库、不部署、不写远程内容。 |
| provision | 创建或发现云资源并记录本地非敏感状态；不等同于部署代码。 |
| deploy | 使用已存在并已绑定的资源构建、迁移、非激活上传 Worker version，再显式激活 exact target；不隐式创建资源。 |
| version upload | 把 immutable candidate 上传成不接流量的 Worker version；成功只产生 canonical lowercase version UUID，不等同于部署。 |
| activation | 把 D1 fence 中已持久化的 exact Worker version UUID 显式切到 100% 流量；与 version upload 使用独立 logical attempt。 |
| logical attempt | D1 持久化的一次 version-upload 或 activation 意图；恢复重传时保持相同 candidate/target 与 attempt id。 |
| `providerCallId` | logical attempt 下某一次实际 provider 调用的 UUID v4；每次重传都新建，并通过不可变 request/result evidence 记录。 |
| deployment fence | D1 单例锁；preflight 是有期限 lease，external/releasing 是必须经可证明恢复显式解决的 hard barrier。 |
| idempotency key | 客户端为一次写请求提供的唯一键；同 key 同请求返回原响应，同 key 不同请求冲突。 |
| CAS | compare-and-swap，只有预期 document version 等于当前 version 时才允许切换 revision。 |
| Guided Start | 面向首次建站者的受控引导入口；长期属于 Studio 产品路径，不是当前 MVP 已实现能力。 |
| GUI / Studio | 长期面向非技术内容创作者的核心可视化入口；与 CLI 共享 application/domain service，但不是 MVP CLI 阶段的一部分。 |
