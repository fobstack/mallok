/**
 * Sign-in (docs/ADMIN.md §12).
 *
 * The password-strength note is deliberate, not decoration: the PBKDF2 cost
 * is capped by the Free plan's 10 ms CPU budget, and if the configured count
 * is below current guidance the product says so rather than implying it is
 * fine (docs/SECURITY.md §3.1).
 */

import { zodResolver } from '@hookform/resolvers/zod';
import type { JSX } from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '../api.js';
import { invalid } from '../form/form.js';
import { REQUIRED_MESSAGE } from '../form/types.js';
import { signIn, useKnownSettings } from '../queries.js';

/** Both are needed; whether they match is the server's to say. */
const signInSchema = z.object({
  email: z.string().trim().min(1, REQUIRED_MESSAGE),
  password: z.string().min(1, REQUIRED_MESSAGE),
});

export function LoginPage(): JSX.Element {
  const form = useForm({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });
  const [error, setError] = useState('');
  const siteName = useKnownSettings()?.name;
  const busy = form.formState.isSubmitting;
  const { errors } = form.formState;

  const submit = form.handleSubmit(async ({ email, password }) => {
    setError('');
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Sign-in failed.');
    }
  });

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">Sign in</h1>
          </CardTitle>
          <CardDescription>{siteName ?? "The site's admin"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={(event) => void submit(event)}>
            <FieldGroup>
              <Field data-invalid={errors.email !== undefined}>
                <FieldLabel htmlFor="login-email">Email</FieldLabel>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  {...invalid('login-email', errors.email?.message)}
                  {...form.register('email')}
                />
                <FieldError id="login-email-error">
                  {errors.email?.message}
                </FieldError>
              </Field>
              <Field data-invalid={errors.password !== undefined}>
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  {...invalid('login-password', errors.password?.message)}
                  {...form.register('password')}
                />
                <FieldError id="login-password-error">
                  {errors.password?.message}
                </FieldError>
              </Field>
              {error === '' ? null : (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
