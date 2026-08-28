# Mallok 0.1 声明式模板格式

- 状态：Accepted 0.1 template format
- 格式版本：`1`
- 发行范围：仅 binary 内置模板

0.1 模板是 Mallok 源仓库内维护、随 binary 发布的声明式 HTML/CSS 资源，不是站点代码。站点只能选择内置模板并填写有限 design token；不能安装、上传或执行自定义模板、JavaScript、npm package 或 plugin。

## 1. 内置模板

0.1 固定提供三个模板：

| id | 用途 |
| --- | --- |
| `journal` | 文章优先的博客/新闻布局 |
| `docs` | 导航与阅读优先的知识库布局（0.1 无搜索） |
| `company` | 首页、介绍与内容并重的企业官网布局 |

三者使用同一内容模型、route、feed 和安全规则，只改变声明式布局与 CSS。模板不能借自己的 id 增加内容字段或 URL。

## 2. Binary 内部布局

```text
templates/journal/
├── template.json
├── home.html
├── article.html
├── page.html
├── not-found.html
├── partials/
│   └── footer.html
└── style.css
```

`template.json` 只包含 `formatVersion`、`id`、`version`、显示名称、固定 entrypoint 和静态 asset 清单。所有 path 是模板根相对 literal；不得由表达式生成。

模板在 release build 时完成 parse、include closure、HTML structure 和 CSS 检查，并作为 bytes 嵌入 binary。运行时再次验证 manifest/hash，不能从站点目录或网络加载同名文件。

## 3. 语法

HTML 使用成熟 Liquid 实现，并由 Mallok Template Profile 锁死为下面的声明式子集。实现者不得自写 Liquid parser，也不得开放底层引擎的完整语法：

```liquid
<h1>{{ page.title }}</h1>

{% if page.description %}
  <p>{{ page.description }}</p>
{% endif %}

{% for article in articles %}
  <a href="{{ article.url }}">{{ article.title }}</a>
{% endfor %}

{% render_content page.body %}
{% include "partials/footer.html" %}
```

唯一允许的控制语法：

- `{{ value }}`：在当前位置按类型转义输出 scalar；
- `{% if value %}`、`{% elsif value %}`、`{% else %}`、`{% endif %}`；
- `{% for item in collection %}`、`{% else %}`、`{% endfor %}`；
- `{% include "literal-relative-file.html" %}`：只能静态 literal，include graph 无环；
- `{% render_content page.body %}`：只接受 compiler mint 的 sanitized content fragment；
- `{% asset_url "literal-template-asset" %}`：输出本 bundle 中对应内容寻址 URL。

允许的纯 filter 只有 `default`、`join`、`date_iso`、`date_human`、`lower`、`upper`。它们不读取 locale、clock 或 environment；`date_human` 使用 project language 和 Mallok 固定表，不调用主机 locale formatter。

明确禁止：

- `raw`、`safe`、任意 HTML bypass；
- assign/capture/macro/eval、动态 include、动态 property name；
- function call、对象 method、prototype lookup、constructor；
- filesystem、network、environment、clock、random；
- script/style body interpolation、event attribute、`srcdoc`；
- JavaScript、Wasm、npm module 或 plugin hook。

未知 tag/filter/property 一律编译失败，不能原样输出。

## 4. 类型化 context

模板只能看到深度冻结、无 getter/Proxy 的 plain data：

```ts
interface TemplateContextV1 {
  readonly site: {
    readonly title: string;
    readonly description?: string;
    readonly logoUrl?: string;
    readonly canonicalUrl?: string; // preview 未建立公开 origin 时不存在
    readonly language: string;
  };
  readonly template: {
    readonly id: "journal" | "docs" | "company";
    readonly options: {
      readonly accent: string;
      readonly font: "sans" | "serif";
      readonly density: "compact" | "comfortable";
    };
  };
  readonly page: PageView;
  readonly articles: readonly ArticleSummary[];
  readonly navigation: readonly NavigationItem[];
}
```

