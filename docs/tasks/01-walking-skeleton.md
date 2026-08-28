# Task 01：Studio walking skeleton

- 状态：`READY_FOR_IMPLEMENTATION`
- 依赖门：编码前必须满足 `AC-00-*` 与本任务全部前置决策
- 用户可见退出结果：打开 Studio，完成“创建站点 → 选择模板 → 编辑文章 → 内嵌预览”，关闭后可重新打开项目
- 验收映射：`AC-01-01` 至 `AC-01-07`，以及适用的 `AC-X-*`

## 1. 目标

交付第一条真实但最薄的产品纵切。它必须同时包含 Studio 界面、application service、最小领域规则、本地持久化、一个受信任模板和预览 adapter。不得先交付一组无人能使用的底层包，再把 Studio 推迟到后续任务。

默认用户全程不打开终端、不登录账号、不安装 Node/pnpm/Git，不编辑 JSON/YAML/TOML 或环境变量，也不需要知道 Markdown frontmatter。

## 2. 开始前依赖

实现以 [TECH_STACK.md](../TECH_STACK.md)、[EDITOR.md](../EDITOR.md)、[PROJECT_FORMAT.md](../PROJECT_FORMAT.md) 和 [TEMPLATE_VISUALS.md](../TEMPLATE_VISUALS.md) 已冻结的选择为准。实现者在改代码前记录：

- 锁定的 Bun 和直接依赖精确版本，必须位于已批准包名清单；
- 编辑器的无损/可访问性验证 fixture 和结果；
- core/application/Studio/test 的实际源码根目录和依赖方向；
- Task 01 的 allowed-path 清单、base SHA 和 dependency-only diff 审批结果。

实际路径只是内部实现记录，不再需要新的产品决策。若已批准依赖无法满足契约，必须 BLOCKED 并提交最小替代决策，不得自行换栈。

## 3. 范围

### Studio 用户流程

1. 首次启动显示“创建站点”和“打开站点”，而不是命令或配置说明。
2. 创建向导只收集站点名称、用途、模板和本地保存位置四个显式决定；语言根据系统推断，描述和语言都可在创建后从“站点”设置修改。
3. 创建过程先写入隔离的临时状态，完成校验后再原子成为有效项目；取消或失败不留下可误开的半项目。
4. 编辑页以可视模式修改一篇示例文章的标题和正文，可切换 Markdown source；底层写出规范、可携带的 Markdown，不支持节点不得静默丢失。
5. Studio 内嵌显示首页和文章页。编辑成功后更新预览；编译失败保留最后一次成功预览并指向具体可修复字段。
6. 关闭并重开 Studio 后，可以从最近项目或“打开站点”恢复同一内容。
7. 再次打开 `Mallok.app` 复用同一 backend并打开新的已认证 tab；关闭 tab、显式退出、idle shutdown 和 stale process state 按 `DISTRIBUTION.md` 工作，不留下无界后台进程。

### 最小纵向能力

- create/open project、update site metadata、update article、preview project 五个明确 use case；
- Studio 只通过 application port 调用这些 use case，不直接承担 slug、持久化、模板渲染或错误翻译规则；
- 本地文件 adapter 采用临时写入、fsync/等价持久化与原子替换，失败不覆盖上一份有效内容；
- 一个声明式、随产品分发的 fixture 模板；模板不能执行任意 JavaScript 或访问文件/网络；
- preview adapter 只消费与未来导出/发布共用的编译结果，不建立第二套渲染真相；
- 稳定内部错误 code 与普通语言消息；技术详情可展开，但不能成为继续操作的前提；
- 为本任务首次使用的验证类别建立真实 registry、test path 和可执行入口。

实现前在任务报告中列出实际路径映射，例如 `Studio shell`、`application`、`domain/compiler`、`local adapter`、`template fixture`、`tests` 分别落在哪些目录；这些路径必须符合已接受架构，不能靠本文虚构尚不存在的目录。

## 4. 非目标

- 第二、第三模板，图片管理，完整 SEO，静态导出；
- Cloudflare、D1、账号、远程网络请求和公网 URL；
- 自包含生产安装包、签名、自动升级；
- 公开 CLI、插件、第三方模板、自定义代码组件；
- 富文本协作、多人、版本历史或 SaaS 控制面。

## 5. 可测试验收

- `AC-01-01`：从 Studio 首屏创建项目，默认流程 0 终端、0 手写配置、0 外部 runtime 安装。
- `AC-01-02`：名称、用途、模板和保存位置四项创建合同可以生成可重开的有效项目；语言自动推断且稍后可改，取消、无权限目录和中途失败无半状态。
- `AC-01-03`：编辑、保存、关闭、重开后标题与正文一致，规范项目内容可由独立测试读取。
- `AC-01-04`：首页/文章预览可访问；成功编辑刷新预览，失败保留 last-known-good；重复启动、关闭 tab、显式退出与 idle shutdown 的单实例生命周期有端到端证据。
- `AC-01-05`：同一 use case 可在无 UI composition root 中测试；禁止 Studio shell out 到 CLI，禁止 UI 复制领域规则。
- `AC-01-06`：首次任务测试中主路径不出现 Node、pnpm、Git、D1、Wrangler、binding、migration、CAS 等术语。
- `AC-01-07`：visual/source 往返与 unsupported-node 回退语义按 EDITOR 契约测试，保存后从磁盘 Markdown 重新解析得到相同受支持语义。
- 适用 `AC-X-*`：路径、内容、错误和输出确定性边界不因 walking skeleton 被绕过。

## 6. 精确验证类别

必须建立并通过：`DOCS`、`STATIC`、`UNIT`、`COMPONENT`、`FLOW-LOCAL`、`A11Y-STUDIO`。

这些是 [TESTING.md](../TESTING.md) 的类别 ID，不是当前已存在的命令。实现者必须在报告中为每个 ID 写出实际 test path、实际命令、退出码、环境和 verified SHA；空脚本、截图或直接调用 reducer 不能冒充 `FLOW-LOCAL`。

## 7. 停止条件

出现任一情况立即停止并报告，不得缩小验收或偷偷换实现：

- 默认流程要求终端、配置编辑、Node/pnpm/Git 或账号；
- Studio 需要启动 CLI 子进程，或 UI 开始拥有独立业务规则；
- 宿主、项目格式、模板信任边界或实际目录仍未接受；
- 保存/创建失败可能覆盖上一份有效项目或留下真假难辨的半状态；
- preview 与未来 PublishBundle 明显需要两套编译语义；
- 新依赖未经过版本、许可证、engine、安装脚本、体积和 runtime 归属审查；
- 需要未批准的网络、凭据、远程 mutation 或任务外路径。

## 8. 完成报告

报告必须包含 base/head SHA、用户流程录像或去敏操作证据、AC→实现→测试映射、实际验证命令和退出码、支持环境、依赖变化、changed-files/allowed-path 审计、未验证项与剩余风险。只有独立复验接受后 Task 02 才能开始。
