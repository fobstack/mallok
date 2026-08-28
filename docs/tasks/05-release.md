# Task 05：自包含 0.1 发行与用户测试

- 状态：`BLOCKED_BY_04`
- 依赖：Task 01–04 全部接受，真实 staging 更新与恢复通过
- 用户可见退出结果：目标用户在受支持干净机器安装/打开 Mallok Studio，无开发环境完成建站、预览、发布、更新与恢复
- 验收映射：`AC-05-01` 至 `AC-05-10`，全部适用 `AC-X-*`

## 1. 目标

把已验证的纵向产品制作成一个可交付、可核验、自包含的 0.1 release candidate，并通过目标用户而非维护者画像证明“默认 0 终端、0 配置”成立。npm 包、源码目录或 CLI demo 不能替代 Studio 发行物。

## 2. 开始前依赖

- 首发 OS、最低系统版本、CPU 架构和支持周期已冻结；
- 正式发行物格式、签名/公证或平台来源验证、下载与校验路径已接受；
- 自包含 runtime、许可证/notice、SBOM/清单、漏洞与 secret policy 已接受；
- 项目格式版本、向前升级、不支持降级、备份和卸载保留用户内容的边界已冻结；
- 更新 metadata/下载的签名与 fail-closed 行为已接受；若 0.1 不提供自动更新，界面和文档明确诚实边界；
- 用户研究画像、招募、同意/隐私、设备、计时、允许提示和成功判定已冻结；
- 计划公开仓库 `JasonYv/mallok` 的远端存在性、所有权、许可证、release 权限在发布动作前实际核实；计划名称不是发布证据。

## 3. 范围

### 发行物

- 为一个批准的首发平台生成包含所需 runtime 的 Studio 发行物；
- 从 clean source/candidate SHA 构建，记录依赖锁、SBOM/许可证、产物清单、hash、签名/来源与构建环境；
- 干净机器无 Node、pnpm、Git、Wrangler、全局 Mallok，仍能安装/打开并完成本地流程；
- 升级保留项目和凭据引用，先做兼容检查；失败可回到原应用或给出恢复说明；
- 卸载默认不删除用户项目；降级/不兼容项目不静默迁移或损坏内容；
- 发行物不含 test、fixture、coverage、secret、本机绝对路径、用户项目、内部 prompt 或 staging evidence；`sharp` native addon/libvips 必须来自锁定清单、使用 bundle-relative load path、完整签名且不依赖全局安装。

### 产品收尾与验证

- 首次启动、示例站、模板选择、编辑、预览、发布、重试/恢复的帮助与空状态使用普通语言；
- Studio 和三个官方模板完成自动化加人工 accessibility 复核；
- 冻结环境运行启动、预览、1000 篇导出、发布本地处理、Worker warm response 和 peak RSS 测量；
- 对真实 Cloudflare staging 运行 `SEO_PERFORMANCE.md` 的 PageSpeed Insights mobile 协议，保存全部 lab 报告；另以 release CI secret 中的 CrUX API key 对代表性 URL 与 origin 分别查询 `PHONE|DESKTOP` 的 LCP/INP/CLS p75，保存不含 key 的 request/response/collectionPeriod，并将 field 可用性与 lab 分开记录；
- 至少 10 名规定画像的首次用户完成定时任务测试，记录求助、误操作、手工配置和放弃点；
- 所有适用类别在同一 clean candidate SHA 汇总，发布前关闭 P0/P1；
- 0.1 同时发布复用相同签名 core/Keychain helper 的高级 CLI zip；其命令只是共享 application service 的 adapter，不能成为 Studio 安装、建站或发布主路径。按 [CLI.md](../CLI.md) 逐命令验证 JSON/退出码合同与 Studio parity；移除 CLI artifact 后 Studio 仍要通过全部主路径。

## 4. 非目标

- 第二个桌面 OS/架构，除非负责人书面加入 0.1 支持矩阵；
- App Store/应用商店审核、自动更新服务（若未单独接受）；
- Mallok SaaS、账号计费、自定义域名、多云；
- 模板/插件市场、多人协作、R2 媒体库；
- 用营销基准宣称全面胜过 Astro；0.1 只验证规定内容建站任务更少前置知识和操作。

