/**
 * Scans the whole Git history for credentials.
 *
 * A repository that is about to be made public carries every version of every
 * file it has ever held, so "the working tree is clean" says nothing. This
 * walks every blob reachable from any ref.
 *
 * **It never prints a suspected secret.** A scanner that echoes what it found
 * moves the secret into a terminal, a CI log and a screenshot; the report
 * gives the object, the path, the line number and the rule that matched,
 * which is everything needed to go and look. Values are reported only as a
 * length and a prefix of the *rule name*, never of the match.
 *
 * Usage: `node scripts/scan-secrets.mjs` — exit 0 when clean, 1 when not.
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * A one-way fingerprint of a matched value.
 *
 * What an acknowledgement has to be tied to, and the reason this exists: an
 * entry keyed only by path and rule silences **every** match of that rule in
 * that file, for ever — including the real credential somebody adds to it
 * next year. The fingerprint is a truncated SHA-256, which is enough to
 * recognise the same value again and not enough to recover it.
 */
function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * What counts as a finding.
 *
 * Each rule is written to match a credential's *shape*, not a keyword, so
 * that documentation saying the word "token" does not produce a finding
 * nobody will read twice.
 */
const RULES = [
  {
    name: 'private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    name: 'Stripe secret key',
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  },
  { name: 'Resend API key', pattern: /\bre_[A-Za-z0-9_]{20,}\b/ },
  {
    // Mallok's own API tokens (docs/CLI.md §4). A token that reaches a public
    // repository is a token that can publish to somebody's site.
    name: 'Mallok API token',
    pattern: /\bmlk_live_[A-Za-z0-9_-]{16,}\b/,
  },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    name: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./,
  },
  {
    // Cloudflare API tokens are 40 characters of base64url. Requiring the
    // assignment keeps this from matching every hash in a lockfile.
    name: 'Cloudflare-shaped token in an assignment',
    pattern:
      /(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN|CF_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/i,
  },
  {
    name: 'secret assigned a long literal',
    pattern:
      /(?:MALLOK_SECRET|[A-Z_]*(?:SECRET|PASSWORD|PRIVATE_KEY))\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/,
  },
];

/** Paths that must never have been committed at all, whatever they contain. */
const FORBIDDEN_PATHS =
  /(^|\/)(\.dev\.vars|\.env|\.env\.[^/]+|[^/]+\.(?:pem|p12|pfx|key))$/;

/**
 * Findings a person has looked at and accepted, with the reason.
 *
 * Not a way to quieten the scanner: an entry here still appears in the
 * report, it just does not fail the run. Each one names an exact path and
 * rule, so a *new* finding in the same file is still a failure.
 */
/**
 * Why this scanner's own tests are full of credential shapes.
 *
 * `test/cli/scan-secrets.test.ts` plants one of each into throwaway
 * repositories and asserts the scan fails on them. The strings are the public
 * example values from each provider's documentation, and they are written out
 * in full on purpose: a test that assembled them from fragments to dodge this
 * scan would be teaching the technique for getting a real key past it.
 *
 * Each is acknowledged **by fingerprint**, so a genuine credential added to
 * that file later is still a finding.
 */
const FIXTURE_REASON =
  "A fixture in the scanner's own tests, planted to prove the scan fails on " +
  'it. Documentation example values, never live credentials.';

