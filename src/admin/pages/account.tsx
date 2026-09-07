/**
 * The user menu's page: password and API tokens (docs/ADMIN.md §12).
 *
 * A minted token is shown once and never again, and the password-cost note
 * is stated plainly rather than hidden (docs/SECURITY.md §3.1).
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
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

  const reload = useCallback(async (): Promise<void> => {
    try {
      const result = await api<{ tokens: TokenRow[] }>('/tokens');
      setTokens(result.tokens);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not load tokens.';
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (event: { preventDefault(): void }): Promise<void> => {
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
    <div className="page">
      <header className="page-head">
        <h1>Account</h1>
      </header>

      <PasswordSection />

      {weakPassword && activeSession !== null ? (
        <section className="card note">
          <h2>About password hashing</h2>
          <p>
            Passwords are hashed with PBKDF2-SHA256 at{' '}
            {activeSession.passwordIterations.toLocaleString()} iterations.
            Current guidance is{' '}
            {activeSession.passwordRecommendedIterations.toLocaleString()}, but
            a sign-in has to finish inside the Cloudflare Free plan's 10 ms CPU
            budget, so the cost is capped.
          </p>
          <p className="help">
            Use a long, unique password. For stronger protection, put Cloudflare
            Access in front of <code>/_mallok/</code>.
          </p>
        </section>
      ) : null}

      <section className="card">
        <h2>API tokens</h2>
        <p className="help">
          The CLI and any script use these. A token is shown once — copy it now,
          it cannot be retrieved later.
        </p>
        {minted === '' ? null : (
          <div className="token-reveal" role="alert">
            <code>{minted}</code>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(minted);
              }}
            >
              Copy
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setMinted('')}
            >
              Done
            </button>
          </div>
        )}
        <ul className="rows">
          {tokens.map((token) => (
            <li key={token.id}>
              <span>{token.name}</span>
              <span className="code">{token.scopes.join(' ')}</span>
              <span className="help">
                {token.lastUsedAt === null
                  ? 'Never used'
                  : `Last used ${token.lastUsedAt.slice(0, 10)}`}
              </span>
              <button
                type="button"
                className="ghost"
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
        <form className="inline-form" onSubmit={(event) => void create(event)}>
          <div className="field">
            <label htmlFor="token-name">New token name</label>
            <div className="control">
              <input
                id="token-name"
                required
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </div>
          </div>
          <fieldset className="scopes">
            <legend>Scopes</legend>
            {SCOPES.map((scope) => (
              <label key={scope} className="check">
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
                <span className="code">{scope}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="primary" disabled={busy}>
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

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
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
    <form className="card" onSubmit={(event) => void submit(event)}>
      <h2>Password</h2>
      <div className="field">
        <label htmlFor="pw-current">Current password</label>
        <div className="control">
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
      <div className="field">
        <label htmlFor="pw-next">New password</label>
        <div className="control">
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
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
        {done ? <span className="pill ok">Changed</span> : null}
      </div>
    </form>
  );
}
