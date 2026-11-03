/**
 * Email: the site's one Resend key and sender address (docs/ADMIN.md §4).
 *
 * Both belong to the site, not to a plugin: every plugin that sends email —
 * inquiry notifications today — goes through them. The key is write-only;
 * this page can replace it, remove it and ask Resend whether it works, but
 * can never show it.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '../api.js';
import { Page, PageHeader, Section, StatusBadge } from '../components/page.js';
import { SecretControl } from '../form/controls.js';
import { notify } from '../notice.js';
import { keys, useSettings } from '../queries.js';
import type { SiteEmail } from '../types.js';

/** Mirrors the server's check, so a typo is caught before the request. */
const SENDER_PATTERN = /^(?:[^\s@<>]+@[^\s@<>]+|[^<>]*<[^\s@<>]+@[^\s@<>]+>)$/;

/** Empty clears the sender; anything else has to be an address. */
const senderSchema = z.object({
  from: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || SENDER_PATTERN.test(value),
      'Use an address such as hello@example.com or Acme <hello@example.com>.',
    ),
});

export function EmailSettingsPage(): JSX.Element {
  const current = useSettings();
  const client = useQueryClient();
  const form = useForm({
    resolver: zodResolver(senderSchema),
    defaultValues: { from: current.email.fromAddress ?? '' },
  });
  const fromError = form.formState.errors.from?.message;
  const busy = form.formState.isSubmitting;
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

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
      client.setQueryData(keys.settings, { ...current, email: stored });
      return true;
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Could not save.');
      return false;
    }
  };

  const saveSender = form.handleSubmit(async ({ from }) => {
    setSaved(false);
    setSaved(await store({ fromAddress: from === '' ? null : from }));
  });

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
    <Page>
      <PageHeader
        title="Email"
        lede="One Resend key and one sender address for the whole site. Every plugin that sends email uses them, and a change applies to the next message — no rebuild, no deploy."
      />

      <Section
        as="form"
        title="Sender"
        onSubmit={(event) => void saveSender(event)}
        footer={
          <>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save sender'}
            </Button>
            {saved ? <StatusBadge tone="ok">Saved</StatusBadge> : null}
          </>
        }
      >
        <Field data-invalid={fromError !== undefined}>
          <FieldLabel htmlFor="email-from">From address</FieldLabel>
          <Input
            id="email-from"
            type="text"
            maxLength={320}
            placeholder="Acme <hello@example.com>"
            aria-invalid={fromError !== undefined}
            aria-describedby={
              fromError === undefined
                ? 'email-from-help'
                : 'email-from-help email-from-error'
            }
            {...form.register('from', { onChange: () => setSaved(false) })}
          />
          <FieldDescription id="email-from-help">
            Must be on a domain you have verified in Resend. A plugin may set
            its own sender; this one is used whenever it does not.
          </FieldDescription>
          <FieldError id="email-from-error">{fromError}</FieldError>
        </Field>
      </Section>

      <Section
        title="Resend API key"
        description="Stored encrypted. It is never shown again, here or anywhere else."
      >
        <Field>
          <FieldLabel htmlFor="email-resend-key">Resend API key</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <SecretControl
              id="email-resend-key"
              label="Resend API key"
              configured={email.resendConfigured}
              onSet={(value) => void writeKey(value)}
              onClear={() => void writeKey(null)}
            />
            {email.resendConfigured ? (
              <Button
                type="button"
                variant="outline"
                disabled={checking}
                onClick={() => void check()}
              >
                {checking ? 'Checking…' : 'Test'}
              </Button>
            ) : null}
            {verdict === null ? null : (
              <StatusBadge tone={verdict.ok ? 'ok' : 'warn'} role="status">
                {verdict.message}
              </StatusBadge>
            )}
          </div>
        </Field>
        {email.resendConfigured ? null : (
          <Alert role="note">
            <TriangleAlert />
            <AlertDescription>
              Without a key no email is sent. A message queued meanwhile is
              retried for about 30 minutes and then marked failed.
            </AlertDescription>
          </Alert>
        )}
      </Section>
    </Page>
  );
}
