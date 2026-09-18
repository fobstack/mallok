# 参与 Mallok

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Mallok 尚处于早期阶段。先阅读[架构](docs/ARCHITECTURE.md)和[工程约定](docs/CONVENTIONS.md)。发现代码、文档或实测不一致时，请说明冲突并提供修改依据，不必把旧文档当作永远正确的规则。

## 语言

代码、注释、提交信息、测试与技术文档以英文为主。欢迎维护 `README.zh-CN.md`、本文和 `docs/zh-CN/` 下的中文翻译。译文链接回英文原文，相关改动保持同步，未翻译页面明确链接英文。

## 开发约定

- 使用严格 TypeScript；边界输入用 Zod 校验，内部使用明确类型。避免 `any`、非空断言与 `namespace`。
- Google TypeScript 风格：两空格、单引号、分号、尾随逗号；运行 `pnpm lint:fix`。
- 类型用 UpperCamelCase，变量/函数用 lowerCamelCase，常量用 CONSTANT_CASE，文件名用小写连字符。数据库列和 Liquid 视图字段用 snake_case。
- 优先命名导出，类型使用 `import type`；框架要求的入口可使用默认导出。
- 导出符号写清用途；内部注释说明原因。优先 const、严格相等、提前返回与清晰控制流。
- 错误响应不暴露 SQL、凭据或内部堆栈；日志使用结构化输出。
- `src/core/` 不依赖 Node 或 Cloudflare API；SQL 属于 `src/db/`；核心渲染保持确定性。
- 新依赖需按 [TECH_STACK.md](docs/TECH_STACK.md) 说明版本、所属层与体积影响。

## 提交与验证

使用英文 Conventional Commits，例如 `fix(worker): preserve cache policy`。不提交秘密、`.dev.vars` 或构建产物。

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build && pnpm bundle:size
```

按变更范围补充必要的浏览器或发行包测试。报告实际运行的命令、结果和未验证项。安全问题通过[安全政策](SECURITY.md)指定的私密渠道报告，不创建公开漏洞 issue。
