# Mallok

**面向 Cloudflare 的开源网站框架，内置 Markdown 内容管理、网页后台、Liquid 主题和插件能力。** 首先服务于多语言 B2B 与外贸企业网站。

[English](README.md) · [简体中文](README.zh-CN.md)

部署到自己的 Cloudflare 账号，内容存储在 D1，媒体存储在 R2。
通过后台或 CLI 编辑，随时导出内容。发布内容无需重新构建网站；修改代码、主题和已安装插件需要构建并部署。

## 发布状态

**0.1.0-rc.6 是候选版本，不是 0.1 稳定版。** 已完成真实 Cloudflare 部署、发布、缓存失效与性能测试。最近 CPU 样本的 60 次请求全部成功，但其中 16 次冷渲染超过项目设定的 10ms 目标。这是已知性能限制，不是 16 次请求失败。

维护者已接受此限制用于公开源码与提供 RC 试用。真实询盘邮件送达、自然七天媒体回收及真实升级回滚等验证仍未完成。详见[发布状态](docs/zh-CN/RELEASE_STATUS.md)。

**截至 2026 年 9 月 18 日，npm 包尚未发布。** 不要假定 `npx mallok` 会安装本候选版本。公开源码、发布 npm 包、通过稳定版验收是不同事项。

## 功能

- D1 中的 Markdown 内容，可导出原始内容。
- 多语言内容、语言 URL、canonical 与自动 hreflang。
- Liquid 主题，内置五套设计，由主题声明内容类型。
- React 后台，管理内容、设置、媒体和插件。
- B2B starter，包含产品、分类、案例、FAQ 和新闻。
- 集成 Turnstile 与 Resend 的询盘插件；本候选版的真实邮件送达验收尚未完成。
- HTML 边缘缓存和 D1 渲染片段缓存。
- 创建、发布、导出、升级等 CLI 工具。
- 可选静态构建；静态输出不包含后台或服务端询盘处理。

运行时位于 `src/runtime`，属于 Mallok 内部模块，无需单独安装。网站通过主题、插件和 starter 接口扩展能力。

## 本地试用源码

需要 Node.js 22 或更新版本，以及 pnpm 10.34.5。仓库测试版本见 `.nvmrc`。

```sh
git clone https://github.com/fobstack/mallok.git
cd mallok
pnpm install --frozen-lockfile
# 仅首次 checkout：创建本地秘密文件，不覆盖已有文件。
(umask 077; set -C; printf 'MALLOK_SECRET=%s\nMALLOK_SETUP_KEY=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .dev.vars)
pnpm dev
```

这会启动使用本地 Wrangler 资源的框架开发环境，不会部署网站或创建云资源。打开 Wrangler 输出的本地地址，在向导中填写本地 `.dev.vars` 的 `MALLOK_SETUP_KEY`。此文件已被 Git 忽略，不要公开。浏览器测试见英文[测试文档](docs/TESTING.md)。`pnpm test` 运行单元与集成测试。

npm 发布后，预期入口为 `npx mallok@<已发布版本> create my-site`。
当前发行包测试使用[发布手册](docs/RELEASE_GATE.md)描述的、关联源码提交的 tarball。Deploy to Cloudflare 按钮暂不可用。

## 框架仓库和网站仓库

本仓库用于开发 **Mallok 框架**。生成的网站是单独的小项目，依赖精确版本的 `mallok` 包。网站配置、内容、自定义主题与插件归网站所有者管理；升级无需合并框架仓库的 fork。

内容包由 Markdown 文件及相对路径媒体组成。初始化可将示例内容导入 D1。
后台编辑修改 D1，不会回写 Git；导出得到可迁移的内容包。格式见英文[内容格式](docs/CONTENT_FORMAT.md)和 [CLI 文档](docs/CLI.md)。

## 托管和缓存

Mallok 以 Cloudflare 免费额度起步为设计目标。实际成本与容量取决于用量、套餐限制、域名注册和邮件等可选服务；免费不代表无限使用。

自动缓存失效需要把仅授权当前 zone 的 Cache Purge 令牌 `CF_API_TOKEN` 和 `CF_ZONE_ID` 配置为 Worker secrets。未配置时，访客可能看到旧内容直到缓存到期。不要提交凭据。
即使主题不输出 JavaScript，Cloudflare 或第三方集成也可能注入脚本。

## 文档与参与贡献

- [英文文档](docs/README.md) · [中文文档导航](docs/zh-CN/README.md)
- [发布状态与已知限制](docs/zh-CN/RELEASE_STATUS.md)
- [主题格式](docs/THEME_FORMAT.md) · [插件 API](docs/PLUGIN_API.md)
- [贡献指南](CONTRIBUTING.zh-CN.md)
- [安全报告](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md)

英文是主要文档语言，中文作为补充翻译。尚未翻译的技术资料链接至英文原文。

## 许可证

[Apache-2.0](LICENSE)。第三方依赖和字体署名见 [NOTICE](NOTICE) 及发行包生成的第三方声明。
