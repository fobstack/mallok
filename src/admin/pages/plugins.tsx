/**
 * Plugins (docs/ADMIN.md §10).
 *
 * Like the appearance page, what is missing is the point: there is no
 * install, update or remove button, because a plugin is source code. What is
 * here — the switch, the settings, the secrets and whatever panels the
 * plugin declares — takes effect immediately.
 */

import { Info, TriangleAlert } from 'lucide-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
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
import {
  Code,
  Facts,
  Page,
  PageHeader,
  StatusBadge,
} from '../components/page.js';
import { PluginPanelView } from '../components/plugin-panel.js';
import { SecretControl } from '../form/controls.js';
import { SchemaForm } from '../form/form.js';
import { toSpecs, validateAll } from '../form/types.js';
import { notice } from '../state.js';
import type { PluginInfo } from '../types.js';

export function PluginsPage(): JSX.Element {
  const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const result = await api<{ plugins: PluginInfo[] }>('/plugins');
      setPlugins(result.plugins);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not load plugins.';
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Page>
      <PageHeader title="Plugins" />

      <Alert role="note">
        <Info />
        <AlertTitle role="heading" aria-level={2}>
          Plugins ship with your source, not through this page
        </AlertTitle>
        <AlertDescription>
          <p>
            To add one, put its folder in <Code>src/plugins/</Code>, list it in{' '}
            <Code>src/plugins/index.ts</Code>, then build and deploy. Removing
            one is the reverse. There is no upload here because there is no way
            to make an upload take effect without a new build.
          </p>
          <p>
            What you can change here — the switch below, settings and secrets —
            is stored in the database and applies to the very next request.
          </p>
        </AlertDescription>
      </Alert>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : plugins.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No plugins are compiled into this build.
        </p>
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
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...plugin.values,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
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
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not change.';
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (event: {
    preventDefault(): void;
  }): Promise<void> => {
    event.preventDefault();
    const found = validateAll(specs, values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
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
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
    } finally {
      setBusy(false);
    }
  };

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
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
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
            caught instanceof ApiError ? caught.message : 'The check failed.',
        },
      }));
    } finally {
      setChecking('');
    }
  };

  const missingLayouts = plugin.pageLayouts.filter((entry) => !entry.provided);
  const nameId = `plugin-${plugin.id}-name`;
  return (
    <section aria-labelledby={nameId}>
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
              <Badge variant="secondary">Official</Badge>
            ) : null}
          </CardTitle>
          {plugin.description === '' ? null : (
            <CardDescription>{plugin.description}</CardDescription>
          )}
          <CardAction className="flex items-center gap-2 text-sm">
            <Switch
              aria-label={`${plugin.name} enabled`}
              checked={plugin.enabled}
              disabled={busy}
              onCheckedChange={(checked) => void toggle(checked)}
            />
            <span aria-hidden="true">{plugin.enabled ? 'On' : 'Off'}</span>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <Facts
            items={[
              [
                'Hooks',
                plugin.hooks.length === 0 ? 'None' : plugin.hooks.join(', '),
              ],
              [
                'Client JavaScript',
                plugin.clientScripts.length === 0 ? (
                  <StatusBadge key="v" tone="ok">
                    None
                  </StatusBadge>
                ) : (
                  <StatusBadge key="v" tone="warn">
                    {plugin.clientScripts.length} script
                    {plugin.clientScripts.length === 1 ? '' : 's'}
                  </StatusBadge>
                ),
              ],
              [
                'Affects cached pages',
                plugin.affectsFragmentCache ? 'Yes' : 'Only at request time',
              ],
            ]}
          />

          {plugin.runsOnEveryRequest ? (
            <Alert role="note" className="border-warning/40 text-warning">
              <TriangleAlert />
              <AlertDescription className="text-foreground">
                This plugin runs on <strong>every visitor request</strong>,
                including ones the cache would otherwise answer for free.
              </AlertDescription>
            </Alert>
          ) : null}

          {missingLayouts.length === 0 ? null : (
            <Alert role="note" className="border-warning/40 text-warning">
              <TriangleAlert />
              <AlertDescription className="text-foreground">
                <p>
                  The current theme has no layout for{' '}
                  {missingLayouts.map((entry, index) => (
                    <span key={entry.layout}>
                      {index === 0 ? '' : ', '}
                      <Code>{entry.layout}</Code>
                    </span>
                  ))}
                  . Those pages are shown in a plain built-in layout, without
                  the site’s design. Adding the layouts to the theme needs a new
                  build and deploy.
                </p>
              </AlertDescription>
            </Alert>
          )}

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

          {specs.length === 0 ? null : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => void saveSettings(event)}
            >
              <h3 className="font-heading text-sm font-semibold">Settings</h3>
              <SchemaForm
                specs={specs}
                values={values}
                errors={errors}
                idPrefix={`plugin-${plugin.id}`}
                onChange={(name, value) =>
                  setValues((previous) => ({ ...previous, [name]: value }))
                }
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy}>
                  Save settings
                </Button>
                {savedSettings ? (
                  <StatusBadge tone="ok">Saved</StatusBadge>
                ) : null}
              </div>
            </form>
          )}

          {plugin.secrets.length === 0 ? null : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="font-heading text-sm font-semibold">Secrets</h3>
                <p className="text-sm text-muted-foreground">
                  Stored encrypted. They are never shown again, here or anywhere
                  else.
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
                        {checking === secret.name ? 'Checking…' : 'Test'}
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

          {plugin.panels.map((panel) =>
            panel.attachTo === undefined ? (
              <PluginPanelView
                key={panel.id}
                pluginId={plugin.id}
                panel={panel}
              />
            ) : (
              // Its records belong to one content item each; a list of all of
              // them, with nothing to say whose they are, would only mislead.
              <p className="text-sm text-muted-foreground" key={panel.id}>
                <strong className="text-foreground">{panel.label}</strong> is
                edited where it belongs: open any{' '}
                <Code>{panel.attachTo.kind}</Code> in Content, and it is under
                the editor.
              </p>
            ),
          )}
        </CardContent>
      </Card>
    </section>
  );
}
