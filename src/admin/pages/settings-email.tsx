/**
 * Email: the site's one Resend key and sender address (docs/ADMIN.md §4).
 *
 * Both belong to the site, not to a plugin: every plugin that sends email —
 * inquiry notifications today — goes through them. The key is write-only;
 * this page can replace it, remove it and ask Resend whether it works, but
 * can never show it.
 */

import type { JSX } from 'react';
import { useState } from 'react';
import { ApiError, api } from '../api.js';
import { SecretControl } from '../form/controls.js';
import { notice, settings } from '../state.js';
import type { SiteEmail } from '../types.js';

/** Mirrors the server's check, so a typo is caught before the request. */
const SENDER_PATTERN = /^(?:[^\s@<>]+@[^\s@<>]+|[^<>]*<[^\s@<>]+@[^\s@<>]+>)$/;

export function EmailSettingsPage(): JSX.Element {
  const current = settings.value;
  const [from, setFrom] = useState(current?.email.fromAddress ?? '');
  const [fromError, setFromError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  if (current === null) {
    return <p>Loading…</p>;
  }
  const email = current.email;

  const store = async (body: {
    fromAddress?: string | null;
    resendApiKey?: string | null;
  }): Promise<boolean> => {
    try {
      const stored = await api<SiteEmail>('/settings/email', {
        method: 'PUT',
        body,
      });
      settings.value = { ...current, email: stored };
      return true;
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
      return false;
    }
  };

  const saveSender = async (event: {
    preventDefault(): void;
  }): Promise<void> => {
    event.preventDefault();
    const value = from.trim();
    if (value !== '' && !SENDER_PATTERN.test(value)) {
      setFromError(
        'Use an address such as hello@example.com or Acme <hello@example.com>.',
      );
      return;
    }
    setFromError('');
    setBusy(true);
    setSaved(false);
    setSaved(await store({ fromAddress: value === '' ? null : value }));
    setBusy(false);
  };

  const writeKey = async (value: string | null): Promise<void> => {
    // A verdict describes the key that was checked, not the one stored now.
    setVerdict(null);
    await store({ resendApiKey: value });
  };

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      setVerdict(
        await api<{ ok: boolean; message: string }>('/settings/email/check', {
          method: 'POST',
        }),
      );
    } catch (caught) {
      setVerdict({
        ok: false,
        message:
          caught instanceof ApiError ? caught.message : 'The check failed.',
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Email</h1>
        <p className="lede">
          One Resend key and one sender address for the whole site. Every plugin
          that sends email uses them, and a change applies to the next message —
          no rebuild, no deploy.
        </p>
      </header>

      <form className="card" onSubmit={(event) => void saveSender(event)}>
        <h2>Sender</h2>
        <div className="field">
          <label htmlFor="email-from">From address</label>
          <input
            id="email-from"
            type="text"
            value={from}
            maxLength={320}
            placeholder="Acme <hello@example.com>"
            aria-invalid={fromError !== ''}
            aria-describedby="email-from-help"
            onInput={(event) => {
              setFrom(event.currentTarget.value);
              setSaved(false);
            }}
          />
          <p className="help" id="email-from-help">
            Must be on a domain you have verified in Resend. A plugin may set
            its own sender; this one is used whenever it does not.
          </p>
          {fromError === '' ? null : (
            <p className="error" role="alert">
              {fromError}
            </p>
          )}
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save sender'}
          </button>
          {saved ? <span className="pill ok">Saved</span> : null}
        </div>
      </form>

      <section className="card secrets">
        <h2>Resend API key</h2>
        <p className="help">
          Stored encrypted. It is never shown again, here or anywhere else.
        </p>
        <div className="field field-inline">
          <label htmlFor="email-resend-key">Resend API key</label>
          <div className="control">
            <SecretControl
              id="email-resend-key"
              label="Resend API key"
              configured={email.resendConfigured}
              onSet={(value) => void writeKey(value)}
              onClear={() => void writeKey(null)}
            />
            {email.resendConfigured ? (
              <button
                type="button"
                className="ghost"
                disabled={checking}
                onClick={() => void check()}
              >
                {checking ? 'Checking…' : 'Test'}
              </button>
            ) : null}
            {verdict === null ? null : (
              <span
                className={verdict.ok ? 'pill ok' : 'pill warn'}
                role="status"
              >
                {verdict.message}
              </span>
            )}
          </div>
        </div>
        {email.resendConfigured ? null : (
          <p className="warning-line">
            Without a key no email is sent. A message queued meanwhile is
            retried for about 30 minutes and then marked failed.
          </p>
        )}
      </section>
    </div>
  );
}
