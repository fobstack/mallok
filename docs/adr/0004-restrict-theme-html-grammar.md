# ADR-0004：限制 Theme HTML 文法而非实现浏览器 tokenizer

- 状态：Accepted for MVP
- 日期：2026-08-27

## 背景

允许 tagged template 在任意 HTML 上下文插值，需要正确实现 WHATWG tokenizer 的 script-data、escaped/double-escaped、style raw-text、comment、foreign content 和跨分块状态。简化为“搜索 `</script>`”会把浏览器仍视为脚本的内容误判为普通文本，从而形成存储型 XSS。

## 决策

- generic `html` 只服务普通文档/tag/text/受控属性上下文；
- 静态 literal 中禁止 ASCII 大小写不敏感的 `<script`、`<style` 和 `<!--`；
- JSON/JSON-LD 只通过 `jsonScript()` 生成完整 script 元素；
- 外部脚本只通过 `externalScript(SafeAssetUrl)` 生成完整元素；`SafeAssetUrl` 只能由 manifest-backed Theme AssetUrls mint，通用/远程 URL 不能升级；MVP 不支持 inline JS/inline style；
- 输出以 HTML5 parser 重解析做安全回归，不把自研 scanner 宣称为浏览器完整 parser。

## 后果

主题作者少了一部分任意内联自由，但获得更容易审计、静态/Worker 一致的安全 contract。若未来需要更广 HTML 文法，应采用成熟 HTML parser/AST builder 并新开 ADR，而不是给 scanner 打零散补丁。
