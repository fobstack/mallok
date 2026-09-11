/**
 * A static file server for the output of `mallok build`.
 *
 * Used by the accessibility run (`test/e2e/accessibility.spec.ts`): every
 * official theme is built to a directory and then scanned in a real browser,
 * which needs the stylesheets to load — `page.setContent()` would leave the
 * pages unstyled and make every colour-contrast result meaningless.
 *
 * Written here rather than pulled from npm because it is thirty lines and a
 * dependency that serves files is a dependency that can serve the wrong ones.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
};

/** Starts a server on an ephemeral port and resolves with it. */
export async function serveStatic(root) {
  const base = resolve(root);
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      // A request path never escapes the root, whatever it contains.
      const relative = normalize(decodeURIComponent(url.pathname)).replace(
        /^(\.\.[/\\])+/,
        '',
      );
      let file = join(base, relative);
      if (!file.startsWith(base + sep) && file !== base) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) {
          file = join(file, 'index.html');
          await stat(file);
        }
      } catch {
        response
          .writeHead(404, { 'content-type': 'text/plain' })
          .end('Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      });
      createReadStream(file).pipe(response);
    })();
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

// Also runnable directly: `node scripts/serve-static.mjs <dir> [port]`.
if (process.argv[1]?.endsWith('serve-static.mjs')) {
  const root = process.argv[2] ?? '.';
  const { origin } = await serveStatic(root);
  process.stdout.write(`serving ${resolve(root)} on ${origin}\n`);
}
