/**
 * Advanced settings and diagnostics (docs/ADMIN.md §11).
 *
 * This is the one page allowed to name the platform. It also carries the
 * deploy/no-deploy table, because that line is the product's central promise
 * and has to be stated once, plainly (docs/ARCHITECTURE.md §15).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ApiError, api } from '../api.js';
import {
  Code,
  Facts,
  Page,
  PageHeader,
  Section,
  StatusBadge,
} from '../components/page.js';
import type { ExportProgress } from '../export.js';
import { notify, useReportError } from '../notice.js';
import { healthQuery, keys, saveSettings, useSettings } from '../queries.js';

interface Diagnostics {
  readonly counts: Readonly<Record<string, number>>;
  readonly migrations: readonly string[];
  readonly failedJobs: readonly {
    type: string;
    lastError: string | null;
    updatedAt: string;
  }[];
  readonly pipeline: string;
  readonly quotaUsage: null;
  readonly quotaUsageNote: string;
}

/** Exported for `AC-INV-10` (docs/ACCEPTANCE.md §11): the interface's own
 * words for what is instant and what needs a deploy, asserted directly
 * rather than re-derived from rendered markup. */
export const INSTANT = [
  'Content: create, edit, publish, delete',
  'Site settings, languages, navigation',
  'Theme options this theme declares',
  'Plugin on/off switches, settings and secrets',
];

export const NEEDS_DEPLOY = [
  'Switching to a different theme',
  'Installing, updating or removing a plugin',
  'Upgrading Mallok itself',
  'Changing anything else in the source tree',
];

/**
 * Backup (docs/ADMIN.md §11).
 *
 * The export is assembled in the browser from the Worker's manifest, so a
 * large site does not have to fit through a Worker's memory. The wording says
 * plainly what the archive is for: it is a site you can take elsewhere, which
 * is what "no lock-in" means concretely (docs/PRODUCT_VISION.md §5.8).
 */
