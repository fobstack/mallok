# ADR-0002：MVP 使用 ESM Theme API

- 状态：Accepted for MVP
- 日期：2026-08-26

## 背景

Mallok 需要主题机制，但首版同时自研模板语法、编译器、调试器和沙箱会显著增加范围与安全风险。

## 决策

MVP 主题是受信任的本地 ESM 模块，实现 experimental `MallokTheme` 接口。核心提供按上下文限制插值的 `html` helper、受控 `SafeHtml` 和安全 URL/JSON helpers。标记为 `universal` 的主题不得读取 Node builtin、ambient I/O、系统时间或随机数，并必须通过 Node/Worker 双 bundle 检查。

## 后果

- 主题可使用原生 HTML/CSS 和 JavaScript/TypeScript 工具，不绑定 UI 框架。
- 静态与 Worker 可以共享同一渲染函数。
- ESM 是主题作者接口，不是最终用户必须学习的模板语法；最终用户只选择、配置和预览模板。
- 非开发者文件模板和在线主题编辑延后；未来可以作为 Theme API 的受控适配器增加，而不改变内容模型。
