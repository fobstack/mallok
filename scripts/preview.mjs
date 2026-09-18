/**
 * Renders demo content through every bundled theme and writes browsable HTML.
 *
 * This is the local half of `mallok preview` (docs/CLI.md §8). It goes through
 * `src/core` — the same view assembly and the same two render stages the
 * Worker runs — so what you see here is what the site serves, not a mock-up.
 *
 * Run with `pnpm preview`, then open `dist/preview/index.html`.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const THEMES_DIR = 'src/themes';
const OUT_DIR = 'dist/preview';
const ORIGIN = 'https://demo.mallok.dev';

async function loadCore() {
  await mkdir('dist/build', { recursive: true });
  await build({
    entryPoints: ['src/core/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    conditions: ['workerd', 'worker', 'browser'],
    target: 'es2022',
    outfile: 'dist/build/core.mjs',
    logLevel: 'warning',
  });
  return import('../dist/build/core.mjs');
}

const core = await loadCore();

/** Demo content, written the way an operator would write it. */
const CONTENT = [
  {
    kind: 'product',
    slug: 'gr5-titanium-bar',
    frontmatter: {
      title: 'Grade 5 titanium bar',
      description:
        'Ti-6Al-4V round bar, 6–160 mm, solution treated and aged on request.',
      grade: 'Ti-6Al-4V',
      standard: 'ASTM B348',
      form: 'Bar',
      moq: '500 kg',
      lead_time: '15–20 days',
      category: 'aerospace-alloys',
    },
    body: `Grade 5 accounts for roughly half of all titanium in use. It holds
its strength to 400 °C and machines predictably, which is why airframe and
fastener buyers specify it by default.

## Delivery condition

Bar is supplied annealed unless the order says otherwise. Solution treated and
aged (STA) material is available above 12 mm.

| Property | Annealed | STA |
|---|---|---|
| Tensile strength | 895 MPa | 1100 MPa |
| Yield strength | 828 MPa | 1030 MPa |
| Elongation | 10% | 8% |

## What ships with it

Every lot carries an EN 10204 3.1 certificate with the heat number, chemistry
and mechanical results. Ultrasonic inspection to AMS-STD-2154 is available.`,
  },
  {
    kind: 'product',
    slug: 'gr2-titanium-plate',
    frontmatter: {
      title: 'Grade 2 titanium plate',
      description:
        'Commercially pure plate for chemical process equipment, 3–60 mm.',
      grade: 'Ti Gr2',
      standard: 'ASTM B265',
      form: 'Plate',
      moq: '1 t',
      lead_time: '10–14 days',
    },
    body: `Commercially pure titanium, chosen for corrosion resistance rather
than strength. It is the standard material for heat exchangers handling
seawater, wet chlorine and most oxidising acids.

Plate is hot rolled, annealed and pickled. Surface condition is 2D unless the
order specifies otherwise.`,
  },
  {
    kind: 'article',
    slug: 'reading-a-mill-certificate',
    frontmatter: {
      title: 'How to read a mill certificate',
      description:
        'The four fields that decide whether a lot is fit for your drawing.',
      date: '2026-08-14T09:00:00Z',
      section: 'operations',
      byline: 'Wen Li',
    },
    body: `A mill test certificate is a claim about one specific lot of metal.
Most buyers check the grade and stop. Four other fields carry more risk.

## Heat number

The heat number ties the certificate to a melt. If it does not appear on the
material itself, the certificate documents nothing you can trace.

## Chemistry against the standard, not against the grade

"Grade 5" is a family. The certificate lists actual percentages; compare each
against the standard your drawing cites, because ASTM B348 and AMS 4928 do not
set the same limits.

## Direction of test

Tensile results depend on whether the specimen was cut longitudinal or
transverse. A certificate that omits the direction is not comparable.`,
  },
  {
    kind: 'article',
    slug: 'sponge-prices-hold-through-august',
    frontmatter: {
      title: 'Sponge prices hold through August as Japanese output steadies',
      description:
        'Two months of flat pricing after a volatile spring. Buyers are booking Q4 tonnage early.',
      date: '2026-08-26T07:30:00Z',
      section: 'markets',
      byline: 'Chen Hao',
    },
    body: `Titanium sponge settled at a narrow range through August, the first
sustained flat stretch since March.

## What moved

Japanese producers restored the output they had trimmed in the spring, and the
additional tonnes met demand that had not grown. Buyers who had been covering
month to month started booking into the fourth quarter.

## What it means downstream

Mill product pricing lags sponge by roughly a quarter. Fabricators quoting
January delivery should not assume today's sponge level survives the restocking
that a flat market invites.`,
  },
  {
    kind: 'article',
    slug: 'export-licence-rules-tighten',
    frontmatter: {
      title: 'Export licence rules tighten for aerospace-grade plate',
      description:
        'A new end-use declaration adds roughly ten days to first shipments.',
      date: '2026-08-19T11:00:00Z',
      section: 'policy',
      byline: 'Anna Weber',
    },
    body: `Exporters of aerospace-grade plate now file an end-use declaration
naming the final programme, not just the consignee.

The paperwork is not onerous, but it is serial: the declaration must clear
before the first shipment against a contract, which adds about ten days to a
new customer relationship and nothing to repeat orders.`,
  },
  {
    kind: 'project',
    slug: 'kiln-bench',
    frontmatter: {
      title: 'Kiln Bench',
      description:
        'A public bench cast in place from the spoil of the site it stands on.',
      year: '2026',
      client: 'Rotterdam Havenbedrijf',
      discipline: 'Public furniture',
      materials: ['Cast concrete', 'Reclaimed aggregate', 'Oiled ash'],
    },
    body: `The brief asked for seating that would not read as street furniture.

We cast each bench in place using aggregate screened from the excavation of the
same quarter, so every unit carries the colour of the ground beneath it. No two
are the same shade, and none of that variation was designed.

## Making

Formwork was built on site from ash left over from the hoarding. After the pour
the boards were planed and returned as the seat surface, which is the only part
anyone touches.`,
  },
  {
    kind: 'project',
    slug: 'signal-lamp',
    frontmatter: {
      title: 'Signal Lamp',
      description: 'A desk lamp whose only control is where you put it.',
      year: '2025',
      client: 'Self-initiated',
      discipline: 'Product',
      materials: ['Anodised aluminium', 'Borosilicate'],
    },
    body: `A lamp with no switch. Tilting the head past forty degrees closes the
circuit, so putting it down in a working position turns it on and standing it
upright turns it off.

The gesture was already there. We removed the button that duplicated it.`,
  },
  {
    kind: 'page',
    slug: 'about',
    frontmatter: {
      title: 'About',
      description: 'Who we are and what we keep in stock.',
    },
    body: `We roll and forge titanium for chemical process and aerospace
customers, and we keep working stock of the grades those industries order
most.

Enquiries are answered by the person who will handle the order.`,
  },
  {
    kind: 'category',
    slug: 'aerospace-alloys',
    frontmatter: {
      title: 'Aerospace alloys',
      description:
        'Airframe and fastener grades held in stock, certified to EN 10204 3.1.',
      summary:
        'The grades airframe and engine buyers specify by name, rolled and tested in-house so the certificate and the material never leave each other.',
      applications: [
        'Airframe fasteners',
        'Engine mounts',
        'Landing gear components',
        'Hydraulic tubing',
      ],
    },
    body: `Every alloy in this family is melted and rolled on the same site.
That is what makes the heat number on the certificate mean something: it points
at a furnace we operate, not at a broker's paperwork.

Lead times below assume stock. For non-stock sizes we roll to order, which adds
roughly four weeks.`,
  },
  {
    kind: 'case',
    slug: 'hydraulic-tubing-for-a-regional-jet',
    frontmatter: {
      title: 'Hydraulic tubing for a regional jet programme',
      description:
        'Twelve tonnes of Grade 9 tube, delivered in six lots against a moving build schedule.',
      client: 'Tier-1 aerostructures supplier',
      industry: 'Aerospace',
      country: 'Brazil',
      year: '2025',
      product: 'gr5-titanium-bar',
      outcomes: {
        'Lots delivered on time': '6 of 6',
        'Certificate queries': 'None',
        'Scrap rate at the customer': '0.4%',
      },
    },
    body: `The programme changed its build rate twice inside a year. Both times
the schedule moved before the purchase order did, which is the situation that
usually turns into either an expedite fee or a line stoppage.

## What we changed

We held two lots of finished tube against a rolling forecast rather than
against firm orders, and agreed that unclaimed material would go back into
general stock after ninety days. The customer carried no inventory risk and we
carried very little, because Grade 9 tube in those sizes sells to other buyers.

## Why the certificates mattered

Every lot shipped with its 3.1 certificate emailed for approval two days before
despatch. Over six deliveries the customer's incoming inspection raised no
queries at all, which is unusual on a new supply and is mostly a function of
sending the paperwork early rather than with the truck.`,
  },
  {
    kind: 'faq',
    slug: 'buying-titanium',
    frontmatter: {
      title: 'Buying titanium',
      description:
        'What buyers ask before the first order: minimums, certificates, lead times and payment.',
      faq: [
        {
          question: 'What is your minimum order quantity?',
          answer:
            'Five hundred kilograms for stock grades and sizes. Below that we can usually point you at a stockist rather than waste your time.',
        },
        {
          question: 'Which certificates ship with the material?',
          answer:
            'An EN 10204 3.1 certificate with every lot, carrying the heat number, full chemistry and mechanical results. Ultrasonic inspection to AMS-STD-2154 is available on request and is reported on the same document.',
        },
        {
          question: 'How long is a typical lead time?',
          answer:
            'Fifteen to twenty days for stock sizes. Rolling to order adds about four weeks, and we say so before you place the order rather than after.',
        },
        {
          question: 'Can you supply to a drawing?',
          answer:
            'Yes. Send the drawing and the tonnage; the engineer who quotes it is the one who will roll it.',
        },
        {
          question: 'What are your payment terms?',
          answer:
            'Thirty percent on order and the balance against the bill of lading for a first order. Repeat customers move to net thirty after three shipments.',
        },
      ],
    },
    body: `These are the questions that come up before a first order. If yours
is not here, the form at the bottom of any product page reaches an engineer,
not a mailbox.`,
  },
];

