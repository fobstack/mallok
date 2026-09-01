/**
 * The `trade-b2b` starter: a complete foreign-trade company site
 * (docs/ARCHITECTURE.md §11).
 *
 * The documents are the repository's own `content/` directory — the same
 * bundles `mallok build` compiles into a static site. There is one copy: what
 * the wizard imports into D1 and what the static builder reads are the same
 * files, so editing `content/` changes both paths.
 *
 * It assumes the `atelier` theme, whose six content kinds these documents are
 * written for. Importing it produces a site with a home page, two product
 * families, three products, an about page, a contact page with an inquiry
 * form, an FAQ, two case studies and two articles.
 *
 * **It is bilingual from the first minute.** The pages a buyer decides on —
 * home, company, products, families, FAQ, contact — ship in English and
 * Chinese with their translation groups already linked, so `hreflang` is
 * correct before anyone edits anything. Case studies and news are English
 * only, which is what a real trade site looks like: the editor's language
 * switcher offers to create the missing ones.
 */

import newsCertificates from '../../../content/article/reading-a-mill-certificate/index.md';
import newsLeadTimes from '../../../content/article/why-titanium-lead-times-move/index.md';
import caseDesalination from '../../../content/case/heat-exchanger-plate-for-a-desalination-retrofit/index.md';
import caseHydraulic from '../../../content/case/hydraulic-tubing-for-a-regional-jet-programme/index.md';
import categoryAerospace from '../../../content/category/aerospace-alloys/index.md';
import zhCategoryAerospace from '../../../content/category/aerospace-alloys/index.zh.md';
import categoryIndustrial from '../../../content/category/industrial-and-chemical-grades/index.md';
import zhCategoryIndustrial from '../../../content/category/industrial-and-chemical-grades/index.zh.md';
import faqBuying from '../../../content/faq/buying-titanium/index.md';
import zhFaqBuying from '../../../content/faq/buying-titanium/index.zh.md';
import about from '../../../content/page/about/index.md';
import zhAbout from '../../../content/page/about/index.zh.md';
import contact from '../../../content/page/contact/index.md';
import zhContact from '../../../content/page/contact/index.zh.md';
import home from '../../../content/page/home/index.md';
import zhHome from '../../../content/page/home/index.zh.md';
import productGr2Plate from '../../../content/product/grade-2-titanium-plate/index.md';
import zhProductGr2Plate from '../../../content/product/grade-2-titanium-plate/index.zh.md';
import productGr5Bar from '../../../content/product/grade-5-titanium-bar/index.md';
import zhProductGr5Bar from '../../../content/product/grade-5-titanium-bar/index.zh.md';
import productGr9Tube from '../../../content/product/grade-9-titanium-tube/index.md';
import zhProductGr9Tube from '../../../content/product/grade-9-titanium-tube/index.zh.md';
import siteConfig from '../../../site.json';
import type { Starter } from '../types.js';

/** The official foreign-trade starter. */
export const tradeB2bStarter: Starter = {
  id: 'trade-b2b',
  name: 'Foreign-trade company site',
  description:
    'A complete B2B site: product families and products, case studies, an FAQ, news and a contact page with an inquiry form.',
  theme: 'atelier',
  plugins: ['inquiry'],
  // Read from the repository's `site.json`, which is also what `mallok build`
  // reads: the wizard and the static builder configure the site from one file
  // rather than from two that can drift apart.
  settings: {
    tagline: siteConfig.tagline,
    locales: siteConfig.locales,
    kinds: siteConfig.kinds,
    nav: siteConfig.nav,
    themeOptions: siteConfig.themeOptions,
  },
  documents: [
    // Categories come first so the products that reference them resolve on
    // the first render rather than after a later save.
    {
      kind: 'category',
      slug: 'aerospace-alloys',
      markdown: categoryAerospace,
      translations: {
        zh: { slug: 'hangkong-hangtian-paihao', markdown: zhCategoryAerospace },
      },
    },
    {
      kind: 'category',
      slug: 'industrial-and-chemical-grades',
      markdown: categoryIndustrial,
      translations: {
        zh: { slug: 'gongye-huagong-paihao', markdown: zhCategoryIndustrial },
      },
    },
    {
      kind: 'product',
      slug: 'grade-5-titanium-bar',
      markdown: productGr5Bar,
      translations: {
        zh: { slug: 'gr5-tihejin-bang', markdown: zhProductGr5Bar },
      },
    },
    {
      kind: 'product',
      slug: 'grade-2-titanium-plate',
      markdown: productGr2Plate,
      translations: { zh: { slug: 'gr2-tiban', markdown: zhProductGr2Plate } },
    },
    {
      kind: 'product',
      slug: 'grade-9-titanium-tube',
      markdown: productGr9Tube,
      translations: {
        zh: { slug: 'gr9-tihejin-guan', markdown: zhProductGr9Tube },
      },
    },
    {
      kind: 'page',
      slug: 'home',
      markdown: home,
      translations: { zh: { slug: 'shouye', markdown: zhHome } },
    },
    {
      kind: 'page',
      slug: 'about',
      markdown: about,
      translations: { zh: { slug: 'guanyu', markdown: zhAbout } },
    },
    {
      kind: 'page',
      slug: 'contact',
      markdown: contact,
      translations: { zh: { slug: 'lianxi', markdown: zhContact } },
    },
    {
      kind: 'faq',
      slug: 'buying-titanium',
      markdown: faqBuying,
      translations: { zh: { slug: 'caigou-timo', markdown: zhFaqBuying } },
    },
    {
      kind: 'case',
      slug: 'hydraulic-tubing-for-a-regional-jet-programme',
      markdown: caseHydraulic,
    },
    {
      kind: 'case',
      slug: 'heat-exchanger-plate-for-a-desalination-retrofit',
      markdown: caseDesalination,
    },
    {
      kind: 'article',
      slug: 'reading-a-mill-certificate',
      markdown: newsCertificates,
    },
    {
      kind: 'article',
      slug: 'why-titanium-lead-times-move',
      markdown: newsLeadTimes,
    },
  ],
};
