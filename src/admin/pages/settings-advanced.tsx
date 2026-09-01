/**
 * Advanced settings and diagnostics (docs/ADMIN.md §11).
 *
 * This is the one page allowed to name the platform. It also carries the
 * deploy/no-deploy table, because that line is the product's central promise
 * and has to be stated once, plainly (docs/ARCHITECTURE.md §15).
 */

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from '../api.js';
import type { ExportProgress } from '../export.js';
import { notice, saveSettings, settings } from '../state.js';

interface Health {
  readonly ok: boolean;
  readonly site: string | null;
  readonly theme: string;
  readonly pipeline: string;
  readonly purgeConfigured: boolean;
  readonly customDomain: string | null;
  readonly mediaBaseUrl: string | null;
}

interface Diagnostics {
  readonly counts: Readonly<Record<string, number>>;
  readonly migrations: readonly string[];
  readonly pipeline: string;
  readonly quotaUsage: null;
  readonly quotaUsageNote: string;
}

const INSTANT = [
  'Content: create, edit, publish, delete',
  'Site settings, languages, navigation',
  'Theme options this theme declares',
  'Plugin on/off switches, settings and secrets',
];

const NEEDS_DEPLOY = [
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
      for (const failure of built.failures) {
        notice.value = `The "${failure.plugin}" plugin could not add its data: ${failure.error}`;
      }
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'The export failed.';
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <section class="card">
      <h2>Backup and export</h2>
      <p class="help">
        A zip containing every page as Markdown, its images, your settings and
        your inquiries. It is a complete site you can read anywhere — take it to
        Astro, Hugo or Obsidian whenever you like. Export before upgrading.
      </p>
      <div class="actions">
        <button
          type="button"
          class="primary"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? 'Building…' : 'Export everything'}
        </button>
        {progress === null ? null : (
          <span class="help" role="status">
            {progress.done}/{progress.total} files
          </span>
        )}
        {result === '' ? null : <span class="pill ok">{result}</span>}
      </div>
    </section>
  );
}

export function AdvancedPage(): JSX.Element {
  const [health, setHealth] = useState<Health | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const current = settings.value;
  const [ttl, setTtl] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState('');
  const [cacheResult, setCacheResult] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [loadedHealth, loadedDiagnostics] = await Promise.all([
          api<Health>('/health'),
          api<Diagnostics>('/diagnostics'),
        ]);
        setHealth(loadedHealth);
        setDiagnostics(loadedDiagnostics);
      } catch (caught) {
        notice.value =
          caught instanceof ApiError
            ? caught.message
            : 'Could not load diagnostics.';
      }
    })();
  }, []);

  if (current === null) {
    return <p>Loading…</p>;
  }
  const effectiveTtl = ttl ?? current.cacheTtl;

  const saveTtl = async (): Promise<void> => {
    setBusy(true);
    try {
      await saveSettings({ cacheTtl: effectiveTtl });
      setTtl(null);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
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
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'That did not work.';
    } finally {
      setClearing('');
    }
  };

  return (
    <div class="page">
      <header class="page-head">
        <h1>Advanced</h1>
        <p class="lede">
          Everything below is a platform detail. You do not need any of it to
          run the site.
        </p>
      </header>

      <section class="card">
        <h2>What is instant, and what needs a deploy</h2>
        <div class="two-col">
          <div>
            <h3>Instant</h3>
            <ul class="bullets">
              {INSTANT.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Needs a rebuild and deploy</h3>
            <ul class="bullets">
              {NEEDS_DEPLOY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Diagnostics</h2>
        <dl class="facts">
          <div>
            <dt>Custom domain</dt>
            <dd>
              {health?.customDomain === null || health === null ? (
                <span class="pill warn">Not bound</span>
              ) : (
                <span class="code">{health.customDomain}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Edge cache</dt>
            <dd>
              {health?.customDomain == null ? (
                <span class="pill warn">
                  Inactive — a workers.dev URL is a preview, not a site
                </span>
              ) : (
                <span class="pill ok">Active</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Cache purge token</dt>
            <dd>
              {health?.purgeConfigured === true ? (
                <span class="pill ok">Configured</span>
              ) : (
                <span class="pill warn">
                  Not configured — edits go live after the cache expires
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Media domain</dt>
            <dd>
              {health?.mediaBaseUrl == null ? (
                <span class="pill warn">Served through the Worker</span>
              ) : (
                <span class="code">{health.mediaBaseUrl}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Theme</dt>
            <dd>
              <span class="code">{health?.theme ?? '—'}</span>
            </dd>
          </div>
          <div>
            <dt>Render pipeline</dt>
            <dd>
              <span class="code">{health?.pipeline ?? '—'}</span>
            </dd>
          </div>
          <div>
            <dt>Applied migrations</dt>
            <dd>{diagnostics?.migrations.join(', ') ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section class="card">
        <h2>Storage</h2>
        {diagnostics === null ? (
          <p>Loading…</p>
        ) : (
          <dl class="facts">
            {Object.entries(diagnostics.counts).map(([key, count]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        )}
        <p class="help">{diagnostics?.quotaUsageNote ?? ''}</p>
      </section>

      <BackupSection />

      <section class="card">
        <h2>Cache</h2>
        <div class="field field-inline">
          <label for="cache-ttl">Edge cache lifetime (seconds)</label>
          <div class="control">
            <input
              id="cache-ttl"
              type="number"
              min={60}
              max={31536000}
              value={String(effectiveTtl)}
              onInput={(event) => setTtl(Number(event.currentTarget.value))}
            />
          </div>
        </div>
        <p class="help">
          Saving content purges the pages it affects, so this is a ceiling for
          pages nothing touched — not the delay before an edit appears.
        </p>
        <div class="actions">
          <button
            type="button"
            class="primary"
            disabled={busy || ttl === null}
            onClick={() => void saveTtl()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>

        <h3>Clearing caches</h3>
        <p class="help">
          Neither of these loses anything. Cached pages and fragments are both
          derived from your content and are rebuilt on the next request — the
          only cost is that the next visitor waits for a render.
        </p>
        <div class="actions">
          <button
            type="button"
            class="ghost"
            disabled={clearing !== ''}
            onClick={() => void clear('purge', 'Cleared the page cache.')}
          >
            {clearing === 'purge' ? 'Clearing…' : 'Clear cached pages'}
          </button>
          <button
            type="button"
            class="ghost"
            disabled={clearing !== ''}
            onClick={() =>
              void clear('fragments', 'Cleared the fragment cache.')
            }
          >
            {clearing === 'fragments' ? 'Clearing…' : 'Rebuild all pages'}
          </button>
          {cacheResult === '' ? null : (
            <span class="pill ok">{cacheResult}</span>
          )}
        </div>
      </section>
    </div>
  );
}
