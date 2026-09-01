/**
 * Sign-in (docs/ADMIN.md §12).
 *
 * The password-strength note is deliberate, not decoration: the PBKDF2 cost
 * is capped by the Free plan's 10 ms CPU budget, and if the configured count
 * is below current guidance the product says so rather than implying it is
 * fine (docs/SECURITY.md §3.1).
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ApiError } from '../api.js';
import { signIn } from '../state.js';

export function LoginPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event): Promise<void> => {
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
    <div class="login">
      <form class="card" onSubmit={(event) => void submit(event)}>
        <h1>Sign in</h1>
        <div class="field">
          <label for="login-email">Email</label>
          <div class="control">
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
        <div class="field">
          <label for="login-password">Password</label>
          <div class="control">
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
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
