/**
 * Admin catalogs: what a theme declares for the operator, in the operator's
 * language (docs/ADMIN_I18N_AND_UI.md, D4; docs/THEME_FORMAT.md §10.1).
 *
 * A theme declares its kinds, fields and options in English in `theme.json`.
 * An optional `admin/<ui-locale>.json` beside it is a flat map from a
 * declaration's path to its words in one interface language. The Worker lays
 * the best match over the manifest it serves to the admin; a key the catalog
 * lacks keeps the declared English, and a theme without catalogs is shown
 * exactly as declared.
 *
 * These are interface languages (`zh-CN`), not the content languages of
 * `locales/<locale>.json` (`zh`): the operator's language, not the reader's.
 */

import type { ThemeManifest } from './theme.js';

/** Where a theme keeps its admin catalogs: `admin/zh-CN.json`. */
export const ADMIN_CATALOG_PATH =
  /^admin\/([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.json$/;

/** One admin catalog: declaration path to text. */
export type AdminCatalog = Readonly<Record<string, string>>;

/**
 * Every key a catalog for this manifest may define, with the English it
 * replaces. A catalog key outside this set is a mistake — a typo, or a field
 * the theme no longer declares — and is refused at build time.
 */
export function themeCatalogKeys(
  manifest: ThemeManifest,
): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  keys.set('name', manifest.name);
  if (manifest.description !== undefined) {
    keys.set('description', manifest.description);
  }
  for (const [kind, declared] of Object.entries(manifest.kinds)) {
    keys.set(`kinds.${kind}.label`, declared.label ?? kind);
    for (const [name, field] of Object.entries(declared.fields ?? {})) {
      keys.set(`kinds.${kind}.fields.${name}.label`, field.label ?? name);
      if (field.help !== undefined) {
        keys.set(`kinds.${kind}.fields.${name}.help`, field.help);
      }
      if (field.group !== undefined) {
        // A group is named once, wherever its fields are declared.
        keys.set(`groups.${field.group}`, field.group);
      }
    }
  }
  for (const [name, option] of Object.entries(manifest.options)) {
    keys.set(`options.${name}.label`, option.label);
  }
  for (const script of manifest.clientScripts) {
    if (typeof script !== 'string') {
      keys.set(`scripts.${script.path}.purpose`, script.purpose);
    }
  }
  return keys;
}

/**
 * Why a catalog cannot be used, or `null` when it can: it must be a JSON
 * object of strings, every key one `themeCatalogKeys` names.
 */
export function adminCatalogProblem(
  text: string,
  keys: ReadonlyMap<string, string>,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'is not valid JSON';
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'must be a JSON object';
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      return `gives "${key}" a value that is not a string`;
    }
    if (!keys.has(key)) {
      return `names "${key}", which the manifest does not declare`;
    }
  }
  return null;
}

/** The interface language an admin catalog path is for, or `undefined`. */
export function adminCatalogLanguage(path: string): string | undefined {
  return ADMIN_CATALOG_PATH.exec(path)?.[1];
}

/**
 * The catalog for the first of `wanted` (most preferred first) that the
 * files have one for: an exact tag, then the same primary language
 * (`zh-Hans-CN` and `zh` find `admin/zh-CN.json`). Empty when none matches,
 * which leaves every declaration in English.
 */
export function pickAdminCatalog(
  files: Readonly<Record<string, string>>,
  wanted: readonly string[],
): AdminCatalog {
  const available = Object.keys(files)
    .map((path) => ({ path, tag: adminCatalogLanguage(path) }))
    .filter(
      (entry): entry is { path: string; tag: string } =>
        entry.tag !== undefined,
    );
  for (const tag of wanted) {
    const lower = tag.toLowerCase();
    const primary = lower.split('-')[0];
    const match =
      available.find((entry) => entry.tag.toLowerCase() === lower) ??
      available.find(
        (entry) => entry.tag.toLowerCase().split('-')[0] === primary,
      );
    if (match !== undefined) {
      return readCatalog(files[match.path]);
    }
  }
  return {};
}

function readCatalog(text: string | undefined): AdminCatalog {
  if (text === undefined) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

/**
 * The manifest with every declaration the catalog names in its language.
 * Only words change: ids, types, layouts and choices are as declared, so
 * nothing that renders a page or validates a value reads differently.
 */
export function localizeThemeManifest(
  manifest: ThemeManifest,
  catalog: AdminCatalog,
): ThemeManifest {
  if (Object.keys(catalog).length === 0) {
    return manifest;
  }
  const say = (key: string, declared: string): string =>
    catalog[key] === undefined || catalog[key] === '' ? declared : catalog[key];
  // A label a theme left out — a kind called by its name — can still be
  // given one by a catalog; `themeCatalogKeys` lists those keys too.
  const sayOptional = (
    key: string,
    declared: string | undefined,
  ): string | undefined =>
    catalog[key] === undefined || catalog[key] === '' ? declared : catalog[key];

  const kinds = Object.fromEntries(
    Object.entries(manifest.kinds).map(([kind, declared]) => {
      const fields =
        declared.fields === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(declared.fields).map(([name, field]) => {
                const prefix = `kinds.${kind}.fields.${name}`;
                const label = sayOptional(`${prefix}.label`, field.label);
                const help = sayOptional(`${prefix}.help`, field.help);
                const group =
                  field.group === undefined
                    ? undefined
                    : say(`groups.${field.group}`, field.group);
                return [
                  name,
                  {
                    ...field,
                    ...(label === undefined ? {} : { label }),
                    ...(help === undefined ? {} : { help }),
                    ...(group === undefined ? {} : { group }),
                  },
                ];
              }),
            );
      const label = sayOptional(`kinds.${kind}.label`, declared.label);
      return [
        kind,
        {
          ...declared,
          ...(label === undefined ? {} : { label }),
          ...(fields === undefined ? {} : { fields }),
        },
      ];
    }),
  );
  const options = Object.fromEntries(
    Object.entries(manifest.options).map(([name, option]) => [
      name,
      { ...option, label: say(`options.${name}.label`, option.label) },
    ]),
  );
  const clientScripts = manifest.clientScripts.map((script) =>
    typeof script === 'string'
      ? script
      : {
          ...script,
          purpose: say(`scripts.${script.path}.purpose`, script.purpose),
        },
  );
  const description = sayOptional('description', manifest.description);
  return {
    ...manifest,
    name: say('name', manifest.name),
    ...(description === undefined ? {} : { description }),
    kinds,
    options,
    clientScripts,
  };
}
