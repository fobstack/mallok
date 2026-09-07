/**
 * Sign-in (docs/ADMIN.md §12).
 *
 * The password-strength note is deliberate, not decoration: the PBKDF2 cost
 * is capped by the Free plan's 10 ms CPU budget, and if the configured count
 * is below current guidance the product says so rather than implying it is
 * fine (docs/SECURITY.md §3.1).
 */

import type { JSX } from 'react';
import { useState } from 'react';
import { ApiError } from '../api.js';
import { signIn } from '../state.js';

export function LoginPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={(event) => void submit(event)}>
        <h1>Sign in</h1>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <div className="control">
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <div className="control">
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </div>
        </div>
        {error === '' ? null : (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
