/**
 * Appearance (docs/ADMIN.md §4.1, §9).
 *
 * There is **no theme list, no upload and no switch button** on this page,
 * and that absence is the design. Switching a theme means editing
 * `ACTIVE_THEME` in the source and deploying; a button here would be a lie
 * (docs/PRODUCT_VISION.md §4).
 */

import type { JSX } from 'react';
import { useState } from 'react';
import { LOCALE_OPTIONS_KEY } from '../../core/constants.js';
import { ApiError } from '../api.js';
import { SavedNote } from '../components/saved-note.js';
import { SchemaForm } from '../form/form.js';
import { optionSpecs, validateAll } from '../form/types.js';
import { notice, saveSettings, settings, theme } from '../state.js';

export function AppearancePage(): JSX.Element {
  const active = theme.value;
  const current = settings.value;
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [touched, setTouched] = useState(false);
  const [editingLocale, setEditingLocale] = useState(
    settings.value?.defaultLocale ?? 'en',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  if (active === null || current === null) {
    return <p>Loading…</p>;
  }

  const specs = optionSpecs(active.options);
  // Options resolve the way the renderer resolves them: the override for the
  // locale being edited, then the site-wide value, then the manifest default
  // (docs/THEME_FORMAT.md §6.1).
  const overrides =
    (current.themeOptions[LOCALE_OPTIONS_KEY] as
      | Record<string, Record<string, unknown>>
      | undefined) ?? {};
  const editingDefault = editingLocale === current.defaultLocale;
  const values: Record<string, unknown> = {};
  for (const spec of specs) {
    if (touched) {
      values[spec.name] = draft[spec.name];
      continue;
    }
    values[spec.name] = editingDefault
      ? (current.themeOptions[spec.name] ?? spec.field.default)
      : (overrides[editingLocale]?.[spec.name] ??
        current.themeOptions[spec.name] ??
        spec.field.default);
  }

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    const found = validateAll(specs, values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    setSaved(false);
    try {
      const next: Record<string, unknown> = { ...current.themeOptions };
      if (editingLocale === current.defaultLocale) {
        for (const [key, value] of Object.entries(values)) {
          next[key] = value;
        }
      } else {
        // Only what actually differs is stored as an override, so a value
        // the two languages share stays in one place.
        const locale: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(values)) {
          if (value !== next[key]) {
            locale[key] = value;
          }
        }
        next[LOCALE_OPTIONS_KEY] = { ...overrides, [editingLocale]: locale };
      }
      await saveSettings({ themeOptions: next });
      setTouched(false);
      setSaved(true);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
    } finally {
      setBusy(false);
    }
  };

  const kinds = Object.entries(active.kinds);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Appearance</h1>
        <p className="lede">
          The options below are runtime settings: saving takes effect without a
          rebuild. The theme itself is source code.
        </p>
      </header>

      <section className="card">
        <h2>
          {active.name} <span className="code">{active.version}</span>
        </h2>
        {active.description === '' ? null : <p>{active.description}</p>}
        <dl className="facts">
          <div>
            <dt>Content types</dt>
            <dd>{kinds.map(([kind]) => kind).join(', ')}</dd>
          </div>
          <div>
            <dt>Client JavaScript</dt>
            <dd>
              {active.clientScripts.length === 0 ? (
                <span className="pill ok">None</span>
              ) : (
                <span className="pill warn">
                  Injects {active.clientScripts.length} script
                  {active.clientScripts.length === 1 ? '' : 's'}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Assets</dt>
            <dd>
              <span className="code">{active.assetBase}</span>
            </dd>
          </div>
        </dl>
        {active.clientScripts.length === 0 ? null : (
          <ul className="rows">
            {active.clientScripts.map((script) => {
              // A theme may list a script as a bare path or with a stated
              // purpose; both are shown verbatim.
              const path = typeof script === 'string' ? script : script.path;
              const purpose = typeof script === 'string' ? '' : script.purpose;
              return (
                <li key={path}>
                  <span className="code">{path}</span>
                  <span>{purpose}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card note">
        <h2>Changing the theme takes a deploy</h2>
        <p>
          Themes live in the source tree, not the database — they are compiled
          into the Worker. To switch, edit <code>ACTIVE_THEME</code> in{' '}
          <code>src/themes/index.ts</code>, then build and deploy again.
        </p>
        <p className="help">
          Built into this deployment: {active.available.join(', ')}. Your
          content, its ids and every URL stay exactly as they are.
        </p>
      </section>

      {specs.length === 0 ? null : (
        <form className="card" onSubmit={(event) => void submit(event)}>
          <h2>Theme options</h2>
          {current.locales.length > 1 ? (
            <>
              <div className="filters">
                <label className="filter">
                  <span>Editing</span>
                  <select
                    value={editingLocale}
                    onChange={(event) => {
                      setEditingLocale(event.currentTarget.value);
                      setTouched(false);
                    }}
                  >
                    {current.locales.map((locale) => (
                      <option key={locale} value={locale}>
                        {locale}
                        {locale === current.defaultLocale ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="help">
                {editingLocale === current.defaultLocale
                  ? 'These values apply to every language unless a language overrides them below.'
                  : `Values you change here apply only to ${editingLocale}. Anything you leave alone follows the ${current.defaultLocale} value.`}
              </p>
            </>
          ) : null}
          <SchemaForm
            specs={specs}
            values={values}
            errors={errors}
            idPrefix="theme"
            onChange={(name, value) => {
              setDraft({ ...values, [name]: value });
              setTouched(true);
            }}
          />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save options'}
            </button>
            {saved ? <SavedNote /> : null}
          </div>
        </form>
      )}
    </div>
  );
}
