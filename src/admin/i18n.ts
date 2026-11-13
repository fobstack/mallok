/**
 * The interface language (docs/ADMIN_I18N_AND_UI.md, D2 and D7).
 *
 * The interface language is the language the admin speaks to its operator.
 * It is not a content language: the two never default from each other, and
 * a site's content languages are whatever codes the site declares.
 *
 * The choice is kept in this browser, like the colour scheme. Without one,
 * the first of the browser's languages the admin has a catalog for is used,
 * and English otherwise. It is resolved and its catalog loaded before the
 * first render, so the admin never paints in the wrong language.
 */

import { i18n, type Messages } from '@lingui/core';
import { useSyncExternalStore } from 'react';

/** An interface language the admin has a catalog for. */
export type InterfaceLanguage = 'en' | 'zh-CN';

/** Each interface language, named in itself (D7, rule 2). */
export const INTERFACE_LANGUAGES: readonly {
  readonly tag: InterfaceLanguage;
  readonly name: string;
}[] = [
  { tag: 'en', name: 'English' },
  { tag: 'zh-CN', name: '简体中文' },
];

const STORAGE_KEY = 'mallok-admin-language';

/**
 * Each catalog is its own chunk, fetched when its language is first needed;
 * the first load carries no catalog at all.
 */
const CATALOGS: Readonly<
  Record<InterfaceLanguage, () => Promise<{ readonly messages: Messages }>>
> = {
  en: () => import('./locales/en.po'),
  'zh-CN': () => import('./locales/zh-CN.po'),
};

function isInterfaceLanguage(value: unknown): value is InterfaceLanguage {
  return INTERFACE_LANGUAGES.some((language) => language.tag === value);
}

/**
 * The best interface language for a list of BCP 47 tags, most preferred
 * first: an exact match, then a match on the primary language alone
 * (`zh-Hans-CN` and `zh` both find `zh-CN`). `undefined` when none matches.
 */
export function matchInterfaceLanguage(
  wanted: readonly string[],
): InterfaceLanguage | undefined {
  for (const tag of wanted) {
    const exact = INTERFACE_LANGUAGES.find(
      (language) => language.tag.toLowerCase() === tag.toLowerCase(),
    );
    if (exact !== undefined) {
      return exact.tag;
    }
    const primary = tag.split('-')[0]?.toLowerCase();
    const near = INTERFACE_LANGUAGES.find(
      (language) => language.tag.split('-')[0]?.toLowerCase() === primary,
    );
    if (near !== undefined) {
      return near.tag;
    }
  }
  return undefined;
}

function stored(): InterfaceLanguage | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isInterfaceLanguage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The language to start in: the stored choice, the browser's, English. */
function initialLanguage(): InterfaceLanguage {
  return stored() ?? matchInterfaceLanguage(window.navigator.languages) ?? 'en';
}

const listeners = new Set<() => void>();

async function activate(language: InterfaceLanguage): Promise<void> {
  const { messages } = await CATALOGS[language]();
  i18n.load(language, messages);
  i18n.activate(language);
  // What lets a browser choose a Simplified Chinese face for Han characters,
  // and what a screen reader pronounces the page in (§5.5).
  document.documentElement.lang = language;
  for (const listener of listeners) {
    listener();
  }
}

/** Resolves the interface language and loads its catalog; before rendering. */
export function startInterfaceLanguage(): Promise<void> {
  return activate(initialLanguage());
}

/**
 * Switches the interface language in place and remembers it in this
 * browser. Nothing is reloaded, so nothing typed into a form is lost.
 */
export async function setInterfaceLanguage(
  language: InterfaceLanguage,
): Promise<void> {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not remembered; it still applies to this page.
  }
  await activate(language);
}

/** The current interface language, re-rendering when it changes. */
export function useInterfaceLanguage(): InterfaceLanguage {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (isInterfaceLanguage(i18n.locale) ? i18n.locale : 'en'),
  );
}
