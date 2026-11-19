/**
 * Site information, languages and navigation.
 *
 * Everything here is a runtime setting: saving takes effect immediately, no
 * deploy involved (docs/PRODUCT_VISION.md §5.1).
 */

import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { JSX } from 'react';
import { useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { ApiError, api } from '../api.js';
import {
  COMMON_LOCALES,
  ContentLanguageSelect,
  useContentLanguageName,
} from '../components/content-language.js';
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

/** The site's own fields, labelled in the interface language. */
function useSiteFields(): readonly FieldSpec[] {
  const { t } = useLingui();
  return [
    {
      name: 'name',
      field: { type: 'string', label: t`Site name`, required: true, max: 120 },
    },
    {
      name: 'tagline',
      field: {
        type: 'text',
        label: t`Tagline`,
        required: false,
        max: 300,
        help: t`Shown by most themes under the site name, and as the home page description.`,
      },
    },
    {
      name: 'domain',
      field: {
        type: 'string',
        label: t`Your domain`,
        required: false,
        max: 253,
        help: t`The address visitors use, such as www.example.com. Until it is set, search engines are asked not to list the site, and pages are not cached, so they load more slowly.`,
      },
    },
    {
      name: 'mediaBaseUrl',
      field: {
        type: 'string',
        label: t`Address for images`,
        required: false,
        // Rarely set, and only with a domain for images (ADMIN_SIMPLE D9).
        advanced: true,
        max: 512,
        help: t`Where images are served from, such as https://media.example.com. Empty serves them from this site.`,
      },
    },
  ];
}

/** The form field holding one language's own tagline. */
function taglineField(locale: string): string {
  return `tagline_${locale}`;
}

export function SiteSettingsPage(): JSX.Element {
  const current = useSettings();
  const { t } = useLingui();
  const siteFields = useSiteFields();
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

  // Other languages' taglines sit under the tagline itself, one field at a
  // time rather than one text box per language (U10, U12). With a single
  // further language that field is simply there; with more, one
  // content-language select says which is shown. The form keeps every
  // language's value, so switching loses nothing.
  const [taglineLocale, setTaglineLocale] = useState(otherLocales[0] ?? '');
  const nameOf = useContentLanguageName();
  const taglineLanguage = nameOf(taglineLocale);
  const splitAt = siteFields.findIndex((spec) => spec.name === 'tagline') + 1;
  const before = siteFields.slice(0, splitAt);
  const after = siteFields.slice(splitAt);
  const otherTagline: FieldSpec = {
    name: taglineField(taglineLocale),
    field: {
      type: 'text',
      label: t`Tagline in ${taglineLanguage}`,
      required: false,
      max: 300,
      help: t`Shown on pages in ${taglineLanguage}. Empty uses the tagline above.`,
    },
  };

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
      notify(caught instanceof ApiError ? caught.message : t`Could not save.`);
    }
  });
  const busy = form.formState.isSubmitting;

  return (
    <Page>
      {/* What applies at once and what needs a deployment is said in one
          place, Advanced (docs/ADMIN_SIMPLE.md §6.5), not on every page. */}
      <PageHeader title={t`General`} />
      <Section
        as="form"
        onSubmit={(event) => void submit(event)}
        footer={
          <>
            <Button type="submit" disabled={busy}>
              {busy ? t`Saving…` : t`Save`}
            </Button>
            {saved ? <SavedNote /> : null}
          </>
        }
      >
        <SchemaForm specs={before} control={form.control} idPrefix="site" />
        {otherLocales.length < 2 ? null : (
          <ContentLanguageSelect
            id="site-tagline-locale"
            value={taglineLocale}
            onChange={setTaglineLocale}
            locales={otherLocales}
            description={t`Each further language can have its own tagline. What you type is kept while you switch; Save stores them all.`}
          />
        )}
        {otherLocales.length === 0 ? null : (
          <SchemaForm
            // A different language is a different field, not the same one
            // with another value: its control must not carry typing over.
            key={taglineLocale}
            specs={[otherTagline]}
            control={form.control}
            idPrefix="site"
          />
        )}
        <SchemaForm specs={after} control={form.control} idPrefix="site" />
      </Section>

      <LocaleSection />
    </Page>
  );
}

