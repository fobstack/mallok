/**
 * The language of *content*, chosen and named the same way everywhere
 * (docs/ADMIN_I18N_AND_UI.md, U10).
 *
 * A site's content languages are whatever codes it declares (`zh`, `de`).
 * Each is shown by its name in the interface language with its code beside
 * it — "Chinese (zh)", "中文（zh）" — and the control that picks one is
 * always called "Content language". That is also what keeps it apart from
 * the interface language, which is chosen in the account menu (D7).
 */

import { Trans, useLingui } from '@lingui/react/macro';
import type { JSX } from 'react';
import { useMemo } from 'react';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

/**
 * Names a content language in the interface language, with its code:
 * "Chinese (zh)". A code `Intl` cannot name is shown as itself.
 */
export function useContentLanguageName(): (code: string) => string {
  const { t, i18n } = useLingui();
  // One formatter per interface language, not one per render: a list names
  // a language on every row.
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([i18n.locale], { type: 'language' });
    } catch {
      return null;
    }
  }, [i18n.locale]);
  return (code) => {
    let name: string | undefined;
    try {
      name = names?.of(code);
    } catch {
      name = undefined;
    }
    return name === undefined || name.toLowerCase() === code.toLowerCase()
      ? code
      : t`${name} (${code})`;
  };
}

/**
 * The options of a content-language select, named, without the select: for
 * a control that labels itself differently or picks more than one.
 */
export function ContentLanguageOptions({
  locales,
  defaultLocale,
  allowAll,
}: {
  readonly locales: readonly string[];
  /** Marked as the default, when it is among `locales`. */
  readonly defaultLocale?: string;
  /** An "All" option, with the value `''`. */
  readonly allowAll?: boolean;
}): JSX.Element {
  const { t } = useLingui();
  const nameOf = useContentLanguageName();
  return (
    <>
      {allowAll === true ? (
        <NativeSelectOption value="">{t`All`}</NativeSelectOption>
      ) : null}
      {locales.map((locale) => {
        const language = nameOf(locale);
        return (
          <NativeSelectOption key={locale} value={locale}>
            {locale === defaultLocale ? t`${language}, default` : language}
          </NativeSelectOption>
        );
      })}
    </>
  );
}

/** A select of the site's content languages, labelled as such. */
export function ContentLanguageSelect({
  id,
  value,
  onChange,
  locales,
  defaultLocale,
  description,
  allowAll,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (locale: string) => void;
  readonly locales: readonly string[];
  /** Marked as the default, when it is among `locales`. */
  readonly defaultLocale?: string;
  /** What choosing one does here: filter, edit, or pick a further language. */
  readonly description?: string;
  /** An "All" option, with the value `''`. */
  readonly allowAll?: boolean;
}): JSX.Element {
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={id}>
        <Trans>Content language</Trans>
      </FieldLabel>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <ContentLanguageOptions
          locales={locales}
          {...(defaultLocale === undefined ? {} : { defaultLocale })}
          {...(allowAll === undefined ? {} : { allowAll })}
        />
      </NativeSelect>
      {description === undefined ? null : (
        <FieldDescription>{description}</FieldDescription>
      )}
    </Field>
  );
}
