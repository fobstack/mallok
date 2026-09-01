/**
 * Makes sure `MALLOK_SECRET` exists before a Workers Builds deploy
 * (docs/CLOUDFLARE_RESOURCES.md §7, option 1).
 *
 * The Deploy-to-Cloudflare button has no step where a person can set a
 * secret, so the build does it — **once**. Rotating it on every build would
 * invalidate every session and make every encrypted plugin key
 * undecryptable, so an existing secret is never touched.
 *
 * When the build environment does not allow writing secrets, this exits 0
 * with an explanation rather than failing the deploy: a site with no secret
 * still boots and says what to do (docs/CLOUDFLARE_RESOURCES.md §7,
 * option 2).
 */

import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';

const NAME = 'MALLOK_SECRET';

function wrangler(args, input) {
  return spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
}

const listed = wrangler(['secret', 'list']);
if (listed.status !== 0) {
  console.log(
    `Could not list secrets, so ${NAME} was left alone. ` +
      'If the site reports a missing secret, add it under ' +
      'Workers & Pages → your Worker → Settings → Variables and Secrets.',
  );
  process.exit(0);
}

if (listed.stdout.includes(NAME)) {
  console.log(`${NAME} already exists; leaving it untouched.`);
  process.exit(0);
}

const secret = Buffer.from(
  webcrypto.getRandomValues(new Uint8Array(32)),
).toString('base64');
const put = wrangler(['secret', 'put', NAME], secret);
if (put.status !== 0) {
  console.log(
    `Could not set ${NAME} from the build. The site will still start; ` +
      'add the secret under Settings → Variables and Secrets to enable ' +
      'sessions and encrypted plugin keys.',
  );
  process.exit(0);
}
console.log(`${NAME} generated and stored.`);