/** The add-language select's value for "a language not listed". */
const ANOTHER = '*';

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
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  /** The language picked to add: a code, or `ANOTHER` to type one. */
  const [adding, setAdding] = useState('');
  const [typed, setTyped] = useState('');
  const prefix = current.defaultLocale;
  const chosen = adding === ANOTHER ? typed.trim() : adding;
  const nameOf = useContentLanguageName();

  const setLocales = async (locales: string[]): Promise<void> => {
    setBusy(true);
    try {
      await saveSettings({ locales });
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : t`Could not save.`);
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async (locale: string): Promise<void> => {
    const language = nameOf(locale);
    const ok = window.confirm(
      t`Make ${language} the default language?\n\nEvery public URL is rewritten and the old URLs are redirected. This cannot be undone automatically.`,
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
      const moved = result.moved;
      notify(
        t`Default language is now ${language}. ${plural(moved, { one: '# URL moved, with a redirect.', other: '# URLs moved, each with a redirect.' })}`,
      );
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : t`Could not switch.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const setPrefix = async (enabled: boolean): Promise<void> => {
    const ok = window.confirm(
      enabled
        ? t`Serve "${prefix}" under /${prefix}/ too?\n\nEvery URL of the default language moves (/about becomes /${prefix}/about) and each old URL, lists and tags included, redirects to its new one. The navigation's links to this site are rewritten to match. The site's root then only redirects to /${prefix}.`
        : t`Serve "${prefix}" at the root again?\n\nEvery URL of the default language moves (/${prefix}/about becomes /about) and each old URL, lists, tags and /${prefix} included, redirects to its new one. The navigation's links to this site are rewritten to match.`,
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
      const moved = result.moved;
      notify(
        plural(moved, {
          one: '# URL moved, with a redirect; navigation links rewritten.',
          other:
            '# URLs moved, each with a redirect; navigation links rewritten.',
        }),
      );
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : t`Could not switch.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t`Languages`}
      // Nothing here waits for a Save; the card says so where the button
      // would be (U12).
      footer={
        <p className="text-sm text-muted-foreground">
          <Trans>Applies immediately</Trans>
        </p>
      }
    >
      {/* How addresses carry the language, and the switch that moves every
          one of them: rare, so closed (docs/ADMIN_SIMPLE.md, G16). */}
      <details className="max-w-2xl rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          <Trans>More options</Trans>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {current.prefixDefaultLocale ? (
              <Trans>
                Every language is served under <Code>/&lt;locale&gt;/</Code>,
                the default one too; the site&apos;s root redirects to{' '}
                <Code>/{prefix}</Code>.
              </Trans>
            ) : (
              <Trans>
                The default language has no URL prefix; every other language is
                served under <Code>/&lt;locale&gt;/</Code>.
              </Trans>
            )}
          </p>
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
                <Trans>
                  Prefix the default language too (<Code>/{prefix}/…</Code>)
                </Trans>
              </span>
            </FieldLabel>
          </Field>
        </div>
      </details>
      {/* As wide as the fields above it: one right edge per card (U2). */}
      <ul className="flex max-w-2xl flex-col divide-y rounded-lg border">
        {current.locales.map((locale) => (
          <li
            key={locale}
            className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
          >
            <span>{nameOf(locale)}</span>
            {locale === current.defaultLocale ? (
              <StatusBadge tone="ok">
                <Trans>Default</Trans>
              </StatusBadge>
            ) : (
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void makeDefault(locale)}
                >
                  <Trans>Make default</Trans>
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
                  <Trans>Remove</Trans>
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label={t`Language to add`}
          value={adding}
          onChange={(event) => setAdding(event.currentTarget.value)}
        >
          <NativeSelectOption value="">{t`Choose a language…`}</NativeSelectOption>
          {COMMON_LOCALES.filter((code) => !current.locales.includes(code)).map(
            (code) => (
              <NativeSelectOption key={code} value={code}>
                {nameOf(code)}
              </NativeSelectOption>
            ),
          )}
          <NativeSelectOption value={ANOTHER}>
            {t`Another language…`}
          </NativeSelectOption>
        </NativeSelect>
        {adding === ANOTHER ? (
          <Input
            className="w-32"
            aria-label={t`Language code`}
            placeholder="pt-BR"
            value={typed}
            onInput={(event) => setTyped(event.currentTarget.value)}
          />
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={busy || chosen === ''}
          onClick={() => {
            void setLocales([...current.locales, chosen]);
            setAdding('');
            setTyped('');
          }}
        >
          <Trans>Add language</Trans>
        </Button>
      </div>
    </Section>
  );
}
