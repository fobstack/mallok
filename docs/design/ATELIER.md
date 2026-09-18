# Atelier visual direction

A material-first industrial catalogue for the fictional Northbound Titanium
starter. English leads; Chinese uses the same hierarchy and a native system
font fallback. Sample photography and copy illustrate a template, not a
verified supplier, certification, inspection, or customer project.

## Tokens

- Paper: #ffffff; cool surface: #f0f4f8; titanium: #dce4eb.
- Ink: #152b40; secondary text: #526477; action blue: #1748bd.
- Headings: local Bricolage Grotesque, restrained 500–600 weight.
- Body: local Instrument Sans; Chinese: PingFang SC / Microsoft YaHei.
- Hero: a navy opening with a left-aligned, light headline over wide material
  photography; a dark gradient protects text contrast and a single white
  action leads to the relevant next step. Three labeled selectors sit below.
- The catalogue stays light after the dark opening; the enquiry panel uses a
  pale blue surface. Article grids adapt to the actual number of entries.
- Product imagery is primary; borders separate content without framing every
  section as a rounded card. Detail pages use a broad reading column and a
  compact specification rail. Small screens stack in reading order.

The earlier decorative metallic CSS rods are replaced by photographs from the project owner’s supplied material library.
The configured image API passed its models check, but both image-edit attempts
ended with a disconnected response. No AI-generated output is used. Product images take priority over bundled illustrative
fallbacks. A declared, dependency-free carousel script runs on the homepage only. No
external font request is introduced.

## Maintaining the default

- `src/themes/atelier/assets/style.css` owns the palette and typography. Fonts
  stay local; their OFL notices remain alongside the WOFF2 files.
- `assets/images/` contains the three material illustrations, each at 1536 and
  768 pixels wide. The templates use responsive sources and lazy-load images
  below the hero. The hero is eager and receives high fetch priority.
- An explicit content cover or resolved product gallery takes precedence over
  the sample photography. A missing gallery falls back to the material image;
  both English and Chinese sample material names are recognized.
- The English theme defaults live in `theme.json`; the Chinese demo overrides
  live in the root `site.json`. Replace the sample company copy before using
  the starter for an actual business.
- Run `pnpm build:site` and serve `dist/site` to review the full bilingual demo.
  Static output omits inquiry forms because those require the Worker backend.
- `pnpm test:a11y` checks Atelier in light and dark modes and at a 390-pixel
  mobile viewport. `test/core/themes.test.ts` checks missing-gallery fallback.

These design changes require a new candidate build before release. Previous
Cloudflare performance measurements belong to the previous candidate, not to
this updated theme.


## Three-story homepage carousel

Atelier 2.5 has three manual slides: materials, processing and quality. The
last two photographs come from the supplied `cnc-lathe-machining-detail.jpg`
and `industrial-metal-ring-inspection.jpg`. They illustrate the demo, not
certified capabilities of the fictional business. Desktop and mobile crops
are separate assets. The first image is eager; other slides are lazy-loaded. No autoplay is enabled.

Selectors, previous/next buttons, Left/Right and Home/End keys, and horizontal
touch gestures change the active slide. There is no autoplay or animation.
Inactive enhanced slides use `hidden` so their links cannot receive focus.
Without JavaScript, all three stories remain in a native scroll-snap strip
and the selectors use fragment links. All copy is translated into Chinese.

The approved homepage carousel is an exception to the older official-theme
zero-JavaScript rule. Other Atelier pages keep their script-free rendering.
The theme package only accepts a `.js` asset when its exact `assets/…` path
is listed in `clientScripts`; SVG and undeclared scripts remain rejected.
