/**
 * Plugins (docs/ADMIN.md §10).
 *
 * Like the appearance page, what is missing is the point: there is no
 * install, update or remove button, because a plugin is source code. What is
 * here — the switch, the settings, the secrets and whatever panels the
 * plugin declares — takes effect immediately.
 */

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from '../api.js';
import { PluginPanelView } from '../components/plugin-panel.js';
import { SecretControl } from '../form/controls.js';
import { SchemaForm } from '../form/form.js';
import { toSpecs, validateAll } from '../form/types.js';
import { notice } from '../state.js';
import type { PluginInfo } from '../types.js';

export function PluginsPage(): JSX.Element {
  const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async (): Promise<void> => {
    try {
      const result = await api<{ plugins: PluginInfo[] }>('/plugins');
      setPlugins(result.plugins);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not load plugins.';
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div class="page">
      <header class="page-head">
        <h1>Plugins</h1>
      </header>

      <section class="card note">
        <h2>Plugins ship with your source, not through this page</h2>
        <p>
          To add one, put its folder in <code>src/plugins/</code>, list it in{' '}
          <code>src/plugins/index.ts</code>, then build and deploy. Removing one
          is the reverse. There is no upload here because there is no way to
          make an upload take effect without a new build.
        </p>
        <p class="help">
          What you can change here — the switch below, settings and secrets — is
          stored in the database and applies to the very next request.
        </p>
      </section>

      {loading ? (
        <p>Loading…</p>
      ) : plugins.length === 0 ? (
        <p class="empty">No plugins are compiled into this build.</p>
      ) : (
        plugins.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} onChanged={reload} />
        ))
      )}
    </div>
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

  const saveSettings = async (event: Event): Promise<void> => {
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

  return (
    <section class="card plugin">
      <header class="plugin-head">
        <div>
          <h2>
            {plugin.name} <span class="code">{plugin.version}</span>
            {plugin.official ? <span class="pill">Official</span> : null}
          </h2>
          {plugin.description === '' ? null : <p>{plugin.description}</p>}
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={plugin.enabled}
            disabled={busy}
            onChange={(event) => void toggle(event.currentTarget.checked)}
          />
          <span>{plugin.enabled ? 'On' : 'Off'}</span>
        </label>
      </header>

      <dl class="facts">
        <div>
          <dt>Hooks</dt>
          <dd>
            {plugin.hooks.length === 0 ? 'None' : plugin.hooks.join(', ')}
          </dd>
        </div>
        <div>
          <dt>Client JavaScript</dt>
          <dd>
            {plugin.clientScripts.length === 0 ? (
              <span class="pill ok">None</span>
            ) : (
              <span class="pill warn">
                {plugin.clientScripts.length} script
                {plugin.clientScripts.length === 1 ? '' : 's'}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Affects cached pages</dt>
          <dd>
            {plugin.affectsFragmentCache ? 'Yes' : 'Only at request time'}
          </dd>
        </div>
      </dl>

      {plugin.runsOnEveryRequest ? (
        <p class="warning-line">
          This plugin runs on <strong>every visitor request</strong>, including
          ones the cache would otherwise answer for free.
        </p>
      ) : null}

      {plugin.clientScripts.length === 0 ? null : (
        <ul class="rows">
          {plugin.clientScripts.map((script) => (
            <li key={script.src}>
              <span class="code">{script.src}</span>
              <span>{script.purpose}</span>
            </li>
          ))}
        </ul>
      )}

      {specs.length === 0 ? null : (
        <form onSubmit={(event) => void saveSettings(event)}>
          <h3>Settings</h3>
          <SchemaForm
            specs={specs}
            values={values}
            errors={errors}
            idPrefix={`plugin-${plugin.id}`}
            onChange={(name, value) =>
              setValues((previous) => ({ ...previous, [name]: value }))
            }
          />
          <div class="actions">
            <button type="submit" class="primary" disabled={busy}>
              Save settings
            </button>
            {savedSettings ? <span class="pill ok">Saved</span> : null}
          </div>
        </form>
      )}

      {plugin.secrets.length === 0 ? null : (
        <div class="secrets">
          <h3>Secrets</h3>
          <p class="help">
            Stored encrypted. They are never shown again, here or anywhere else.
          </p>
          {plugin.secrets.map((secret) => (
            <div class="field field-inline" key={secret.name}>
              <label for={`secret-${plugin.id}-${secret.name}`}>
                {secret.label}
                {secret.required ? (
                  <span class="req" aria-hidden="true">
                    *
                  </span>
                ) : null}
              </label>
              <div class="control">
                <SecretControl
                  id={`secret-${plugin.id}-${secret.name}`}
                  label={secret.label}
                  configured={secret.configured}
                  onSet={(value) => void writeSecret(secret.name, value)}
                  onClear={() => void writeSecret(secret.name, null)}
                />
                {secret.checkable && secret.configured ? (
                  <button
                    type="button"
                    class="ghost"
                    disabled={checking !== ''}
                    onClick={() => void checkSecret(secret.name)}
                  >
                    {checking === secret.name ? 'Checking…' : 'Test'}
                  </button>
                ) : null}
                {checkResult[secret.name] === undefined ? null : (
                  <span
                    class={
                      checkResult[secret.name]?.ok ? 'pill ok' : 'pill warn'
                    }
                  >
                    {checkResult[secret.name]?.message}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {plugin.panels.map((panel) => (
        <PluginPanelView key={panel.id} pluginId={plugin.id} panel={panel} />
      ))}
    </section>
  );
}
