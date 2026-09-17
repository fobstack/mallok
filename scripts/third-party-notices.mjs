/**
 * `THIRD_PARTY_NOTICES` for the published package.
 *
 * Apache-2.0 §4(d) and every permissive licence Mallok's dependencies use
 * require the notices to travel with the redistributed code. The `mallok`
 * tarball is redistributed code: `worker/index.js` and `cli/index.js` are
 * bundles with dozens of libraries inlined, while `assets/_mallok/app` is a
 * third Vite build graph with React, CodeMirror and signals.
 *
 * The list is built from esbuild's own metafiles and Vite 8's generated
 * licence metadata rather than from `package.json` — a dependency list is
 * what was *installed*, and the thing that needs attributing is what was
 * **bundled**. The two differ in both directions: `sharp` is a dependency and
 * is deliberately left external, and a transitive package nobody declared
 * can still end up inside a bundle.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Filenames a package might use for its licence text. */
const LICENSE_FILES = /^(LICEN[CS]E|COPYING|NOTICE)(\.(md|txt))?$/i;

/**
 * The installed package a bundled input belongs to.
 *
 * Inputs look like `node_modules/unified/index.js` or
 * `node_modules/@types/mdast/index.d.ts`; a nested `node_modules` means a
 * package brought its own copy of a dependency, and the *last* segment is the
 * one that owns the file.
 */
function owningPackage(input) {
  const parts = input.split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at === -1) {
    return null;
  }
  const first = parts[at + 1];
  if (first === undefined) {
    return null;
  }
  const scoped = first.startsWith('@');
  const name = scoped ? `${first}/${parts[at + 2] ?? ''}` : first;
  const dir = parts.slice(0, at + (scoped ? 3 : 2)).join('/');
  return { name, dir };
}

/** The licence text a package ships, if it ships one. */
async function licenseText(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const file = entries.find((entry) => LICENSE_FILES.test(entry));
  if (file === undefined) {
    return null;
  }
  return (await readFile(join(dir, file), 'utf8')).trimEnd();
}

