/**
 * Plugins (docs/ADMIN.md §10).
 *
 * Like the appearance page, what is missing is the point: there is no
 * install, update or remove button, because a plugin is source code. What is
 * here — the switch, the settings, the secrets and whatever panels the
 * plugin declares — takes effect immediately.
 */

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Info, List, TriangleAlert } from 'lucide-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { ApiError, api } from '../api.js';
import { EmptyState } from '../components/empty-state.js';
import {
  Code,
  Facts,
  Page,
  PageHeader,
  StatusBadge,
} from '../components/page.js';
import { SecretControl } from '../form/controls.js';
import { SchemaForm, showServerErrors } from '../form/form.js';
import { toSpecs } from '../form/types.js';
import { notify, useReportError } from '../notice.js';
import { pluginsQuery } from '../queries.js';
import type { PluginInfo } from '../types.js';

export function PluginsPage(): JSX.Element {
  const { t } = useLingui();
  const client = useQueryClient();
  const listed = useQuery(pluginsQuery);
  useReportError(listed.error, t`Could not load plugins.`);
  const plugins = listed.data?.plugins ?? [];
  const loading = listed.isPending;
  // A panel's "Its settings" link lands on its plugin's card. The router
  // does not scroll to an anchor, and the card exists once the list is in.
  useEffect(() => {
    if (!loading && window.location.hash.startsWith('#plugin-')) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    }
  }, [loading]);
  const reload = useCallback(
    () => client.invalidateQueries({ queryKey: pluginsQuery.queryKey }),
    [client],
  );

  return (
    <Page>
      <PageHeader title={t`Plugins`} />

      <Alert role="note">
        <Info />
        <AlertTitle role="heading" aria-level={2}>
          <Trans>Plugins ship with your source, not through this page</Trans>
        </AlertTitle>
        <AlertDescription>
          <p>
            <Trans>
              To add one, put its folder in <Code>src/plugins/</Code>, list it
              in <Code>src/plugins/index.ts</Code>, then build and deploy.
              Removing one is the reverse. There is no upload here because there
              is no way to make an upload take effect without a new build.
            </Trans>
          </p>
          <p>
            <Trans>
              What you can change here — the switch below, settings and secrets
              — is stored in the database and applies to the very next request.
            </Trans>
          </p>
        </AlertDescription>
      </Alert>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : plugins.length === 0 ? (
        // Adding one is a redeploy, not a button (U19).
        <EmptyState>
          <Trans>No plugins are compiled into this build.</Trans>
        </EmptyState>
      ) : (
        plugins.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} onChanged={reload} />
        ))
      )}
    </Page>
  );
}