`PageView` 只暴露 id、kind、title、description、cover URL/alt、SEO title/description、可选 canonical URL、published/updated time、tags 和 compiler-owned body fragment。Markdown source、绝对 path、environment、Cloudflare id 和 credential 不进入 context。publish context 的 canonical 必须存在；preview 没有公开 origin 时不存在，模板不得自行拼 loopback canonical。

普通 string 在 HTML text/attribute/URL context 分别 escape。模板不能选择 escape mode。`render_content` 是唯一 raw HTML 通道，其值只能来自固定 Markdown sanitizer；普通 string 即使结构相同也不能传入。

URL 字段在进入 context 前已经按用途验证。template literal 中只允许 `https:` canonical URL、站内 absolute path、`mailto:`（仅显式 contact 字段）和 compiler 生成的 asset URL；禁止 `javascript:`、data、protocol-relative 和动态 scheme。

## 5. HTML 与 CSS 边界

每个 entrypoint 必须产生一个 `html`、一个 `head`、一个 `body` 和唯一 main landmark 的完整 HTML5 document。模板源只声明视觉 head 资源；compiler 按 [SEO_PERFORMANCE.md](SEO_PERFORMANCE.md) 注入 UTF-8、viewport、title、description、canonical、分享 metadata 和 preview/404 robots 语义，再对最终 bytes 用 HTML5 parser 重解析。模板不得维护第二套 SEO head，也不能只靠字符串扫描验收。

公开模板不得生成：

- inline 或 external `<script>`；
- inline `<style>`；
- iframe/object/embed/form/meta refresh；
- event handler attribute；
- template 未声明的 remote stylesheet/font。

0.1 compiler 同样不生成 JSON-LD script；结构化数据等到内容模型具备准确作者/发布主体且 CSP/hash 方案另行接受后再加入。Lighthouse SEO 100 不能被解释为已经验证 structured data。

`style.css` 是随发行物签名的静态 CSS，不执行 Liquid-like 表达式。compiler 先生成只含经过类型验证的 `--mallok-accent`、density spacing 和 Mallok 内置 font stack 的 token rules，再按固定 UTF-8/LF 顺序 `token rules + one LF + style.css` 直接合并和内容寻址，不在用户机器上运行另一套 CSS minifier。页面与 PublishBundle 只得到这一份最终 CSS asset，不产生独立 `tokens.css`；站点 string 不直接拼进 CSS。

0.1 `style.css` 禁止 `@import`、`@font-face` 和任何 `url()`；官方模板不携带图片或字体 asset，视觉装饰只能使用颜色、边框、渐变和其他不发请求的 CSS。该限制由 release-time CSS parse/test 强制，不能靠运行时字符串替换绕过。

## 6. 固定 entrypoint

| entrypoint | 用途 |
| --- | --- |
| `home.html` | `/` |
| `article.html` | `/articles/<slug>/` |
| `page.html` | 普通 `/<slug>/` |
| `not-found.html` | `/404.html` 与 Cloudflare 404 body |

四个 entrypoint 都产生完整 document；可通过静态 include 复用 `partials/`，不实现 layout inheritance、block 或动态 slot。

RSS、sitemap 和 robots 由 compiler serializer 生成，SEO head 由 compiler projection 生成，都不交给模板，避免视觉布局改变协议或搜索语义。

## 7. Determinism 与预算

- 相同 context、模板 bytes 和 binary version 必须输出相同 UTF-8 bytes；
- object key 不可枚举为页面顺序，所有 collection 由 compiler 预先排序；
- 模板最大 include depth 8、单文件最大 128 KiB、总模板 bytes 最大 1 MiB；
- 单 route 渲染步骤有固定 iteration/output budget；超过即 `TEMPLATE_BUDGET_EXCEEDED`，不能挂起 Studio；
- error 只报告模板 id、entrypoint、稳定 code 和 source line，不包含用户 home path。

## 8. 扩展政策

0.1 不接受用户模板目录，即使格式看似符合本文。先用三个内置模板验证 context 和 design token；只有出现真实第三方模板需求后，才能另立 ADR 决定签名、分发、兼容和支持边界。

未来开放声明式模板也不得自动开放 JavaScript/plugin API。模板格式升级使用新的整数 `formatVersion`；旧 binary 遇到未知版本 fail closed。
