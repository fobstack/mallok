/** Build the public read-only Atelier demo with the real Mallok CLI. */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const input = join(root, '.tmp/public-demo-input');
const output = join(root, 'dist/demo');
await rm(input, { recursive: true, force: true });
await rm(output, { recursive: true, force: true });
await mkdir(input, { recursive: true });
await cp(join(root, 'content'), join(input, 'content'), { recursive: true });
await cp(join(root, 'demo/content'), join(input, 'content'), {
  recursive: true,
});
const site = JSON.parse(await readFile(join(root, 'site.json'), 'utf8'));
site.nav.zh = site.nav.zh.map((link) =>
  link.href === '/zh/about' ? { ...link, href: '/zh/guanyu' } : link,
);
await writeFile(join(input, 'site.json'), JSON.stringify(site, null, 2));
execFileSync(
  process.execPath,
  [
    join(root, 'dist/pkg/cli/index.js'),
    'build',
    input,
    '--theme',
    join(root, 'src/themes/atelier'),
    '--out',
    output,
    '--origin',
    'https://demo.mallok.dev',
  ],
  { cwd: root, stdio: 'inherit' },
);

await writeFile(
  join(output, 'demo.css'),
  `
.demo-notice{display:flex;justify-content:center;align-items:center;gap:1rem;flex-wrap:wrap;padding:.55rem 1rem;background:#eef3f8;color:#152b40;font:500 12px/1.5 system-ui,sans-serif;text-align:center}
.demo-notice a{color:#1748bd;text-decoration:underline;text-underline-offset:3px}
@media(max-width:600px){.demo-notice{gap:.2rem .75rem;font-size:11px}}
`,
);
async function decorate(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await decorate(path);
    else if (entry.name.endsWith('.html')) {
      let html = await readFile(path, 'utf8');
      const zh = /<html[^>]+lang="zh/.test(html);
      const note = zh
        ? 'Atelier 演示 · 虚构企业 · 不接收询盘'
        : 'Atelier demo · Fictional company · No inquiries collected';
      html = html
        .replace('</head>', '<link rel="stylesheet" href="/demo.css">\n</head>')
        .replace(
          /<body([^>]*)>/,
          `<body$1><aside class="demo-notice" aria-label="${zh ? '演示说明' : 'Demo notice'}"><span>${note}</span><a href="https://github.com/fobstack/mallok">${zh ? '获取 Mallok' : 'Get Mallok'}</a><a href="${zh ? '/' : '/zh/'}" lang="${zh ? 'en' : 'zh'}">${zh ? 'English' : '中文'}</a></aside>`,
        );
      await writeFile(path, html);
    }
  }
}
await decorate(output);
await writeFile(
  join(output, '404.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — Mallok demo</title><link rel="stylesheet" href="/demo.css"></head><body><main style="max-width:40rem;margin:15vh auto;padding:2rem;font-family:system-ui;color:#152b40"><p>MALLOK / ATELIER</p><h1>Page not found</h1><p>This page is not part of the demo.</p><a href="/">Return to the demo</a></main></body></html>`,
);
await writeFile(
  join(output, '_headers'),
  '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n',
);
console.log('Public demo built at dist/demo (static, no inquiry collection).');
