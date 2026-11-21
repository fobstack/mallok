/**
 * Appearance (docs/ADMIN.md §4.1, §9).
 *
 * There is **no theme list, no upload and no switch button** on this page,
 * and that absence is the design. Switching a theme means editing
 * `ACTIVE_THEME` in the source and deploying; a button here would be a lie
 * (docs/PRODUCT_VISION.md §4).
 */

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Info } from 'lucide-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LOCALE_OPTIONS_KEY } from '../../core/constants.js';
import { readOptionValue } from '../../core/theme-options.js';
import { ApiError } from '../api.js';
import {
  ContentLanguageSelect,
  useContentLanguageName,
} from '../components/content-language.js';
import {
  Code,
  Facts,
  Page,
  PageHeader,
  Section,
  StatusBadge,
} from '../components/page.js';
import { SavedNote } from '../components/saved-note.js';
import { SchemaForm, showServerErrors } from '../form/form.js';
import { optionSpecs } from '../form/types.js';
import { notify } from '../notice.js';
import { saveSettings, useSettings, useTheme } from '../queries.js';

export function AppearancePage(): JSX.Element {
  const active = useTheme();
  const current = useSettings();
  const { t } = useLingui();
  const [editingLocale, setEditingLocale] = useState(current.defaultLocale);
  const [saved, setSaved] = useState(false);

  const specs = optionSpecs(active.options);
  // Options resolve the way the renderer resolves them: the override for the
  // locale being edited, then the site-wide value, then the manifest default
  // (docs/THEME_FORMAT.md §6.1).
  const overrides =
    (current.themeOptions[LOCALE_OPTIONS_KEY] as
      | Record<string, Record<string, unknown>>
      | undefined) ?? {};
  const editingDefault = editingLocale === current.defaultLocale;
  const resolved: FieldValues = {};
  for (const spec of specs) {
    // A list saved as one string, before options could be lists, is shown
    // as the list it meant (docs/ADMIN_SIMPLE.md, D10a).
    resolved[spec.name] = readOptionValue(
      spec.field.type,
      editingDefault
        ? (current.themeOptions[spec.name] ?? spec.field.default)
        : (overrides[editingLocale]?.[spec.name] ??
            current.themeOptions[spec.name] ??
            spec.field.default),
    );
  }
  // `values`, not `defaultValues`: switching the language being edited, or
  // a save coming back, resets the form to what is now stored.
  const form = useForm<FieldValues>({ values: resolved });

  const submit = form.handleSubmit(async (values) => {
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
      setSaved(true);
    } catch (caught) {
      showServerErrors(form.setError, caught);
      notify(caught instanceof ApiError ? caught.message : t`Could not save.`);
    }
  });
  const busy = form.formState.isSubmitting;

  const kinds = Object.entries(active.kinds);
  const listSeparator = t({
    comment: 'Between items of a list',
    message: ', ',
  });
  const scripts = active.clientScripts.length;
  const builtIn = active.available.join(', ');
  const nameOf = useContentLanguageName();
  const editingLanguage = nameOf(editingLocale);
  const defaultLanguage = nameOf(current.defaultLocale);

  return (
    <Page>
      <PageHeader
        title={t`Appearance`}
        lede={t`How your theme looks: these options change the site as soon as you save.`}
      />

      {specs.length === 0 ? null : (
        <Section
          as="form"
          title={t`Theme options`}
          onSubmit={(event) => void submit(event)}
          footer={
            <>
              <Button type="submit" disabled={busy}>
                {busy ? t`Saving…` : t`Save options`}
              </Button>
              {saved ? <SavedNote /> : null}
            </>
          }
        >
          {current.locales.length > 1 ? (
            <ContentLanguageSelect
              id="theme-editing-locale"
              value={editingLocale}
              onChange={setEditingLocale}
              locales={current.locales}
              defaultLocale={current.defaultLocale}
              description={
                editingLocale === current.defaultLocale
                  ? t`These values apply to every language unless a language overrides them below.`
                  : t`Values you change here apply only to ${editingLanguage}. Anything you leave alone follows the ${defaultLanguage} value.`
              }
            />
          ) : null}
          <SchemaForm specs={specs} control={form.control} idPrefix="theme" />
        </Section>
      )}

      <Section
        title={
          <>
            {active.name} <Code>{active.version}</Code>
          </>
        }
        {...(active.description === ''
          ? {}
          : { description: active.description })}
      >
        <Facts
          items={[
            [
              t`Content types`,
              // The theme's names for them, as the content list shows (U4).
              kinds.map(([kind, def]) => def.label ?? kind).join(listSeparator),
            ],
            [
              t`Client JavaScript`,
              scripts === 0 ? (
                <StatusBadge key="scripts" tone="ok">
                  <Trans>None</Trans>
                </StatusBadge>
              ) : (
                <StatusBadge key="scripts" tone="warn">
                  <Plural
                    value={scripts}
                    one="Injects # script"
                    other="Injects # scripts"
                  />
                </StatusBadge>
              ),
            ],
          ]}
        />
      </Section>

      <Alert role="note">
        <Info />
        <AlertTitle role="heading" aria-level={2}>
          <Trans>Changing the theme takes a deploy</Trans>
        </AlertTitle>
        <AlertDescription>
          <p>
            <Trans>
              Whoever deploys the site changes its theme. Your content, its ids
              and every address stay exactly as they are.
            </Trans>
          </p>
        </AlertDescription>
      </Alert>

      {/* Paths and file names, for whoever builds the site; closed, so the
          operator's page reads in their words (ADMIN_SIMPLE.md §6.5). */}
      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
          <Trans>For the person who deploys</Trans>
        </summary>
        <div className="flex flex-col gap-4 border-t px-3 py-3 text-sm">
          <p>
            <Trans>
              Themes live in the source tree, not the database — they are
              compiled into the Worker. To switch, edit{' '}
              <Code>ACTIVE_THEME</Code> in <Code>src/themes/index.ts</Code>,
              then build and deploy again.
            </Trans>
          </p>
          <p>
            <Trans>Built into this deployment: {builtIn}.</Trans>
          </p>
          <Facts
            items={[[t`Assets`, <Code key="assets">{active.assetBase}</Code>]]}
          />
          {active.clientScripts.length === 0 ? null : (
            <ul className="flex flex-col divide-y rounded-lg border text-sm">
              {active.clientScripts.map((script) => {
                // A theme may list a script as a bare path or with a stated
                // purpose; both are shown verbatim.
                const path = typeof script === 'string' ? script : script.path;
                const purpose =
                  typeof script === 'string' ? '' : script.purpose;
                return (
                  <li
                    key={path}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2"
                  >
                    <Code>{path}</Code>
                    <span className="text-muted-foreground">{purpose}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </Page>
  );
}
