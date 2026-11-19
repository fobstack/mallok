# A simpler admin: direction and plan

- Status: **decided**. On 2026-11-19 the owner took every recommendation
  in §4 as written ("可以 搞吧"): D1–D10 as recommended, D5 as option A
  (assisted Markdown first, a Tiptap spike before anything more). Built so
  far: G1 (`c83be67`), ahead of phase 4 because it unpublishes live pages;
  G10's "URL 别名" (`6cdfb0c`). The width draft of §2.2 is superseded by D7
  and kept only as a stash.
- Date: 2026-11-19
- Asked for by the owner on 2026-11-19: "我的目的就是，如果登录到 admin 后，
  操作要简单，参考主流的 CMS 后台，而不是那么极客。" Once signed in, operating
  the admin should be simple, modelled on mainstream CMS admins, and not so
  geeky. The owner asked for a direction for the whole admin, not a list of
  single fixes.
- Measured at `ffec401` (`main`) plus the uncommitted draft on
  `feat/admin-wide-lists` (five files, 13 lines; §2.2).
- Follows `ADMIN_I18N_AND_UI.md`, which translated the admin and fixed
  findings U1–U20. Nothing done there is proposed again; where this plan
  changes something that plan decided, it says so and makes it a decision.

## 1. Goal

1. A person who runs a trade company's site, reads Chinese, and is not a
   developer can do the daily work — read an inquiry, add a product, fix a
   sentence, publish a news item — without meeting a word or a control they
   have to ask someone about.
2. The admin looks and behaves like the admins that person may already
   know (WordPress, Shopify), in structure, not in decoration: a home
   screen, lists by content type, a writing-first editor, settings that
   show the common case first.
3. Everything that makes it "geeky" today is still reachable, one step
   further away, for the person who deployed the site.

Out of scope: the public site and its themes' templates; the CLI; new
content features beyond the ones named in §6 (revision history, multiple
users and roles, bulk edit, a navigation editor); a third interface
language; right-to-left layout; decoration (colours, illustration, brand).
A full visual editor is not in this plan's phases; whether to bring it
forward is decision D5.

## 2. Where it is today

### 2.1 The evidence, and its limits

| Source | What it is |
| --- | --- |
| `.tmp/tour/` | 29 screenshots, 2026-11-19: the wizard (English), every admin page at 1440 px and 390 px in Simplified Chinese, the editor on a product and on a new item, the account menu. Starter `trade-b2b`, theme Atelier 2.5.2, content languages English and Chinese |
| `.tmp/wide/before`, `.tmp/wide/after` | 21 pairs for the uncommitted width draft, English interface, sidebar open and closed, 1280–2560 px |
| The code | `src/admin` (7,784 lines in `pages/` and `components/`), `src/worker/admin*.ts`, the inquiry plugin's and Atelier's manifests. A claim taken from code says so |
| `node scripts/admin-size.mjs` | Run on the existing build of 2026-11-19 07:13: **first load 166.3 KiB gzip of 170**, 478.6 KiB loaded on demand |

Limits, so that nothing below is read as wider than it is:

- **The tour was captured with the width draft applied.** In the images the
  content list starts 291 px from the left at 1440 px and the settings
  pages 339 px; on `main` both start at 339 px.
- **`login-1440.png` is not the sign-in page.** It shows the content list
  in English. The sign-in page is not reviewed here.
- **Inquiries and Media were captured empty.** What a row looks like is
  taken from the manifest and the code, not seen.
- The sidebar shows "目录条目" and "Catalog log". They belong to a test
  plugin ("A test plugin: products with a price and variants") in the
  instance that was photographed, not to a real site.
- Light scheme only; macOS only.

### 2.2 The width draft, measured

The shell centres one column (`mx-auto`) inside the area beside the
sidebar. On `main` the column is 68 rem (1,088 px). The draft adds a second
width, 90 rem (1,440 px), for the content list, Media and plugin panels,
and leaves forms at 68 rem.

| Window, sidebar open | `main`: band left of the content | Draft: list pages | Draft: form pages |
| --- | ---: | ---: | ---: |
| 1440 px | 83 px | 35 px | 83 px |
| 1920 px | 323 px | 147 px | 323 px |
| 2560 px | 643 px | 467 px | 643 px |

Computed from the classes in `shell.tsx` (256 px sidebar, `max-w-[68rem]`
or `max-w-[90rem]`, 35 px padding at these widths) and checked against the
images: 579 px and 403 px left edges at 1920 px, 723 px at 2560 px.

Two things follow. The draft does remove the wrapped paths: at 1920 px the
longest path in the starter no longer breaks mid-word. But **it gives the
admin two left edges**: moving from Content to Settings shifts the heading
48 px at 1440 px and 176 px at 1920 px, and the band beside the sidebar is
still there, only narrower. The band comes from centring, not from the cap.
D7 proposes the alternative.

### 2.3 What makes it geeky, ranked

Severity is how much a finding hurts the operator of §1: **1** — it
misleads them or stops a daily task; **2** — it makes them hesitate, ask,
or learn a concept they should not need; **3** — it is noise.

