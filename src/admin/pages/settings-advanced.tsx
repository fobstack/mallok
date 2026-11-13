/**
 * Advanced settings and diagnostics (docs/ADMIN.md §11).
 *
 * This is the one page allowed to name the platform. It also carries the
 * deploy/no-deploy table, because that line is the product's central promise
 * and has to be stated once, plainly (docs/ARCHITECTURE.md §15).
 */

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
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
import { formatDateTime, formatNumber } from '../format.js';
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
export const INSTANT: readonly MessageDescriptor[] = [
  msg`Content: create, edit, publish, delete`,
  msg`Site settings, languages, navigation`,
  msg`Theme options this theme declares`,
  msg`Plugin on/off switches, settings and secrets`,
];

export const NEEDS_DEPLOY: readonly MessageDescriptor[] = [
  msg`Switching to a different theme`,
  msg`Installing, updating or removing a plugin`,
  msg`Upgrading Mallok itself`,
  msg`Changing anything else in the source tree`,
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
  const { t } = useLingui();

  const run = async (): Promise<void> => {
    setBusy(true);
    setResult('');
    try {
      const { buildExportZip, downloadBlob } = await import('../export.js');
      const built = await buildExportZip(setProgress);
      downloadBlob(built.blob, built.fileName);
      const items = built.counts.content;
      const files = built.counts.media;
      const fileName = built.fileName;
      setResult(
        t`${plural(items, { one: '# item', other: '# items' })} and ${plural(files, { one: '# file', other: '# files' })} in ${fileName}.`,
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t`The export failed.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Section
      title={t`Backup and export`}
      description={t`A zip containing every page as Markdown, its images, your settings and your inquiries. It is a complete site you can read anywhere — take it to Astro, Hugo or Obsidian whenever you like. Export before upgrading.`}
      footer={
        <>
          <Button type="button" disabled={busy} onClick={() => void run()}>
            {busy ? t`Building…` : t`Export everything`}
          </Button>
          {progress === null ? null : (
            <span className="text-sm text-muted-foreground" role="status">
              <Trans>
                {progress.done}/{progress.total} files
              </Trans>
            </span>
          )}
          {result === '' ? null : <StatusBadge tone="ok">{result}</StatusBadge>}
        </>
      }
    />
  );
}

/** What asked for a purge, in the operator's terms. */
const PURGE_SOURCES: Readonly<Record<string, MessageDescriptor>> = {
  manual: msg`Clear cached pages`,
  content: msg`a content change`,
  settings: msg`a settings change`,
  plugins: msg`a plugin switch`,
  setup: msg`setup`,
  scheduled: msg`a scheduled publication`,
  fragments: msg`clearing the fragment cache`,
};

/** What each storage count is, by the key the Worker reports it under. */
const STORAGE_COUNTS: Readonly<Record<string, MessageDescriptor>> = {
  content: msg`Content items`,
  published: msg`Published`,
  media: msg`Media files`,
  redirects: msg`Redirects`,
  fragments: msg`Rendered fragments`,
  jobsPending: msg`Background jobs waiting`,
};

/** Names what asked for a purge, joined the interface language's way. */
function describePurgeSource(source: string): string {
  const parts = source.split(',').map((part) => {
    if (part.startsWith('plugin:')) {
      const plugin = part.slice('plugin:'.length);
      return i18n._(msg`the ${plugin} plugin`);
    }
    const named = PURGE_SOURCES[part];
    return named === undefined ? part : i18n._(named);
  });
  return new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(
    parts,
  );
}

export function AdvancedPage(): JSX.Element {
  const current = useSettings();
  const client = useQueryClient();
  const { t } = useLingui();
  // Fresh on every visit: this page is where an operator comes to check.
  const healthNow = useQuery({ ...healthQuery, refetchOnMount: 'always' });
  const loadedDiagnostics = useQuery({
    queryKey: keys.diagnostics,
    queryFn: () => api<Diagnostics>('/diagnostics'),
  });
  useReportError(
    healthNow.error ?? loadedDiagnostics.error,
    t`Could not load diagnostics.`,
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
      notify(caught instanceof ApiError ? caught.message : t`Could not save.`);
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
        caught instanceof ApiError ? caught.message : t`That did not work.`,
      );
    } finally {
      setClearing('');
    }
  };

  const purgeFailure = health?.lastPurgeFailure ?? null;
  const failedPurge = (() => {
    if (purgeFailure === null) {
      return '';
    }
    const when = formatDateTime(purgeFailure.at);
    const cause = describePurgeSource(purgeFailure.source);
    const status = purgeFailure.status;
    return status === undefined
      ? t`${when} — after ${cause}, Cloudflare could not be reached`
      : t`${when} — after ${cause}, Cloudflare answered HTTP ${status}`;
  })();
  const diagnosticsFacts: [ReactNode, ReactNode][] = [
    [
      t`Custom domain`,
      health?.customDomain === null || health === null ? (
        <StatusBadge key="v" tone="warn">
          <Trans>Not bound</Trans>
        </StatusBadge>
      ) : (
        <Code key="v">{health.customDomain}</Code>
      ),
    ],
    [
      t`Edge cache`,
      health?.customDomain == null ? (
        <StatusBadge key="v" tone="warn">
          <Trans>Inactive — a workers.dev URL is a preview, not a site</Trans>
        </StatusBadge>
      ) : (
        <StatusBadge key="v" tone="ok">
          <Trans>Active</Trans>
        </StatusBadge>
      ),
    ],
    [
      t`Cache purge token`,
      health?.purgeConfigured === true ? (
        <StatusBadge key="v" tone="ok">
          <Trans>Configured</Trans>
        </StatusBadge>
      ) : (
        <StatusBadge key="v" tone="warn">
          <Trans>Not configured — edits go live after the cache expires</Trans>
        </StatusBadge>
      ),
    ],
    ...(purgeFailure === null
      ? []
      : [
          [
            t`Last failed purge`,
            <div key="v" className="flex flex-col items-start gap-1">
              <StatusBadge tone="warn">{failedPurge}</StatusBadge>
              <p className="text-muted-foreground">
                <Trans>
                  Pages it named may still be served from the cache until they
                  expire.
                </Trans>{' '}
                {purgeFailure.advice} {purgeFailure.detail}
              </p>
            </div>,
          ] as [ReactNode, ReactNode],
        ]),
    [
      t`Email (Resend)`,
      current.email.resendConfigured !== true ? (
        <StatusBadge key="v" tone="warn">
          <Trans>No key — no email is sent</Trans>
        </StatusBadge>
      ) : current.email.fromAddress === '' ? (
        <StatusBadge key="v" tone="warn">
          <Trans>
            Key set, no site sender — only plugins with their own send
          </Trans>
        </StatusBadge>
      ) : (
        <StatusBadge key="v" tone="ok">
          <Trans>Configured</Trans>
        </StatusBadge>
      ),
    ],
    [
      t`Media domain`,
      health?.mediaBaseUrl == null ? (
        <StatusBadge key="v" tone="warn">
          <Trans>Served through the Worker</Trans>
        </StatusBadge>
      ) : (
        <Code key="v">{health.mediaBaseUrl}</Code>
      ),
    ],
    [t`Theme`, <Code key="v">{health?.theme ?? '—'}</Code>],
    [t`Render pipeline`, <Code key="v">{health?.pipeline ?? '—'}</Code>],
    [t`Applied migrations`, diagnostics?.migrations.join(', ') ?? '—'],
  ];

  return (
    <Page>
      <PageHeader
        title={t`Advanced`}
        lede={t`Everything below is a platform detail. You do not need any of it to run the site.`}
      />

      <Section title={t`What is instant, and what needs a deploy`}>
        <div className="grid gap-6 sm:grid-cols-2">
          {(
            [
              [t`Instant`, INSTANT],
              [t`Needs a rebuild and deploy`, NEEDS_DEPLOY],
            ] as const
          ).map(([heading, lines]) => (
            <div key={heading} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{heading}</h3>
              <ul className="ml-4 flex list-disc flex-col gap-1 text-sm text-muted-foreground">
                {lines.map((line) => (
                  <li key={line.id}>{i18n._(line)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t`Diagnostics`}>
        <Facts items={diagnosticsFacts} />
      </Section>

      {diagnostics === null || diagnostics.failedJobs.length === 0 ? null : (
        <Section
          title={t`Failed background jobs`}
          description={t`Work that was retried and gave up — an email that could not be sent, a plugin's job that kept failing. Nothing here is retried again by itself.`}
        >
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {diagnostics.failedJobs.map((job) => (
              <li
                key={`${job.type}-${job.updatedAt}`}
                className="grid gap-1 px-3 py-2 sm:grid-cols-[auto_1fr_auto] sm:gap-4"
              >
                <Code>{job.type}</Code>
                <span className="min-w-0 break-words">
                  {job.lastError ?? t`No error was recorded.`}
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
        title={t`Storage`}
        {...(diagnostics === null || diagnostics.quotaUsageNote === ''
          ? {}
          : { description: diagnostics.quotaUsageNote })}
      >
        {diagnostics === null ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        ) : (
          <Facts
            items={Object.entries(diagnostics.counts).map(([key, count]) => {
              // A count this admin does not know yet keeps the Worker's key.
              const label = STORAGE_COUNTS[key];
              return [
                label === undefined ? key : i18n._(label),
                formatNumber(count),
              ] as const;
            })}
          />
        )}
      </Section>

      <BackupSection />

      <Section title={t`Cache`}>
        <Field>
          <FieldLabel htmlFor="cache-ttl">
            <Trans>Edge cache lifetime (seconds)</Trans>
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
              {busy ? t`Saving…` : t`Save`}
            </Button>
          </div>
          <FieldDescription>
            <Trans>
              Saving content purges the pages it affects, so this is a ceiling
              for pages nothing touched — not the delay before an edit appears.
            </Trans>
          </FieldDescription>
        </Field>

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            <Trans>Clearing caches</Trans>
          </h3>
          <p className="text-sm text-muted-foreground">
            <Trans>
              Neither of these loses anything. Cached pages and fragments are
              both derived from your content and are rebuilt on the next request
              — the only cost is that the next visitor waits for a render.
            </Trans>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={clearing !== ''}
              onClick={() => void clear('purge', t`Cleared the page cache.`)}
            >
              {clearing === 'purge' ? t`Clearing…` : t`Clear cached pages`}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={clearing !== ''}
              onClick={() =>
                void clear('fragments', t`Cleared the fragment cache.`)
              }
            >
              {clearing === 'fragments' ? t`Clearing…` : t`Rebuild all pages`}
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
