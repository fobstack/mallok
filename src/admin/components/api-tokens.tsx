/**
 * API tokens: what the CLI and scripts sign in with (docs/ADMIN.md §12).
 *
 * Under Settings → Advanced, not Account: an operator who opens Account to
 * change a password should not have to read about scopes first
 * (docs/ADMIN_SIMPLE.md, G18).
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { KeyRound } from 'lucide-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '../api.js';
import { invalid, showServerErrors } from '../form/form.js';
import { requiredMessage } from '../form/types.js';
import { notify, useReportError } from '../notice.js';
import { keys } from '../queries.js';
import {
  describeToken,
  revokeFailureMessage,
  type TokenSummary,
} from '../tokens.js';
import { Section } from './page.js';

const SCOPES = [
  'content:write',
  'media:write',
  'export',
  'settings:write',
] as const;

/** A token needs a name; which scopes it may have is the server's rule. */
const tokenSchema = z.object({
  name: z.string().trim().min(1, { error: requiredMessage }),
  scopes: z.array(z.string()),
});

/** Creating, listing and revoking API tokens. */
export function ApiTokensSection(): JSX.Element {
  const { t } = useLingui();
  const client = useQueryClient();
  const [minted, setMinted] = useState('');
  const tokenForm = useForm({
    resolver: zodResolver(tokenSchema),
    defaultValues: { name: '', scopes: ['content:write'] },
  });
  const busy = tokenForm.formState.isSubmitting;
  const nameError = tokenForm.formState.errors.name?.message;

  const listed = useQuery({
    queryKey: keys.tokens,
    queryFn: () => api<{ tokens: TokenSummary[] }>('/tokens'),
  });
  useReportError(listed.error, t`Could not load tokens.`);
  const tokens = listed.data?.tokens ?? [];
  const reload = (): Promise<void> =>
    client.invalidateQueries({ queryKey: keys.tokens });

  const create = tokenForm.handleSubmit(async ({ name, scopes }) => {
    try {
      const result = await api<{ token: string }>('/tokens', {
        method: 'POST',
        body: { name, scopes },
      });
      setMinted(result.token);
      // The scopes stay ticked: the next token is often a sibling.
      tokenForm.resetField('name');
      await reload();
    } catch (caught) {
      showServerErrors(tokenForm.setError, caught);
      notify(
        caught instanceof ApiError ? caught.message : t`Could not create.`,
      );
    }
  });

  const revoke = async (id: string): Promise<void> => {
    try {
      await api(`/tokens/${id}`, { method: 'DELETE' });
    } catch (caught) {
      notify(revokeFailureMessage(caught));
    }
    // Reloaded either way: after a 404 the list is what is out of date.
    await reload();
  };

  return (
    <Section
      title={t`API tokens`}
      description={t`The CLI and any script use these. A token is shown once — copy it now, it cannot be retrieved later.`}
    >
      {minted === '' ? null : (
        // A real alert: the token is on screen this once, and never again.
        <Alert className="border-primary/40 bg-primary/5">
          <KeyRound />
          <AlertDescription className="flex flex-wrap items-center gap-2 text-foreground">
            <code className="min-w-0 flex-1 rounded-sm bg-background px-2 py-1 font-mono text-xs break-all">
              {minted}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(minted);
              }}
            >
              <Trans>Copy</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMinted('')}
            >
              <Trans>Done</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {tokens.length === 0 ? null : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {tokens.map((token) => {
            const view = describeToken(token);
            return (
              <li
                key={token.id}
                // `revoked` styles nothing; it marks the row for the browser
                // test that checks a revoked token is told apart.
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm',
                  !view.revocable && 'revoked text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'font-medium',
                    !view.revocable && 'font-normal line-through',
                  )}
                >
                  {token.name}
                </span>
                <span className="flex flex-wrap gap-1">
                  {token.scopes.map((scope) => (
                    <Badge
                      key={scope}
                      variant="secondary"
                      className="font-mono"
                    >
                      {scope}
                    </Badge>
                  ))}
                </span>
                <span className="text-xs text-muted-foreground">
                  {view.status}
                </span>
                {view.revocable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      void revoke(token.id);
                    }}
                  >
                    <Trans>Revoke</Trans>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => void create(event)}
      >
        <Field data-invalid={nameError !== undefined}>
          <FieldLabel htmlFor="token-name">
            <Trans>New token name</Trans>
          </FieldLabel>
          <Input
            id="token-name"
            className="max-w-sm"
            {...invalid('token-name', nameError)}
            {...tokenForm.register('name')}
          />
          <FieldError id="token-name-error">{nameError}</FieldError>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">
            <Trans>Scopes</Trans>
          </FieldLegend>
          <Controller
            control={tokenForm.control}
            name="scopes"
            render={({ field }) => (
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                {SCOPES.map((scope) => (
                  <Field
                    key={scope}
                    orientation="horizontal"
                    className="w-auto"
                  >
                    <Checkbox
                      id={`token-scope-${scope}`}
                      checked={field.value.includes(scope)}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked === true
                            ? [...field.value, scope]
                            : field.value.filter((entry) => entry !== scope),
                        )
                      }
                    />
                    <FieldLabel
                      htmlFor={`token-scope-${scope}`}
                      className="font-mono font-normal"
                    >
                      {scope}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            )}
          />
        </FieldSet>
        <div>
          <Button type="submit" disabled={busy}>
            <Trans>Create token</Trans>
          </Button>
        </div>
      </form>
    </Section>
  );
}