| # | Sev | Where | What is wrong | Evidence |
| --- | :-: | --- | --- | --- |
| G1 | 1 | Editor | **"Save draft" on a published item takes it off the site**, with no warning: the two buttons always send `status: 'draft'` or `'published'`. An operator fixing a typo who presses the safer-sounding button unpublishes the page. Every mainstream admin changes the button to "Update" once an item is live | Code: `pages/editor.tsx`, `save('draft')` |
| G2 | 1 | Editor | The centre of the editor is raw source, **front matter included**: line 1 is `---`, then `title:`, `lead_time:`, `specs:` as YAML, a second copy of what the field pane beside it already shows. A stray space in that block is a YAML error. This is the screen an operator uses most, and it opens as a code editor with line numbers | `editor-product-1440.png`, `editor-new-1440.png` |
| G3 | 1 | Editor | There is **no way to put an image into the body** except typing `![](images/…)`: the media picker opens only from a declared field. There is no formatting control of any kind; a heading is `##` | Code: `markdown-editor.tsx` has no toolbar, drop or paste handler; `pickMedia` is passed only to the form |
| G4 | 1 | Editor | **Publish date, cover image and tags cannot be set without writing YAML.** The form always offers Title and Description and then only what the theme declares; `date`, `cover` and `tags` are common fields of every item (`CONTENT_FORMAT.md §3.1`) and Atelier's article kind declares none. A news item cannot be scheduled from the form | Code: `specs` in `pages/editor.tsx`; `themes/atelier/theme.json` |
| G5 | 1 | Content list | **An item cannot be deleted from the admin.** The Worker has `DELETE /_mallok/api/content/<id>`; no page calls it. The starter's 13 sample pages can be unpublished but never removed | Code: no `method: 'DELETE'` on content in `src/admin` |
| G6 | 1 | Content list | **No search.** With the starter the list is 13 rows; the owner's own sites publish news daily. `ADMIN.md §4` lists search; neither the page nor the API has it (the API filters by kind, language, slug and status) | Code: `admin-content.ts` |
| G7 | 1 | After sign-in | The first screen is a table of every item of every type. Nothing says what needs attention — a new inquiry, an inquiry form with no recipient address, no domain — or what to do first. A fresh site's most important fact, that inquiries go nowhere until a recipient is entered, is on the Plugins page under a required field | `content-1440.png`, `plugins-1440.png` |
| G8 | 2 | Content list | One list mixes six types (页面, 产品, 文章, 产品系列, 案例, 常见问题) behind a "类型" filter. This is the developer's model — one `content` table — not the operator's, who thinks "my products" and "my news". WordPress and Shopify give each type its own entry | `content-1440.png` |
| G9 | 2 | Content list | The **路径 column**: `/cases/heat-exchanger-plate-for-a-desalination-retrofit`, monospace, the widest column on the page, and the one that wrapped mid-word before the draft. It repeats the title in a form only a browser needs | `content-1440.png`, `wide/before/content-1920-open.png` |
| G10 | 2 | Editor | The first two controls of the editor are **类型** and **Slug** — still the English word in the Chinese interface (`zh-CN.po` maps "Slug" to "Slug"; the owner chose "URL 别名" on 2026-11-19 and it is not applied). The title, which is what the operator came to type, is a small field in the left pane | `editor-new-1440.png` |
| G11 | 2 | Editor | Three panes of 350 to 380 px each at 1440 px. The body wraps at about 40 characters; the preview shows the theme's phone layout; a product's five properties need scrolling. No pane is big enough for its job | `editor-product-1440.png` |
| G12 | 2 | Editor, 390 px | The bar — back link, type, Slug, status, date, "在站点上查看", language chips, pane tabs — takes the first 430 px. The first field starts below the middle of the screen | `editor-product-390.png` |
| G13 | 2 | Sidebar | The group is called **站点** and the first item under 设置 is also **站点**. **插件** sits beside 内容 and 媒体 although a deployment, not the operator, changes it. Every plugin panel has the same list icon. The breadcrumb for Inquiries reads "插件 › 询盘" and its subtitle "来自 询盘 插件。插件设置" — how it is built, not what it is | `inquiries-1440.png`, every page |
| G14 | 2 | Appearance | Three options are **typed as syntax**: "数据（数值\|名称 ;; 数值\|名称）", "认证（用逗号分隔）", "能力要点（标题\|说明 ;; 标题\|说明）". One wrong separator changes the home page. A "内容语言" select with one useful meaning sits above the first option. Below the form: "前台 JavaScript — 注入 1 个脚本", `/theme/atelier/2.5.2`, `assets/hero-carousel.js` | `settings-appearance-1440.png` |
| G15 | 2 | Plugins | The page opens with `src/plugins/` and `src/plugins/index.ts`. The inquiry settings are one flat list of nine in which "收件邮箱" (required, and the only one most sites need) has the same weight as "Turnstile 站点密钥", "Liquid 模板。可用变量：name、site_name…" and "ISO 3166-1 两位字母代码" | `plugins-1440.png` |
| G16 | 2 | Settings → Site | "默认语言不带 URL 前缀；其他语言都在 `/<locale>/` 下提供", a checkbox "默认语言也加前缀（`/en/…`）" that moves every URL of the site, and "媒体域名" stand in the first settings page at the same level as the site's name | `settings-site-1440.png` |
| G17 | 2 | Media | The page introduces itself with "文件按原图的哈希值存储…" and, under the drop zone, "转换为 WebP，并按 480、960和1440 像素宽度上传。不支持 SVG——它可能携带脚本". Both are true and neither helps anyone upload a photo | `media-1440.png` |
| G18 | 2 | Account | Between the password form and the tokens: "密码使用 PBKDF2-SHA256 哈希，迭代 50,000 次…Cloudflare 免费计划 10 毫秒的 CPU 预算". Then API tokens with scopes printed as `content:write`, `media:write`. The menu entry is "账号与 API 令牌". An operator who wants to change a password reads all of it | `account-1440.png`, `account-menu-1440.png` |
| G19 | 2 | Everywhere | Content languages carry their code and a flag word: "英语（en）· 默认", "中文（zh）", in the list's filter, the editor's chips, Appearance and Site. The last plan chose name-and-code on purpose (its D7); seen in daily use it is the most frequent piece of code-like text in the admin | Every content screenshot |
| G20 | 2 | Inquiries | Empty, it says "这里还没有内容。" — the generic sentence — beside two disabled buttons. Nothing says where inquiries come from or that the recipient address is not set. From the manifest: a row shows name, email, country, status and time; **the message is not in the row** and needs the detail view | `inquiries-1440.png`; `plugins/inquiry/plugin.json` |
| G21 | 3 | Width | §2.2: a band beside the sidebar, and under the draft two left edges | `.tmp/wide` |
| G22 | 3 | Content list | Dates are all "2026年11月19日"; a list that is ordered by last change reads better as "今天 07:12". No thumbnail on a product row | `content-1440.png` |
| G23 | 3 | Settings | Ledes explain the architecture instead of the page: "点击保存即生效——无需重新构建或部署", "以下选项是运行时设置…主题本身属于源代码" | `settings-site-1440.png`, `settings-appearance-1440.png` |
| G24 | 3 | Email | "Resend API 密钥" with no word on what Resend is or where a key comes from. The warning below it is clear and should stay | `settings-email-1440.png` |
| G25 | 3 | Wizard | The first field a new owner types after the password is "Setup key — Printed once by `mallok create`"; step 4 says "Cloudflare's edge cache does not apply to it" in bold. Both are honest and required (`ADMIN.md §5`); the person at this screen is the one who deployed. The result screen opens the content list | `wizard-1-admin-1440.png`, `wizard-4-domain-1440.png` |

**What already holds up**, and is kept: one-line standing notice; the
status badge, "Updated" and "View on site" in the editor; honest saved
messages; named content languages; empty states with one action; panels in
the sidebar; Advanced as the one place for infrastructure words; no page
scrolls sideways at 390 px.

**The pattern.** Six of the seven severity-1 findings are in the editor
and the content list, and each is the same thing: the screen shows the
storage model (one table, a Markdown file with a YAML header, a status
column) instead of the task (write a page, publish it, find it again).
Measured against §3, the admin today sits with Strapi and Payload, which
are built for developers, and the owner is asking for WordPress and
Shopify.

## 3. How mainstream admins handle the same screens

Written from working knowledge of these products, not from a fresh review
of each: no screenshot was taken and no pixel measured for this section.
"Sure" marks what has been stable for years and is safe to design against;
"less sure" marks what may have changed or what is remembered loosely.
Phase 0 (§7) re-checks anything a decision turns on.

