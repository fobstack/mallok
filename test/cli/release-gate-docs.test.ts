import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gate = readFileSync('docs/RELEASE_GATE.md', 'utf8');
const packageVersion = (
  JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
).version;

interface ShellBlock {
  readonly line: number;
  readonly body: string;
}

interface NodeHeredoc {
  readonly line: number;
  readonly module: boolean;
  readonly source: string;
}

/** Executable fenced blocks, including fences nested under a list item. */
function shellBlocks(markdown: string): ShellBlock[] {
  const lines = markdown.split('\n');
  const blocks: ShellBlock[] = [];
  let start = -1;
  let fence = -1;
  let body: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (start === -1 && /^\s*```(?:sh|bash)\s*$/.test(line)) {
      fence = index + 1;
      start = index + 2;
      body = [];
      continue;
    }
    if (start !== -1 && /^\s*```\s*$/.test(line)) {
      blocks.push({ line: start, body: body.join('\n') });
      start = -1;
      fence = -1;
      body = [];
      continue;
    }
    if (start !== -1) {
      body.push(line);
    }
  }
  if (start !== -1) {
    throw new Error(`Unclosed executable shell fence at line ${fence}.`);
  }
  return blocks;
}

function section(markdown: string, start: string, end: string): string {
  const from = markdown.indexOf(start);
  const to = markdown.indexOf(end, from + start.length);
  if (from === -1 || to === -1 || to <= from) {
    throw new Error(`Could not find release-gate section ${start}.`);
  }
  return markdown.slice(from, to);
}

function shellSource(markdown: string): string {
  return shellBlocks(markdown)
    .map(({ body }) => body)
    .join('\n\n');
}

/** JavaScript programs embedded in the executable blocks as `node -` input. */
function nodeHeredocs(markdown: string): NodeHeredoc[] {
  const programs: NodeHeredoc[] = [];
  for (const block of shellBlocks(markdown)) {
    const lines = block.body.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const command = lines[index] ?? '';
      if (!/<<'NODE'\s*$/.test(command)) {
        continue;
      }
      const invocation = lines
        .slice(Math.max(0, index - 5), index + 1)
        .join(' ');
      if (!/\bnode\b/.test(invocation)) {
        throw new Error(
          `NODE heredoc at line ${block.line + index} is not a Node command.`,
        );
      }
      const end = lines.indexOf('NODE', index + 1);
      if (end === -1) {
        throw new Error(`Unclosed Node heredoc at line ${block.line + index}.`);
      }
      programs.push({
        line: block.line + index + 1,
        module: invocation.includes('--input-type=module'),
        source: lines.slice(index + 1, end).join('\n'),
      });
      index = end;
    }
  }
  return programs;
}

