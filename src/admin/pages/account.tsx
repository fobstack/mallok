/**
 * The user menu's page: password and API tokens (docs/ADMIN.md §12).
 *
 * A minted token is shown once and never again, and the password-cost note
 * is stated plainly rather than hidden (docs/SECURITY.md §3.1).
 */

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from '../api.js';
import { notice, session } from '../state.js';

const SCOPES = [
  'content:write',
  'media:write',
  'export',
  'settings:write',
] as const;

interface TokenRow {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export function AccountPage(): JSX.Element {
  const current = session.value;
  const [tokens, setTokens] = useState<readonly TokenRow[]>([]);
  const [minted, setMinted] = useState('');
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>(['content:write']);
  const [busy, setBusy] = useState(false);

  const reload = async (): Promise<void> => {
    try {
      const result = await api<{ tokens: TokenRow[] }>('/tokens');
      setTokens(result.tokens);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not load tokens.';
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ token: string }>('/tokens', {
        method: 'POST',
        body: { name, scopes: chosen },
      });
      setMinted(result.token);
      setName('');
      await reload();
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not create.';
    } finally {
      setBusy(false);
    }
  };

  const activeSession = current === null || current === false ? null : current;
  const weakPassword =
    activeSession !== null &&
    activeSession.passwordIterations <
      activeSession.passwordRecommendedIterations;

  return (
    <div class="page">
      <header class="page-head">
        <h1>Account</h1>
      </header>

      <PasswordSection />

      {weakPassword && activeSession !== null ? (
        <section class="card note">
          <h2>About password hashing</h2>
          <p>
            Passwords are hashed with PBKDF2-SHA256 at{' '}
            {activeSession.passwordIterations.toLocaleString()} iterations.
            Current guidance is{' '}
            {activeSession.passwordRecommendedIterations.toLocaleString()}, but
            a sign-in has to finish inside the Cloudflare Free plan's 10 ms CPU
            budget, so the cost is capped.
          </p>
          <p class="help">
            Use a long, unique password. For stronger protection, put Cloudflare
            Access in front of <code>/_mallok/</code>.
          </p>
        </section>
      ) : null}

      <section class="card">
        <h2>API tokens</h2>
        <p class="help">
          The CLI and any script use these. A token is shown once — copy it now,
          it cannot be retrieved later.
        </p>
        {minted === '' ? null : (
          <div class="token-reveal" role="alert">
            <code>{minted}</code>
            <button
              type="button"
              class="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(minted);
              }}
            >
              Copy
            </button>
            <button type="button" class="ghost" onClick={() => setMinted('')}>
              Done
            </button>
          </div>
        )}
        <ul class="rows">
          {tokens.map((token) => (
            <li key={token.id}>
              <span>{token.name}</span>
              <span class="code">{token.scopes.join(' ')}</span>
              <span class="help">
                {token.lastUsedAt === null
                  ? 'Never used'
                  : `Last used ${token.lastUsedAt.slice(0, 10)}`}
              </span>
              <button
                type="button"
                class="ghost"
                onClick={() => {
                  void (async () => {
                    await api(`/tokens/${token.id}`, { method: 'DELETE' });
                    await reload();
                  })();
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
        <form class="inline-form" onSubmit={(event) => void create(event)}>
          <div class="field">
            <label for="token-name">New token name</label>
            <div class="control">
              <input
                id="token-name"
                required
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </div>
          </div>
          <fieldset class="scopes">
            <legend>Scopes</legend>
            {SCOPES.map((scope) => (
              <label key={scope} class="check">
                <input
                  type="checkbox"
                  checked={chosen.includes(scope)}
                  onChange={(event) =>
                    setChosen(
                      event.currentTarget.checked
                        ? [...chosen, scope]
                        : chosen.filter((entry) => entry !== scope),
                    )
                  }
                />
                <span class="code">{scope}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" class="primary" disabled={busy}>
            Create token
          </button>
        </form>
      </section>
    </div>
  );
}

function PasswordSection(): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setDone(false);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { currentPassword, newPassword: nextPassword },
      });
      setCurrentPassword('');
      setNextPassword('');
      setDone(true);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError
          ? caught.message
          : 'Could not change the password.';
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card" onSubmit={(event) => void submit(event)}>
      <h2>Password</h2>
      <div class="field">
        <label for="pw-current">Current password</label>
        <div class="control">
          <input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onInput={(event) => setCurrentPassword(event.currentTarget.value)}
          />
        </div>
      </div>
      <div class="field">
        <label for="pw-next">New password</label>
        <div class="control">
          <input
            id="pw-next"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={nextPassword}
            onInput={(event) => setNextPassword(event.currentTarget.value)}
          />
        </div>
      </div>
      <div class="actions">
        <button type="submit" class="primary" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
        {done ? <span class="pill ok">Changed</span> : null}
      </div>
    </form>
  );
}