## 5. 可测试验收

- `AC-05-01`：支持平台干净机器从正式候选发行物完成安装/打开、创建、编辑、预览、静态导出，无外部开发工具。
- `AC-05-02`：来源、签名、版本、SBOM/许可证和产物清单可验证；禁止文件/secret/本机路径扫描通过。
- `AC-05-03`：升级、失败升级、降级提示、卸载和项目兼容矩阵不丢用户内容。
- `AC-05-04`：至少 9/10 目标用户完成创建→模板→编辑→预览，中位时间不超过 3 分钟，且 0 终端/代码配置。
- `AC-05-05`：至少 9/10 从无 Cloudflare 账号开始完成注册、邮箱验证、条款、连接授权和真实首次公网发布，中位时间不超过 10 分钟；已有账号样本单独报告。
- `AC-05-06`：已写文章到公网新内容不超过 3 个显式动作；五类规定错误至少四类仅靠界面到达解决或正确人工升级状态。
- `AC-05-07`：Studio 与三模板通过适用 keyboard、focus、label、读屏、zoom/reflow、contrast、reduced-motion 自动与人工检查。
- `AC-05-08`：同一 clean candidate SHA 的全部适用类别有真实证据且无 P0/P1。
- `AC-05-09`：30 次 staging 更新的 P95、10 人模板切换和连续三小版本升级矩阵达到 PRD 数字门；网络等待、人工提示和失败样本不从统计中静默剔除。
- `AC-05-10`：三个官方模板的真实 staging homepage/article 各 3 次顺序 PSI mobile 运行达到冻结门；CrUX 缺失诚实记录，有数据时按第 75 百分位报告 LCP/INP/CLS。
- 全部 `AC-X-*`：架构、安全、确定性、错误和证据不变量在最终包中成立。
- `AC-X-06`：所有 0.1 公开 CLI 命令与 Studio 共享 use case，JSON/退出码契约通过，Studio 无 CLI 仍能独立运行。

## 6. 精确验证类别

必须在同一候选 SHA 汇总全部适用类别：`DOCS`、`STATIC`、`UNIT`、`COMPONENT`、`FLOW-LOCAL`、`FLOW-EXPORT`、`CLOUD-CONTRACT`、`FLOW-FIRST-PUBLISH`、`FLOW-UPDATE`、`RECOVERY`、`SECURITY`、`DETERMINISM`、`A11Y-STUDIO`、`A11Y-SITE`、`SEO-SITE`、`PAGESPEED-LOCAL`、`PAGESPEED-STAGING`、`PACKAGE`、`PERFORMANCE`、`USABILITY`、`RELEASE`。

每个类别必须链接真实 test path、命令/受控人工协议、结果、环境和 verified SHA。`PACKAGE` 必须来自干净机器；`USABILITY` 必须来自规定画像首次用户；`FLOW-*` 的真实公网结论必须来自授权 staging。类别之间不能互相替代。

## 7. 停止条件

- 发行物只是 npm/tarball/源码，或需要预装 Node、pnpm、Git、Wrangler；
- 产物未签名/来源不可核实，含 secret、开发路径、用户数据或未审许可证；
- 升级/卸载/不兼容项目可能删除或静默破坏用户内容；
- 真人测试未达到 9/10、对应中位时间或三动作门，维护者需要代操作，或出现手工配置/终端；
- accessibility、security、package、staging 或 recovery 存在 P0/P1；
- `JasonYv/mallok`、许可证、域名或 release ownership 尚未远端核实，却准备声称已公开发布；
- 真实 Cloudflare 或 GitHub mutation 没有明确授权与目标。

## 8. 完成报告

发布报告至少包含 candidate SHA、支持矩阵、产物 URL/hash/signature/SBOM/许可证、clean-machine 证据、升级/卸载矩阵、全类别结果、性能协议与统计、去标识用户测试原始记录/汇总、staging ownership/cleanup、所有 P0/P1 关闭证据和未支持边界。只有负责人接受后才能把状态改为 0.1 released；仓库或域名的计划归属不能代替该动作。