describe('the external release runbook', () => {
  it('names the current package candidate without rewriting rc.4 history', () => {
    expect(gate).toContain(`updated for the ${packageVersion} candidate`);
    expect(gate).toContain('mallok-0.1.0-rc.4.tgz');
    expect(gate).toContain(
      '### 4.1 What the 2026-09-12 run produced — `STALE`',
    );
  });

  it('rejects unclosed executable shell fences', () => {
    expect(() => shellBlocks('```bash\nset -euo pipefail')).toThrow(
      /Unclosed executable shell fence at line 1/,
    );
    expect(() => shellBlocks(gate)).not.toThrow();
  });

  it('has a non-vacuous set of executable shell blocks', () => {
    expect(shellBlocks(gate).length).toBeGreaterThanOrEqual(10);
  });

  it('makes every executable shell block fail closed on shell errors', () => {
    const missing = shellBlocks(gate)
      .filter(
        ({ body }) =>
          body
            .split('\n')
            .find((line) => line.trim() !== '')
            ?.trim() !== 'set -euo pipefail',
      )
      .map(({ line }) => line);

    expect(
      missing,
      `shell fences without strict mode at lines ${missing}`,
    ).toEqual([]);
  });

  it('keeps every executable shell block valid Bash', () => {
    const invalid = shellBlocks(gate).flatMap(({ line, body }) => {
      const checked = spawnSync('bash', ['-n'], {
        input: body,
        encoding: 'utf8',
      });
      if (checked.status === 0) {
        return [];
      }
      const detail = checked.error?.message ?? checked.stderr.trim();
      return [`line ${line}: ${detail}`];
    });

    expect(invalid, invalid.join('\n')).toEqual([]);
  });

  it('keeps every embedded Node program syntactically valid', () => {
    const programs = nodeHeredocs(gate);
    expect(programs.length).toBeGreaterThan(5);
    const invalid = programs.flatMap(({ line, module, source }) => {
      const checked = spawnSync(
        process.execPath,
        [...(module ? ['--input-type=module'] : []), '--check'],
        { input: source, encoding: 'utf8' },
      );
      return checked.status === 0
        ? []
        : [`line ${line}: ${checked.error?.message ?? checked.stderr.trim()}`];
    });

    expect(invalid, invalid.join('\n')).toEqual([]);
  });

  it('uses shell variables rather than angle-bracket placeholders', () => {
    const placeholders = shellBlocks(gate).flatMap(({ line, body }) =>
      body
        .split('\n')
        .flatMap((source, offset) =>
          [...source.matchAll(/<[^<>\n]+>/g)].map(
            ([placeholder]) => `line ${line + offset}: ${placeholder}`,
          ),
        ),
    );

    expect(placeholders, placeholders.join('\n')).toEqual([]);
  });

  it('does not put the one-time setup key in JSON or a command result', () => {
    for (const { body } of shellBlocks(gate)) {
      if (body.includes('mallok create')) {
        expect(body).not.toContain('--json');
      }
    }
    expect(gate).toContain('The returned command result and every JSON/file');
    expect(gate).toContain('run `mallok setup-key`');
  });

  it('records one validated provisioning identity before remote create', () => {
    const deployment = section(gate, '## 6. Create', '## 7. Bind');
    const commands = shellSource(deployment);
    const recordedAt = commands.indexOf('.tmp/gate-target.json');
    const remoteCreateAt = commands.indexOf('--domain "$SITE_DOMAIN"');

    expect(commands).toContain(': "${GATE_SLUG:?');
    expect(commands).toContain(': "${SITE_DOMAIN:?');
    expect(commands).toContain('--slug "$GATE_SLUG" --no-deploy');
    expect(commands).toContain("flag: 'wx'");
    expect(recordedAt).toBeGreaterThanOrEqual(0);
    expect(remoteCreateAt).toBeGreaterThan(recordedAt);
    expect(commands).toContain('ledger_slug" = "$GATE_SLUG');
    expect(commands).toContain('ledger_domain" = "$SITE_DOMAIN');
    expect(commands).not.toContain('--slug gate-20260911');
    expect(commands).not.toContain('gate.example.com');
  });

  it('tests and publishes one independently recorded candidate file', () => {
    expect(gate).toContain('dist/release/mallok-$version.tgz');
    expect(gate).toContain('MALLOK_CANDIDATE_TARBALL="$candidate"');
    expect(gate).toContain('node scripts/verify-candidate.mjs "$candidate"');
    expect(gate).toContain('MALLOK_EXPECTED_SHA256');
    expect(gate).toContain('actual[key] !== value');
    expect(gate).toContain('release record has');
    expect(gate).toContain('npm publish "$candidate"');
    for (const { body } of shellBlocks(gate)) {
      expect(body).not.toMatch(
        /\bnpm\s+publish\s+(?:\.\/?|dist\/pkg(?:\/|\s|$))/,
      );
    }
  });

  it('accepts only the locked R2 key-absence contract', () => {
    expect(gate).toContain(
      "errors[0] !== '[ERROR] The specified key does not exist.'",
    );
    expect(gate).not.toMatch(/grep[^\n]+not found[^\n]+does not exist/i);
    expect(gate).not.toMatch(/grep[^\n]+NoSuchKey/i);
  });

  it('validates DNS hostnames portably and records the exact article path', () => {
    const media = section(gate, '## 8. Wizard', '## 9. Cache');
    const mediaCommands = shellSource(media);
    expect(media).not.toContain('gate.example.com');
    expect(mediaCommands).toContain('$' + '{#MEDIA_DOMAIN}');
    expect(mediaCommands).toContain(
      '(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$',
    );
    expect(mediaCommands).not.toContain('(?:');

    const content = section(gate, '## 9. Cache', '## 10. Cache');
    const contentCommands = shellSource(content);
    expect(contentCommands).toContain(
      'SELECT id, path, status FROM content WHERE id =',
    );
    expect(contentCommands).toContain('.tmp/article-target.json');
    expect(contentCommands).toContain("row.status !== 'published'");
    expect(contentCommands).toContain(
      'PAGE="https://$SITE_DOMAIN$ARTICLE_PATH"',
    );
    expect(contentCommands).not.toContain('ARTICLE_SLUG');
    expect(shellSource(gate)).not.toContain('/news/$ARTICLE_SLUG');
  });

  it('proves a root-page HIT before purging and checks exact HEAD semantics', () => {
    const cache = section(
      gate,
      '## 10. Cache safety on the real edge',
      '## 11. CPU and D1 on the real edge',
    );
    const commands = shellSource(cache);
    const warmAt = commands.indexOf(
      "until assert_response_headers HIT 'public, max-age=0, s-maxage=3600'",
    );
    const purgeAt = commands.indexOf('purge_response=$(curl');
    const missAt = commands.indexOf(
      "until assert_response_headers MISS 'public, max-age=0, s-maxage=3600'",
    );

    expect(warmAt).toBeGreaterThanOrEqual(0);
    expect(purgeAt).toBeGreaterThan(warmAt);
    expect(missAt).toBeGreaterThan(purgeAt);
    expect(commands).toContain("grep -Eq '^[A-Za-z0-9:_-]+$'");
    expect(commands).toContain("redirect: 'manual'");
    expect(commands).toContain('response.status !== 200');
    expect(commands).not.toContain('!response.ok');
  });

  it('keeps cache-cold CPU and cache-warm edge responses separate', () => {
    const cpu = section(
      gate,
      '## 11. CPU and D1 on the real edge',
      '## 12. Cron:',
    );
    const commands = shellSource(cpu);

    expect(cpu).toContain('| cache-cold | 30 confirmed `MISS`');
    expect(cpu).toContain('| cache-warm | 30 confirmed `HIT`');
    expect(cpu).toContain('$workers.cpuTimeMs');
    expect(cpu).toContain('$metadata.url');
    expect(cpu).toMatch(/both\s+paths invoke the Worker/);
    expect(cpu).not.toContain('invocation count must be 0');
    expect(cpu).not.toContain('wrangler tail --format=json > tail.json');

    // A HEAD cache miss executes locals, D1 and render, so it cannot precede
    // the GET whose first-execution CPU this population is intended to record.
    expect(commands).not.toMatch(
      /\bcurl\b[^\n]*(?:\s-I(?:\s|$)|--head\b|-X\s+HEAD\b)/,
    );
    expect(cpu).toMatch(/\$metadata\.type\s*=\s*cf-worker-event/);
    expect(cpu).toMatch(/\$workers\.cpuTimeMs[^.\n]{0,50}(?:Exists|to exist)/i);
    expect(cpu).toMatch(/\$workers\.outcome[^.\n]{0,50}ok/i);
    expect(cpu).toMatch(/max\s*(?:≤|<=)\s*10\s*ms/i);
    expect(cpu).not.toMatch(/max\s*(?:≤|<=)\s*50\s*ms/i);
  });

  it('binds scheduled publishing to one machine-recorded state transition', () => {
    const cron = section(gate, '## 12. Cron:', '## 13. Turnstile');
    const commands = shellSource(cron);
    const scheduledAt = commands.indexOf("rows[0].status !== 'scheduled'");
    const recordAt = commands.indexOf('writeFileSync(output');
    const publishedAt = commands.indexOf("row.status !== 'published'");

    expect(scheduledAt).toBeGreaterThanOrEqual(0);
    expect(recordAt).toBeGreaterThan(scheduledAt);
    expect(publishedAt).toBeGreaterThan(recordAt);
    expect(commands).toContain('publishedAt: rows[0].published_at');
    expect(commands).toContain('beforeUpdatedAt: rows[0].updated_at');
    expect(commands).toContain('row.published_at !== target.publishedAt');
    expect(commands).toContain('row.updated_at === target.beforeUpdatedAt');
    expect(commands).toContain(
      'Date.parse(row.updated_at) < Date.parse(target.publishedAt)',
    );
  });

  it('proves a new migration moves from zero to one on a bypass render', () => {
    const upgrade = section(
      gate,
      '## 16. Rolling upgrade',
      '## 17. Delete everything',
    );
    const commands = shellSource(upgrade);
    const absentAt = commands.indexOf('assert_migration_count 0');
    const upgradeAt = commands.indexOf('mallok upgrade --to');
    const deployAt = commands.indexOf('wrangler deploy');
    const bypassAt = commands.indexOf('Authorization: Bearer x');
    const appliedAt = commands.indexOf('assert_migration_count 1');

    expect(absentAt).toBeGreaterThanOrEqual(0);
    expect(upgradeAt).toBeGreaterThan(absentAt);
    expect(deployAt).toBeGreaterThan(upgradeAt);
    expect(bypassAt).toBeGreaterThan(deployAt);
    expect(appliedAt).toBeGreaterThan(bypassAt);
    expect(commands).toContain('[ "$cache_status" = BYPASS ]');
    expect(commands).toContain('[ "$cache_control" = \'private, no-store\' ]');
    expect(commands).toContain('PAGE="https://$SITE_DOMAIN$ARTICLE_PATH"');
    expect(commands).not.toContain('ARTICLE_SLUG');
  });

  it('derives media and destroy targets from asserted machine records', () => {
    const media = section(gate, '## 12. Cron:', '## 13. Turnstile');
    const mediaCommands = shellSource(media);
    expect(mediaCommands).toContain('--json');
    expect(mediaCommands).toContain('.tmp/media-reclaim-target.json');
    expect(mediaCommands).toMatch(/writeFileSync\(output,[\s\S]+?flag:\s*'wx'/);
    expect(mediaCommands).toMatch(/rows\.length\s*!==\s*1/);
    expect(mediaCommands).toMatch(/Number\(rows\[0\]\.n\)\s*!==\s*0/);
    expect(mediaCommands).toMatch(
      /MEDIA_SHA=\$\(node -p [^\n]+media-reclaim-target\.json[^\n]+\.sha/,
    );
    expect(mediaCommands).toContain(
      'assert_r2_object_absent "$BUCKET/media/$SHA.$EXT"',
    );

    const destroy = section(
      gate,
      '## 17. Delete everything the gate created',
      '## 18. The five `STALE` rows',
    );
    const destroyCommands = shellSource(destroy);
    const recordedAt = destroyCommands.indexOf('.tmp/destroy-target.json');
    const destroyedAt = destroyCommands.indexOf('mallok destroy');
    expect(destroyCommands).toContain('.mallok/create-state.json');
    expect(destroyCommands).toContain("readFileSync('wrangler.jsonc'");
    expect(destroyCommands).toContain('const expectedNames = {');
    expect(destroyCommands).toContain(
      'ledger.worker.name !== expectedNames.worker',
    );
    expect(destroyCommands).toContain(
      'database?.database_id !== ledger.database.id',
    );
    expect(destroyCommands).toContain(
      'bucket?.bucket_name !== expectedNames.bucket',
    );
    expect(destroyCommands).toContain(
      'config.vars?.MALLOK_DOMAIN !== ledger.domain',
    );
    expect(destroyCommands).toContain('CLOUDFLARE_ACCOUNT_ID=$(');
    expect(destroyCommands).not.toContain('export CLOUDFLARE_ACCOUNT_ID=$(');
    expect(recordedAt).toBeGreaterThanOrEqual(0);
    expect(destroyedAt).toBeGreaterThan(recordedAt);
    expect(destroyCommands).not.toMatch(/\bmallok-gate-\d{8}\b/);
    expect(destroyCommands).not.toContain('gate.example.com');
    expect(destroyCommands).toContain('--name "$WORKER_NAME"');
    expect(destroyCommands).toContain('d1 info "$DATABASE_NAME"');
    expect(destroyCommands).toContain('"$BUCKET_NAME" --json');
    expect(destroyCommands).toContain('assert_dns_absent "$SITE_DOMAIN"');
    expect(destroyCommands).toContain('assert_dns_absent "$MEDIA_DOMAIN"');
    expect(destroyCommands).toContain('for record_type in A AAAA CNAME');
    expect(destroyCommands).toContain('"$host" "$record_type"');
  });

  it('states the inquiry CPU and subrequest ceilings numerically', () => {
    const inquiry = section(gate, '## 13. Turnstile', '## 14. Lighthouse');
    expect(inquiry).toMatch(
      /(?:\$workers\.cpuTimeMs|CPU)[^.\n]{0,80}(?:≤|<=|at most)\s*10(?:\s*ms)?/i,
    );
    expect(inquiry).toMatch(
      /(?:subrequests?|fetch plus binding spans)[\s\S]{0,120}(?:≤|at most)\s*50/i,
    );
  });
});
