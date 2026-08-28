# Mallok 0.1 二进制发行策略

- 状态：Accepted 0.1 distribution contract
- 发行单元：一个 Bun application core + 一个窄 Keychain helper；普通用户获得签名的 `Mallok.app`

Mallok application core 用 TypeScript 开发，并由 Bun 编译为包含运行时的自包含 executable。0.1 把该 core 与一个无业务逻辑的签名 Swift Keychain helper 包进标准 macOS 应用包；用户双击打开 Studio，不需要安装 Bun、Node.js、npm、pnpm、Wrangler，也不需要把命令放进 `PATH`。Bun 官方支持将 TypeScript 和依赖编译为 standalone executable，但“可以交叉编译”不等于 Mallok 已支持对应平台。

## 1. 单产品、单版本

一个 release tag 同时绑定：

- `Mallok.app` 内的 `mallok` executable；
- `Mallok.app` 内的固定协议 `mallok-keychain-helper`；
- embedded Studio frontend；
- 三个 built-in template；
- generic Cloudflare Worker 和 D1 schema；
- project/bundle/runtime protocol 支持矩阵；
- 文档、checksum、signature、SBOM 和 source commit。

不分别发布 core、CLI、Cloudflare adapter、template SDK 或 `create-mallok` package。内部模块没有独立 semver。

## 2. 0.1 支持平台

0.1 只承诺一个 Tier 1 平台，用最小矩阵先验证产品而不是同时维护三套桌面发行：

| target | artifact |
| --- | --- |
| macOS 13+ Apple Silicon | 签名并公证的 `Mallok-0.1.dmg`，内含 `Mallok.app` |

Windows x64 是下一优先平台；macOS Intel 和 Linux CLI 根据真实需求排序。它们在拥有独立 CI、文件系统、credential store、浏览器启动、安装和真人测试前不作支持承诺。unsupported 平台可以从 source 开发运行，但不能标成发行版已验证。

Tier 1 发行物必须在没有 Bun、Node 和 package manager 的 clean machine 完成：双击安装/启动、create/open project、loopback Studio、compile、static export、credential store 和 embedded resource hash smoke。高级 CLI 以同一签名 core/helper 组成 `MallokCLI-0.1-macos-arm64.zip`，不复制业务代码，也不作为普通用户验收入口。

## 3. Binary 内容

binary只嵌入：

- application/domain/compiler代码；
- Studio静态HTML/CSS/JS；
- 三个声明式模板；
- generic Worker、D1 schema和protocol metadata；
- `sharp` 在 Tier-1 所需且 dependency gate 已核验的 macOS arm64 native addon/libvips runtime files；
- 最小MIME/locale/error/help数据。

不得嵌入source map中的开发机路径、test/fixture、Cloudflare credential、release token、用户项目、package registry credential或未使用runtime。

binary启动不下载component、template、plugin、browser或compiler。0.1没有install hook和self-update code。

### 3.1 Studio 进程生命周期

- `Mallok.app` 每个 macOS 用户只运行一个 loopback backend；再次打开 app 时复用健康进程并打开一个新的单次认证 browser tab，不启动第二套业务状态。
- runtime rendezvous 只使用用户私有、权限 `0700/0600` 的 Application Support 目录和 Unix socket；验证 peer UID、binary version 与进程存活，stale state 只能在验证后清理。
- backend 只绑定 `127.0.0.1` 的 OS-assigned ephemeral port，不扫描固定端口；每次打开 tab 使用新的 fragment capability。
- Studio 提供明确的“退出 Mallok”。最后一个 authenticated tab 消失且没有保存、导出或发布操作时，backend 在 5 分钟 idle grace 后退出；有操作时先写入可恢复状态并走到安全终点，再重新开始 idle grace。
- 0.1 不安装 daemon、login item 或后台 updater。非 UI CLI 命令不启动长期 Studio server；`mallok preview` 只在当前进程存活期间提供 loopback URL，收到正常 signal 后安全关闭。

## 4. 安装渠道

权威渠道是项目 GitHub Release 中签名、公证的 DMG、`SHA256SUMS`、detached signature 和 SBOM。普通用户下载 DMG、把 `Mallok.app` 拖入 Applications 并双击打开；不得要求 Terminal、`PATH` 或 shell profile。

应用包只做最薄封装：`Contents/MacOS/mallok` 是唯一业务执行核心，`Contents/Helpers/mallok-keychain-helper` 只封装固定 Keychain CRUD，批准的 `sharp` native addon/libvips 只放在 bundle-relative 的 `Contents/Frameworks`/`Contents/Resources` 固定清单中，Info.plist 负责应用身份、图标和 OAuth callback；不得引入 Electron 或第二套业务 runtime。executable、helper 与全部 nested native code 使用同一 release/build provenance 并完整 codesign/notarize；加载路径必须是 bundle-relative，不能搜索 Homebrew、系统或用户目录中的 libvips。entitlements 采用最小集合并单独安全审查，不能照抄宽泛示例。