function PluginCard({
  plugin,
  onChanged,
}: {
  readonly plugin: PluginInfo;
  readonly onChanged: () => Promise<void>;
}): JSX.Element {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const form = useForm<FieldValues>({ defaultValues: { ...plugin.values } });
  const [savedSettings, setSavedSettings] = useState(false);
  const [checking, setChecking] = useState('');
  const [checkResult, setCheckResult] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
  const specs = toSpecs(plugin.settings);

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    try {
      await api(`/plugins/${plugin.id}/enabled`, {
        method: 'POST',
        body: { enabled },
      });
      await onChanged();
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : t`Could not change.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = form.handleSubmit(async (values) => {
    setBusy(true);
    setSavedSettings(false);
    try {
      await api(`/plugins/${plugin.id}/settings`, {
        method: 'PATCH',
        body: values,
      });
      setSavedSettings(true);
      await onChanged();
    } catch (caught) {
      showServerErrors(form.setError, caught);
      notify(caught instanceof ApiError ? caught.message : t`Could not save.`);
    } finally {
      setBusy(false);
    }
  });

  const writeSecret = async (
    name: string,
    value: string | null,
  ): Promise<void> => {
    try {
      await api(`/plugins/${plugin.id}/secrets`, {
        method: 'PUT',
        body: { [name]: value },
      });
      await onChanged();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : t`Could not save.`);
    }
  };

  const checkSecret = async (name: string): Promise<void> => {
    setChecking(name);
    try {
      const verdict = await api<{ ok: boolean; message: string }>(
        `/plugins/${plugin.id}/secrets/${name}`,
        { method: 'POST' },
      );
      setCheckResult((previous) => ({ ...previous, [name]: verdict }));
    } catch (caught) {
      setCheckResult((previous) => ({
        ...previous,
        [name]: {
          ok: false,
          message:
            caught instanceof ApiError ? caught.message : t`The check failed.`,
        },
      }));
    } finally {
      setChecking('');
    }
  };

  const missingLayouts = plugin.pageLayouts.filter((entry) => !entry.provided);
  const pluginName = plugin.name;
  const listSeparator = t({
    comment: 'Between items of a list',
    message: ', ',
  });
  // Each layout name is code; the list around them is the language's own.
  const layouts = missingLayouts.map((entry, index) => (
    <span key={entry.layout}>
      {index === 0 ? '' : listSeparator}
      <Code>{entry.layout}</Code>
    </span>
  ));
  const nameId = `plugin-${plugin.id}-name`;
  return (
    <section
      id={`plugin-${plugin.id}`}
      aria-labelledby={nameId}
      className="scroll-mt-4"
    >
      <Card>
        <CardHeader>
          <CardTitle
            id={nameId}
            role="heading"
            aria-level={2}
            className="flex flex-wrap items-center gap-2"
          >
            {plugin.name}{' '}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {plugin.version}
            </span>
            {plugin.official ? (
              <Badge variant="secondary">
                <Trans>Official</Trans>
              </Badge>
            ) : null}
          </CardTitle>
          {plugin.description === '' ? null : (
            <CardDescription>{plugin.description}</CardDescription>
          )}
          <CardAction className="flex items-center gap-2 text-sm">
            <Switch
              aria-label={t`${pluginName} enabled`}
              checked={plugin.enabled}
              disabled={busy}
              onCheckedChange={(checked) => void toggle(checked)}
            />
            <span aria-hidden="true">{plugin.enabled ? t`On` : t`Off`}</span>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {plugin.runsOnEveryRequest ? (
            <Alert role="note" className="border-warning/40 text-warning">
              <TriangleAlert />
              <AlertDescription className="text-foreground">
                <Trans>
                  This plugin runs on <strong>every visitor request</strong>,
                  including ones the cache would otherwise answer for free.
                </Trans>
              </AlertDescription>
            </Alert>
          ) : null}

          {missingLayouts.length === 0 ? null : (
            <Alert role="note" className="border-warning/40 text-warning">
              <TriangleAlert />
              <AlertDescription className="text-foreground">
                <p>
                  <Trans>
                    The current theme has no layout for {layouts}. Those pages
                    are shown in a plain built-in layout, without the site’s
                    design. Adding the layouts to the theme needs a new build
                    and deploy.
                  </Trans>
                </p>
              </AlertDescription>
            </Alert>
          )}

          {plugin.panels.map((panel) => {
            if (panel.attachTo === undefined) {
              // The list itself is a page in the sidebar (U3); here, the
              // way to it.
              return (
                <Button
                  key={panel.id}
                  asChild
                  variant="outline"
                  className="self-start"
                >
                  <Link to={`/plugins/${plugin.id}/${panel.id}`}>
                    <List aria-hidden="true" />
                    {panel.label}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              );
            }
            const panelLabel = panel.label;
            const kind = panel.attachTo.kind;
            // Its records belong to one content item each; a list of all of
            // them, with nothing to say whose they are, would only mislead.
            return (
              <p className="text-sm text-muted-foreground" key={panel.id}>
                <Trans>
                  <strong className="text-foreground">{panelLabel}</strong> is
                  edited where it belongs: open any <Code>{kind}</Code> in
                  Content, and it is under the editor.
                </Trans>
              </p>
            );
          })}

          {specs.length === 0 ? null : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => void saveSettings(event)}
            >
              <h3 className="font-heading text-sm font-semibold">
                <Trans>Settings</Trans>
              </h3>
              <SchemaForm
                specs={specs}
                control={form.control}
                idPrefix={`plugin-${plugin.id}`}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy}>
                  <Trans>Save settings</Trans>
                </Button>
                {savedSettings ? (
                  <StatusBadge tone="ok">
                    <Trans>Saved</Trans>
                  </StatusBadge>
                ) : null}
              </div>
            </form>
          )}

          {plugin.secrets.length === 0 ? null : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="font-heading text-sm font-semibold">
                  <Trans>Secrets</Trans>
                </h3>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Stored encrypted. They are never shown again, here or
                    anywhere else.
                  </Trans>
                </p>
              </div>
              {plugin.secrets.map((secret) => (
                <Field key={secret.name}>
                  <FieldLabel htmlFor={`secret-${plugin.id}-${secret.name}`}>
                    {secret.label}
                    {secret.required ? (
                      <span className="text-destructive" aria-hidden="true">
                        *
                      </span>
                    ) : null}
                  </FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <SecretControl
                      id={`secret-${plugin.id}-${secret.name}`}
                      label={secret.label}
                      configured={secret.configured}
                      onSet={(value) => void writeSecret(secret.name, value)}
                      onClear={() => void writeSecret(secret.name, null)}
                    />
                    {secret.checkable && secret.configured ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={checking !== ''}
                        onClick={() => void checkSecret(secret.name)}
                      >
                        {checking === secret.name ? t`Checking…` : t`Test`}
                      </Button>
                    ) : null}
                    {checkResult[secret.name] === undefined ? null : (
                      <StatusBadge
                        tone={checkResult[secret.name]?.ok ? 'ok' : 'warn'}
                      >
                        {checkResult[secret.name]?.message}
                      </StatusBadge>
                    )}
                  </div>
                </Field>
              ))}
            </div>
          )}

          {/* What the plugin does to the site, which ADMIN.md §10 requires
              to be shown; closed, because it is read once, not operated. */}
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
              <Trans>For the person who deploys</Trans>
            </summary>
            <div className="flex flex-col gap-4 border-t px-3 py-3">
              <Facts
                items={[
                  [
                    t`Hooks`,
                    plugin.hooks.length === 0
                      ? t`None`
                      : plugin.hooks.join(', '),
                  ],
                  [
                    t`Client JavaScript`,
                    plugin.clientScripts.length === 0 ? (
                      <StatusBadge key="v" tone="ok">
                        <Trans>None</Trans>
                      </StatusBadge>
                    ) : (
                      <StatusBadge key="v" tone="warn">
                        <Plural
                          value={plugin.clientScripts.length}
                          one="# script"
                          other="# scripts"
                        />
                      </StatusBadge>
                    ),
                  ],
                  [
                    t`Affects cached pages`,
                    plugin.affectsFragmentCache
                      ? t`Yes`
                      : t`Only at request time`,
                  ],
                ]}
              />

              {plugin.clientScripts.length === 0 ? null : (
                <ul className="flex flex-col divide-y rounded-lg border">
                  {plugin.clientScripts.map((script) => (
                    <li
                      key={script.src}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                    >
                      <Code>{script.src}</Code>
                      <span className="text-muted-foreground">
                        {script.purpose}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </CardContent>
      </Card>
    </section>
  );
}
