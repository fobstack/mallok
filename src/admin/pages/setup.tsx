/**
 * The first-run wizard (docs/ADMIN.md §5).
 *
 * Two of its steps exist to tell the truth rather than to collect input: the
 * domain step says plainly that a `.workers.dev` address is a preview with no
 * edge cache, and the wizard reports when it has shortened the cache lifetime
 * because no purge token is configured. Both are honest degradations, and the
 * wording keeps them distinct from failures.
 */

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  ExternalLink,
  Info,
} from 'lucide-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { LOCALE_PATTERN } from '../../core/index.js';
import { ApiError, api, setCsrf } from '../api.js';
import {
  COMMON_LOCALES,
  useContentLanguageName,
} from '../components/content-language.js';
import { LanguagePicker } from '../components/language-picker.js';
import { Code, Section } from '../components/page.js';
import { PasswordInput } from '../components/password-input.js';
import { keys } from '../queries.js';

interface SetupStatus {
  readonly completed: boolean;
  readonly hasAdmin: boolean;
  readonly theme: {
    id: string;
    name: string;
    version: string;
    /** The languages the theme's own wording comes in. */
    locales?: readonly string[];
  };
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

/** The four steps; "done" is the result they lead to, not a fifth step. */
type Step = 'admin' | 'site' | 'starter' | 'domain' | 'done';

const STEPS = ['admin', 'site', 'starter', 'domain'] as const;

const STEP_LABELS: Readonly<Record<(typeof STEPS)[number], MessageDescriptor>> =
  {
    admin: msg`Administrator`,
    site: msg`Site and languages`,
    starter: msg`Starting content`,
    domain: msg`Domain`,
  };

/** The select's value for "a language not listed". */
const ANOTHER = '*';

/** Where Cloudflare explains adding a custom domain to a Worker. */
const CUSTOM_DOMAIN_GUIDE =
  'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/';

export function SetupPage(): JSX.Element {
  const { t } = useLingui();
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
        : t`Could not start setup.`;
  const [chosen, setStep] = useState<Step | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [name, setName] = useState('');
  // The main language starts as the one the wizard is being read in.
  const [mainChoice, setMainChoice] = useState(
    () => i18n.locale.split('-')[0] ?? 'en',
  );
  const [mainCode, setMainCode] = useState('');
  const [others, setOthers] = useState<readonly string[]>([]);
  const [otherCodes, setOtherCodes] = useState('');
  const nameOf = useContentLanguageName();
  /** Made in this visit, or found already made: step 1 cannot run twice. */
  const [madeAdmin, setMadeAdmin] = useState(false);
  /** A starter imports content; going back past it would undo nothing. */
  const [installedStarter, setInstalledStarter] = useState(false);
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
        setMadeAdmin(true);
      }
      if (path === 'site') {
        setTtlLowered(result.cacheTtlLowered === true);
      }
      if (path === 'starter') {
        setInstalled(Number(result.created ?? 0));
        setInstalledRecords(Number(result.records ?? 0));
        setNotInstalled(importFailures(result));
        setInstalledStarter(true);
      }
      setStep(next);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : t`That did not work.`,
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
              <h1 className="text-xl">
                <Trans>Setup is finished</Trans>
              </h1>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              <Trans>
                This site has already been set up. Everything the wizard did can
                be changed in{' '}
                <a
                  className="text-primary underline underline-offset-4"
                  href="/_mallok/app/settings"
                >
                  Settings
                </a>
                .
              </Trans>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted p-6 text-sm text-muted-foreground">
        {loadError === '' ? t`Loading…` : loadError}
      </div>
    );
  }

  const customDomain = status.customDomain;
  // The result screen shows every step as done.
  const at = step === 'done' ? STEPS.length : STEPS.indexOf(step);
  const adminExists = status.hasAdmin || madeAdmin;
  const themeLocales = status.theme.locales ?? [];
  const candidates = [
    ...themeLocales,
    ...COMMON_LOCALES.filter((code) => !themeLocales.includes(code)),
  ];
  const mainLocale = mainChoice === ANOTHER ? mainCode.trim() : mainChoice;
  const themeLanguages = themeLocales.map(nameOf).join(', ');
  const back = (to: Step): JSX.Element => (
    <Button
      type="button"
      variant="ghost"
      disabled={busy}
      onClick={() => {
        setError('');
        setStep(to);
      }}
    >
      <ArrowLeft aria-hidden="true" />
      <Trans>Back</Trans>
    </Button>
  );

  return (
    <div className="flex min-h-svh justify-center bg-muted p-4 sm:p-6">
      <div className="flex w-full max-w-2xl flex-col gap-6 py-6">
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              <Trans>Set up your site</Trans>
            </h1>
            {/* The interface language, not the site's languages (D7). */}
            <LanguagePicker />
          </div>
          <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {STEPS.map((entry, index) => (
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
                {i18n._(STEP_LABELS[entry])}
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

        {step === 'admin' && adminExists ? (
          // Back from step 2: the account exists and cannot be made again.
          <Section
            title={t`Create the administrator`}
            footer={
              <Button type="button" onClick={() => setStep('site')}>
                <Trans>Continue</Trans>
              </Button>
            }
          >
            <p className="text-sm">
              {email === '' ? (
                <Trans>The administrator account is created.</Trans>
              ) : (
                <Trans>
                  The administrator account, <strong>{email}</strong>, is
                  created.
                </Trans>
              )}{' '}
              <Trans>
                Its email and password can be changed later in Account.
              </Trans>
            </p>
          </Section>
        ) : null}

        {step === 'admin' && !adminExists ? (
          <Section
            as="form"
            title={t`Create the administrator`}
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                'admin',
                // The language the wizard is used in becomes the account's
                // (docs/ADMIN_I18N_AND_UI.md, D2).
                status.requiresSetupKey
                  ? { email, password, setupKey, uiLocale: i18n.locale }
                  : { email, password, uiLocale: i18n.locale },
                'site',
              );
            }}
            footer={
              <Button type="submit" disabled={busy}>
                {busy ? t`Creating…` : t`Continue`}
              </Button>
            }
          >
            <Field>
              <FieldLabel htmlFor="setup-email">
                <Trans>Email</Trans>
              </FieldLabel>
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
              <FieldLabel htmlFor="setup-password">
                <Trans>Password</Trans>
              </FieldLabel>
              <PasswordInput
                id="setup-password"
                required
                minLength={12}
                autoComplete="new-password"
                value={password}
                onInput={(event) => setPassword(event.currentTarget.value)}
              />
              <FieldDescription>
                <Trans>At least 12 characters. This is the only account.</Trans>
              </FieldDescription>
            </Field>
            {status.requiresSetupKey ? (
              <Field>
                <FieldLabel htmlFor="setup-key">
                  <Trans>Setup key</Trans>
                </FieldLabel>
                <Input
                  id="setup-key"
                  type="password"
                  required
                  autoComplete="off"
                  value={setupKey}
                  onInput={(event) => setSetupKey(event.currentTarget.value)}
                />
                <FieldDescription>
                  <Trans>
                    Printed once by <Code>mallok create</Code>. It proves this
                    site is yours: without it, whoever found the address first
                    could claim it. It stops working the moment setup succeeds.
                  </Trans>
                </FieldDescription>
              </Field>
            ) : null}
          </Section>
        ) : null}

        {step === 'site' ? (
          <Section
            as="form"
            title={t`Name your site`}
            onSubmit={(event) => {
              event.preventDefault();
              const typed = otherCodes
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== '');
              const wrong = [mainLocale, ...typed].find(
                (code) => !LOCALE_PATTERN.test(code),
              );
              if (wrong !== undefined) {
                setError(
                  t`"${wrong}" is not a language code. Use one such as de or pt-BR.`,
                );
                return;
              }
              const extra = [...others, ...typed].filter(
                (code, index, all) =>
                  code !== mainLocale && all.indexOf(code) === index,
              );
              void run(
                'site',
                {
                  name,
                  defaultLocale: mainLocale,
                  locales: [mainLocale, ...extra],
                },
                'starter',
              );
            }}
            footer={
              <>
                {back('admin')}
                <Button type="submit" disabled={busy}>
                  {busy ? t`Saving…` : t`Continue`}
                </Button>
              </>
            }
          >
            <Field>
              <FieldLabel htmlFor="setup-name">
                <Trans>Site name</Trans>
              </FieldLabel>
              <Input
                id="setup-name"
                required
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="setup-locale">
                <Trans>Main language</Trans>
              </FieldLabel>
              <NativeSelect
                id="setup-locale"
                value={mainChoice}
                onChange={(event) => setMainChoice(event.currentTarget.value)}
              >
                {themeLocales.length === 0 ? null : (
                  <NativeSelectOptGroup label={t`Translated by the theme`}>
                    {themeLocales.map((code) => (
                      <NativeSelectOption key={code} value={code}>
                        {nameOf(code)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                )}
                <NativeSelectOptGroup label={t`Other languages`}>
                  {candidates
                    .filter((code) => !themeLocales.includes(code))
                    .map((code) => (
                      <NativeSelectOption key={code} value={code}>
                        {nameOf(code)}
                      </NativeSelectOption>
                    ))}
                  <NativeSelectOption value={ANOTHER}>
                    {t`Another language…`}
                  </NativeSelectOption>
                </NativeSelectOptGroup>
              </NativeSelect>
              <FieldDescription>
                {themeLanguages === '' ? (
                  <Trans>
                    Its pages have no URL prefix; every other language's do.
                  </Trans>
                ) : (
                  <Trans>
                    Its pages have no URL prefix; every other language's do. The
                    theme's own wording, such as its buttons, comes in{' '}
                    {themeLanguages}.
                  </Trans>
                )}
              </FieldDescription>
            </Field>
            {mainChoice === ANOTHER ? (
              <Field>
                <FieldLabel htmlFor="setup-locale-code">
                  <Trans>Language code</Trans>
                </FieldLabel>
                <Input
                  id="setup-locale-code"
                  className="max-w-32"
                  required
                  placeholder="pt-BR"
                  value={mainCode}
                  onInput={(event) => setMainCode(event.currentTarget.value)}
                />
              </Field>
            ) : null}
            <FieldSet className="max-w-2xl">
              <FieldLegend variant="label">
                <Trans>Other languages</Trans>
              </FieldLegend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {candidates
                  .filter((code) => code !== mainLocale)
                  .map((code) => (
                    <Field key={code} orientation="horizontal">
                      <Checkbox
                        id={`setup-other-${code}`}
                        checked={others.includes(code)}
                        onCheckedChange={(checked) =>
                          setOthers((current) =>
                            checked === true
                              ? [...current, code]
                              : current.filter((entry) => entry !== code),
                          )
                        }
                      />
                      <FieldLabel
                        htmlFor={`setup-other-${code}`}
                        className="font-normal"
                      >
                        {nameOf(code)}
                      </FieldLabel>
                    </Field>
                  ))}
              </div>
              <Field>
                <FieldLabel htmlFor="setup-extra">
                  <Trans>More language codes</Trans>
                </FieldLabel>
                <Input
                  id="setup-extra"
                  className="max-w-64"
                  placeholder="pt-BR, sv"
                  value={otherCodes}
                  onInput={(event) => setOtherCodes(event.currentTarget.value)}
                />
                <FieldDescription>
                  <Trans>
                    For a language not listed, comma separated. Languages can
                    also be added later.
                  </Trans>
                </FieldDescription>
              </Field>
            </FieldSet>
          </Section>
        ) : null}

        {step === 'starter' && installedStarter ? (
          // Back from step 4: what was installed stays installed.
          <Section
            title={t`Start with example content?`}
            footer={
              <Button type="button" onClick={() => setStep('domain')}>
                <Trans>Continue</Trans>
              </Button>
            }
          >
            <p className="text-sm">
              <Trans>
                The starter is installed. Its pages can be edited or deleted
                like any other.
              </Trans>
            </p>
          </Section>
        ) : null}

        {step === 'starter' && !installedStarter ? (
          <Section
            title={t`Start with example content?`}
            description={t`A starter fills the site with real pages you can edit or delete. Skipping gives you an empty site.`}
            footer={
              <>
                {back('site')}
                <Button
                  type="button"
                  disabled={busy || starter === ''}
                  onClick={() => void run('starter', { starter }, 'domain')}
                >
                  {busy ? t`Installing…` : t`Install`}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setStep('domain')}
                >
                  <Trans>Skip</Trans>
                </Button>
              </>
            }
          >
            <RadioGroup value={starter} onValueChange={setStarter}>
              {status.starters.map((entry) => {
                const records = entry.records ?? 0;
                const starterTheme = entry.theme;
                const activeTheme = status.theme.id;
                return (
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
                          <Plural
                            value={entry.documents}
                            one="# page"
                            other="# pages"
                          />
                          {records > 0 ? (
                            <>
                              {' · '}
                              <Plural
                                value={records}
                                one="# sample record"
                                other="# sample records"
                              />
                            </>
                          ) : null}
                          {entry.matchesActiveTheme ? null : (
                            <>
                              {' · '}
                              <Trans>
                                written for the "{starterTheme}" theme, but this
                                build runs "{activeTheme}", so some pages will
                                use the plain page layout
                              </Trans>
                            </>
                          )}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                );
              })}
            </RadioGroup>
          </Section>
        ) : null}

        {step === 'domain' ? (
          <Section
            title={t`Your domain`}
            footer={
              <>
                {back('starter')}
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void run('complete', {}, 'done')}
                >
                  <Trans>Finish setup</Trans>
                </Button>
              </>
            }
          >
            {status.customDomain === null ? (
              <>
                <p className="text-sm">
                  <Trans>
                    This site has no custom domain yet, so it is running on a{' '}
                    <Code>.workers.dev</Code> address. That address is a
                    preview:{' '}
                    <strong>
                      Cloudflare's edge cache does not apply to it
                    </strong>
                    , so pages are rendered on every request and will feel
                    slower than the real site.
                  </Trans>
                </p>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    A domain can be added at any time; your content and its URLs
                    stay as they are.{' '}
                    <a
                      className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
                      href={CUSTOM_DOMAIN_GUIDE}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      How to add a custom domain
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  </Trans>
                </p>
              </>
            ) : (
              <p className="text-sm">
                <Trans>
                  Serving <Code>{customDomain}</Code>. The edge cache is active.
                </Trans>
              </p>
            )}
            {ttlLowered ? (
              <Alert role="note">
                <Info />
                <AlertDescription>
                  <Trans>
                    No cache-purge token is configured, so edits reach visitors
                    within a minute instead of immediately. This is a working
                    configuration, not a broken one; Settings → Advanced says
                    how to make publishing instant.
                  </Trans>
                </AlertDescription>
              </Alert>
            ) : null}
          </Section>
        ) : null}

        {step === 'done' ? (
          <Section
            title={t`Your site is ready`}
            footer={
              <>
                <Button asChild>
                  <a href="/_mallok/app/">
                    <Trans>Open the admin</Trans>
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href="/">
                    <Trans>View the site</Trans>
                  </a>
                </Button>
              </>
            }
          >
            <p className="text-sm">
              {installed > 0 ? (
                <Plural
                  value={installed}
                  one="# page was installed."
                  other="# pages were installed."
                />
              ) : (
                <Trans>The site is empty and waiting for its first page.</Trans>
              )}{' '}
              {installedRecords > 0 ? (
                <>
                  <Plural
                    value={installedRecords}
                    one="# sample record was added."
                    other="# sample records were added."
                  />{' '}
                </>
              ) : null}
              <Trans>
                Everything the wizard set can be changed later in Settings.
              </Trans>
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
                    <Plural
                      value={notInstalled.length}
                      one="# of the starter's items could not be imported:"
                      other="# of the starter's items could not be imported:"
                    />
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