const ACKNOWLEDGED = [
  {
    path: 'test/cli/scan-secrets.test.ts',
    rule: 'private key block',
    fingerprint: '8bcac7908eb95041',
    reason: FIXTURE_REASON,
  },
  {
    path: 'test/cli/scan-secrets.test.ts',
    rule: 'AWS access key id',
    fingerprint: '1a5d44a2dca19669',
    reason: FIXTURE_REASON,
  },
  {
    path: 'test/cli/scan-secrets.test.ts',
    rule: 'GitHub token',
    fingerprint: '6ec359a75c2ee8ad',
    reason: FIXTURE_REASON,
  },
  {
    path: 'test/cli/scan-secrets.test.ts',
    rule: 'Resend API key',
    fingerprint: '1a5f96abd839f988',
    reason: FIXTURE_REASON,
  },
  {
    path: 'test/cli/scan-secrets.test.ts',
    rule: 'Resend API key',
    fingerprint: '8c822d27ba59d1b3',
    reason: FIXTURE_REASON,
  },
  {
    path: 'test/cli/scan-secrets.test.ts',
    rule: 'Mallok API token',
    fingerprint: 'fc200f5ca6cb4b58',
    reason: FIXTURE_REASON,
  },
  {
    path: 'test/cli/scan-secrets.test.ts',
    rule: 'Cloudflare-shaped token in an assignment',
    fingerprint: '931345270cf39455',
    reason: FIXTURE_REASON,
  },
  {
    path: 'test/cli/scan-secrets.test.ts',
    rule: 'secret assigned a long literal',
    fingerprint: 'e43dd183706039ad',
    reason: FIXTURE_REASON,
  },
  {
    path: 'test/worker/secret-check.test.ts',
    rule: 'Resend API key',
    // The fingerprint of the exact string that was reviewed. Another match of
    // the same rule in the same file is a new finding and fails the run.
    fingerprint: fingerprint('re_live_supersecret_value'),
    reason:
      'A test fixture, never a live key. The current file no longer has the ' +
      'shape; the match is in an older commit, and history is not being ' +
      'rewritten for a value that was never a credential.',
  },
];

/** Paths whose contents are noise: lockfiles, fixtures, this scanner. */
const IGNORED_PATHS =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|scripts\/scan-secrets\.mjs)$/;

/** Every blob reachable from any ref, with the path it was stored under. */
async function listBlobs() {
  const { stdout } = await run('git', ['rev-list', '--objects', '--all'], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const blobs = [];
  for (const line of stdout.split('\n')) {
    const space = line.indexOf(' ');
    if (space === -1) {
      continue;
    }
    blobs.push({ oid: line.slice(0, space), path: line.slice(space + 1) });
  }
  return blobs;
}

/**
 * Reads several blobs in one `git cat-file` call.
 *
 * Buffers throughout, not strings: `cat-file --batch` frames each object with
 * a *byte* length, and slicing a UTF-8 string by byte counts desynchronises
 * the stream the moment a file contains a non-ASCII character.
 */
function readBlobs(oids) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch', '--buffer']);
    const chunks = [];
    const errors = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      // A scanner whose reader failed has not found nothing; it has found
      // out nothing. Exiting 0 there would be the worst possible answer.
      if (code !== 0) {
        reject(
          new Error(
            `git cat-file exited with ${code}: ${Buffer.concat(errors)
              .toString('utf8')
              .trim()}`,
          ),
        );
        return;
      }
      const out = Buffer.concat(chunks);
      const contents = new Map();
      let offset = 0;
      for (const oid of oids) {
        const newline = out.indexOf(0x0a, offset);
        if (newline === -1) {
          break;
        }
        const header = out
          .subarray(offset, newline)
          .toString('utf8')
          .split(' ');
        const size = Number(header[2] ?? 0);
        const start = newline + 1;
        if (header[1] === 'blob') {
          contents.set(oid, out.subarray(start, start + size));
        }
        offset = start + size + 1;
      }
      resolve(contents);
    });
    child.stdin.end(`${oids.join('\n')}\n`);
  });
}

/** Which commits a blob path first appeared in, for the report. */
async function firstCommitFor(path) {
  try {
    const { stdout } = await run('git', [
      'log',
      '--all',
      '--format=%h %ad',
      '--date=short',
      '-1',
      '--',
      path,
    ]);
    return stdout.trim() || 'unknown commit';
  } catch {
    return 'unknown commit';
  }
}

