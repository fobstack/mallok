# 内容编辑器契约

状态：`Accepted for 0.1`

Studio 的可视编辑器降低 Markdown 使用门槛，但磁盘上的 Markdown 仍是作者真相。编辑器不得建立一个只能由 Mallok 读取的第二种正文格式。

## 1. 0.1 内容能力

可视模式必须支持：

- 段落与一至三级标题；
- 粗体、斜体、行内代码、删除线；
- 有序/无序列表与引用；
- 站内/HTTPS 链接；
- fenced code block 与语言标签；
- 图片和替代文本；0.1 不定义图片说明/caption 的非标准 Markdown 表示；
- GFM 表格与分隔线。

脚注、任务列表、数学公式、HTML、MDX、组件、嵌入脚本和任意 shortcode 不属于 0.1 可视模式。

## 2. 数据真相

1. 文件打开时由成熟 CommonMark/GFM parser 生成内存 AST。
2. 可视编辑只修改批准节点，保存时由固定 serializer 生成 canonical Markdown。
3. frontmatter 由站点/内容表单编辑，不在正文中暴露。
4. preview 与 publish 重新从已保存 Markdown 解析，不能直接信任编辑器 DOM。
5. 编辑器内部 JSON、selection 和 undo history 只进入 `.mallok/` 自动恢复状态，不是作者数据。

## 3. 无损规则

- 导入文件若包含可安全解析但可视模式不支持的节点，Studio 默认进入“Markdown 源码模式”，继续允许保存和预览；不得静默删除或降级节点。
- 用户主动选择“转换为可视模式”前，必须展示将改变的语法并先创建备份。
- raw HTML 永远不会进入发布结果；源码模式必须明确提示这一点，但仍保留原始本地文本，除非用户确认删除。
- 从可视模式切换到源码模式必须是无损的；从源码切回可视模式需要重新解析并通过支持度检查。

## 4. 保存与冲突

- 编辑 transaction 最多在 100 ms 内发送到 loopback backend，并由单调 sequence/ack 标记“已收到”；backend 先原子写 `.mallok/` recovery journal，再以 750 ms debounce 写 canonical Markdown。应用内“关闭站点/退出 Mallok”必须等待 flush；browser `pagehide/beforeunload` 只作 best effort，不能被当成数据保证。
- UI 分开显示“正在保存 / 已保存到本地 / 保存失败”和“有更改待发布”。
- 保存使用 expected file hash；发现外部修改时停止覆盖，提供“查看差异、另存副本、重新载入”。
- crash recovery 保存最后由 backend ack 的编辑 AST、sequence、原文件 hash 和时间；若磁盘文件更新更晚，只能提示恢复，不得自动覆盖。突然杀死浏览器或进程时最多可能丢失尚未 ack 的最后一小段输入，界面只能把已 ack 的状态显示为“已保存到本地”，不得承诺浏览器无法提供的零丢失。
- 每个内容文件保留进程内 undo/redo；长期发布历史不由编辑器承担。

## 5. 图片

拖入图片先复制到项目 `media/` 的安全名称，再插入逻辑 `/media/...` 引用。复制或校验失败时正文不写悬空引用。图片控件必须要求 1–300 code point 的可编辑 alt；0.1 不提供正文装饰图或空 alt 选项，模板装饰只能使用不发请求的 CSS。选择 cover 时同一对话框必须填写 `coverAlt`。

## 6. 安全与可访问性

- 粘贴内容按文本/受支持结构处理，不保留任意 HTML、style 或 event attribute。
- 链接在写入前按 `PROJECT_FORMAT.md` 的站内/外 URL policy 校验；Studio 站内链接选择器写 canonical root-relative route，预览链接不允许驱动 Studio backend。
- toolbar、编辑区、错误、source/visual 切换和图片对话框可完整键盘操作，具有 name/role/state 和可见 focus。
- 编辑器选择的第三方库必须在 Task 01 dependency gate 中证明 Markdown 数据模型、无损策略、a11y、bundle 体积和维护状态；不得因库默认行为改变本文。
