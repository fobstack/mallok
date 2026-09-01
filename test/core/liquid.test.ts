import { describe, expect, it } from 'vitest';
import {
  compileTheme,
  parseThemeManifest,
  SafeHtml,
  themeStrings,
} from '../../src/core/index.js';

const manifest = parseThemeManifest({
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  home: 'layouts/home.liquid',
  kinds: { article: { layout: 'layouts/article.liquid', base: 'news' } },
  locales: ['en', 'de'],
  defaultLocale: 'en',
});

const files = {
  'layouts/base.liquid':
    '<html>{% render "partials/header" %}{% block content %}{% endblock %}</html>',
  'layouts/home.liquid':
    '{% layout "layouts/base" %}{% block content %}home{% endblock %}',
  'layouts/article.liquid':
    '{% layout "layouts/base" %}{% block content %}<h1>{{ content.title }}</h1>{{ content.html }}{% endblock %}',
  'partials/header.liquid': '<header>{{ site.name }}</header>',
  'locales/en.json': '{"read_more":"Read more","only_en":"EN"}',
  'locales/de.json': '{"read_more":"Weiterlesen"}',
};

describe('compileTheme', () => {
  const theme = compileTheme(manifest, files, 1);

  it('escapes all output by default and passes SafeHtml through', async () => {
    const html = await theme.render('layouts/article.liquid', {
      site: { name: 'A & B' },
      content: { title: '<b>x</b>', html: new SafeHtml('<p>ok</p>') },
    });
    expect(html).toBe(
      '<html><header>A &amp; B</header><h1>&lt;b&gt;x&lt;/b&gt;</h1><p>ok</p></html>',
    );
  });

  it('does not let the raw filter bypass escaping for plain strings', async () => {
    const t = compileTheme(
      manifest,
      { ...files, 'layouts/home.liquid': '{{ v | raw }}' },
      1,
    );
    expect(await t.render('layouts/home.liquid', { v: '<i>' })).toBe(
      '&lt;i&gt;',
    );
  });

  it('hides prototype properties from templates', async () => {
    const t = compileTheme(
      manifest,
      {
        ...files,
        'layouts/home.liquid': '[{{ site.constructor }}|{{ site.__proto__ }}]',
      },
      1,
    );
    expect(await t.render('layouts/home.liquid', { site: { name: 'x' } })).toBe(
      '[|]',
    );
  });

  it('only resolves templates that belong to the theme', async () => {
    const t = compileTheme(
      manifest,
      { ...files, 'layouts/home.liquid': '{% render "../../etc/passwd" %}' },
      1,
    );
    await expect(t.render('layouts/home.liquid', {})).rejects.toThrow(
      /Failed to lookup/,
    );
  });

  it('rejects unknown filters', async () => {
    const t = compileTheme(
      manifest,
      { ...files, 'layouts/home.liquid': '{{ v | evil }}' },
      1,
    );
    await expect(t.render('layouts/home.liquid', { v: 1 })).rejects.toThrow(
      /undefined filter/,
    );
  });

  it('fails clearly for a missing template', async () => {
    await expect(theme.render('layouts/nope.liquid', {})).rejects.toThrow(
      /no template/,
    );
  });
});

describe('themeStrings', () => {
  it('falls back to the default locale', () => {
    expect(themeStrings(manifest, files, 'de')).toEqual({
      read_more: 'Weiterlesen',
      only_en: 'EN',
    });
    expect(themeStrings(manifest, files, 'fr')).toEqual({
      read_more: 'Read more',
      only_en: 'EN',
    });
  });
});