async function main() {
  const blobs = await listBlobs();
  const findings = [];

  const interesting = blobs.filter(
    (blob) => blob.path !== '' && !IGNORED_PATHS.test(blob.path),
  );

  for (const blob of interesting) {
    if (FORBIDDEN_PATHS.test(blob.path)) {
      findings.push({
        path: blob.path,
        rule: 'a file of this name must never be committed',
        line: 0,
      });
    }
  }

  // Read in batches: one `git cat-file` per blob would spawn thousands of
  // processes on a repository of any age.
  const batchSize = 200;
  for (let index = 0; index < interesting.length; index += batchSize) {
    const batch = interesting.slice(index, index + batchSize);
    const contents = await readBlobs(batch.map((blob) => blob.oid));
    for (const blob of batch) {
      const buffer = contents.get(blob.oid);
      // A NUL byte means binary; a compiled asset has nothing to say here.
      if (buffer === undefined || buffer.includes(0)) {
        continue;
      }
      const text = buffer.toString('utf8');
      for (const rule of RULES) {
        // Whole-blob test first: running every rule line by line across every
        // version of every file is far more work for the same answer, and
        // almost every blob matches nothing.
        if (!rule.pattern.test(text)) {
          continue;
        }
        for (const [number, line] of text.split('\n').entries()) {
          // Every line is examined, however long. Skipping long ones — this
          // used to skip anything over 4096 characters — is an invitation to
          // hide a key on a minified line, and minified lines are exactly
          // where a bundled credential ends up.
          const match = rule.pattern.exec(line);
          if (match === null) {
            continue;
          }
          findings.push({
            path: blob.path,
            rule: rule.name,
            line: number + 1,
            fingerprint: fingerprint(match[0]),
          });
        }
      }
    }
  }

  // One row per path, rule **and value**: the same secret in fifty historical
  // versions of one file is one problem, and two different secrets in one file
  // are two.
  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.path} ${finding.rule} ${finding.fingerprint ?? ''}`;
    const existing = unique.get(key);
    if (existing === undefined || finding.line < existing.line) {
      unique.set(key, finding);
    }
  }

  const rows = [...unique.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const accepted = rows.filter((finding) =>
    ACKNOWLEDGED.some(
      (entry) =>
        entry.path === finding.path &&
        entry.rule === finding.rule &&
        entry.fingerprint === finding.fingerprint,
    ),
  );
  const blocking = rows.filter((finding) => !accepted.includes(finding));

  process.stdout.write(
    `Scanned ${interesting.length} objects across all refs.\n`,
  );
  for (const finding of accepted) {
    const entry = ACKNOWLEDGED.find(
      (candidate) =>
        candidate.path === finding.path &&
        candidate.rule === finding.rule &&
        candidate.fingerprint === finding.fingerprint,
    );
    process.stdout.write(
      `\nAcknowledged: ${finding.path} — ${finding.rule}\n    ${entry?.reason ?? ''}\n`,
    );
  }

  if (blocking.length === 0) {
    process.stdout.write('\nNo unreviewed credentials found.\n');
    return 0;
  }

  process.stdout.write(`\n${blocking.length} finding(s):\n\n`);
  for (const finding of blocking) {
    const where = await firstCommitFor(finding.path);
    process.stdout.write(
      `  ${finding.path}${finding.line > 0 ? `:${finding.line}` : ''}\n` +
        `    rule: ${finding.rule}\n` +
        `    fingerprint: ${finding.fingerprint ?? '(path rule)'}\n` +
        `    last touched: ${where}\n`,
    );
  }
  process.stdout.write(
    '\nNo values are printed. Open the file at that line to see what matched.\n' +
      'A real credential in history means rotating it first and rewriting\n' +
      'history second — a public repository is assumed to have been cloned.\n',
  );
  return 1;
}

/**
 * Runs the scan, and fails loudly when it could not run.
 *
 * Any error from `git` — a missing repository, a broken object, a killed
 * subprocess — exits non-zero. "The scan crashed" and "the scan found
 * nothing" must never look the same to whoever reads the gate.
 */
try {
  process.exitCode = await main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`The secret scan could not complete: ${detail}\n`);
  process.stderr.write(
    `This is a failure, not a clean result: nothing was ruled out.\n`,
  );
  process.exitCode = 1;
}
