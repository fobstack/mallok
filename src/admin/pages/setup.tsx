/**
 * The first-run wizard (docs/ADMIN.md §5).
 *
 * Two of its steps exist to tell the truth rather than to collect input: the
 * domain step says plainly that a `.workers.dev` address is a preview with no
 * edge cache, and the wizard reports when it has shortened the cache lifetime
 * because no purge token is configured. Both are honest degradations, and the
 * wording keeps them distinct from failures.
 */

import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { Check, CircleAlert, Info } from 'lucide-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ApiError, api, setCsrf } from '../api.js';
import { Code, Section } from '../components/page.js';
import { keys } from '../queries.js';

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
    /** Sample records for the starter's plugins. */
    records?: number;
    matchesActiveTheme: boolean;
  }[];
  readonly purgeConfigured: boolean;
  readonly customDomain: string | null;
  /** Whether this deployment has a one-time setup key to check. */
  readonly requiresSetupKey: boolean;
}

/** One line per item a starter failed to import, pages then records. */
function importFailures(result: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const list = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, unknown> =>
            entry !== null && typeof entry === 'object',
        )
      : [];
  for (const entry of list(result.failed)) {
    lines.push(`${String(entry.slug ?? '')}: ${String(entry.error ?? '')}`);
  }
  for (const entry of list(result.failedRecords)) {
    lines.push(`${String(entry.record ?? '')}: ${String(entry.error ?? '')}`);
  }
  return lines;
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
  const loaded = useQuery({
    queryKey: keys.setup,
    queryFn: () => api<SetupStatus>('/setup'),
    // Read once: the wizard's own steps change what it would say next.
    staleTime: Number.POSITIVE_INFINITY,
  });
  const status = loaded.data ?? null;
  // A 404 means setup already ran; the wizard closes for good.
  const gone = loaded.error instanceof ApiError && loaded.error.status === 404;
  const loadError =
    loaded.error === null || gone
      ? ''
      : loaded.error instanceof ApiError
        ? loaded.error.message
        : 'Could not start setup.';
  const [chosen, setStep] = useState<Step | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [name, setName] = useState('');
  const [locale, setLocale] = useState('en');
  const [extraLocales, setExtraLocales] = useState('');
  const [ttlLowered, setTtlLowered] = useState(false);
  const [installed, setInstalled] = useState(0);
  /** Sample plugin records the starter imported. */
  const [installedRecords, setInstalledRecords] = useState(0);
  /** What the starter could not import, said rather than swallowed. */
  const [notInstalled, setNotInstalled] = useState<readonly string[]>([]);

  // Until a step is taken, the wizard starts where the site is: an
  // administrator already made means the site step is next.
  const step: Step = chosen ?? (status?.hasAdmin === true ? 'site' : 'admin');
  const [starterChoice, setStarter] = useState<string | null>(null);
  const starter = starterChoice ?? status?.starters[0]?.id ?? '';

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
        setInstalledRecords(Number(result.records ?? 0));
        setNotInstalled(importFailures(result));
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
      <div className="flex min-h-svh items-center justify-center bg-muted p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl">Setup is finished</h1>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              This site has already been set up. Everything the wizard did can
              be changed in{' '}
              <a
                className="text-primary underline underline-offset-4"
                href="/_mallok/app/settings"
              >
                Settings
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted p-6 text-sm text-muted-foreground">
        {loadError === '' ? 'Loading…' : loadError}
      </div>
    );
  }

  const steps: Step[] = ['admin', 'site', 'starter', 'domain', 'done'];
  const at = steps.indexOf(step);

  return (
    <div className="flex min-h-svh justify-center bg-muted p-4 sm:p-6">
      <div className="flex w-full max-w-2xl flex-col gap-6 py-6">
        <header className="flex flex-col gap-4">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Set up your site
          </h1>
          <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {steps.map((entry, index) => (
              <li
                key={entry}
                className={cn(
                  'flex items-center gap-2 text-muted-foreground',
                  entry === step && 'font-medium text-foreground',
                )}
                {...(entry === step ? { 'aria-current': 'step' as const } : {})}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs',
                    entry === step &&
                      'border-primary bg-primary text-primary-foreground',
                    at > index && 'border-primary text-primary',
                  )}
                  aria-hidden="true"
                >
                  {at > index ? <Check className="size-3.5" /> : index + 1}
                </span>
                {STEP_LABELS[entry]}
              </li>
            ))}
          </ol>
        </header>

        {error === '' ? null : (
          <Alert
            variant="destructive"
            // Full strength: shadcn's 90% falls under WCAG AA on the light card.
            className="*:data-[slot=alert-description]:text-destructive"
          >
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step === 'admin' ? (
          <Section
            as="form"
            title="Create the administrator"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                'admin',
                status.requiresSetupKey
                  ? { email, password, setupKey }
                  : { email, password },
                'site',
              );
            }}
            footer={
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Continue'}
              </Button>
            }
          >
            <Field>
              <FieldLabel htmlFor="setup-email">Email</FieldLabel>
              <Input
                id="setup-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="setup-password">Password</FieldLabel>
              <Input
                id="setup-password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                value={password}
                onInput={(event) => setPassword(event.currentTarget.value)}
              />
              <FieldDescription>
                At least 12 characters. This is the only account.
              </FieldDescription>
            </Field>
            {status.requiresSetupKey ? (
              <Field>
                <FieldLabel htmlFor="setup-key">Setup key</FieldLabel>
                <Input
                  id="setup-key"
                  type="password"
                  required
                  autoComplete="off"
                  value={setupKey}
                  onInput={(event) => setSetupKey(event.currentTarget.value)}
                />
                <FieldDescription>
                  Printed once by <Code>mallok create</Code>. It proves this
                  site is yours: without it, whoever found the address first
                  could claim it. It stops working the moment setup succeeds.
                </FieldDescription>
              </Field>
            ) : null}
          </Section>
        ) : null}

        {step === 'site' ? (
          <Section
            as="form"
            title="Name your site"
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
            footer={
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Continue'}
              </Button>
            }
          >
            <Field>
              <FieldLabel htmlFor="setup-name">Site name</FieldLabel>
              <Input
                id="setup-name"
                required
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="setup-locale">Main language</FieldLabel>
              <Input
                id="setup-locale"
                className="max-w-32"
                required
                value={locale}
                onInput={(event) => setLocale(event.currentTarget.value)}
              />
              <FieldDescription>
                A language code such as <Code>en</Code> or <Code>zh</Code>. It
                has no URL prefix; every other language does.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="setup-extra">Other languages</FieldLabel>
              <Input
                id="setup-extra"
                placeholder="zh, de"
                value={extraLocales}
                onInput={(event) => setExtraLocales(event.currentTarget.value)}
              />
              <FieldDescription>
                Comma separated. You can add more later.
              </FieldDescription>
            </Field>
          </Section>
        ) : null}

        {step === 'starter' ? (
          <Section
            title="Start with example content?"
            description="A starter fills the site with real pages you can edit or delete. Skipping gives you an empty site."
            footer={
              <>
                <Button
                  type="button"
                  disabled={busy || starter === ''}
                  onClick={() => void run('starter', { starter }, 'domain')}
                >
                  {busy ? 'Installing…' : 'Install'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setStep('domain')}
                >
                  Skip
                </Button>
              </>
            }
          >
            <RadioGroup value={starter} onValueChange={setStarter}>
              {status.starters.map((entry) => (
                <FieldLabel
                  key={entry.id}
                  id={`starter-${entry.id}-label`}
                  htmlFor={`starter-${entry.id}`}
                >
                  <Field orientation="horizontal">
                    {/* Named by the whole option, said in so many words:
                        axe does not take a `<label for>` as a radio
                        button's name. */}
                    <RadioGroupItem
                      id={`starter-${entry.id}`}
                      aria-labelledby={`starter-${entry.id}-label`}
                      value={entry.id}
                    />
                    <FieldContent>
                      <FieldTitle>{entry.name}</FieldTitle>
                      <FieldDescription>{entry.description}</FieldDescription>
                      <FieldDescription>
                        {entry.documents} pages
                        {(entry.records ?? 0) > 0
                          ? ` · ${entry.records} sample records`
                          : ''}
                        {entry.matchesActiveTheme
                          ? ''
                          : ` · written for the "${entry.theme}" theme, but this build runs "${status.theme.id}", so some pages will use the plain page layout`}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          </Section>
        ) : null}

        {step === 'domain' ? (
          <Section
            title="Your domain"
            footer={
              <Button
                type="button"
                disabled={busy}
                onClick={() => void run('complete', {}, 'done')}
              >
                Finish setup
              </Button>
            }
          >
            {status.customDomain === null ? (
              <>
                <p className="text-sm">
                  This site has no custom domain yet, so it is running on a{' '}
                  <Code>.workers.dev</Code> address. That address is a preview:{' '}
                  <strong>Cloudflare's edge cache does not apply to it</strong>,
                  so pages are rendered on every request and will feel slower
                  than the real site.
                </p>
                <p className="text-sm text-muted-foreground">
                  Add a custom domain in the Cloudflare dashboard under Workers
                  &amp; Pages → your Worker → Settings → Domains &amp; Routes,
                  then enter it under Settings → Site. Nothing else changes:
                  your content, its ids and every URL stay as they are.
                </p>
              </>
            ) : (
              <p className="text-sm">
                Serving <Code>{status.customDomain}</Code>. The edge cache is
                active.
              </p>
            )}
            {ttlLowered ? (
              <Alert role="note">
                <Info />
                <AlertDescription>
                  No cache-purge token is configured, so the cache lifetime was
                  set to 60 seconds — edits appear within a minute instead of
                  immediately. Add <Code>CF_API_TOKEN</Code> and{' '}
                  <Code>CF_ZONE_ID</Code> as Worker secrets for instant
                  publishing. This is a working configuration, not a broken one.
                </AlertDescription>
              </Alert>
            ) : null}
          </Section>
        ) : null}

        {step === 'done' ? (
          <Section
            title="Your site is ready"
            footer={
              <>
                <Button asChild>
                  <a href="/_mallok/app/">Open the admin</a>
                </Button>
                <Button variant="outline" asChild>
                  <a href="/">View the site</a>
                </Button>
              </>
            }
          >
            <p className="text-sm">
              {installed > 0
                ? `${installed} pages were installed. `
                : 'The site is empty and waiting for its first page. '}
              {installedRecords > 0
                ? `${installedRecords} sample records were added. `
                : ''}
              Everything the wizard set can be changed later in Settings.
            </p>
            {notInstalled.length === 0 ? null : (
              <Alert
                variant="destructive"
                // Full strength: shadcn's 90% falls under WCAG AA on the light card.
                className="*:data-[slot=alert-description]:text-destructive"
              >
                <CircleAlert />
                <AlertDescription>
                  <p>
                    {notInstalled.length} of the starter's items could not be
                    imported:
                  </p>
                  <ul className="list-disc pl-5">
                    {notInstalled.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