function BackupSection(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<string>('');

  const run = async (): Promise<void> => {
    setBusy(true);
    setResult('');
    try {
      const { buildExportZip, downloadBlob } = await import('../export.js');
      const built = await buildExportZip(setProgress);
      downloadBlob(built.blob, built.fileName);
      setResult(
        `${built.counts.content} items and ${built.counts.media} files in ${built.fileName}.`,
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The export failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Section
      title="Backup and export"
      description="A zip containing every page as Markdown, its images, your settings and your inquiries. It is a complete site you can read anywhere — take it to Astro, Hugo or Obsidian whenever you like. Export before upgrading."
      footer={
        <>
          <Button type="button" disabled={busy} onClick={() => void run()}>
            {busy ? 'Building…' : 'Export everything'}
          </Button>
          {progress === null ? null : (
            <span className="text-sm text-muted-foreground" role="status">
              {progress.done}/{progress.total} files
            </span>
          )}
          {result === '' ? null : <StatusBadge tone="ok">{result}</StatusBadge>}
        </>
      }
    />
  );
}

/** Names what asked for a purge, in the operator's terms. */
function describePurgeSource(source: string): string {
  const named: Readonly<Record<string, string>> = {
    manual: 'Clear cached pages',
    content: 'a content change',
    settings: 'a settings change',
    plugins: 'a plugin switch',
    setup: 'setup',
    scheduled: 'a scheduled publication',
    fragments: 'clearing the fragment cache',
  };
  return source
    .split(',')
    .map((part) =>
      part.startsWith('plugin:')
        ? `the ${part.slice('plugin:'.length)} plugin`
        : (named[part] ?? part),
    )
    .join(' and ');
}

export function AdvancedPage(): JSX.Element {
  const current = useSettings();
  const client = useQueryClient();
  // Fresh on every visit: this page is where an operator comes to check.
  const healthNow = useQuery({ ...healthQuery, refetchOnMount: 'always' });
  const loadedDiagnostics = useQuery({
    queryKey: keys.diagnostics,
    queryFn: () => api<Diagnostics>('/diagnostics'),
  });
  useReportError(
    healthNow.error ?? loadedDiagnostics.error,
    'Could not load diagnostics.',
  );
  const health = healthNow.data ?? null;
  const diagnostics = loadedDiagnostics.data ?? null;
  const [ttl, setTtl] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState('');
  const [cacheResult, setCacheResult] = useState('');

  const effectiveTtl = ttl ?? current.cacheTtl;

  const saveTtl = async (): Promise<void> => {
    setBusy(true);
    try {
      await saveSettings({ cacheTtl: effectiveTtl });
      setTtl(null);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async (what: string, done: string): Promise<void> => {
    setClearing(what);
    setCacheResult('');
    try {
      const result = await api<{ note?: string; cleared?: number }>(
        `/cache/${what}`,
        { method: 'POST' },
      );
      // The server says when it could not purge; repeat that rather than
      // claiming success (docs/ADMIN.md §5).
      setCacheResult(result.note ?? done);
      // A whole-site purge that worked clears a recorded failure; show that.
      await client.invalidateQueries({ queryKey: keys.health });
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : 'That did not work.',
      );
    } finally {
      setClearing('');
    }
  };

  const purgeFailure = health?.lastPurgeFailure ?? null;
  const diagnosticsFacts: [ReactNode, ReactNode][] = [
    [
      'Custom domain',
      health?.customDomain === null || health === null ? (
        <StatusBadge key="v" tone="warn">
          Not bound
        </StatusBadge>
      ) : (
        <Code key="v">{health.customDomain}</Code>
      ),
    ],
    [
      'Edge cache',
      health?.customDomain == null ? (
        <StatusBadge key="v" tone="warn">
          Inactive — a workers.dev URL is a preview, not a site
        </StatusBadge>
      ) : (
        <StatusBadge key="v" tone="ok">
          Active
        </StatusBadge>
      ),
    ],
    [
      'Cache purge token',
      health?.purgeConfigured === true ? (
        <StatusBadge key="v" tone="ok">
          Configured
        </StatusBadge>
      ) : (
        <StatusBadge key="v" tone="warn">
          Not configured — edits go live after the cache expires
        </StatusBadge>
      ),
    ],
    ...(purgeFailure === null
      ? []
      : [
          [
            'Last failed purge',
            <div key="v" className="flex flex-col items-start gap-1">
              <StatusBadge tone="warn">
                {new Date(purgeFailure.at).toLocaleString()} — after{' '}
                {describePurgeSource(purgeFailure.source)}
                {purgeFailure.status === undefined
                  ? ', Cloudflare could not be reached'
                  : `, Cloudflare answered HTTP ${purgeFailure.status}`}
              </StatusBadge>
              <p className="text-muted-foreground">
                Pages it named may still be served from the cache until they
                expire. {purgeFailure.advice} {purgeFailure.detail}
              </p>
            </div>,
          ] as [ReactNode, ReactNode],
        ]),
    [
      'Email (Resend)',
      current.email.resendConfigured !== true ? (
        <StatusBadge key="v" tone="warn">
          No key — no email is sent
        </StatusBadge>
      ) : current.email.fromAddress === '' ? (
        <StatusBadge key="v" tone="warn">
          Key set, no site sender — only plugins with their own send
        </StatusBadge>
      ) : (
        <StatusBadge key="v" tone="ok">
          Configured
        </StatusBadge>
      ),
    ],
    [
      'Media domain',
      health?.mediaBaseUrl == null ? (
        <StatusBadge key="v" tone="warn">
          Served through the Worker
        </StatusBadge>
      ) : (
        <Code key="v">{health.mediaBaseUrl}</Code>
      ),
    ],
    ['Theme', <Code key="v">{health?.theme ?? '—'}</Code>],
    ['Render pipeline', <Code key="v">{health?.pipeline ?? '—'}</Code>],
    ['Applied migrations', diagnostics?.migrations.join(', ') ?? '—'],
  ];

  return (
    <Page>
      <PageHeader
        title="Advanced"
        lede="Everything below is a platform detail. You do not need any of it to run the site."
      />

      <Section title="What is instant, and what needs a deploy">
        <div className="grid gap-6 sm:grid-cols-2">
          {(
            [
              ['Instant', INSTANT],
              ['Needs a rebuild and deploy', NEEDS_DEPLOY],
            ] as const
          ).map(([heading, lines]) => (
            <div key={heading} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{heading}</h3>
              <ul className="ml-4 flex list-disc flex-col gap-1 text-sm text-muted-foreground">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Diagnostics">
        <Facts items={diagnosticsFacts} />
      </Section>

      {diagnostics === null || diagnostics.failedJobs.length === 0 ? null : (
        <Section
          title="Failed background jobs"
          description="Work that was retried and gave up — an email that could not be sent, a plugin's job that kept failing. Nothing here is retried again by itself."
        >
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {diagnostics.failedJobs.map((job) => (
              <li
                key={`${job.type}-${job.updatedAt}`}
                className="grid gap-1 px-3 py-2 sm:grid-cols-[auto_1fr_auto] sm:gap-4"
              >
                <Code>{job.type}</Code>
                <span className="min-w-0 break-words">
                  {job.lastError ?? 'No error was recorded.'}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {job.updatedAt.slice(0, 16).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Storage"
        {...(diagnostics === null || diagnostics.quotaUsageNote === ''
          ? {}
          : { description: diagnostics.quotaUsageNote })}
      >
        {diagnostics === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Facts
            items={Object.entries(diagnostics.counts).map(
              ([key, count]) => [key, count] as const,
            )}
          />
        )}
      </Section>

      <BackupSection />

      <Section title="Cache">
        <Field>
          <FieldLabel htmlFor="cache-ttl">
            Edge cache lifetime (seconds)
          </FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="cache-ttl"
              className="w-40"
              type="number"
              min={60}
              max={31536000}
              value={String(effectiveTtl)}
              onInput={(event) => setTtl(Number(event.currentTarget.value))}
            />
            <Button
              type="button"
              disabled={busy || ttl === null}
              onClick={() => void saveTtl()}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <FieldDescription>
            Saving content purges the pages it affects, so this is a ceiling for
            pages nothing touched — not the delay before an edit appears.
          </FieldDescription>
        </Field>

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Clearing caches</h3>
          <p className="text-sm text-muted-foreground">
            Neither of these loses anything. Cached pages and fragments are both
            derived from your content and are rebuilt on the next request — the
            only cost is that the next visitor waits for a render.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={clearing !== ''}
              onClick={() => void clear('purge', 'Cleared the page cache.')}
            >
              {clearing === 'purge' ? 'Clearing…' : 'Clear cached pages'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={clearing !== ''}
              onClick={() =>
                void clear('fragments', 'Cleared the fragment cache.')
              }
            >
              {clearing === 'fragments' ? 'Clearing…' : 'Rebuild all pages'}
            </Button>
            {cacheResult === '' ? null : (
              <StatusBadge tone="ok">{cacheResult}</StatusBadge>
            )}
          </div>
        </div>
      </Section>
    </Page>
  );
}