/** A readable package manifest, or null for a directory that is not one. */
async function manifestAt(dir) {
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Completes a Vite licence entry whose nested package.json omits metadata.
 *
 * `@preact/signals-react/runtime/package.json`, for example, deliberately has
 * no version, licence or licence file; Vite therefore reports its private
 * name at `0.0.0`. The redistributed code is still covered by the parent
 * package's version and MIT text. This lookup discovers that relationship
 * from the installed manifests — no hand-maintained dependency table.
 */
async function completeViteLicense(entry) {
  if (
    entry.version !== '0.0.0' &&
    entry.identifier !== undefined &&
    entry.text !== undefined
  ) {
    return entry;
  }

  const scoped = entry.name.startsWith('@');
  const parts = entry.name.split('/');
  const rootsDir = scoped
    ? join('node_modules', parts[0] ?? '')
    : 'node_modules';
  let roots = [];
  try {
    roots = await readdir(rootsDir);
  } catch {
    // Reported below as incomplete with the package name in the error.
  }

  for (const child of roots) {
    if (!scoped && child.startsWith('@')) {
      continue;
    }
    const root = join(rootsDir, child);
    const parent = await manifestAt(root);
    if (
      typeof parent?.name !== 'string' ||
      (parent.name !== entry.name && !entry.name.startsWith(`${parent.name}-`))
    ) {
      continue;
    }

    const candidates = [root];
    for (const nested of await readdir(root).catch(() => [])) {
      candidates.push(join(root, nested));
    }
    for (const candidate of candidates) {
      const nested = await manifestAt(candidate);
      if (nested?.name !== entry.name) {
        continue;
      }
      const text =
        entry.text ??
        (await licenseText(candidate)) ??
        (await licenseText(dirname(candidate))) ??
        (await licenseText(root));
      const completed = {
        ...entry,
        version:
          entry.version === '0.0.0'
            ? (nested.version ?? parent.version)
            : entry.version,
        identifier: entry.identifier ?? nested.license ?? parent.license,
        text,
      };
      if (
        typeof completed.version === 'string' &&
        completed.version !== '0.0.0' &&
        typeof completed.identifier === 'string' &&
        typeof completed.text === 'string' &&
        completed.text !== ''
      ) {
        return completed;
      }
    }
  }

  throw new Error(
    `Vite emitted incomplete licence metadata for ${entry.name}@${entry.version}.`,
  );
}

/**
 * Collects every package whose code is inside the given esbuild bundles.
 *
 * @typedef {{name: string, version: string, identifier?: string, text?: string}} ViteLicense
 *
 * @param {readonly {metafile: {inputs: Record<string, unknown>}}[]} builds
 * @param {readonly ViteLicense[]} [viteLicenses]
 * @returns {Promise<{text: string, packages: {name: string, version: string, license: string}[]}>}
 */
export async function thirdPartyNotices(builds, viteLicenses = []) {
  /** @type {Map<string, {name: string, dir: string}>} */
  const directories = new Map();
  for (const build of builds) {
    for (const input of Object.keys(build.metafile.inputs)) {
      const owner = owningPackage(input);
      if (owner !== null) {
        let version = 'unknown';
        try {
          const manifest = JSON.parse(
            await readFile(join(owner.dir, 'package.json'), 'utf8'),
          );
          version = manifest.version ?? version;
        } catch {
          // Kept below as unknown; omitting the package would be worse.
        }
        directories.set(`${owner.name}@${version}`, owner);
      }
    }
  }

  const packages = [];
  for (const [, { name, dir }] of [...directories].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let manifest = {};
    try {
      manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    } catch {
      // A package with no readable manifest still has to be listed; naming it
      // with "unknown" is honest, dropping it is not.
    }
    packages.push({
      name,
      version: manifest.version ?? 'unknown',
      license:
        typeof manifest.license === 'string'
          ? manifest.license
          : (manifest.license?.type ?? 'see text below'),
      homepage: manifest.homepage ?? manifest.repository?.url ?? '',
      text: await licenseText(dir),
    });
  }

  for (const rawEntry of viteLicenses) {
    const entry = await completeViteLicense(rawEntry);
    if (
      typeof entry?.name !== 'string' ||
      entry.name === '' ||
      typeof entry.version !== 'string' ||
      entry.version === ''
    ) {
      throw new Error('Vite emitted an invalid admin licence entry.');
    }
    const key = `${entry.name}@${entry.version}`;
    if (packages.some((pkg) => `${pkg.name}@${pkg.version}` === key)) {
      continue;
    }
    packages.push({
      name: entry.name,
      version: entry.version,
      license: entry.identifier ?? 'see text below',
      homepage: '',
      text: entry.text?.trimEnd() ?? null,
    });
  }

  packages.sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );

  return { packages, text: render(packages) };
}

/** The file itself. */
function render(packages) {
  const lines = [
    'THIRD-PARTY SOFTWARE NOTICES',
    '',
    'The `mallok` package redistributes the libraries below, bundled into',
    '`worker/index.js`, `cli/index.js` and the Vite-built admin assets. Each',
    'remains under its own licence, reproduced here in full where the package',
    'ships the text. Mallok itself is licensed under Apache-2.0; see LICENSE.',
    '',
    `${packages.length} packages:`,
    '',
  ];
  for (const pkg of packages) {
    lines.push(`  - ${pkg.name}@${pkg.version} (${pkg.license})`);
  }

  for (const pkg of packages) {
    lines.push(
      '',
      '-'.repeat(76),
      `${pkg.name}@${pkg.version} — ${pkg.license}`,
      ...(pkg.homepage === '' ? [] : [pkg.homepage]),
      '',
      pkg.text ??
        `No licence file is shipped with this package; it declares ${pkg.license}.`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Exported for the test that checks it against real esbuild input paths. */
export { owningPackage };