| Screen | WordPress | Shopify | Ghost | Strapi / Payload |
| --- | --- | --- | --- | --- |
| After sign-in | A dashboard: "At a Glance" counts, recent activity, a quick draft, site health | Home: a setup guide with steps to complete on a new shop, then things needing attention | A dashboard of member and post figures | Straight to the content manager or a near-empty welcome page |
| Navigation | One entry per type: Posts, Pages, Media; then Appearance, Plugins, Settings | One entry per thing: Orders, Products, Customers, Content; Settings is a separate area opened from the foot of the sidebar | Posts, Pages, Tags, Members; Settings behind a gear | "Content Manager" listing collection types by their model names |
| List | Title, author, categories, date. **No slug or URL column.** Status as tabs above the table (All, Published, Drafts). A search box. Row actions on hover: Edit, Quick Edit, Trash, View. Columns chosen under "Screen Options" | Thumbnail, title, status badge, a few facts. Status as tabs (All, Active, Draft, Archived). Search and filters. No URL | Title, status, date; filters by status and tag | A table with configurable columns that by default includes the numeric id; filters built from field names |
| Editor | Title and body in one wide column; a settings sidebar on the right (status, URL, categories, featured image) that can be closed; the primary button is "Publish", then "Save" or "Update" once live; "Switch to draft" is a separate, explicit action | Main column: title, rich-text description, media, then the type's own fields as cards. Right column: status and organisation. **The URL is inside a "Search engine listing" card that is closed until "Edit" is pressed.** A save bar appears when something changed | Title and body alone, full width, nothing else on screen; a side panel slides in for URL, date, tags, excerpt; "Publish" opens a short confirmation flow; then "Update" and "Unpublish" | Every field of the model in a form, in schema order, with a right rail for status; the slug is an ordinary visible field |
| Settings | Sub-pages (General, Reading, Permalinks…), each a plain form with one save button; the permalink structure has its own page, apart from General | A separate area with its own menu; each page is cards, the common fields first | A searchable single page of cards | Split between project settings and plugin configuration |
| Media | A grid of thumbnails; clicking one opens its details (alt text, title); upload by drop anywhere | Files as a list with thumbnails; images are mostly added where they are used | No library; images are placed in the post | A grid with folders |
| Forms, inquiries | Not in core. Form plugins store entries in a list with a detail view (less sure of each plugin's layout) | Not in the basic product; a contact form sends email. Shopify Inbox is a chat-style list with a reading pane (less sure) | Not in core | None; a collection the developer defines |
| Width | Lists are fluid and left-aligned; forms are left-aligned with labels in a left column | A centred, capped page; index tables may go full width (the cap's value is not something measured here) | Centred and capped | Fluid |

Wix and Squarespace are site builders: the operator edits the page in
place, and their content lists and form inboxes are secondary screens.
Less sure of their current layouts, and they are not used as a model for
any screen below — editing in place is a different product from Mallok's
(`PRODUCT_VISION.md §4`: themes are source).

What the first three share, and Mallok lacks or does differently:

1. A first screen that says what to do next.
2. A sidebar entry per content type.
3. A list with no address column, with search, with status as tabs.
4. An editor whose main column is the title and the body, with everything
   that is not writing in a panel beside it.
5. The address as a closed-by-default detail, edited rarely.
6. A primary button that says what it will do to *this* item: Publish,
   then Update.

## 4. Decisions the owner has to make

### D1 — The first screen after sign-in

| | A. As today | B. A Home page: next steps and what is new | C. A dashboard with figures |
| --- | --- | --- | --- |
| Shows | The content list | Up to four unfinished setup steps, each a link; the newest rows of each plugin's list (inquiries); the five items edited last; shortcuts to add content | B plus visits, inquiry counts over time |
| New Worker code | None | None: it reads what the shell already loads (settings, health, plugins), `GET /content?limit=5`, each table panel's first rows, and `/diagnostics` | An analytics source Mallok does not have, and counting queries |
| First-load cost | None | A page loaded on demand; the shell gains one link | As B |

**Recommended: B.** It answers G7 with data the admin already has. The
setup steps are derived, never stored: no custom domain
(`health.customDomain`), no email key or sender (`/diagnostics`), an
enabled plugin with an empty required setting (the inquiry recipient), no
content edited since the starter was installed. A step disappears when its
condition does, and the card disappears with the last one. C is not
recommended: Mallok records no visits, and `COUNT(*)` over inquiries is
the kind of query the budgets exist to prevent.

### D2 — The sidebar

| | A. As today | B. By what the operator works on |
| --- | --- | --- |
| Top | Content, Media, each panel, Plugins | Home; then each plugin panel (Inquiries) |
| Content | One "Content" entry, all types behind a filter | A "Content" group with **one entry per content type the theme declares**, by the theme's label, then Media |
| Settings | Site, Appearance, Email, Advanced | General (renamed from Site), Appearance, Email, Plugins, Advanced |
| Cost | — | The entries come from `GET /_mallok/api/theme`, which the shell already loads. A type the site has content of but the theme no longer declares needs a place (an "Other content" entry, shown only then) |

**Recommended: B.** It is G8 and G13 in one change, and it is what
WordPress and Shopify do. The list page is the same page with the type
fixed by the address (`/content?kind=product` works today), so "New
Product" and the empty state already say the right thing. Plugins moves to
Settings because the operator can change only a switch and settings there,
and the page itself says installing one is a deployment. Atelier declares
six types; six entries and Media is a longer sidebar than today's, and
still shorter than a WordPress site's.

### D3 — The address: path and slug

| | A. As today | B. Out of the list; in the editor's panel, as an address | C. Hidden entirely |
| --- | --- | --- | --- |
| List | A Path column | No column. "View" in the row's actions opens the page; "Copy address" in its menu | As B |
| Editor | "Slug" in the top bar, first | In the settings panel, under "Search and address", shown as the whole address with only its last part editable: `example.com/products/` `[grade-5-titanium-bar]` | Generated from the title; never shown |
| Risk | — | None to data. The field keeps `slug.ts`'s rules and messages | A Chinese title has no Latin letters to build a slug from (`ADMIN.md §6.2`), so the operator must be able to type one |

**Recommended: B.** C cannot work for this audience for the reason in the
table. The words follow §5.4: the field is "Web address" / "网址", and its
editable part is "URL 别名", the owner's choice of 2026-11-19. For a
new item with a title that yields no slug, the panel opens itself at that
field with today's explanation.

### D4 — The editor's layout

| | A. Three panes, as today | B. Writing-first | C. B, with the source one step away |
| --- | --- | --- | --- |
| Main column | Fields, source, preview side by side | The title as a large field, the body, then the type's own fields as cards (a product's specification, gallery, datasheet) | As B |
| Beside it | — | One panel: status and publishing, language versions, publish date, summary, cover, tags, address. It closes, and this browser remembers | As B |
| Preview | Always on, about 350 px | A "Preview" button swaps the panel for the preview; on a window of 1600 px or more both fit | As B |
| The YAML block | In the source, always | Not shown. The body editor holds the body only | Not shown by default; "Edit source" in the "More" menu opens today's whole-document editor |
| Who loses | The operator | Whoever pastes a document with front matter or fixes an unusual field by hand | No one |

**Recommended: C.** B is what the owner asked for; C costs one menu item
more and keeps the promise that the Markdown is the operator's own file
(`PRODUCT_VISION.md §5.2`). The type's fields go in the main column, not
the panel, because for a product they *are* the content — Shopify's layout,
not Ghost's. Two things must hold and are tested (§8): an item opened and
closed is byte-identical, which means the hidden block is kept as the text
it was and re-serialised only when a field is edited, exactly as now; and
a field the theme does not declare is preserved.

### D5 — Visual editing before 0.2

`ADMIN.md §14` and `PRODUCT_VISION.md §9` put the visual editor (Tiptap) in
0.2. Read on 2026-11-19: `@tiptap/core` and `@tiptap/markdown` are at
3.34.0 (npm, published 2026-11-13); Tiptap's Markdown page says the
extension "is a early release and can be subject to change or may have
edge cases that may not be supported yet", and does not say that a
document it parses and writes back is unchanged. **Its size in this
admin's build and its fidelity on Mallok's content are not measured.**

| | A. Assisted Markdown now | B. Tiptap now | C. A, then a measured spike |
| --- | --- | --- | --- |
| What the operator gets | The body in a proportional face, no line numbers, headings and bold styled as they are typed; a toolbar (heading, bold, italic, list, link, quote, image, table) that inserts the syntax; images by button, drop and paste | True what-you-see-is-what-you-get | A now; B's facts before 0.2 is planned |
| New dependencies | None: CodeMirror's Markdown package is already loaded with the editor | Three or more packages through `TECH_STACK.md §11`, on an extension its authors call early | None until the spike reports |
| Risk to "Markdown is the truth" | None: the text is still what is typed | High until proven: a visual editor rewrites the whole body on save, so an untouched paragraph can change bytes; raw HTML, tables and reference links are the known hard cases | Contained in a throwaway branch |
| Still shows `##` and `**` | Yes, styled | No | Yes, until 0.2 |

**Recommended: C.** A removes most of what G2 and G3 describe at no
dependency cost and no risk to the contract. The spike is one small phase
(§7, phase 8): load the starter's 13 pages and the owner's real articles
into Tiptap with its Markdown extension, write them back, and report how
many are byte-identical, how many differ only in whitespace, and what the
editor chunk weighs. With that number the owner can decide whether 0.2's
editor is Tiptap, and whether "unchanged unless edited" has to be relaxed
to "unchanged paragraphs are kept" — which is a change to
`CONTENT_FORMAT.md §3`, not to the admin. B today would be choosing that
change without the number.

### D6 — What the buttons do to a live page

| | A. As today | B. By the item's state |
| --- | --- | --- |
| A draft or a new item | Save draft · Publish | Save draft · **Publish** |
| A published item | Save draft (unpublishes) · Publish | **Update**. "Unpublish" and "Delete" are in the "More" menu, each with a confirmation that says what a visitor will see |
| A scheduled item | Save draft · Publish | **Update** · "Publish now" in the menu |
| Changes | — | Labels and one menu. The API is unchanged: Update sends `published`, Unpublish sends `draft`, Delete calls the existing route |

**Recommended: B.** It is G1 and G5, the smallest change in this plan and
the one that stops an operator taking a page down by accident. What the
delete route does to the item's redirects, its translations and its
images' reference counts was not read for this proposal; the confirmation
must state it, so phase 4's first step is to read it and write the
sentence from what the code does.

### D7 — Width and alignment

| | A. Centred, 68 rem (`main`) | B. Centred, 90 rem for lists (the draft) | C. Left-aligned, capped by kind of page | D. Fluid |
| --- | --- | --- | --- | --- |
| Left edge | Moves with the window | Moves with the window **and** with the page | Fixed: the sidebar plus the page's padding, on every page at every width | Fixed |
| Band beside the sidebar at 1920 px | 323 px | 147 px on lists, 323 px on forms | **None** | None |
| Spare room | Split left and right | Split left and right | On the right only, where a page ends | None; rows stretch |
| A table row at 2560 px | 1,018 px | 1,370 px | 1,370 px (cap 90 rem) | 2,234 px: title and status are a screen apart |
| A form | Fields 42 rem in a 68 rem card | As A | Fields 42 rem; the card ends at 56 rem instead of running empty to 68 | Cards 2,234 px wide around 672 px fields |

**Recommended: C.** The complaint was a band beside a centred column, and
only left alignment removes the band; the draft narrows it and adds a
second edge (§2.2). With D3 the list also loses its widest column, so the
pressure that produced the draft goes away. Lists and panels cap at
90 rem, forms at 56 rem, Home at 68 rem; the editor stays full width. The
standing notice takes the page's width, as now. This replaces the
uncommitted draft; its one good line — removing `max-w-72` from the path
cell — is moot once the column is gone.

### D8 — Content languages in daily screens

The last plan's D7 ruled that a content language always shows its name
and its code. That rule did its job — nobody confuses it with the
interface language — and G19 is its cost.

| | A. Name and code everywhere (today) | B. Name alone in daily screens |
| --- | --- | --- |
| List, editor, Appearance | "英语（en）· 默认" | "English · 中文" as tabs; the main language first, unmarked |
| Settings → General → Languages | Name and code | Name and code, and "主要语言" on the main one |
| Two languages with one name (`zh`, `zh-TW`) | Told apart by code | The code is added to exactly those |
| A site with one language | The control is still drawn | No language control anywhere outside Settings |
| Contract | `ADMIN.md §4.3` as written | `§4.3` revised: one sentence |

**Recommended: B.** The two languages stay apart by where they are chosen
(the interface language only in the account menu, the sign-in page and the
wizard), which was always the stronger of the four rules.

### D9 — Showing the common case first in generated forms

Forms for content types, theme options and plugin settings are generated
from manifests, so the admin cannot decide which inquiry setting is
advanced. The manifest has to say.

| | A. Nothing | B. An optional `advanced: true` on a field | C. Decide in the admin, per plugin |
| --- | --- | --- | --- |
| Result | G15 stays | Fields so marked are drawn together, after the others, inside a closed "More options" block; a required field may not be marked | — |
| Contract | — | Additive to `theme.json` fields and options and to `plugin.json` settings; a manifest without it renders as today; validated at build time | **Not allowed**: themes and plugins ship no admin code, and the admin has none of theirs |

**Recommended: B.** The inquiry plugin marks seven of its nine settings
(everything but the recipient and the autoreply switch), and its secret
moves into the same block. Atelier marks nothing; its problem is G14,
which is the next decision.

### D10 — Two smaller questions

**a. Theme options typed as syntax (G14).** Options allow six types
(`THEME_FORMAT.md §6`); a list of pairs has to be a string with `|` and
`;;`. Options: (A) leave it; (B) allow `string[]` and `keyvalue` in
options — both exist for content fields, with controls — and move
Atelier's three options to them, bumping its version and migrating stored
values in the theme's own reading code. **Recommended: B, as its own late
phase**, because it changes a theme contract and a released theme's
stored values, and needs the care that implies.

**b. The interface language for a Chinese browser.** It already follows
the browser: `src/admin/i18n.ts` takes the stored choice, else the first
of `navigator.languages` it has a catalog for (`zh`, `zh-Hans-CN` and
`zh-TW` all find `zh-CN`), else English; after sign-in the account's
choice wins. **Nothing to build.** The open half is the reverse case the
last plan left with the owner: the wizard starts the site's *main content
language* as the interface language, so a Chinese-speaking owner setting
up an export site is offered Chinese as the site's main language.
**Recommended: start it as the first language the theme has a pack for
(English, for every official theme), whatever the interface language** —
which is also what `ADMIN.md §4.3` says in principle ("it never defaults
from a content language, nor they from it").

## 5. Constraints that do not move

| Constraint | Source | What it means here |
| --- | --- | --- |
| `content.markdown` is the only truth; an item opened and closed is byte-identical | `CONTENT_FORMAT.md §3`, `ADMIN.md §6.2`, `13-editor-untouched.spec.ts` | D4 hides the front matter; it does not parse and rewrite it. D5's option A inserts text at the cursor and changes nothing else |
| Immediate and redeploy stay apart; installing is never a button | `PRODUCT_VISION.md §4`, `ADMIN.md §4.1`, `§10` | Plugins and Appearance keep their sentence, at the top, in plain words; the file paths move into a closed "For the person who deploys" block on the same page |
| Messages are honest | `ADMIN.md §5`, `§11` | The standing no-token notice stays on every page. Home's steps say "not set up yet", never "error". Unpublish and Delete say what a visitor will see |
| First load ≤ 170 KiB gzip | `ADMIN.md §13`, `pnpm admin:size` | **3.7 KiB of headroom** (166.3 measured). Home, the editor's new parts and the list's menu load with their pages. The shell gains links only. Each commit reports the number; the last plan lost 1.4 KiB to one shared import (`ADMIN_I18N_AND_UI.md §8`) |
| New dependencies go through the gate | `TECH_STACK.md §11` | Phases 1–7 add none. Phase 8 installs Tiptap in a throwaway branch only |
| Generated forms; no theme or plugin code in the admin | `ADMIN.md §7` | D9 and D10a change manifests, never add a per-plugin screen. Home lists panels generically |
| Infrastructure words only under Advanced | `ADMIN.md §2` | §6.5 lists every breach found and where it goes |
| No `COUNT(*)` in a list; list pages never read `markdown` | `CLAUDE.md`, `budget.test.ts` | Status tabs carry no counts. Search matches the title column only |
| Every SQL statement lives in `src/db` | `CLAUDE.md` | The search filter is a change there, with a worker test |
| Everything in the repository is English; `zh-CN` is a catalog | `CONVENTIONS.md` | New words are English in the source with `zh-CN` in the same commit; `pnpm i18n:check` fails otherwise |
| Browser tests find controls by English role and name | `test/e2e` | A renamed control changes its selector in the same commit, and the diff says why |
| No serious or critical axe violation, both languages | `05-accessibility.spec.ts` | Every new screen joins the scan |
| One change, one demonstrable path | `CLAUDE.md` | §7's commits |

## 6. The direction

### 6.1 Principles

1. **The task, not the table.** A screen is named and shaped by what the
   operator does there — Products, Inquiries, Write — not by what stores
   it.
2. **The common case first; the rest one step away.** Nothing is removed.
   What a daily operator does not need is closed, in a menu, or under
   Advanced, and each has one fixed place (§6.5).
3. **Plain words in both languages.** If a word needs a developer to
   explain it, it is replaced, or it moves to Advanced.
4. **One left edge.** Every page starts at the same place.
5. **A button says what it will do to this item.**
6. **Honesty is not negotiable and is not jargon.** A degraded state is
   said in the operator's words where they are, with the technical reason
   one link away.
7. **Familiar beats clever.** Where WordPress and Shopify agree, do that.

### 6.2 Information architecture

```
[M] Titanium demo                      View site ↗
─────────────────────────────────────
Home                                    概览
Inquiries                               询盘          ← each plugin list panel
─────────────────────────────────────
CONTENT                                 内容
  Pages                                 页面          ← one per type the
  Products                              产品            theme declares,
  Product families                      产品系列        by its label
  Case studies                          案例
  FAQ                                   常见问题
  News                                  文章
  Media                                 媒体
─────────────────────────────────────
SETTINGS                                设置
  General                               基本设置      ← was "Site"
  Appearance                            外观
  Email                                 邮箱
  Plugins                               插件          ← was beside Content
  Advanced                              高级          ← gains API tokens
─────────────────────────────────────
e2e@example.test ▾                      Account · Colour scheme ·
                                        Interface language · Sign out
```

Changes to `ADMIN.md §4`: a Home section is added; Content is one group
with an entry per type; Plugins is listed under Settings; API tokens move
from Account to Advanced. The breadcrumb names the place only ("Inquiries",
"Products › Grade 5 titanium bar"); a panel's page drops "From the Inquiry
plugin" to a "Settings" link in its header.

### 6.3 Key screens

**Home** (D1). 68 rem.

```
Good morning                                              [ Add ▾ ]
                                                           Product · News · Page
┌ Finish setting up ──────────────────────────────── 2 of 4 done ┐
│ ○ Say where inquiries are sent        Without this, no email   │
│                                       reaches you.      [Set] │
│ ○ Connect your domain                 Visitors still see a     │
│                                       preview address.  [How] │
│ ● Email sending is set up                                      │
│ ● Your first page is edited                                    │
└────────────────────────────────────────────────────────────────┘
┌ New inquiries ───────────────────────────────── [All inquiries]┐
│ Li Wei · Acme Metals · Germany               Today 09:14  New  │
│ "We need 500 kg of Grade 5 bar, 40 mm, delivered to…"          │
│ …                                                              │
│ (empty: "No inquiries yet. They appear here when a visitor     │
│  sends the form on your contact page.")                        │
└────────────────────────────────────────────────────────────────┘
┌ Recently edited ───────────────────────────────────────────────┐
│ Grade 5 titanium bar      Product      Published   Today 07:12 │
│ Why titanium lead times…  News         Draft       Yesterday   │
└────────────────────────────────────────────────────────────────┘
```

The inquiries card is generic: for each enabled plugin, each of its `table`
panels that is not attached to a content type shows its five newest rows,
by the panel's own columns. A `records` panel (a catalogue, not an inbox)
is not shown. No count is drawn.

**A content list** (D2, D3, D7). 90 rem, left-aligned.

```
Products                                              [ Add product ]

 All   Published   Drafts   Scheduled          [ Search products…   ]
 English   中文                                 ← only with 2+ languages
┌──────────────────────────────────────────────────────────────────┐
│ Title                               Status      Last edited      │
├──────────────────────────────────────────────────────────────────┤
│ Grade 9 titanium tube               Published   Today 07:12   ⋯  │
│ Grade 2 titanium plate              Published   Yesterday     ⋯  │
│ Grade 5 titanium bar                Draft       12 Nov        ⋯  │
└──────────────────────────────────────────────────────────────────┘
                                                  ‹ Previous  Next ›

 ⋯  →  Edit · View on site · Copy address · Unpublish · Delete
 390 px: title; status and date beneath it; ⋯ at the row's end.
```

No Type column inside a type's list; "Other content" keeps it. Status tabs
replace the Status select and carry no counts. The whole row opens the
editor. Search is by title, within the type and language shown.

**The editor** (D4, D5, D6).

```
← Products     Published · Saved 07:12            Preview    ⋯    [ Update ]
──────────────────────────────────────────────────────────────────────────
 English   中文   + Add a language version                ┌ Page settings ┐
                                                          │ Status         │
 Grade 5 titanium bar                    ← the title,     │  Published     │
 ══════════════════════════════════        large          │  12 Nov 2026 ✎ │
                                                          │                │
 H2  H3  B  I  • —  1.  "  Link  Image  Table             │ Summary        │
 ──────────────────────────────────────────────           │  [ Ti-6Al-4V…] │
 Grade 5 accounts for roughly half of all titanium        │  Shown in      │
 in use. It holds its strength to 400 °C and              │  lists and in  │
 machines predictably…                                    │  search results│
                                                          │                │
 ## Delivery condition                  ← styled as a     │ Cover image    │
 Bar is supplied annealed unless…         heading         │  [ Choose… ]   │
                                                          │ Tags           │
 ┌ Specification ───────────────────────────────┐         │  [ aerospace ×]│
 │ Grade [Ti-6Al-4V ]   Standard [ASTM B348 ]   │         │                │
 │ Form  [Bar      ▾]                           │         │ ▸ Search and   │
 └──────────────────────────────────────────────┘         │   address      │
 ┌ Properties ─────────────────────────────────┐          │   example.com/ │
 │ Density          4.43 g/cm³        Remove    │         │   products/    │
 │ Tensile strength 895 MPa           Remove    │         │   [grade-5-…]  │
 │ [ Add a row ]                                │         └────────────────┘
 └──────────────────────────────────────────────┘
 ┌ Gallery ─────────┐ ┌ Trade ──────────────────┐
 └──────────────────┘ └─────────────────────────┘

 ⋯  →  View on site · Edit source (Markdown) · Unpublish · Delete
 Preview  →  swaps the panel for the page as visitors get it; both at ≥ 1600 px.
 390 px: title, toolbar, body, cards in one column; the panel is a sheet
         behind "Settings"; a bar pinned to the bottom holds Preview and
         the primary button. The top bar is one line: ← · status · ⋯.
```

The cards are the theme's `group`s, as declared; ungrouped fields form one
card named after the type. A new item's type comes from the list it was
opened from, so the Type select is gone from the bar (it stays, enabled
only before the first save, in the panel under "Search and address" for an
item opened from "Other content"). "N images missing" and "Unsaved" stay
beside the status.

**Settings → General** (D8, D9, G16). 56 rem.

```
General
┌ Your site ─────────────────────────────────────────┐
│ Site name   [ Titanium demo                      ] │
│ Tagline     [ Titanium bar, plate and tube for…  ] │
│             English   中文         ← only with 2+   │
│                                          [ Save ]  │
└────────────────────────────────────────────────────┘
┌ Languages ─────────────────── Changes apply at once ┐
│ English (en)      Main language                     │
│ 中文 (zh)          [ Make main ]  [ Remove ]         │
│ [ Add a language ▾ ]                                │
└─────────────────────────────────────────────────────┘
┌ Domain ─────────────────────────────────────────────┐
│ Not connected yet. Visitors see a preview address,  │
│ search engines are asked not to list the site, and  │
│ pages load more slowly.            How to connect ↗ │
│ Your domain [ www.example.com                     ] │
│                                          [ Save ]   │
│ ▸ More options                                      │
│    Address for images · Put the main language's     │
│    pages under /en/ too                             │
└─────────────────────────────────────────────────────┘
```

**Inquiries** (G20). 90 rem. Still drawn from the manifest.

```
Inquiries                                   [ Settings ]  [ Export ]

 New   Replied   Spam   All                    [ Search…           ]
┌──────────────────────────────────────────────────────────────────┐
│ □  From                    Message                     Received  │
├──────────────────────────────────────────────────────────────────┤
│ □  Li Wei · Acme Metals    We need 500 kg of Grade 5…  09:14 New │
│ □  J. Okafor               Do you supply seamless…     Yesterday │
└──────────────────────────────────────────────────────────────────┘
 With rows selected:  [ Mark replied ]  [ Mark spam ]

 Opening a row: the whole message, company, phone, country, the page it
 was sent from, and [ Reply by email ] (a mailto: link) · [ Mark replied ].
 Empty: "No inquiries yet. They appear here when a visitor sends the form
 on your contact page." — and, while the recipient is empty, the same
 step Home shows.
```

Three generic rules produce this from the manifest, none special to the
plugin: a filter on a field whose values the catalog names, with four
values or fewer, is drawn as tabs; bulk actions appear when a row is
selected instead of standing disabled; a detail field of type `email`
offers a mailto link. The inquiry plugin's own manifest changes its
columns to put the message in the row and gives its panel an empty
sentence through its catalog (a new optional key, `panels.<id>.empty`).

### 6.4 Vocabulary

| Today (English / zh-CN) | Proposed English | Proposed zh-CN | Where |
| --- | --- | --- | --- |
| Slug / Slug | Web address (the field); its editable part: "URL slug" | 网址；可编辑部分：URL 别名 | Editor panel |
| Path / 路径 | — (column removed); "Copy address" | 复制网址 | Lists |
| Content / 内容 (one list) | The type's label: Products, News… | 产品、文章… | Sidebar, list titles |
| New content / 新建内容 | Add product, Add page… | 添加产品、添加页面… | Lists, Home |
| Type / 类型 | Content type | 内容类型 | Only in "Other content" |
| Site / 站点 (group) | Content | 内容 | Sidebar group |
| Site / 站点 (settings) | General | 基本设置 | Sidebar, page title |
| — | Home | 概览 | Sidebar; not 首页, which is the site's home page |
| English (en), default / 英语（en）· 默认 | English; "Main language" in Settings | 英语；主要语言 | D8 |
| Content language / 内容语言 | Language (as tabs, no label) | — | Lists, editor |
| Create Chinese (zh) / 创建 中文（zh） | Add a language version | 添加语言版本 | Editor |
| Description — "Used as the meta description…" / 描述 | Summary — "Shown in lists and in search results. Empty uses the start of the text." | 摘要——显示在列表和搜索结果中。留空则取正文开头。 | Editor panel |
| Markdown (pane name) | Text | 正文 | Editor |
| Fields / 字段, Hide fields / 收起字段 | Page settings; Hide settings | 页面设置；收起设置 | Editor |
| Save draft · Publish (on a live item) | Update | 更新 | D6 |
| — | Unpublish; Delete | 取消发布；删除 | Editor and row menus |
| Updated / 更新时间 | Last edited | 最后编辑 | Lists |
| Custom domain / 自定义域名 | Your domain | 网站域名 | General |
| Media domain / 媒体域名 | Address for images | 图片地址 | General → More options |
| "Files are stored by the hash…" | "Photos and files used on your site." | 网站上用到的图片和文件。 | Media |
| "Plugins ship with the source…" | "Plugins are added by whoever deploys the site. Here you switch them on and set them up." | 插件由部署站点的人添加。在这里可以启用并设置它们。 | Plugins |
| Technical details / 技术细节 | For the person who deploys | 部署相关信息 | Plugins, Appearance |
| Account and API tokens / 账号与 API 令牌 | Account | 账号 | Account menu |
| "About password hashing: PBKDF2-SHA256…" | "Use a long password you use nowhere else. This site's hosting limits how strongly passwords can be protected." + "Details" | 请使用足够长、且不在别处使用的密码。受托管环境限制，本站对密码的保护强度有限。＋“详细说明” | Account |
| "Nothing here yet." on Inquiries | The panel's own sentence (§6.3) | 还没有收到询盘。访客在联系页提交表单后，会显示在这里。 | Inquiries |

Unchanged on purpose: 发布, 草稿, 定时发布, 询盘, 媒体, 外观, 邮箱, 插件,
高级, and every term in the glossary agreed on 2026-11-13. "Markdown"
remains a name the admin may say — in "Edit source (Markdown)", in
Advanced's backup card — because it is the format the operator's content
leaves in.

### 6.5 What moves, and where to

| Today, in plain view | Goes to |
| --- | --- |
| Front matter in the body editor | "More" → "Edit source (Markdown)" |
| Slug in the editor bar; Path column | Panel → "Search and address"; row menu → "Copy address" |
| Type select in the editor bar | Fixed by the list; in the panel only for "Other content" |
| Language codes | Settings → General → Languages |
| "Prefix the default language too", `/<locale>/` | General → Domain → "More options" |
| Media domain | The same block |
| "Converted to WebP… 480, 960 and 1440… SVG" | Shown when a file is refused, as the reason; the sizes are in Advanced → Diagnostics |
| "Stored by the hash of the original" | Removed from the page; `ADMIN.md §8` keeps it |
| `src/plugins/`, `src/plugins/index.ts`, `ACTIVE_THEME`, `src/themes/index.ts` | "For the person who deploys", closed, on Plugins and Appearance. The sentence that a change needs a redeploy stays above it, open |
| Theme facts: client JavaScript, asset path, script list | The same closed block on Appearance; "This theme adds 1 script to the home page" stays open, in words |
| Inquiry: Turnstile keys, autoreply templates, blocked countries and keywords, thank-you path, own sender | "More options" on the plugin's card (D9) |
| PBKDF2 iterations and the CPU budget | "Details" under the password form. The plain warning stays open: `ADMIN.md §12` requires it to be said |
| API tokens and their scopes | Advanced → "API tokens" |
| "No rebuild, no deploy" ledes on Site, Appearance, Email | Removed. Advanced's "What applies immediately, what needs a deployment" card is the one place, as `ADMIN.md §11` asks |

## 7. Phases

Sizes are estimates: S under a day, M a few days, L a week or more. Each
numbered item is one commit and one thing the owner can see. The gate of
every commit is §8's; what is listed under a phase is added to it.

### Phase 0 — Decisions and baseline (S)

1. Record the owner's decisions in this file's status block.
2. Re-check what a decision turns on: the delete route's effects (D6);
   whether a panel's `email` detail already renders a link.
3. Capture the baseline again from `main` without the draft, adding the
   sign-in page, a seeded inbox and a seeded media library, in both
   languages — the gaps of §2.1.

**Gate:** decisions recorded; baseline images with the owner.

### Phase 1 — One left edge (S), D7

1. The shell's column is left-aligned; pages declare `form`, `list`, `home`
   or `full`. The uncommitted draft is dropped in favour of this.

**Gate:** images at 1280, 1440, 1920 and 2560 px, sidebar open and closed,
and at 390 px, for a list, a form and the editor; `17-shell` passes.

### Phase 2 — Words (S), §6.4

1. The catalog changes of §6.4 that need no layout change: the Slug label,
   Summary, the Media and Plugins sentences, the account menu, the ledes.
2. The sidebar's group and "General"; the breadcrumb.

**Gate:** images in both languages; every selector that changed is listed
in the commit; `pnpm i18n:check`.

### Phase 3 — Lists like the ones people know (M), D2, D3

1. A sidebar entry per content type; the list takes its type from the
   address; "Other content" when needed.
2. The Path column goes; a row menu brings Edit, View on site and Copy
   address; "Last edited" is relative for the last seven days.
3. Status as tabs; the language as tabs, hidden with one language (D8).
4. Search by title: the `q` parameter in `src/db` and the Worker, with a
   worker test and a query-count check; the box in the list.

**Gate:** `03-publish`, `19-translation` and a new list spec pass;
`budget.test.ts` unchanged; images at both widths.

### Phase 4 — The editor (L), D4, D5 option A, D6

Ordered so that each commit is safe to stop after.

1. **Update, Unpublish, Delete** (D6), in the editor as it stands, and
   Unpublish and Delete in the list's row menu.
2. Publish date, cover image and tags as always-present fields (G4).
3. Writing-first layout: the title, the body, the type's cards; the panel;
   Preview as a toggle. The source pane shows the body only; "Edit source
   (Markdown)" opens the whole document.
4. The body's look: proportional face, no line numbers, headings and
   emphasis styled.
5. The toolbar: heading, bold, italic, lists, quote, link, table.
6. Images in the body: the toolbar's button opens the media picker and
   inserts the reference; then drop and paste upload.
7. The 390 px layout.

**Gate:** `13-editor-untouched` passes unchanged at every step — it is the
proof for D4; `21-editor-layout` is rewritten for the new layout with axe
at both widths; a new spec takes a published item through Update,
Unpublish and Delete and reads each confirmation; the editor chunk's size
is reported before and after; images to the owner after steps 1, 3 and 6.

### Phase 5 — Home (M), D1

1. The page with "Recently edited" and the Add menu; sign-in and the
   wizard's result land on it.
2. "Finish setting up", from the four derived conditions.
3. The newest rows of each table panel.

**Gate:** a spec on a fresh database sees four steps, sets the recipient
and sees three; axe in both languages; first load reported — the page must
not be in it.

### Phase 6 — Settings, plugins, account (M), D9

1. `advanced` in the three manifests' schemas, its build-time validation
   and the "More options" block in the form generator; `THEME_FORMAT.md`
   and `PLUGIN_API.md` revised in the same commit.
2. The inquiry plugin marks its fields; its `zh-CN` catalog follows.
3. General: the three cards of §6.3.
4. Plugins and Appearance: the plain sentence and the closed block.
5. Account: the plain password note with "Details"; tokens move to
   Advanced.

**Gate:** a core test for a manifest with and without the key, and for a
required field wrongly marked; `06-tokens`, `08-email-settings`,
`16-appearance`, `18-locale-prefix` pass with their selector changes
listed; images of each page, both languages, both widths.

### Phase 7 — Inquiries (S–M)

1. The three generic panel rules of §6.3: tabs for a small named filter,
   bulk actions on selection, a mailto link on an `email` field.
2. The inquiry manifest: the message in the row; `panels.<id>.empty` in
   plugin catalogs, documented in `PLUGIN_API.md §7.8`.

**Gate:** `10-records-panel` and `14-failed-jobs` pass; images of a seeded
inbox and an empty one.

### Phase 8 — Spike: what a visual editor would cost (S), D5

Throwaway branch; only §9's numbers merge. Tiptap with its Markdown
extension, fed the starter's pages and a sample of the owner's real
articles: how many come back byte-identical, how the rest differ, the
chunk's gzip size in this build, and whether raw HTML and tables survive.

**Gate:** the numbers, and the owner's decision on 0.2's editor.

### Phase 9 — Theme options as lists (M), D10a, and close (S)

1. `string[]` and `keyvalue` as option types; Atelier's three options
   move, with its version bumped and `pnpm themes:record` run.
2. `ADMIN.md` revised (§4, §4.3, §6.1, §10, §12 and a new Home section);
   the CHANGELOG; `docs/zh-CN/`; the index entry in `docs/README.md`.

**Gate:** a site saved with the old option strings renders the same home
page after the change, shown by a test; the six checks of §8.

## 8. Verification

- **Every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build
  && pnpm bundle:size && pnpm admin:size`, then `pnpm test:e2e`. The
  first-load figure goes in the commit message.
- **The content contract:** `13-editor-untouched` unchanged throughout
  phase 4; a new test saves an item after editing only the body and
  asserts the front-matter block's bytes did not change, and another after
  editing one field asserts every undeclared field is still there.
- **Honesty:** specs read the Unpublish and Delete confirmations, the
  no-token notice on Home, and a draft's save, which must not claim
  visitors see it.
- **Both languages:** `05-accessibility` gains Home, a type's list and the
  new editor, in English and Chinese; `pnpm i18n:check` in lint.
- **Budgets:** `budget.test.ts` unchanged; the search query has its own
  count check.
- **The owner's eye:** before-and-after images per phase, in Chinese, at
  1440 px and 390 px, plus the widths of phase 1. No visual-regression
  tooling is added.
- **The real test, once:** after phase 5, someone who has not seen the
  admin adds a product with two photos, publishes it, fixes a typo in it
  and answers an inquiry, with no help. Where they stop is the next list
  of findings. This is the owner's to arrange.

## 9. Measurements

To be filled as phases run. At proposal time:

| What | Value | How |
| --- | ---: | --- |
| First load | 166.3 KiB gzip of 170 | `node scripts/admin-size.mjs`, build of 2026-11-19 07:13, draft applied |
| Loaded on demand | 478.6 KiB gzip | The same run |
| Interface messages | 543, both languages | `grep -c '^msgid'` on `zh-CN.po` gives 544 with the header |
| Browser specs | 22 files (`00`–`21`) | `ls test/e2e` |
| Tiptap's size and fidelity here | **Not measured** | Phase 8 |
| Benchmarks in §3 | **Not measured**; from knowledge | — |

## 10. Risks and open questions

| Risk | Why it is real | What contains it |
| --- | --- | --- |
| Hiding the front matter breaks "byte-identical" | Splitting and rejoining a document is exactly where a newline goes missing | The block is carried as its original text; `13-editor-untouched` and two new tests gate every editor commit |
| The first load passes 170 KiB | 3.7 KiB left; the shell changes in phases 2, 3 and 5; one shared import cost 1.4 KiB last time | New screens are lazy pages; the figure is in every commit; a phase that cannot fit stops and reports rather than raising the budget |
| Browser tests are rewritten to fit | Phases 2–4 rename the controls the suite finds | One rename per commit, the selector's diff saying why; behaviour specs are not edited in a wording commit |
| "Simple" hides something an operator needs | Each closed block is a guess about what is rare | Nothing is removed, each thing has one place (§6.5), and the unaided test of §8 is the check |
| Delete loses data | There is no trash and no revision interface (`ADMIN.md §14`) | A confirmation that names what goes; Unpublish offered first in the same menu; Advanced's backup is unchanged. A trash is an open question |
| A long sidebar | A theme may declare many types | Six today. If a theme passes about eight, the group collapses; not built until one does |
| The toolbar raises expectations Markdown cannot meet | A toolbar looks like a word processor; the text still shows `**` | Styling in phase 4 step 4 softens it; D5's spike decides the rest |
| Chinese wording reads translated | §6.4's zh-CN is a proposal by a non-native process | The owner reviews each phase's images, as in the last plan; the glossary is extended as terms are agreed |
| Manifest additions fragment | `advanced`, `panels.<id>.empty`, two option types | All optional and additive under theme API 1 and plugin API 2; each documented in the commit that adds it |

Conflicts between documents and code, found on the way and **not resolved
by this plan**:

1. `ADMIN.md §4` lists a Navigation editor under Settings, and Advanced
   tells the operator navigation changes at once. The admin has no screen
   for it. For a non-technical operator the site's menu is a real need;
   it is a feature, so it is outside this plan, and it is the first thing
   to plan after it.
2. `ADMIN.md §7` says a `reference` field "opens the content picker"; the
   control is a text input for the slug with a "Choose…" button only where
   a picker is passed, and `reference[]` "has no control yet"
   (`form/form.tsx`). Atelier's own help text reads "Slug of the category
   this product belongs to."
3. `ADMIN.md §8` says the media library lists "unused media" separately;
   the page marks each item "unused" in place.
4. The owner's choice of "URL 别名" for Slug (2026-11-19) is not in
   `zh-CN.po`.

Open questions:

1. Should deleted content go to a trash for some days? It needs a column
   or a status and a cron step, so it is a data-model question.
2. Should the sidebar show how many inquiries are new? It needs a count
   the panel API does not give, and a rule that keeps it cheap.
3. Should a product row show a thumbnail? The list API returns no cover,
   and list pages must stay within their query budget.
4. Does the reference field get a real picker in this plan (conflict 2)?
   It would join phase 4.
5. Home's greeting and the order of its cards are taste; the proposed
   order puts what blocks inquiries first.
6. Should "Edit source" be hidden entirely for an account that has never
   used it, or always sit in the menu? Proposed: always there.
7. D10b changes what the wizard preselects. Is English the right start for
   every site, or should the wizard ask without preselecting?

## 11. Not in this plan

- A visual editor; phase 8 only measures one.
- A navigation editor, revision history, a trash, bulk editing, multiple
  users or roles.
- Visit statistics or any dashboard figure that needs counting.
- In-place editing of the public site, as Wix and Squarespace do.
- Installing or switching themes or plugins from the admin.
- Changes to the admin's colours, type or decoration beyond what the
  layouts above need.
- A third interface language; Windows and Linux screenshots, still owed
  from the last plan.
