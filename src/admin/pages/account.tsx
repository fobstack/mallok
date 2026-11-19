/**
 * The user menu's page: password and API tokens (docs/ADMIN.md §12).
 *
 * A minted token is shown once and never again, and the password-cost note
 * is stated plainly rather than hidden (docs/SECURITY.md §3.1).
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { Info } from 'lucide-react';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '../api.js';
import {
  Code,
  Page,
  PageHeader,
  Section,
  StatusBadge,
} from '../components/page.js';
import { invalid, showServerErrors } from '../form/form.js';
import { requiredMessage } from '../form/types.js';
import { formatNumber } from '../format.js';
import { notify } from '../notice.js';
import { useSession } from '../queries.js';

/**
 * The new password's length is checked here too, so the rule is read before
 * the round trip; the server enforces it either way. The message is passed in
 * so it is in the interface language.
 */
function passwordSchema(tooShort: string) {
  return z.object({
    currentPassword: z.string().min(1, { error: requiredMessage }),
    newPassword: z.string().min(12, tooShort),
  });
}

export function AccountPage(): JSX.Element {
  const { t } = useLingui();
  const activeSession = useSession();
  const iterations = formatNumber(activeSession.passwordIterations);
  const recommended = formatNumber(activeSession.passwordRecommendedIterations);
  const weakPassword =
    activeSession.passwordIterations <
    activeSession.passwordRecommendedIterations;

  return (
    <Page>
      <PageHeader title={t`Account`} />

      <PasswordSection />

      {weakPassword ? (
        // Said plainly, as ADMIN.md §12 requires it be said; the numbers
        // behind it are one click away (docs/ADMIN_SIMPLE.md, G18).
        <Alert role="note">
          <Info />
          <AlertTitle role="heading" aria-level={2}>
            <Trans>Use a long password you use nowhere else</Trans>
          </AlertTitle>
          <AlertDescription>
            <p>
              <Trans>
                This site's hosting limits how strongly passwords can be
                protected.
              </Trans>
            </p>
            <details>
              <summary className="cursor-pointer">
                <Trans>Details</Trans>
              </summary>
              <p className="mt-2">
                <Trans>
                  Passwords are hashed with PBKDF2-SHA256 at {iterations}{' '}
                  iterations. Current guidance is {recommended}, but a sign-in
                  has to finish inside the Cloudflare Free plan's 10 ms CPU
                  budget, so the cost is capped.
                </Trans>
              </p>
              <p className="mt-2">
                <Trans>
                  For stronger protection, put Cloudflare Access in front of{' '}
                  <Code>/_mallok/</Code>.
                </Trans>
              </p>
            </details>
          </AlertDescription>
        </Alert>
      ) : null}
    </Page>
  );
}

function PasswordSection(): JSX.Element {
  const { t } = useLingui();
  const schema = useMemo(() => passwordSchema(t`At least 12 characters.`), [t]);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const [done, setDone] = useState(false);
  const busy = form.formState.isSubmitting;
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setDone(false);
    try {
      await api('/auth/password', { method: 'POST', body: values });
      form.reset();
      setDone(true);
    } catch (caught) {
      showServerErrors(form.setError, caught);
      notify(
        caught instanceof ApiError
          ? caught.message
          : t`Could not change the password.`,
      );
    }
  });

  return (
    <Section
      as="form"
      title={t`Password`}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="submit" disabled={busy}>
            {busy ? t`Changing…` : t`Change password`}
          </Button>
          {done ? (
            <StatusBadge tone="ok">
              <Trans>Changed</Trans>
            </StatusBadge>
          ) : null}
        </>
      }
    >
      <Field data-invalid={errors.currentPassword !== undefined}>
        <FieldLabel htmlFor="pw-current">
          <Trans>Current password</Trans>
        </FieldLabel>
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          {...invalid('pw-current', errors.currentPassword?.message)}
          {...form.register('currentPassword')}
        />
        <FieldError id="pw-current-error">
          {errors.currentPassword?.message}
        </FieldError>
      </Field>
      <Field data-invalid={errors.newPassword !== undefined}>
        <FieldLabel htmlFor="pw-next">
          <Trans>New password</Trans>
        </FieldLabel>
        <Input
          id="pw-next"
          type="password"
          autoComplete="new-password"
          {...invalid('pw-next', errors.newPassword?.message)}
          {...form.register('newPassword')}
        />
        <FieldError id="pw-next-error">
          {errors.newPassword?.message}
        </FieldError>
      </Field>
    </Section>
  );
}
