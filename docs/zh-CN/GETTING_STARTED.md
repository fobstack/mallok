# 创建你的第一个 Mallok 网站

[English](../GETTING_STARTED.md) · [中文文档](README.md)

本指南适用于已发布的 **0.1.0-rc.6** 候选版，未完成的验收见[发布状态](RELEASE_STATUS.md)。[公开演示站](https://demo.mallok.dev/)只读；后台和询盘需要部署到自己的账号。

## 1. 生成本地项目

安装 Node.js 22 或更新版本（包含 npm）。部署需要可使用 Workers、D1 和 R2 的 Cloudflare 账号。生成的网站使用 npm；开发 Mallok 源码才使用 pnpm。

```sh
npx mallok create my-site --no-deploy
cd my-site
npx mallok --version
```

命令安装依赖、构建并检查部署配置，不创建云资源。保留生成的 `package-lock.json`。

## 2. 登录并部署

在 `my-site` 目录内运行，使用项目安装的 Wrangler：

```sh
npx wrangler login
npx wrangler whoami
npx mallok create . --slug my-site
```

确认账号正确，为不同网站选择不同 slug。部署会创建 Worker、D1 数据库和 R2 存储桶，不会自动接管项目不拥有的同名资源。

如需首次部署就绑定域名，将最后一条替换为以下命令，把域名换成你在 Cloudflare 管理的主机名：

```sh
npx mallok create . --slug my-site --domain site.example.com
```

中途失败时，保留项目和 `.mallok/create-state.json`，修复提示的问题，再用相同 slug、域名重跑。不要删除记录文件，也不要用 `destroy` 重试。已经完成的 create 不会重复部署代码。

CLI 会显示一次性 **setup key**，初始化前请私密保存。Cloudflare 登录用于管理基础设施，setup key 用于认领后台，两者都不是 Mallok 内容 API token。

## 3. 初始化后台

打开 CLI 输出的 `/_mallok/setup` 地址：

1. 输入至少 12 位的管理员密码和 setup key。
2. 设置网站名称。面向海外用户可将主语言设为 `en`，其他语言填 `zh` 等；次语言带 URL 前缀。
3. 安装示例内容或跳过。示例企业、产品和宣传数据都是占位内容，正式使用前请替换。
4. 检查域名信息并完成初始化。

后台位于 `/_mallok/app`。如果使用 `workers.dev` 地址，评估边缘缓存前先按向导说明绑定自定义域名。未配置清缓存凭据时，向导使用较短缓存有效期，检查修改结果时要等待缓存过期。

## 4. 发布第一个产品

在 **Content** 编辑示例产品，或新建主题支持的内容类型。填写标题、slug、语言、Markdown 正文及产品字段。通过 **Media** 或编辑器媒体选择器上传自己的图片，替换示例参数。

先用 **Save draft** 保存草稿，再点 **Publish**。退出登录或使用独立浏览器检查公开页面的标题、图片、正文和语言链接。再次修改并发布，等待缓存失效或过期后确认更新。发布内容无需重新构建代码。

在 **Settings** 修改网站资料和外观。修改主题代码或安装的插件代码需要重新构建与部署。

## 5. 配置询盘

公开静态演示站不能收集询盘。在自己部署的后台进入 **Plugins → Inquiry**：

| 配置 | 填写内容 |
| --- | --- |
| Recipient email | 你控制并会检查的收件邮箱 |
| From address | Resend 账号中已验证的发信地址 |
| Send buyers an automatic confirmation | 准备好给买家发送确认邮件后再开启 |
| Turnstile site key | 允许当前网站域名的公开站点密钥 |
| Thank-you page path | 已发布的感谢页路径，例如 `/thank-you` |
| Resend API key | 填入插件专用秘密字段 |
| Turnstile secret key | 填入配套的插件秘密字段 |

保存设置和秘密字段，启用插件。不要将密钥写入文章、源码或公开 site key 字段。启用后，内容中的 `[[inquiry]]` 会渲染为询盘表单。

用自己控制的邮箱提交明确标注的测试询盘，分别检查感谢页、后台询盘记录以及真实收件箱。开启自动回复时，还要检查买家邮箱。跳转成功或 API key 检查通过不等于邮件已送达。本版本的真实 Turnstile 与 Resend 邮件送达验收仍待完成，见[发布状态](RELEASE_STATUS.md)。

## 6. 导出内容

在后台账号页创建带 export 权限的 API token，通过私密方式设置 `MALLOK_TOKEN` 环境变量，然后执行：

```sh
npx mallok export ./site-backup --url https://site.example.com
```

将域名替换为实际网站地址。分别保管导出内容与项目配置；内容导出不等于所有云资源和密钥的完整备份。其他操作见[CLI 参考](../CLI.md)。