/** Per-theme demo identity, so each theme is shown as the site it is for. */
const IDENTITIES = {
  atelier: {
    name: 'Northbound Titanium',
    tagline: 'Titanium bar, plate and tube for process and airframe work',
  },
  journal: {
    name: 'Northbound Titanium',
    tagline: 'Notes from a titanium mill',
  },
  gazette: {
    name: 'Ferralloy Wire',
    tagline: 'Daily coverage of the specialty metals trade',
  },
  manual: {
    name: 'Mallok Handbook',
    tagline: "The operator's guide to running a site on Mallok",
  },
  folio: {
    name: 'Studio Merel',
    tagline: 'Objects and public work in cast material',
  },
};

const SITE = {
  name: 'Northbound Titanium',
  tagline: 'Titanium bar, plate and tube for process and airframe work',
  defaultLocale: 'en',
  locales: ['en'],
  kinds: {
    page: { base: '' },
    product: { base: 'products' },
    category: { base: 'families' },
    case: { base: 'cases' },
    faq: { base: 'faq' },
    project: { base: 'work' },
    article: { base: 'notes' },
  },
  nav: {
    en: [
      { label: 'Products', href: '/products' },
      { label: 'Cases', href: '/cases' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Notes', href: '/notes' },
      { label: 'About', href: '/about' },
    ],
  },
  themeOptions: {},
  mediaBaseUrl: '',
};

/** Reads one theme directory into the shape `compileTheme` takes. */
async function loadTheme(dir) {
  const root = join(THEMES_DIR, dir);
  const manifest = core.parseThemeManifest(
    JSON.parse(await readFile(join(root, 'theme.json'), 'utf8')),
  );
  const files = {};
  for (const sub of ['layouts', 'partials', 'locales']) {
    let entries = [];
    try {
      entries = await readdir(join(root, sub));
    } catch {
      continue;
    }
    for (const name of entries) {
      files[`${sub}/${name}`] = await readFile(join(root, sub, name), 'utf8');
    }
  }
  return { manifest, files };
}

/** Prepares every demo item: fragment, summary and public path. */
async function prepare(manifest) {
  const prepared = [];
  for (const item of CONTENT) {
    if (manifest.kinds[item.kind] === undefined) {
      continue;
    }
    const fragment = await core.renderFragment({
      body: item.body,
      frontmatter: item.frontmatter,
      assets: {},
      mediaBaseUrl: '',
    });
    const base = SITE.kinds[item.kind]?.base ?? '';
    const path = core.buildPublicPath({
      kind: item.kind,
      locale: 'en',
      defaultLocale: 'en',
      slug: item.slug,
      base,
    });
    prepared.push({
      kind: item.kind,
      fragment,
      path,
      view: {
        id: item.slug,
        kind: item.kind,
        locale: 'en',
        slug: item.slug,
        path,
        title: String(item.frontmatter.title),
        description: String(item.frontmatter.description ?? ''),
        publishedAt: String(item.frontmatter.date ?? '2026-08-01T00:00:00Z'),
        updatedAt: '2026-08-20T00:00:00Z',
        frontmatter: item.frontmatter,
        cover: '',
      },
    });
  }
  return prepared;
}

function contextFor(theme, path) {
  const identity = IDENTITIES[theme.manifest.id] ?? {};
  return {
    settings: { ...SITE, ...identity },
    manifest: theme.manifest,
    origin: ORIGIN,
    locale: 'en',
    path,
    strings: core.themeStrings(theme.manifest, theme.files, 'en'),
  };
}

/**
 * The demo equivalent of the Worker's `loadRelations`: reads the same
 * `reference` declarations off the manifest so the preview shows exactly the
 * links a real site would.
 */
function relationsFor(manifest, item, items) {
  const refs = {};
  const backrefs = {};
  for (const [field, decl] of Object.entries(
    manifest.kinds[item.kind]?.fields ?? {},
  )) {
    if (decl.type !== 'reference') {
      continue;
    }
    const slug = item.view.frontmatter[field];
    const target = items.find(
      (other) => other.kind === decl.kind && other.view.slug === slug,
    );
    if (target !== undefined) {
      refs[field] = target.view;
    }
  }
  for (const [otherKind, decl] of Object.entries(manifest.kinds)) {
    if (otherKind === item.kind) {
      continue;
    }
    for (const [field, fieldDecl] of Object.entries(decl.fields ?? {})) {
      if (fieldDecl.type !== 'reference' || fieldDecl.kind !== item.kind) {
        continue;
      }
      backrefs[otherKind] = items
        .filter(
          (other) =>
            other.kind === otherKind &&
            other.view.frontmatter[field] === item.view.slug,
        )
        .map((other) => other.view);
    }
  }
  const siblings =
    manifest.kinds[item.kind]?.listLayout === undefined
      ? []
      : items
          .filter(
            (other) =>
              other.kind === item.kind && other.view.id !== item.view.id,
          )
          .slice(0, 6)
          .map((other) => other.view);
  return { refs, backrefs, siblings };
}

/** Renders every page of one theme and returns what was written. */
async function renderTheme(dir) {
  const theme = await loadTheme(dir);
  const compiled = core.compileTheme(theme.manifest, theme.files, 1);
  const items = await prepare(theme.manifest);
  const out = join(OUT_DIR, theme.manifest.id);
  await mkdir(out, { recursive: true });

  const written = [];
  const write = async (name, html, label) => {
    await writeFile(join(out, name), html);
    written.push({ name, label });
  };

  // Home
  const recent = {};
  for (const item of items) {
    const bucket = recent[item.kind] ?? [];
    bucket.push(item.view);
    recent[item.kind] = bucket;
  }
  await write(
    'home.html',
    await core.renderPage(
      compiled,
      theme.manifest.home,
      core.buildHomePageView(contextFor(theme, '/'), recent),
    ),
    'Home',
  );

  // One page per content item
  for (const item of items) {
    const kind = theme.manifest.kinds[item.kind];
    const layout = kind?.layout ?? 'layouts/page.liquid';
    await write(
      `${item.kind}-${item.view.slug}.html`,
      await core.renderPage(
        compiled,
        layout,
        core.buildContentPageView(
          contextFor(theme, item.path),
          item.view,
          { html: item.fragment.html, meta: item.fragment.meta },
          [{ locale: 'en', path: item.path }],
          relationsFor(theme.manifest, item, items),
        ),
      ),
      `${kind?.label ?? item.kind}: ${item.view.title}`,
    );
  }

  // One list page per kind that has a list layout
  for (const [kind, config] of Object.entries(theme.manifest.kinds)) {
    if (config.listLayout === undefined) {
      continue;
    }
    const kindItems = items.filter((item) => item.kind === kind);
    if (kindItems.length === 0) {
      continue;
    }
    const base = SITE.kinds[kind]?.base ?? kind;
    await write(
      `list-${kind}.html`,
      await core.renderPage(
        compiled,
        config.listLayout,
        core.buildListPageView(contextFor(theme, `/${base}`), {
          kind,
          items: kindItems.map((item) => item.view),
          hasNext: false,
          page: 1,
          basePath: `/${base}`,
          kindBase: base,
        }),
      ),
      `Index: ${config.label ?? kind}`,
    );
  }

  // Assets go to the server root, because templates reference them with an
  // absolute `/theme/<id>/<version>/…` path exactly as they do in production.
  const assetDir = join(
    OUT_DIR,
    'theme',
    theme.manifest.id,
    theme.manifest.version,
  );
  await mkdir(assetDir, { recursive: true });
  try {
    await cp(join(THEMES_DIR, dir, 'assets'), assetDir, { recursive: true });
  } catch {
    // A theme without assets is allowed.
  }

  return { manifest: theme.manifest, written };
}

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const dirs = (await readdir(THEMES_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const results = [];
for (const dir of dirs) {
  results.push(await renderTheme(dir));
  console.log(`✓ ${dir}`);
}

const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mallok theme preview</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font:16px/1.6 system-ui,sans-serif; background:#fafaf9; color:#18181b; }
  @media (prefers-color-scheme:dark){ body{background:#0c0c0d;color:#e7e7e6;} }
  .wrap { max-width:56rem; margin:0 auto; padding:3rem 1.5rem 5rem; }
  h1 { font-size:1.5rem; letter-spacing:-0.02em; margin:0 0 0.4rem; }
  .lede { color:#71717a; margin:0 0 2.5rem; }
  .theme { margin-bottom:2.5rem; padding-bottom:2rem; border-bottom:1px solid #e4e4e7; }
  @media (prefers-color-scheme:dark){ .theme{border-color:#27272a;} }
  .theme h2 { font-size:1.1rem; margin:0 0 0.2rem; }
  .theme p { margin:0 0 0.9rem; color:#71717a; font-size:0.92rem; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:0.5rem; }
  a.page { display:inline-block; padding:0.4rem 0.8rem; border:1px solid #d4d4d8; border-radius:2px; text-decoration:none; color:inherit; font-size:0.88rem; }
  a.page:hover { border-color:#18181b; }
  @media (prefers-color-scheme:dark){ a.page{border-color:#3f3f46;} a.page:hover{border-color:#e7e7e6;} }
</style></head><body><div class="wrap">
<h1>Mallok theme preview</h1>
<p class="lede">Rendered through <code>src/core</code> — the same two stages and the same view assembly the Worker runs.</p>
${results
  .map(
    (result) => `<section class="theme">
  <h2>${result.manifest.name} <span style="color:#a1a1aa;font-weight:400">${result.manifest.id}@${result.manifest.version}</span></h2>
  <p>${result.manifest.description ?? ''}</p>
  <ul>${result.written
    .map(
      (page) =>
        `<li><a class="page" href="./${result.manifest.id}/${page.name}">${page.label}</a></li>`,
    )
    .join('')}</ul>
</section>`,
  )
  .join('\n')}
</div></body></html>
`;
await writeFile(join(OUT_DIR, 'index.html'), index);
console.log(`\nOpen ${OUT_DIR}/index.html`);
