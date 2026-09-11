/**
 * Authentication endpoints: bootstrapping the first administrator, login,
 * logout, password changes and API token management.
 *
 * Routes here are the only ones the router reaches before a principal exists,
 * so each one states its own access rule explicitly.
 */

import { z } from 'zod';
import {
  claimSite,
  countAdminUsers,
  createApiToken,
  createSession,
  deleteSession,
  deleteSessionsOfUser,
  findAdminUserByEmail,
  findAdminUserById,
  listApiTokens,
  revokeApiToken,
  updateAdminPassword,
} from '../db/auth.js';
import { loadSite } from '../db/queries.js';
import {
  clearedSessionCookie,
  isScope,
  type Principal,
  type Scope,
  SESSION_TTL_MS,
  sessionCookie,
} from './auth.js';
import {
  hashPassword,
  mintApiToken,
  mintCsrfToken,
  mintSessionToken,
  PBKDF2_ITERATIONS,
  PBKDF2_RECOMMENDED_ITERATIONS,
  parsePasswordParams,
  passwordNeedsUpgrade,
  verifyPassword,
} from './credentials.js';
import type { Env } from './env.js';
import { json, problem, readJson } from './http.js';

const MIN_PASSWORD_LENGTH = 12;

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(1024),
  /** The one-time key `mallok create` printed; see {@link checkSetupKey}. */
  setupKey: z.string().min(1).max(512).optional(),
});

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * `===` on strings returns as soon as two bytes differ, which over enough
 * attempts is a way to learn a value one character at a time.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  // Lengths are compared openly: a length is not the secret.
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (const [index, byte] of left.entries()) {
    difference |= byte ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Whether this deployment insists on a setup key.
 *
 * Set by `mallok create` as a plain var, alongside the secret itself. The two
 * are separate on purpose: a var is visible in `wrangler.jsonc` and survives
 * a lost secret, so a site can say "I require a key" even in the window where
 * it has not been given one — which is exactly the window an automated
 * scanner needs, and exactly when falling back to "no key configured, anyone
 * may proceed" would hand the site away.
 */
function requiresSetupKey(env: Env): boolean {
  return (env.MALLOK_REQUIRE_SETUP_KEY ?? '').toLowerCase() === 'true';
}

/**
 * The one-time credential that makes the first-run wizard safe.
 *
 * A freshly deployed site has no administrator, and its address is not a
 * secret: a `.workers.dev` name is guessable, and certificate transparency
 * publishes a custom domain within minutes of the first request. Whoever
 * reached `/_mallok/setup` first became the administrator of somebody else's
 * site — a race with a scanner, on every deployment, until now.
 *
 * `mallok create` generates `MALLOK_SETUP_KEY`, sets it as a Worker secret and
 * prints it once. This checks it, and records that it has been spent so that
 * the same key cannot be replayed even if it is later found in a terminal's
 * scrollback.
 *
 * When the Worker has no such secret — a site deployed by hand, or one created
 * before this existed — the check is skipped and the wizard behaves as it did.
 * Refusing would lock those sites out of their own setup.
 */
async function checkSetupKey(
  env: Env,
  supplied: string | undefined,
): Promise<{ refusal: Response } | { keyUsed: boolean }> {
  const expected = env.MALLOK_SETUP_KEY;
  const required = requiresSetupKey(env);

  if (expected === undefined || expected === '') {
    if (required) {
      // Deployed, and its secrets not set yet. **Fail closed**: there is
      // nothing to compare a key against, so accepting any request here would
      // mean the first caller to guess any string becomes the owner.
      return {
        refusal: problem(
          503,
          'This site is not finished being set up: its setup key has not ' +
            'been deployed yet. Run `mallok create .` again in the project ' +
            'directory to complete it.',
        ),
      };
    }
    // A site deployed by hand, before this existed. It behaves as it did.
    return { keyUsed: false };
  }

  const site = await loadSite(env.DB);
  if (site?.setup_key_used_at != null) {
    return {
      refusal: problem(
        409,
        'The setup key has already been used. Deploy a new key with ' +
          '`wrangler secret put MALLOK_SETUP_KEY` if you need to run setup again.',
      ),
    };
  }
  if (supplied === undefined || !constantTimeEqual(supplied, expected)) {
    return {
      refusal: problem(
        403,
        'That setup key is not correct. It was printed once, by `mallok create`.',
      ),
    };
  }
  return { keyUsed: true };
}

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(1024),
});

const tokenCreateSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string()).min(1),
});

/**
 * Creates the first administrator. Open only while no administrator exists;
 * once one does, this returns 409 forever (docs/SECURITY.md §3.6).
 */
