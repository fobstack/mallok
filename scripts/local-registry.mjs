/**
 * A throwaway npm registry that serves one local tarball.
 *
 * The problem it solves: a generated project depends on `mallok` at an exact
 * version, and that version does not exist on npmjs.com until it is
 * published. Verifying the candidate therefore needs somewhere for `npm
 * install` to find it — and the alternatives are all worse. A `file:`
 * dependency is exactly what the shell must never contain; `npm link` leaves
 * a symlink the project would build against; installing the tarball by path
 * rewrites the dependency to `file:` in the manifest.
 *
 * So: serve the candidate from a local registry, and let npm resolve it by
 * name and version like any other package. Everything else is redirected to
 * the public registry, so the rest of the install is real.
 *
 * **The test method does not leak into the generated project.** The CLI has
 * no flag for this and no knowledge of it; the registry is selected through
 * `npm_config_registry` in the environment of the install, which is npm's own
 * mechanism. A project created without it resolves `mallok` from npmjs.com.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const UPSTREAM = 'https://registry.npmjs.org';

/**
 * Starts a registry serving `tarballs` (name → { version, path }).
 *
 * Returns the origin to point `npm_config_registry` at, and a `close`.
 */
export async function startLocalRegistry(tarballs) {
  // name → version → entry. More than one version per name is what makes an
  // upgrade testable: `mallok upgrade --to <next>` has to resolve a version
  // the project is not on yet.
  const packages = new Map();
  for (const { name, version, path } of normalise(tarballs)) {
    const bytes = await readFile(path);
    // The **real** manifest, read out of the tarball.
    //
    // npm builds its tree from the registry's metadata, not from the file it
    // downloads: a packument carrying only `{name, version, dist}` installs
    // the package and then links no binaries and installs none of its
    // dependencies, silently. That produced a generated project with `mallok`
    // in `node_modules` and no `mallok` command — which is a fine way to
    // spend an afternoon.
    const { stdout } = await run(
      'tar',
      ['-xzOf', path, 'package/package.json'],
      { maxBuffer: 1 << 24 },
    );
    const versions = packages.get(name) ?? new Map();
    versions.set(version, {
      version,
      bytes,
      manifest: JSON.parse(stdout),
      file: basename(path),
      shasum: createHash('sha1').update(bytes).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    });
    packages.set(name, versions);
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const origin = `http://127.0.0.1:${server.address().port}`;

    for (const [name, versions] of packages) {
      if (path === `/${name}`) {
        const latest = [...versions.keys()].at(-1);
        const body = JSON.stringify({
          name,
          'dist-tags': { latest },
          versions: Object.fromEntries(
            [...versions.values()].map((entry) => [
              entry.version,
              {
                ...entry.manifest,
                name,
                version: entry.version,
                dist: {
                  tarball: `${origin}/${name}/-/${entry.file}`,
                  shasum: entry.shasum,
                  integrity: entry.integrity,
                },
              },
            ]),
          ),
        });
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        });
        response.end(body);
        return;
      }
      const entry = [...versions.values()].find(
        (candidate) => path === `/${name}/-/${candidate.file}`,
      );
      if (entry !== undefined) {
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': entry.bytes.length,
        });
        response.end(entry.bytes);
        return;
      }
    }

    // Everything else is somebody else's package: let npm fetch it for real.
    response.writeHead(302, { location: `${UPSTREAM}${request.url}` });
    response.end();
  });

  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** Accepts `{ name: {version, path} }` or `[{name, version, path}]`. */
function normalise(tarballs) {
  if (Array.isArray(tarballs)) {
    return tarballs;
  }
  return Object.entries(tarballs).map(([name, entry]) => ({ name, ...entry }));
}

// Runnable directly, for working on a shell by hand:
//   node scripts/local-registry.mjs dist/pkg/mallok-0.1.0-rc.4.tgz
if (process.argv[1]?.endsWith('local-registry.mjs')) {
  const tarball = process.argv[2];
  if (tarball === undefined) {
    process.stderr.write('usage: node scripts/local-registry.mjs <tarball>\n');
    process.exit(1);
  }
  await stat(tarball);
  const version = /mallok-(.+)\.tgz$/.exec(basename(tarball))?.[1];
  const { origin } = await startLocalRegistry({
    mallok: { version, path: tarball },
  });
  process.stdout.write(
    `serving mallok@${version} on ${origin}\n` +
      `  npm_config_registry=${origin} npm install\n`,
  );
}
