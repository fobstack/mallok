/**
 * Site information, languages and navigation.
 *
 * Everything here is a runtime setting: saving takes effect immediately, no
 * deploy involved (docs/PRODUCT_VISION.md §5.1).
 */

import type { JSX } from 'react';
import { useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '../api.js';
import {
  Code,
  Page,
  PageHeader,
  Section,
  StatusBadge,
} from '../components/page.js';
import { SavedNote } from '../components/saved-note.js';
import { SchemaForm, showServerErrors } from '../form/form.js';
import type { FieldSpec } from '../form/types.js';
import { notify } from '../notice.js';
import { reloadWorkspace, saveSettings, useSettings } from '../queries.js';

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

/** The form field holding one language's own tagline. */
function taglineField(locale: string): string {
  return `tagline_${locale}`;
}

export function SiteSettingsPage(): JSX.Element {
  const current = useSettings();
  /** The languages that can have a tagline of their own. */
  const otherLocales = (current.locales ?? []).filter(
    (locale) => locale !== current.defaultLocale,
  );
  const form = useForm<FieldValues>({
    defaultValues: (() => {
      // One string, or one per language keyed by locale.
      const stored = current.tagline ?? '';
      const byLocale = typeof stored === 'string' ? {} : stored;
      return {
        name: current.name,
        tagline:
          typeof stored === 'string'
            ? stored
            : (stored[current.defaultLocale ?? ''] ?? ''),
        ...Object.fromEntries(
          Object.entries(byLocale)
            .filter(([locale]) => locale !== current.defaultLocale)
            .map(([locale, text]) => [taglineField(locale), text]),
        ),
        domain: current.domain ?? '',
        mediaBaseUrl: current.mediaBaseUrl ?? '',
      };
    })(),
  });
  const [saved, setSaved] = useState(false);

  // A tagline field per further language, right under the tagline itself.
  const fields: readonly FieldSpec[] = SITE_FIELDS.flatMap((spec) =>
    spec.name === 'tagline'
      ? [
          spec,
          ...otherLocales.map(
            (locale): FieldSpec => ({
              name: taglineField(locale),
              field: {
                type: 'text',
                label: `Tagline (${locale})`,
                required: false,
                max: 300,
                help: `Shown on pages in ${locale}. Empty uses the tagline above.`,
              },
            }),
          ),
        ]
      : [spec],
  );

  /** One string when no language has its own tagline, otherwise the map. */
  const taglineValue = (
    draft: FieldValues,
  ): string | Record<string, string> | null => {
    const own = String(draft.tagline ?? '');
    const others = Object.fromEntries(
      otherLocales
        .map((locale) => [locale, String(draft[taglineField(locale)] ?? '')])
        .filter(([, text]) => (text ?? '').trim() !== ''),
    ) as Record<string, string>;
    if (Object.keys(others).length === 0) {
      return own === '' ? null : own;
    }
    return { [current.defaultLocale]: own, ...others };
  };

  const submit = form.handleSubmit(async (draft) => {
    setSaved(false);
    try {
      await saveSettings({
        name: String(draft.name ?? ''),
        tagline: taglineValue(draft),
        domain: draft.domain === '' ? null : String(draft.domain ?? ''),
        mediaBaseUrl:
          draft.mediaBaseUrl === '' ? null : String(draft.mediaBaseUrl ?? ''),
      });
      setSaved(true);
    } catch (caught) {
      showServerErrors(form.setError, caught);
      notify(caught instanceof ApiError ? caught.message : 'Could not save.');
    }
  });
  const busy = form.formState.isSubmitting;

  return (
    <Page>
      <PageHeader
        title="Site"
        lede="These are stored the moment you save — no rebuild, no deploy."
      />
      <Section
        as="form"
        onSubmit={(event) => void submit(event)}
        footer={
          <>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            {saved ? <SavedNote /> : null}
          </>
        }
      >
        <SchemaForm specs={fields} control={form.control} idPrefix="site" />
      </Section>

      <LocaleSection />
    </Page>
  );
}

/**
 * Enabled languages, the default-locale switch, and whether the default
 * language carries a prefix.
 *
 * Changing either of the last two rewrites every public URL, so each goes
 * through its own endpoint with an explicit confirmation
 * (docs/DATA_MODEL.md §2.2).
 */
function LocaleSection(): JSX.Element {
  const current = useSettings();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');

  const setLocales = async (locales: string[]): Promise<void> => {
    setBusy(true);
    try {
      await saveSettings({ locales });
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Could not save.');
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
      await reloadWorkspace();
      notify(
        `Default language is now "${locale}". ${result.moved} URLs moved, each with a redirect.`,
      );
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Could not switch.');
    } finally {
      setBusy(false);
    }
  };

  const setPrefix = async (enabled: boolean): Promise<void> => {
    const ok = window.confirm(
      enabled
        ? `Serve "${current.defaultLocale}" under /${current.defaultLocale}/ too?\n\nEvery URL of the default language moves (/about becomes /${current.defaultLocale}/about) and each old URL, lists and tags included, redirects to its new one. The navigation's links to this site are rewritten to match. The site's root then only redirects to /${current.defaultLocale}.`
        : `Serve "${current.defaultLocale}" at the root again?\n\nEvery URL of the default language moves (/${current.defaultLocale}/about becomes /about) and each old URL, lists, tags and /${current.defaultLocale} included, redirects to its new one. The navigation's links to this site are rewritten to match.`,
    );
    if (!ok) {
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ moved: number }>('/settings/locale-prefix', {
        method: 'POST',
        body: { enabled, confirm: true },
      });
      await reloadWorkspace();
      notify(
        `${result.moved} URLs moved, each with a redirect; navigation links rewritten.`,
      );
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Could not switch.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Languages"
      description={
        current.prefixDefaultLocale ? (
          <>
            Every language is served under <Code>/&lt;locale&gt;/</Code>, the
            default one too; the site&apos;s root redirects to{' '}
            <Code>/{current.defaultLocale}</Code>.
          </>
        ) : (
          <>
            The default language has no URL prefix; every other language is
            served under <Code>/&lt;locale&gt;/</Code>.
          </>
        )
      }
    >
      <Field orientation="horizontal">
        <Checkbox
          id="site-prefix-default"
          checked={current.prefixDefaultLocale}
          disabled={busy}
          onCheckedChange={(checked) => void setPrefix(checked === true)}
        />
        <FieldLabel htmlFor="site-prefix-default">
          {/* One run of text: the label lays its children out with a gap. */}
          <span>
            Prefix the default language too (
            <Code>/{current.defaultLocale}/…</Code>)
          </span>
        </FieldLabel>
      </Field>
      <ul className="flex flex-col divide-y rounded-lg border">
        {current.locales.map((locale) => (
          <li
            key={locale}
            className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
          >
            <Code>{locale}</Code>
            {locale === current.defaultLocale ? (
              <StatusBadge tone="ok">Default</StatusBadge>
            ) : (
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void makeDefault(locale)}
                >
                  Make default
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void setLocales(
                      current.locales.filter((entry) => entry !== locale),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-32"
          aria-label="Language code"
          placeholder="de"
          value={adding}
          onInput={(event) => setAdding(event.currentTarget.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || adding.trim() === ''}
          onClick={() => {
            void setLocales([...current.locales, adding.trim()]);
            setAdding('');
          }}
        >
          Add language
        </Button>
      </div>
    </Section>
  );
}
