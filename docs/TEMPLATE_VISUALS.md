# Mallok 0.1 官方模板视觉契约

- 状态：Accepted for 0.1
- 适用：`journal`、`docs`、`company` 三个内置模板

本文冻结视觉角色、响应式行为和可见设置，让 Task 02 不需要实现者现场发明产品。它不是第三方模板 API。

## 1. 共享设计系统

### 1.1 只有三个可调 token

| token | 值 | 行为 |
| --- | --- | --- |
| accent | valid `#RRGGBB` | 用于 link、focus、小面积强调；不盲目用作正文字色 |
| font | `sans | serif` | sans 为系统 UI stack；serif 为 Georgia/Times 系统 stack；不请求远程 font |
| density | `compact | comfortable` | 调整 spacing/line-height，不改变 DOM、route 或内容 |

Logo 属于站点设置，不是模板 token。0.1 没有自由分栏、拖拽布局、字号、边框半径、阴影或自定义 CSS 控件。

### 1.2 共享可访问性

- 页面顺序固定为 skip link → header/nav → main → footer。
- 文字/背景以 WCAG 2.2 AA 为下限；accent 不达标时自动选用深色派生色，不接受“用户选的颜色”作为豁免。
- focus ring 至少 2 px、不被截断；所有主要区域有 landmark/heading。
- 动画不是理解前提；`prefers-reduced-motion` 下关闭非必要 transition。
- 图片使用 compiler 优化后的受管 asset，保留准确 width/height/aspect-ratio，默认 lazy-load；每页最多一个首屏/LCP 主图可 eager + `fetchpriority=high`，但不加 JS lazy loader。
- 公开模板不输出 client JavaScript。

### 1.3 响应式基线

- mobile：`< 720px`，单列，主要操作不依赖 hover。
- desktop：`720px–1119px`，模板可使用双列，但正文阅读宽度不超过 76ch。
- wide：`≥ 1120px`，最大页面宽 1200px；不因屏幕变宽无限拉伸正文。
- 必测 viewport：390×844、1024×768、1440×900，以及 200% zoom/reflow。

## 2. Journal：编辑部感的文章站

目标：让博客、新闻和长文站看起来像编辑过的出版物，而不是默认开发者博客。

```text
desktop
┌ logo/name ─ navigation ─────────────┐
│ featured article: title + summary + cover │
├ latest stories ────────────────┤
│ article cards in 2 columns             │
└ footer                                  ┘
```

- 默认 font 为 serif，导航/元数据用 sans。
- 首页第一篇 published article 作 featured；没有 cover 时使用排版而不生成占位图。
- 文章页 max-width 720px，标题、summary、日期/tags、cover、body 顺序固定。
- mobile 卡片改为单列，不隐藏 summary 或日期。

## 3. Docs：导航优先的知识站

目标：让小型知识库一打开就知道“我在哪里、还能看什么”。0.1 没有搜索，不显示假搜索框。

```text
desktop
┌ site header ───────────────────┐
│ left navigation │ page title + content │
│ up to 8 items  │ max 76ch            │
└ footer ─────────────────────────┘
```

- 默认 font 为 sans，浅色背景、高对比代码块。
- desktop 左导航宽 240–280px、当前页同时用文字和形状标记，不只用颜色。
- mobile 导航使用原生 `<details>` 展开，无 JavaScript；默认显示当前页名称。
- 页面过长时不自动生成新的内容模型；目录/搜索延后到 P1。

## 4. Company：克制的业务与内容官网

目标：给小企业、产品和工作室一个不需要拖拽搭建器的正式首页。

```text
desktop
┌ logo/name ─ navigation ─────────────┐
│ home title + description + optional cover │
│ rendered home body (headings/lists/images)   │
├ latest 3 articles ────────────────┤
└ footer                                      ┘
```

- 默认 font 为 sans，大标题、小面积 accent、克制边框，不使用漂浮渐变或无意义动画。
- 首页正文来自 `home.md`；模板不增加 hero/features/testimonials 等私有 frontmatter。用户用标题、列表、引用和图片组织业务信息。
- 如有 published articles，首页底部显示最新 3 篇；没有时整区不输出。
- mobile 全部单列，主要标题不超过 3 个视觉行为设计目标，不通过截断内容达成。

## 5. 必须输出的页面

三个模板都必须完整支持：

- home、普通 page、article、404；
- 标准 header/navigation/footer、canonical/SEO metadata；
- 同一个 compiler-owned SEO head；模板不得自定义 canonical、sitemap 或分享 metadata 语义；
- 无 Logo、无 cover、无 article、长标题、长 URL、中英文混排和 900 张 media 边界 fixture；
- RSS/sitemap/robots 由 compiler 生成，不为每模板发明视觉版本。

## 6. 视觉验收

Task 02 对每个模板产出同一 canonical fixture 的 390、1024、1440 宽度 screenshot baseline，但 screenshot diff 不是唯一验收。还必须通过：

1. HTML5 结构与 landmark/heading 顺序；
2. 键盘导航、focus、读屏名称、200% zoom/reflow、contrast 和 reduced motion；
3. 无 client JavaScript、无远程 font/script/style、无 layout overflow；
4. accent/font/density 全组合和缺失可选数据；
5. 同内容切换三模板后 ID、slug、route、SEO 与 media 引用 100% 保留。
6. `SEO_PERFORMANCE.md` 的 CSS、首屏传输、图片、Lighthouse 和 sitemap/head 合同。

任何新视觉能力若需要新内容字段、JavaScript、remote asset 或用户 CSS，不能在 0.1 “顺手”加入。
