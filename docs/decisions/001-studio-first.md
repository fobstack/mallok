# DEC-001：Studio-first

状态：`Accepted`

## 决定

Mallok 0.1 的主产品是自包含的本地 Studio。普通用户通过可视界面完成创建、编辑、预览、发布和恢复；CLI 只是同一应用能力的高级适配器。

## 原因

如果 0.1 只交付 CLI，它最多证明引擎可用，无法证明 Mallok 比通用框架更简单。用户不应该先学习 Node、包管理器、Git、frontmatter 或部署命令。

## 后果

- Studio 必须在第一个纵向任务中出现。
- 业务规则位于独立 application service，不能埋在 UI 或 CLI。
- 用户项目是数据目录，不是前端源码项目。
- GUI 不再是“未来可选项”，而是 MVP 完成定义的一部分。

