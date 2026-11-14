import { describe, expect, it } from 'vitest';
import {
  adminCatalogProblem,
  localizeThemeManifest,
  pickAdminCatalog,
  themeCatalogKeys,
} from '../../src/core/admin-catalog.js';
import { parseThemeManifest } from '../../src/core/theme.js';

/**
 * Admin catalogs (docs/THEME_FORMAT.md §10.1): a theme's declarations in the
 * operator's language, laid over the manifest the admin is served. Only
 * words change, a missing key keeps the declared English, and a catalog that
 * names something the theme does not declare is refused.
 */

const manifest = parseThemeManifest({
  id: 'trade',
  name: 'Trade',
  version: '1.0.0',
  description: 'A catalogue.',
  home: 'layouts/home.liquid',
  kinds: {
    page: { layout: 'layouts/page.liquid', label: 'Page' },
    product: {
      layout: 'layouts/page.liquid',
      label: 'Product',
      fields: {
        grade: { type: 'string', label: 'Grade', group: 'Specification' },
        form: {
          type: 'select',
          label: 'Form',
          group: 'Specification',
          choices: ['Bar', 'Plate'],
          help: 'The shape it ships in.',
        },
        lead_time: { type: 'string' },
      },
    },
    case: { layout: 'layouts/page.liquid' },
  },
  options: {
    hero_title: { type: 'string', label: 'Hero headline', default: '' },
  },
  locales: ['en'],
  defaultLocale: 'en',
  clientScripts: [{ path: 'assets/x.js', purpose: 'A carousel.' }],
});

describe('themeCatalogKeys', () => {
  it('names every word the admin shows, with the English it replaces', () => {
    const keys = themeCatalogKeys(manifest);
    expect(Object.fromEntries(keys)).toEqual({
      name: 'Trade',
      description: 'A catalogue.',
      'kinds.page.label': 'Page',
      'kinds.product.label': 'Product',
      'kinds.product.fields.grade.label': 'Grade',
      'kinds.product.fields.form.label': 'Form',
      'kinds.product.fields.form.help': 'The shape it ships in.',
      'kinds.product.fields.lead_time.label': 'lead_time',
      'groups.Specification': 'Specification',
      'kinds.case.label': 'case',
      'options.hero_title.label': 'Hero headline',
      'scripts.assets/x.js.purpose': 'A carousel.',
    });
  });
});

describe('adminCatalogProblem', () => {
  const keys = themeCatalogKeys(manifest);
  const allows = (key: string): boolean => keys.has(key);

  it('accepts a partial catalog', () => {
    expect(
      adminCatalogProblem(
        JSON.stringify({ 'kinds.product.label': '产品' }),
        allows,
      ),
    ).toBeNull();
  });

  it('refuses what is not a map of strings', () => {
    expect(adminCatalogProblem('{', allows)).toBe('is not valid JSON');
    expect(adminCatalogProblem('[]', allows)).toBe('must be a JSON object');
    expect(adminCatalogProblem('{"name":1}', allows)).toMatch(/not a string/);
  });

  it('refuses a key the manifest does not declare, naming it', () => {
    expect(
      adminCatalogProblem(
        JSON.stringify({ 'kinds.product.fields.grde.label': '牌号' }),
        allows,
      ),
    ).toBe(
      'names "kinds.product.fields.grde.label", which the manifest does not declare',
    );
  });
});

describe('pickAdminCatalog', () => {
  const files = {
    'admin/zh-CN.json': JSON.stringify({ 'kinds.page.label': '页面' }),
    'admin/de.json': JSON.stringify({ 'kinds.page.label': 'Seite' }),
    'locales/zh.json': JSON.stringify({ page: 'not this' }),
  };

  it('takes an exact tag, then the same primary language, in order', () => {
    expect(pickAdminCatalog(files, ['zh-CN'])).toEqual({
      'kinds.page.label': '页面',
    });
    expect(pickAdminCatalog(files, ['zh-Hans-CN'])).toEqual({
      'kinds.page.label': '页面',
    });
    expect(pickAdminCatalog(files, ['fr', 'de-AT'])).toEqual({
      'kinds.page.label': 'Seite',
    });
  });

  it('is empty when no catalog matches: everything stays as declared', () => {
    expect(pickAdminCatalog(files, ['fr'])).toEqual({});
    expect(pickAdminCatalog(files, [])).toEqual({});
    expect(pickAdminCatalog({}, ['zh-CN'])).toEqual({});
  });
});

describe('localizeThemeManifest', () => {
  const catalog = {
    description: '产品目录。',
    'kinds.product.label': '产品',
    'kinds.product.fields.grade.label': '牌号',
    'kinds.product.fields.form.help': '交货形态。',
    'kinds.product.fields.lead_time.label': '交货期',
    'groups.Specification': '规格',
    'kinds.case.label': '案例',
    'options.hero_title.label': '首屏标题',
    'scripts.assets/x.js.purpose': '轮播。',
  };
  const localized = localizeThemeManifest(manifest, catalog);

  it('puts every catalogued word in place', () => {
    expect(localized.description).toBe('产品目录。');
    expect(localized.kinds.product?.label).toBe('产品');
    expect(localized.kinds.product?.fields?.grade?.label).toBe('牌号');
    expect(localized.kinds.product?.fields?.form?.help).toBe('交货形态。');
    // A group is renamed on every field in it, so they stay together.
    expect(localized.kinds.product?.fields?.grade?.group).toBe('规格');
    expect(localized.kinds.product?.fields?.form?.group).toBe('规格');
    expect(localized.options.hero_title?.label).toBe('首屏标题');
    expect(localized.clientScripts).toEqual([
      { path: 'assets/x.js', purpose: '轮播。' },
    ]);
  });

  it('labels what the theme left unlabelled', () => {
    expect(localized.kinds.case?.label).toBe('案例');
    expect(localized.kinds.product?.fields?.lead_time?.label).toBe('交货期');
  });

  it('keeps the declared English for a key the catalog lacks', () => {
    expect(localized.name).toBe('Trade');
    expect(localized.kinds.page?.label).toBe('Page');
    expect(localized.kinds.product?.fields?.form?.label).toBe('Form');
  });

  it('changes words only: ids, types, layouts and choices are as declared', () => {
    const form = localized.kinds.product?.fields?.form;
    expect(form?.type).toBe('select');
    expect(form?.choices).toEqual(['Bar', 'Plate']);
    expect(localized.kinds.product?.layout).toBe('layouts/page.liquid');
    expect(Object.keys(localized.kinds)).toEqual(Object.keys(manifest.kinds));
    // The input is not touched: the Worker keeps serving it as `declared`.
    expect(manifest.kinds.product?.label).toBe('Product');
  });

  it('returns the manifest itself for an empty catalog', () => {
    expect(localizeThemeManifest(manifest, {})).toBe(manifest);
  });
});
