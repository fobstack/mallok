import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

/**
 * A project that has only the tarball.
 *
 * Not a generated Mallok site and not this repository: an empty directory, a
 * `package.json`, the `mallok` tarball, TypeScript, and the Cloudflare types
 * any Worker needs. No path back to Mallok's source, no sibling package, no
 * inherited `tsconfig`. Whatever compiles here is what the package actually
 * promises; everything else was resolved by proximity.
 *
 * `skipLibCheck` is **false** on purpose. It is the setting that hid the bug
 * this file exists for: the published declarations were a `tsc` emit of the
 * whole source tree, and through the core barrel they reached `zod`, `mdast`
 * and `hast` — three packages `mallok` does not depend on and npm therefore
 * never installs. A site that turned `skipLibCheck` off, which is what a
 * careful project does, got three unresolved-module errors before compiling a
 * line of its own code. The generated shell had it on, so nothing noticed.
 */

let sandbox = '';
let tarball = '';

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith('VITEST') ||
      key.startsWith('npm_') ||
      key === 'NODE_PATH' ||
      key === 'NODE_OPTIONS'
    ) {
      delete environment[key];
    }
  }
  return environment;
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env: cleanEnvironment(),
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'mallok-strict-'));

  const candidate = process.env.MALLOK_CANDIDATE_TARBALL;
  if (candidate !== undefined) {
    // The release gate supplies the already packed file selected for
    // publication. Repacking dist/pkg here would verify a different artifact.
    tarball = resolve(candidate);
    await expect(readFile(tarball)).resolves.toBeDefined();
  } else {
    // Normal development tests make an isolated throwaway tarball.
    const packed = await run(
      'npm',
      ['pack', '--json', '--pack-destination', sandbox],
      join(process.cwd(), 'dist/pkg'),
    );
    expect(packed.code, packed.stderr).toBe(0);
    const [entry] = JSON.parse(packed.stdout) as { filename: string }[];
    tarball = join(sandbox, entry?.filename ?? '');
  }

  await writeFile(
    join(sandbox, 'package.json'),
    `${JSON.stringify(
      {
        name: 'strict-consumer',
        version: '1.0.0',
        private: true,
        type: 'module',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const installed = await run(
    'npm',
    [
      'install',
      tarball,
      'typescript@5.9.3',
      '@cloudflare/workers-types@5.20260828.1',
    ],
    sandbox,
  );
  expect(installed.code, installed.stderr).toBe(0);
}, 900_000);

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('a project that installed only the tarball', () => {
  beforeAll(async () => {
    await mkdir(join(sandbox, 'src'), { recursive: true });
    await writeFile(
      join(sandbox, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'es2022',
            module: 'preserve',
            moduleResolution: 'bundler',
            lib: ['es2023'],
            types: ['@cloudflare/workers-types'],
            strict: true,
            noUncheckedIndexedAccess: true,
            exactOptionalPropertyTypes: true,
            verbatimModuleSyntax: true,
            isolatedModules: true,
            // The whole point of this fixture.
            skipLibCheck: false,
            noEmit: true,
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  });

  it('compiles the four-line composition every site ships', async () => {
    await writeFile(
      join(sandbox, 'src/worker.ts'),
      [
        "import { atelier, createMallok, inquiry } from 'mallok/worker';",
        '',
        'export default createMallok({ theme: atelier, plugins: [inquiry] });',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await run(
      join(sandbox, 'node_modules/.bin/tsc'),
      ['-p', 'tsconfig.json'],
      sandbox,
    );

    // Before the fix this failed with three of these:
    //   error TS2307: Cannot find module 'zod' or its corresponding type
    //   declarations.
    expect(result.stdout + result.stderr).not.toMatch(
      /Cannot find module '(zod|mdast|hast)'/,
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
  }, 300_000);

  it('compiles against the public theme and plugin types by name', async () => {
    await writeFile(
      join(sandbox, 'src/typed.ts'),
      [
        "import type { BundledTheme, Env, MallokOptions, MallokPlugin } from 'mallok/worker';",
        "import { createMallok, defineTheme, folio, inquiry } from 'mallok/worker';",
        '',
        '// A site naming its own theme, which is what `defineTheme` is for.',
        'const mine: BundledTheme = defineTheme(',
        "  { id: 'mine', name: 'Mine', version: '1.0.0' },",
        "  { 'layouts/base.liquid': '<html></html>' },",
        ');',
        '',
        'const plugins: readonly MallokPlugin[] = [inquiry];',
        'const options: MallokOptions = { theme: mine, plugins };',
        '',
        '// A site reading a binding off its own Env, as a scheduled handler or',
        '// a test helper would.',
        'export function site(env: Env): string {',
        '  return env.MALLOK_SITE;',
        '}',
        '',
        'export const chosen = folio.manifest.name;',
        'export default createMallok(options);',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await run(
      join(sandbox, 'node_modules/.bin/tsc'),
      ['-p', 'tsconfig.json'],
      sandbox,
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
  }, 300_000);

  it('compiles a real third-party plugin, written against the package alone', async () => {
    // The surface `docs/PLUGIN_API.md` promises, exercised the way an author
    // would meet it: a manifest, a declared hook and a declared route, with
    // inline handlers receiving their types from `definePlugin`. Explicit
    // annotations would hide the exact regression this consumer catches.
    //
    // Before this, `mallok/worker` exported `MallokPlugin` with an opaque
    // four-field manifest and nothing else — enough for a site to *name* a
    // plugin, and not nearly enough to write one. An author had to reach into
    // the package's internals, which is the private interface §1 says does
    // not exist.
    await writeFile(
      join(sandbox, 'src/plugin.ts'),
      [
        "import { definePlugin } from 'mallok/worker';",
        '',
        'const manifest = {',
        "  id: 'guestbook',",
        "  name: 'Guestbook',",
        "  version: '1.0.0',",
        '  pluginApi: 1,',
        "  hooks: ['afterRender', 'onContentSave'],",
        "  routes: [{ path: 'sign', method: 'POST' }],",
        '  settings: {',
        "    heading: { type: 'string', label: 'Heading' },",
        '  },',
        "  secrets: { token: { label: 'Token' } },",
        '  panels: [{',
        "    id: 'entries', label: 'Entries', type: 'table',",
        "    table: 'p_guestbook_entries',",
        "    columns: [{ field: 'name', label: 'Name' }],",
        "    actions: [{ id: 'clear', label: 'Clear' }],",
        '  }],',
        '};',
        '',
        'const plugin = definePlugin({',
        '  manifest,',
        "  migrations: [{ id: 'plugin:guestbook:0001', sql: 'SELECT 1' }],",
        '  hooks: {',
        '    afterRender: (html, ctx) =>',
        '      `#{html}<!-- #{ctx.site.name} #{ctx.locale} -->`,'.replaceAll(
          '#',
          '$',
        ),
        '    onContentSave: async (draft, ctx) => {',
        '      await ctx.sendEmail({',
        "        to: 'editor@example.com',",
        '        subject: `Saved #{draft.title}`,'.replace('#', '$'),
        '        html: `<p>#{draft.slug}</p>`,'.replace('#', '$'),
        '        text: draft.slug,',
        '      });',
        '      return undefined;',
        '    },',
        '  },',
        '  routes: {',
        '    async sign(input, ctx) {',
        "      return new Response(`#{input.fields.name ?? 'anonymous'}:#{ctx.locale}`, { status: 201 });".replaceAll(
          '#',
          '$',
        ),
        '    },',
        '  },',
        '  exportFiles: async (ctx) => [',
        "    { path: 'guestbook.txt', text: ctx.site.name },",
        '  ],',
        '  checkSecrets: {',
        "    token: async (ctx) => ({ ok: Boolean(ctx.secrets.token), message: 'checked' }),",
        '  },',
        '  actions: {',
        '    clear: async (ids, ctx) => new Response(`#{ids.length}:#{ctx.site.name}`),'.replaceAll(
          '#',
          '$',
        ),
        '  },',
        '});',
        '',
        'export default plugin;',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await run(
      join(sandbox, 'node_modules/.bin/tsc'),
      ['-p', 'tsconfig.json'],
      sandbox,
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
  }, 300_000);

  it('runs that same compiled plugin, and refuses a broken one', async () => {
    const compiled = await run(
      join(sandbox, 'node_modules/.bin/tsc'),
      ['-p', 'tsconfig.json', '--noEmit', 'false', '--outDir', 'compiled'],
      sandbox,
    );
    expect(compiled.code, compiled.stdout + compiled.stderr).toBe(0);

    // Compiling is not enough: `definePlugin` does its work at module
    // initialisation, so execute the exact third-party source above.
    const script = join(sandbox, 'plugin-check.mjs');
    await writeFile(
      script,
      [
        "import plugin from './compiled/plugin.js';",
        "import { definePlugin } from 'mallok/worker';",
        '',
        'if (plugin.manifest.routes[0].rateLimit !== false) {',
        '  throw new Error("route defaults were not applied");',
        '}',
        'const routed = await plugin.routes.sign(',
        "  { fields: { name: 'Ada' } },",
        "  { locale: 'en' },",
        ');',
        "if ((await routed.text()) !== 'Ada:en') throw new Error('route did not run');",
        "const rendered = await plugin.hooks.afterRender('page', {",
        "  site: { name: 'Acme' }, locale: 'en',",
        '});',
        "if (!rendered.includes('Acme en')) throw new Error('hook did not run');",
        '',
        '// And a declared hook with no implementation must refuse, naming it.',
        'let refused = null;',
        'try {',
        '  definePlugin({ manifest: { id: "bad", name: "Bad", version: "1.0.0", hooks: ["scheduled"] } });',
        '} catch (error) {',
        '  refused = error;',
        '}',
        'if (refused === null) throw new Error("a broken plugin was accepted");',
        'if (!String(refused.message).includes("bad")) {',
        '  throw new Error("the refusal did not name the plugin");',
        '}',
        'process.stdout.write("plugin: ok\\n");',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await run('node', [script], sandbox);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('plugin: ok');
  }, 120_000);

  it('ships declarations that name no package it does not depend on', async () => {
    const declarations = await readFile(
      join(sandbox, 'node_modules/mallok/types/worker.d.ts'),
      'utf8',
    );
    const manifest = JSON.parse(
      await readFile(join(sandbox, 'node_modules/mallok/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));

    // Comments first. The declarations carry a worked example showing
    // `import { definePlugin } from 'mallok/worker'`, and a scan of the raw
    // text reads that as the package importing itself — which it then
    // reports as an undeclared dependency.
    const code = declarations
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // Every bare import in the published declarations must be a dependency.
    // Relative imports are fine; there are none, which is the simplest way to
    // keep this true.
    for (const match of code.matchAll(
      /^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gm,
    )) {
      const specifier = match[1] ?? '';
      const bare = !specifier.startsWith('.') && !specifier.startsWith('node:');
      const providedByTypesPackage =
        specifier === 'mdast' && declared.has('@types/mdast');
      expect(
        bare &&
          !providedByTypesPackage &&
          !declared.has(specifier.split('/')[0] ?? ''),
        specifier,
      ).toBe(false);
    }
  });
});

describe('the notices for what the bundles inlined', () => {
  it('are shipped, and list the packages the bundle really contains', async () => {
    const notices = await readFile(
      join(sandbox, 'node_modules/mallok/THIRD_PARTY_NOTICES'),
      'utf8',
    );

    // Read from esbuild's metafiles and Vite's generated licence graph, so
    // these are packages genuinely inside a shipped bundle — not a copy of
    // `dependencies`.
    for (const bundled of [
      // Worker and CLI (esbuild metafiles).
      'liquidjs',
      'unified',
      'micromark',
      'zod',
      // Admin (Vite 8's generated build graph).
      'react',
      'react-dom',
      '@preact/signals-react',
      '@codemirror/state',
      '@codemirror/view',
    ]) {
      expect(notices, bundled).toContain(`  - ${bundled}@`);
    }

    // `sharp` is a dependency and is deliberately external: it is installed
    // for the consumer's platform, never inlined, so it is not redistributed
    // here and has no place in this file.
    expect(notices).not.toContain('  - sharp@');
    expect(notices).not.toMatch(/@(unknown|0\.0\.0)\b/);

    // Licence texts, not just a list of names: the list alone satisfies no
    // licence.
    expect(notices).toContain('Permission is hereby granted, free of charge');
    expect(notices).not.toContain(
      'No licence file is shipped with this package',
    );
    expect(notices.length).toBeGreaterThan(20_000);
  });

  it('accounts for every bundled package', async () => {
    const notices = await readFile(
      join(sandbox, 'node_modules/mallok/THIRD_PARTY_NOTICES'),
      'utf8',
    );
    const listed = [...notices.matchAll(/^ {2}- (\S+)@/gm)].map(
      (match) => match[1],
    );
    const claimed = /^(\d+) packages:$/m.exec(notices)?.[1] ?? '0';

    expect(listed.length).toBe(Number(claimed));
    expect(new Set(listed).size).toBe(listed.length);
    // Each listed package also has its own section below the summary.
    for (const name of listed) {
      expect(notices.split(`\n${name}@`).length, name).toBeGreaterThan(1);
    }
  });
});
