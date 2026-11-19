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
 * Widely used languages, offered by name wherever a language is added, so
 * that most sites never type a code; any other code can still be typed
 * (docs/ADMIN_I18N_AND_UI.md, U12 and U16).
 */
export const COMMON_LOCALES: readonly string[] = [
  'en',
  'zh',
  'es',
  'fr',
  'de',
  'ja',
  'ko',
  'pt',
  'ru',
  'ar',
  'it',
  'nl',
  'tr',
  'vi',
  'id',
  'th',
  'pl',
];

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
 * Names the site's content languages for daily screens: the name alone —
 * "English", "中文" — with the code added only to languages whose names
 * would otherwise be the same, and to a code `Intl` cannot name
 * (docs/ADMIN_SIMPLE.md, D8). Settings → General still shows every code.
 */
export function useShortLanguageNames(
  locales: readonly string[],
): (code: string) => string {
  const { i18n } = useLingui();
  const long = useContentLanguageName();
  const names = useMemo(() => {
    let display: Intl.DisplayNames | null = null;
    try {
      display = new Intl.DisplayNames([i18n.locale], { type: 'language' });
    } catch {
      display = null;
    }
    const nameOf = (code: string): string | undefined => {
      try {
        const name = display?.of(code);
        return name === undefined || name.toLowerCase() === code.toLowerCase()
          ? undefined
          : name;
      } catch {
        return undefined;
      }
    };
    const counts = new Map<string, number>();
    for (const code of locales) {
      const name = nameOf(code) ?? code;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return { nameOf, counts };
  }, [i18n.locale, locales]);
  return (code) => {
    const name = names.nameOf(code);
    return name === undefined || (names.counts.get(name) ?? 0) > 1
      ? long(code)
      : name;
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
