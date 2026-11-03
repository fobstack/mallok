/**
 * Appearance (docs/ADMIN.md §4.1, §9).
 *
 * There is **no theme list, no upload and no switch button** on this page,
 * and that absence is the design. Switching a theme means editing
 * `ACTIVE_THEME` in the source and deploying; a button here would be a lie
 * (docs/PRODUCT_VISION.md §4).
 */

import { Info } from 'lucide-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { LOCALE_OPTIONS_KEY } from '../../core/constants.js';
import { ApiError } from '../api.js';
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
    resolved[spec.name] = editingDefault
      ? (current.themeOptions[spec.name] ?? spec.field.default)
      : (overrides[editingLocale]?.[spec.name] ??
        current.themeOptions[spec.name] ??
        spec.field.default);
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
      notify(caught instanceof ApiError ? caught.message : 'Could not save.');
    }
  });
  const busy = form.formState.isSubmitting;

  const kinds = Object.entries(active.kinds);

  return (
    <Page>
      <PageHeader
        title="Appearance"
        lede="The options below are runtime settings: saving takes effect without a rebuild. The theme itself is source code."
      />

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
            ['Content types', kinds.map(([kind]) => kind).join(', ')],
            [
              'Client JavaScript',
              active.clientScripts.length === 0 ? (
                <StatusBadge key="scripts" tone="ok">
                  None
                </StatusBadge>
              ) : (
                <StatusBadge key="scripts" tone="warn">
                  Injects {active.clientScripts.length} script
                  {active.clientScripts.length === 1 ? '' : 's'}
                </StatusBadge>
              ),
            ],
            ['Assets', <Code key="assets">{active.assetBase}</Code>],
          ]}
        />
        {active.clientScripts.length === 0 ? null : (
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {active.clientScripts.map((script) => {
              // A theme may list a script as a bare path or with a stated
              // purpose; both are shown verbatim.
              const path = typeof script === 'string' ? script : script.path;
              const purpose = typeof script === 'string' ? '' : script.purpose;
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
      </Section>

      <Alert role="note">
        <Info />
        <AlertTitle role="heading" aria-level={2}>
          Changing the theme takes a deploy
        </AlertTitle>
        <AlertDescription>
          <p>
            Themes live in the source tree, not the database — they are compiled
            into the Worker. To switch, edit <Code>ACTIVE_THEME</Code> in{' '}
            <Code>src/themes/index.ts</Code>, then build and deploy again.
          </p>
          <p>
            Built into this deployment: {active.available.join(', ')}. Your
            content, its ids and every URL stay exactly as they are.
          </p>
        </AlertDescription>
      </Alert>

      {specs.length === 0 ? null : (
        <Section
          as="form"
          title="Theme options"
          onSubmit={(event) => void submit(event)}
          footer={
            <>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save options'}
              </Button>
              {saved ? <SavedNote /> : null}
            </>
          }
        >
          {current.locales.length > 1 ? (
            <Field>
              <FieldLabel htmlFor="theme-editing-locale">Editing</FieldLabel>
              <NativeSelect
                id="theme-editing-locale"
                value={editingLocale}
                onChange={(event) =>
                  setEditingLocale(event.currentTarget.value)
                }
              >
                {current.locales.map((locale) => (
                  <NativeSelectOption key={locale} value={locale}>
                    {locale}
                    {locale === current.defaultLocale ? ' (default)' : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                {editingLocale === current.defaultLocale
                  ? 'These values apply to every language unless a language overrides them below.'
                  : `Values you change here apply only to ${editingLocale}. Anything you leave alone follows the ${current.defaultLocale} value.`}
              </FieldDescription>
            </Field>
          ) : null}
          <SchemaForm specs={specs} control={form.control} idPrefix="theme" />
        </Section>
      )}
    </Page>
  );
}
