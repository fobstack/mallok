/**
 * Site information, languages and navigation.
 *
 * Everything here is a runtime setting: saving takes effect immediately, no
 * deploy involved (docs/PRODUCT_VISION.md §5.1).
 */

import type { JSX } from 'react';
import { useState } from 'react';
import { ApiError, api } from '../api.js';
import { SavedNote } from '../components/saved-note.js';
import { SchemaForm } from '../form/form.js';
import type { FieldSpec } from '../form/types.js';
import { validateAll } from '../form/types.js';
import { loadWorkspace, notice, saveSettings, settings } from '../state.js';

const SITE_FIELDS: readonly FieldSpec[] = [
  {
    name: 'name',
    field: { type: 'string', label: 'Site name', required: true, max: 120 },
  },
  {
    name: 'tagline',
    field: {
      type: 'text',
      label: 'Tagline',
      required: false,
      max: 300,
      help: 'Shown by most themes under the site name, and as the home page description.',
    },
  },
  {
    name: 'domain',
    field: {
      type: 'string',
      label: 'Custom domain',
      required: false,
      max: 253,
      help: 'Only this host is indexable. Without one, every page is served noindex and the edge cache does not apply.',
    },
  },
  {
    name: 'mediaBaseUrl',
    field: {
      type: 'string',
      label: 'Media domain',
      required: false,
      max: 512,
      help: 'An R2 custom domain, e.g. https://media.example.com. Empty serves images through the Worker.',
    },
  },
];

export function SiteSettingsPage(): JSX.Element {
  const current = settings.value;
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({
    name: current?.name ?? '',
    tagline: current?.tagline ?? '',
    domain: current?.domain ?? '',
    mediaBaseUrl: current?.mediaBaseUrl ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  if (current === null) {
    return <p>Loading…</p>;
  }

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    const found = validateAll(SITE_FIELDS, draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    setSaved(false);
    try {
      await saveSettings({
        name: String(draft.name ?? ''),
        tagline: draft.tagline === '' ? null : String(draft.tagline ?? ''),
        domain: draft.domain === '' ? null : String(draft.domain ?? ''),
        mediaBaseUrl:
          draft.mediaBaseUrl === '' ? null : String(draft.mediaBaseUrl ?? ''),
      });
      setSaved(true);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Site</h1>
        <p className="lede">
          These are stored the moment you save — no rebuild, no deploy.
        </p>
      </header>
      <form className="card" onSubmit={(event) => void submit(event)}>
        <SchemaForm
          specs={SITE_FIELDS}
          values={draft}
          errors={errors}
          idPrefix="site"
          onChange={(name, value) =>
            setDraft((previous) => ({ ...previous, [name]: value }))
          }
        />
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {saved ? <SavedNote /> : null}
        </div>
      </form>

      <LocaleSection />
    </div>
  );
}

/**
 * Enabled languages, and the default-locale switch.
 *
 * Changing the default rewrites every public URL, so it goes through its own
 * endpoint with an explicit confirmation (docs/DATA_MODEL.md §2.2).
 */
function LocaleSection(): JSX.Element {
  const current = settings.value;
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');
  if (current === null) {
    return <p>Loading…</p>;
  }

  const setLocales = async (locales: string[]): Promise<void> => {
    setBusy(true);
    try {
      await saveSettings({ locales });
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async (locale: string): Promise<void> => {
    const ok = window.confirm(
      `Make "${locale}" the default language?\n\nEvery public URL is rewritten and the old URLs are redirected. This cannot be undone automatically.`,
    );
    if (!ok) {
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ moved: number }>('/settings/default-locale', {
        method: 'POST',
        body: { locale, confirm: true },
      });
      await loadWorkspace();
      notice.value = `Default language is now "${locale}". ${result.moved} URLs moved, each with a redirect.`;
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not switch.';
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Languages</h2>
      <p className="help">
        The default language has no URL prefix; every other language is served
        under <code>/&lt;locale&gt;/</code>.
      </p>
      <ul className="rows">
        {current.locales.map((locale) => (
          <li key={locale}>
            <span className="code">{locale}</span>
            {locale === current.defaultLocale ? (
              <span className="pill ok">Default</span>
            ) : (
              <>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void makeDefault(locale)}
                >
                  Make default
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    void setLocales(
                      current.locales.filter((entry) => entry !== locale),
                    )
                  }
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="list-row">
        <input
          aria-label="Language code"
          placeholder="de"
          value={adding}
          onInput={(event) => setAdding(event.currentTarget.value)}
        />
        <button
          type="button"
          className="ghost"
          disabled={busy || adding.trim() === ''}
          onClick={() => {
            void setLocales([...current.locales, adding.trim()]);
            setAdding('');
          }}
        >
          Add language
        </button>
      </div>
    </section>
  );
}
