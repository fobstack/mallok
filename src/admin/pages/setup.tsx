/**
 * The first-run wizard (docs/ADMIN.md §5).
 *
 * Two of its steps exist to tell the truth rather than to collect input: the
 * domain step says plainly that a `.workers.dev` address is a preview with no
 * edge cache, and the wizard reports when it has shortened the cache lifetime
 * because no purge token is configured. Both are honest degradations, and the
 * wording keeps them distinct from failures.
 */

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api, setCsrf } from '../api.js';

interface SetupStatus {
  readonly completed: boolean;
  readonly hasAdmin: boolean;
  readonly theme: { id: string; name: string; version: string };
  readonly starters: readonly {
    id: string;
    name: string;
    description: string;
    theme: string;
    documents: number;
    matchesActiveTheme: boolean;
  }[];
  readonly purgeConfigured: boolean;
  readonly customDomain: string | null;
}

type Step = 'admin' | 'site' | 'starter' | 'domain' | 'done';

const STEP_LABELS: Readonly<Record<Step, string>> = {
  admin: 'Administrator',
  site: 'Site and languages',
  starter: 'Starting content',
  domain: 'Domain',
  done: 'Finish',
};

export function SetupPage(): JSX.Element {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<Step>('admin');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [locale, setLocale] = useState('en');
  const [extraLocales, setExtraLocales] = useState('');
  const [starter, setStarter] = useState('');
  const [ttlLowered, setTtlLowered] = useState(false);
  const [installed, setInstalled] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await api<SetupStatus>('/setup');
        setStatus(loaded);
        setStarter(loaded.starters[0]?.id ?? '');
        if (loaded.hasAdmin) {
          setStep('site');
        }
      } catch (caught) {
        // A 404 means setup already ran; the wizard closes for good.
        if (caught instanceof ApiError && caught.status === 404) {
          setGone(true);
          return;
        }
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Could not start setup.',
        );
      }
    })();
  }, []);

  const run = async (
    path: string,
    body: unknown,
    next: Step,
  ): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const result = await api<Record<string, unknown>>(`/setup/${path}`, {
        method: 'POST',
        body,
      });
      if (path === 'admin') {
        // Sign in immediately: every later step needs that account.
        const session = await api<{ csrf: string }>('/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        setCsrf(session.csrf);
      }
      if (path === 'site') {
        setTtlLowered(result.cacheTtlLowered === true);
      }
      if (path === 'starter') {
        setInstalled(Number(result.created ?? 0));
      }
      setStep(next);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That did not work.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (gone) {
    return (
      <div class="login">
        <div class="card">
          <h1>Setup is finished</h1>
          <p>
            This site has already been set up. Everything the wizard did can be
            changed in <a href="/_mallok/app/settings">Settings</a>.
          </p>
        </div>
      </div>
    );
  }

  if (status === null) {
    return <div class="booting">{error === '' ? 'Loading…' : error}</div>;
  }

  const steps: Step[] = ['admin', 'site', 'starter', 'domain', 'done'];

  return (
    <div class="setup">
      <header class="setup-head">
        <h1>Set up your site</h1>
        <ol class="steps">
          {steps.map((entry, index) => (
            <li
              key={entry}
              class={
                entry === step
                  ? 'current'
                  : steps.indexOf(step) > index
                    ? 'done'
                    : ''
              }
            >
              {STEP_LABELS[entry]}
            </li>
          ))}
        </ol>
      </header>

      {error === '' ? null : (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      {step === 'admin' ? (
        <form
          class="card"
          onSubmit={(event) => {
            event.preventDefault();
            void run('admin', { email, password }, 'site');
          }}
        >
          <h2>Create the administrator</h2>
          <div class="field">
            <label for="setup-email">Email</label>
            <div class="control">
              <input
                id="setup-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
            </div>
          </div>
          <div class="field">
            <label for="setup-password">Password</label>
            <div class="control">
              <input
                id="setup-password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                value={password}
                onInput={(event) => setPassword(event.currentTarget.value)}
              />
            </div>
            <p class="help">
              At least 12 characters. This is the only account.
            </p>
          </div>
          <button type="submit" class="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Continue'}
          </button>
        </form>
      ) : null}

      {step === 'site' ? (
        <form
          class="card"
          onSubmit={(event) => {
            event.preventDefault();
            const extra = extraLocales
              .split(',')
              .map((entry) => entry.trim())
              .filter((entry) => entry !== '');
            void run(
              'site',
              {
                name,
                defaultLocale: locale,
                locales: [locale, ...extra.filter((e) => e !== locale)],
              },
              'starter',
            );
          }}
        >
          <h2>Name your site</h2>
          <div class="field">
            <label for="setup-name">Site name</label>
            <div class="control">
              <input
                id="setup-name"
                required
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </div>
          </div>
          <div class="field">
            <label for="setup-locale">Main language</label>
            <div class="control">
              <input
                id="setup-locale"
                required
                value={locale}
                onInput={(event) => setLocale(event.currentTarget.value)}
              />
            </div>
            <p class="help">
              A language code such as <code>en</code> or <code>zh</code>. It has
              no URL prefix; every other language does.
            </p>
          </div>
          <div class="field">
            <label for="setup-extra">Other languages</label>
            <div class="control">
              <input
                id="setup-extra"
                placeholder="zh, de"
                value={extraLocales}
                onInput={(event) => setExtraLocales(event.currentTarget.value)}
              />
            </div>
            <p class="help">Comma separated. You can add more later.</p>
          </div>
          <button type="submit" class="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </form>
      ) : null}

      {step === 'starter' ? (
        <div class="card">
          <h2>Start with example content?</h2>
          <p class="help">
            A starter fills the site with real pages you can edit or delete.
            Skipping gives you an empty site.
          </p>
          {status.starters.map((entry) => (
            <label class="starter-option" key={entry.id}>
              <input
                type="radio"
                name="starter"
                checked={starter === entry.id}
                onChange={() => setStarter(entry.id)}
              />
              <span>
                <strong>{entry.name}</strong>
                <span class="help">{entry.description}</span>
                <span class="help">
                  {entry.documents} pages
                  {entry.matchesActiveTheme
                    ? ''
                    : ` · written for the "${entry.theme}" theme, but this build runs "${status.theme.id}", so some pages will use the plain page layout`}
                </span>
              </span>
            </label>
          ))}
          <div class="actions">
            <button
              type="button"
              class="primary"
              disabled={busy || starter === ''}
              onClick={() => void run('starter', { starter }, 'domain')}
            >
              {busy ? 'Installing…' : 'Install'}
            </button>
            <button
              type="button"
              class="ghost"
              disabled={busy}
              onClick={() => setStep('domain')}
            >
              Skip
            </button>
          </div>
        </div>
      ) : null}

      {step === 'domain' ? (
        <div class="card">
          <h2>Your domain</h2>
          {status.customDomain === null ? (
            <>
              <p>
                This site has no custom domain yet, so it is running on a{' '}
                <code>.workers.dev</code> address. That address is a preview:{' '}
                <strong>Cloudflare's edge cache does not apply to it</strong>,
                so pages are rendered on every request and will feel slower than
                the real site.
              </p>
              <p class="help">
                Add a custom domain in the Cloudflare dashboard under Workers
                &amp; Pages → your Worker → Settings → Domains &amp; Routes,
                then enter it under Settings → Site. Nothing else changes: your
                content, its ids and every URL stay as they are.
              </p>
            </>
          ) : (
            <p>
              Serving <code>{status.customDomain}</code>. The edge cache is
              active.
            </p>
          )}
          {ttlLowered ? (
            <p class="help">
              No cache-purge token is configured, so the cache lifetime was set
              to 60 seconds — edits appear within a minute instead of
              immediately. Add <code>CF_API_TOKEN</code> and{' '}
              <code>CF_ZONE_ID</code> as Worker secrets for instant publishing.
              This is a working configuration, not a broken one.
            </p>
          ) : null}
          <div class="actions">
            <button
              type="button"
              class="primary"
              disabled={busy}
              onClick={() => void run('complete', {}, 'done')}
            >
              Finish setup
            </button>
          </div>
        </div>
      ) : null}

      {step === 'done' ? (
        <div class="card">
          <h2>Your site is ready</h2>
          <p>
            {installed > 0
              ? `${installed} pages were installed. `
              : 'The site is empty and waiting for its first page. '}
            Everything the wizard set can be changed later in Settings.
          </p>
          <div class="actions">
            <a class="button-link" href="/_mallok/app/">
              Open the admin
            </a>
            <a class="button-link ghost-link" href="/">
              View the site
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