Homebrew 等 package manager 可以作为后续高级分发层，但只能下载并校验同一权威 executable。npm shim、curl-pipe-shell installer、自动修改 shell profile、后台 daemon 和自动启动项不属于 0.1。

卸载只删除 `Mallok.app`；用户 project 和 credential store 默认保留。删除 credential 或下线远端站点必须在 Studio 中单独、明确执行。

## 5. Source build

Mallok源码仓库可以使用根`package.json`和Bun lockfile管理开发依赖；锁定Bun版本和所有direct/transitive dependency。标准release由干净CI checkout生成，不从开发者dirty tree发布。

source build产物必须经过与官方artifact相同的test和content scan。由于code signing identity不同，社区build不能冒充官方signedbinary。

## 6. Version 与兼容

binary使用SemVer。下列machine format各有整数版本但由同一release统一维护：

| format | 0.1 version | 兼容规则 |
| --- | --- | --- |
| project | `1` | unknown fail closed；显式backup/migrate |
| PublishBundle | `1` | sink/Worker capability必须接受 |
| template | `1` | 只用于embedded template |
| Cloudflare protocol/schema | `1` | 普通publish不自动upgrade |

binary打开project前检查format；publish前读取Worker capability。需要runtime upgrade时给精确命令和影响，不得把upgrade藏在普通publish中。

patch release 不得改变同一输入的 bundle bytes，除非修复安全/正确性 bug；若改变规范输出语义，release note 必须说明并提升 `compilerOutputVersion` 和适用的 template version，使新 `bundleHash` 自然变化。完整 binary version 不进入 canonical manifest；project 作者数据不能因 binary update 自动改写。

## 7. Update 与 rollback

0.1 不实现后台 self-update。用户可在 Studio 的“关于 Mallok → 检查更新”中显式读取签名的权威 release metadata，查看版本/兼容影响并打开官方下载；高级 CLI 的 `mallok version check` 调用同一 use case。默认不联网、不遥测、不弹后台升级。

升级方式是下载新的已签名/公证 `Mallok.app`，由 Studio 说明安装步骤和项目兼容影响；普通用户不使用命令替换 binary。Cloudflare runtime upgrade 是发布页中独立、显式确认的维护动作，也有同能力的高级 CLI 入口。新 app 若不能读旧 project，必须先生成 backup 和 migration plan。

binary rollback不能自动downgrade已经迁移的project或Cloudflare schema。文档必须列出每个release可读的format/protocol，而不是用SemVer猜测。

## 8. Release pipeline

release必须在同一source commit完成：

1. lint、typecheck、unit/integration/security；
2. project/bundle/templategolden；
3. static/Cloudflare sink contract与fault injection；
4. 三个官方模板的 technical SEO、sitemap、受管图片与固定版本 Lighthouse gate；
5. Tier 1 executable 与 `Mallok.app`/DMG 构建；
6. macOS 13+ Apple Silicon clean-machine 安装与双击启动 smoke；
7. archive content、secret/history、license、advisory和SBOM检查；
8. code sign/notarize；
9. 生成并签名checksum；
10. 人工核对release notes、format/protocol矩阵及真实 staging PSI/CrUX 可用性证据；
11. 发布immutableartifact。

任一平台未实际smoke只能标为unverified，不能根据另一平台结果推断。release失败不得部分覆盖同versionartifact；新bytes使用新version。

## 9. 平台 adapter 边界

平台差异只允许位于：

- executable packaging/signing；
- browser launch；
- atomic replace/file permission；
- OS credential store。

compiler、projectformat、bundlehash、templateoutput、staticlayout和Cloudflareprotocol必须跨Tier 1一致。平台没有可用credential store时只允许environment fallback，不能发明plaintextproject secret文件。

## 10. 维护预算

0.1 最多维护一个 Tier 1 GUI artifact、一个复用同一 core/helper 的高级 CLI zip、一个 source build 流程和一个 release version。新增平台、installer、package-manager channel 或 auto-updater 必须有独立 CI、安全模型和维护 owner；不能因为 Bun “可以 cross compile”就自动声称支持。

## 11. 外部能力依据

- Bun 官方 `--compile` 可以把 TypeScript/JavaScript、依赖与 Bun runtime 打进 standalone executable，并列出 macOS/Windows/Linux targets：[Single-file executable](https://bun.sh/docs/bundler/executables)。
- Bun 当前要求 macOS 13.0 或更高版本：[Installation](https://bun.sh/docs/installation)。

这些是选择 Bun 的可行性依据，不是 Mallok 发行物已经签名、兼容或通过干净机器测试的证据。