export async function bootstrapAdmin(
  request: Request,
  env: Env,
  now: Date,
): Promise<Response> {
  if ((await countAdminUsers(env.DB)) > 0) {
    return problem(409, 'An administrator already exists.');
  }
  const parsed = credentialsSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(
      400,
      `Provide an email and a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  // Checked after the payload parses and before any work is done, so a bad
  // key costs an attacker the same as a bad password.
  const check = await checkSetupKey(env, parsed.data.setupKey);
  if ('refusal' in check) {
    return check.refusal;
  }

  // Hashing first, and deliberately outside the claim: it is the slow part,
  // and doing it inside would hold the claim open for the length of a
  // PBKDF2 derivation. If this throws, nothing has been consumed.
  const derived = await hashPassword(parsed.data.password);

  // One batch: the claim, the administrator and the spent key. The database
  // decides who wins, and the loser's work is rolled back entirely — no
  // administrator, and a key that is still usable by whoever actually holds
  // it.
  const claimed = await claimSite(
    env.DB,
    {
      id: crypto.randomUUID(),
      email: parsed.data.email.toLowerCase(),
      passwordHash: derived.hash,
      passwordParams: JSON.stringify(derived.params),
      now: now.toISOString(),
    },
    check.keyUsed,
  );
  if (!claimed) {
    return problem(409, 'An administrator already exists.');
  }
  return json({ ok: true }, { status: 201 });
}

/** Exchanges an email and password for a session cookie. */
export async function login(
  request: Request,
  env: Env,
  now: Date,
): Promise<Response> {
  const parsed = credentialsSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(400, 'Invalid email or password.');
  }
  const email = parsed.data.email.toLowerCase();
  const user = await findAdminUserByEmail(env.DB, email);

  if (user === null) {
    // Derive anyway so a missing account cannot be told apart from a wrong
    // password by timing alone.
    await hashPassword(parsed.data.password);
    return problem(401, 'Invalid email or password.');
  }

  const params = parsePasswordParams(user.password_params);
  if (params === null) {
    return problem(401, 'Invalid email or password.');
  }
  const ok = await verifyPassword(
    parsed.data.password,
    user.password_hash,
    params,
  );
  if (!ok) {
    return problem(401, 'Invalid email or password.');
  }

  // Opportunistically re-derive when the stored cost is below the current
  // setting (docs/SECURITY.md §3.1).
  if (passwordNeedsUpgrade(params)) {
    const upgraded = await hashPassword(parsed.data.password);
    await updateAdminPassword(
      env.DB,
      user.id,
      upgraded.hash,
      JSON.stringify(upgraded.params),
    );
  }

  const token = await mintSessionToken();
  const csrf = mintCsrfToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await createSession(env.DB, {
    id: token.id,
    userId: user.id,
    csrf,
    expiresAt: expiresAt.toISOString(),
    now: now.toISOString(),
  });
  return json(
    { email: user.email, csrf, expiresAt: expiresAt.toISOString() },
    { headers: { 'set-cookie': sessionCookie(token.plaintext, expiresAt) } },
  );
}

/** Ends the current session. Idempotent. */
export async function logout(
  env: Env,
  principal: Principal,
): Promise<Response> {
  if (principal.kind === 'session') {
    await deleteSession(env.DB, principal.sessionId);
  }
  return json(
    { ok: true },
    { headers: { 'set-cookie': clearedSessionCookie() } },
  );
}

/** Describes the current credential, including the CSRF token for writes. */
export async function whoami(
  env: Env,
  principal: Principal,
): Promise<Response> {
  if (principal.kind === 'token') {
    return json({
      kind: 'token',
      name: principal.name,
      scopes: principal.scopes,
    });
  }
  const user = await findAdminUserById(env.DB, principal.userId);
  return json({
    kind: 'session',
    email: user?.email ?? null,
    csrf: principal.csrf,
    passwordIterations: PBKDF2_ITERATIONS,
    // Surfaced so the admin UI can tell the truth about password strength
    // rather than implying it meets current guidance.
    passwordRecommendedIterations: PBKDF2_RECOMMENDED_ITERATIONS,
  });
}

/** Changes the administrator's password and invalidates other sessions. */
export async function changePassword(
  request: Request,
  env: Env,
  principal: Principal,
): Promise<Response> {
  if (principal.kind !== 'session') {
    return problem(403, 'Password changes require a browser session.');
  }
  const parsed = passwordChangeSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(
      400,
      `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  const user = await findAdminUserById(env.DB, principal.userId);
  if (user === null) {
    return problem(401, 'Unauthorized.');
  }
  const params = parsePasswordParams(user.password_params);
  if (
    params === null ||
    !(await verifyPassword(
      parsed.data.currentPassword,
      user.password_hash,
      params,
    ))
  ) {
    return problem(403, 'The current password is not correct.');
  }
  const derived = await hashPassword(parsed.data.newPassword);
  await updateAdminPassword(
    env.DB,
    user.id,
    derived.hash,
    JSON.stringify(derived.params),
  );
  // Every existing session, including this one, is dropped.
  await deleteSessionsOfUser(env.DB, user.id);
  return json(
    { ok: true },
    { headers: { 'set-cookie': clearedSessionCookie() } },
  );
}

/** Lists API tokens. Secrets are never included. */
export async function getTokens(env: Env): Promise<Response> {
  const rows = await listApiTokens(env.DB);
  return json({
    tokens: rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: safeScopes(row.scopes),
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    })),
  });
}

/** Creates an API token and returns its plaintext exactly once. */
export async function postToken(
  request: Request,
  env: Env,
  now: Date,
): Promise<Response> {
  const parsed = tokenCreateSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(400, 'Provide a name and at least one scope.');
  }
  const unknown = parsed.data.scopes.filter((scope) => !isScope(scope));
  if (unknown.length > 0) {
    return problem(400, `Unknown scope: ${unknown.join(', ')}.`);
  }
  const scopes = parsed.data.scopes.filter((scope): scope is Scope =>
    isScope(scope),
  );
  const token = await mintApiToken();
  await createApiToken(env.DB, {
    id: token.id,
    name: parsed.data.name,
    scopes,
    now: now.toISOString(),
  });
  return json(
    {
      id: token.id,
      name: parsed.data.name,
      scopes,
      // The only time this value is ever returned.
      token: token.plaintext,
    },
    { status: 201 },
  );
}

/** Revokes an API token. */
export async function revokeToken(
  env: Env,
  id: string,
  now: Date,
): Promise<Response> {
  const revoked = await revokeApiToken(env.DB, id, now.toISOString());
  if (!revoked) {
    return problem(404, 'Not found.');
  }
  return json({ ok: true });
}

function safeScopes(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}
