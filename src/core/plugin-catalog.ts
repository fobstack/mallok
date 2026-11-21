/**
 * Admin catalogs for plugins (docs/PLUGIN_API.md §7.8,
 * docs/ADMIN_I18N_AND_UI.md D5): what a plugin declares for the operator —
 * its settings, secrets, panels, columns, actions and fields — in the
 * operator's language.
 *
 * The same idea as a theme's (`admin-catalog.ts`): a flat map from where a
 * word is declared to that word in one interface language, laid over the
 * manifest the admin is served. A missing key keeps the declared English.
 * Plugin panels never reach a visitor, so unlike a theme there is no
 * untranslated copy to keep for a preview.
 */

import type { AdminCatalog } from './admin-catalog.js';
import type { PluginManifest as Declared } from './plugin.js';

/**
 * A manifest as callers hold it: deeply read-only, as `MallokPlugin` keeps
 * it. Nothing here changes one.
 */
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/** A plugin manifest, read-only. */
export type PluginManifest = DeepReadonly<Declared>;

/** A field declaration's words: what a catalog may replace on it. */
interface Worded {
  readonly label?: string | undefined;
  readonly help?: string | undefined;
}

/**
 * Which catalog keys this manifest allows. A key outside it — a typo, or a
 * declaration the plugin no longer has — is refused when the plugin is
 * defined, so it cannot leave a label silently in English.
 *
 * `panels.<panel>.values.<field>.<value>` names the words for a value a
 * `badge` column shows (`new`, `replied`); the values themselves are data,
 * so any value of a badge column is allowed.
 */
export function pluginCatalogAllows(
  manifest: PluginManifest,
): (key: string) => boolean {
  const keys = new Set<string>(['name', 'description']);
  const fieldKeys = (prefix: string, field: Worded): void => {
    keys.add(`${prefix}.label`);
    if (field.help !== undefined) {
      keys.add(`${prefix}.help`);
    }
  };
  for (const [name, setting] of Object.entries(manifest.settings)) {
    fieldKeys(`settings.${name}`, setting);
    if (setting.group !== undefined) {
      keys.add(`groups.${setting.group}`);
    }
  }
  for (const name of Object.keys(manifest.secrets)) {
    keys.add(`secrets.${name}.label`);
  }
  for (const script of manifest.clientScripts) {
    keys.add(`scripts.${script.src}.purpose`);
  }
  const badges = new Set<string>();
  for (const panel of manifest.panels) {
    const p = `panels.${panel.id}`;
    keys.add(`${p}.label`);
    // What the panel says while it has no rows: where they come from
    // (docs/ADMIN_SIMPLE.md §6.3). Words only, so the catalog's alone.
    keys.add(`${p}.empty`);
    for (const column of panel.columns) {
      keys.add(`${p}.columns.${column.field}`);
      if (column.type === 'badge') {
        badges.add(`${p}.values.${column.field}.`);
      }
    }
    // A field's own name, wherever the panel shows one rather than a
    // column label: a filter, the detail view, the search box.
    for (const field of [
      ...panel.columns.map((column) => column.field),
      ...panel.filters,
      ...panel.detail,
      ...panel.search,
    ]) {
      keys.add(`${p}.names.${field}`);
    }
    for (const [name, field] of Object.entries(panel.fields ?? {})) {
      fieldKeys(`${p}.fields.${name}`, field);
      if (field.group !== undefined) {
        keys.add(`${p}.groups.${field.group}`);
      }
      if (field.type === 'rows') {
        for (const [inner, innerField] of Object.entries(field.fields)) {
          fieldKeys(`${p}.fields.${name}.fields.${inner}`, innerField);
        }
      }
    }
    for (const action of panel.actions) {
      keys.add(`${p}.actions.${action.id}.label`);
      for (const [name, field] of Object.entries(action.params ?? {})) {
        fieldKeys(`${p}.actions.${action.id}.params.${name}`, field);
      }
    }
    for (const related of panel.related) {
      keys.add(`${p}.related.${related.id}.label`);
      for (const column of related.columns) {
        keys.add(`${p}.related.${related.id}.columns.${column.field}`);
        if (column.type === 'badge') {
          badges.add(`${p}.values.${column.field}.`);
        }
      }
    }
  }
  return (key) =>
    keys.has(key) ||
    [...badges].some(
      (prefix) => key.startsWith(prefix) && key.length > prefix.length,
    );
}

/**
 * The words a panel shows that are not declared as labels at all: what a
 * filter, a detail row or a search field is called (`names`), what a badge
 * value reads as (`values`), and what the panel says while it has no rows
 * (`empty`). Empty maps, and no `empty`, when the catalog has none.
 */
export interface PanelWords {
  readonly names: Readonly<Record<string, string>>;
  readonly values: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly empty?: string;
}

/** {@link PanelWords} for one panel, out of a catalog. */
export function panelWords(panelId: string, catalog: AdminCatalog): PanelWords {
  const names: Record<string, string> = {};
  const values: Record<string, Record<string, string>> = {};
  const namesPrefix = `panels.${panelId}.names.`;
  const valuesPrefix = `panels.${panelId}.values.`;
  const empty = catalog[`panels.${panelId}.empty`];
  for (const [key, text] of Object.entries(catalog)) {
    if (text === '') {
      continue;
    }
    if (key.startsWith(namesPrefix)) {
      names[key.slice(namesPrefix.length)] = text;
    } else if (key.startsWith(valuesPrefix)) {
      const rest = key.slice(valuesPrefix.length);
      const dot = rest.indexOf('.');
      if (dot > 0) {
        const field = rest.slice(0, dot);
        values[field] = { ...values[field], [rest.slice(dot + 1)]: text };
      }
    }
  }
  return {
    names,
    values,
    ...(empty === undefined || empty === '' ? {} : { empty }),
  };
}

/**
 * The manifest with every declaration the catalog names in its language.
 * Only words change: ids, types, tables, choices and currencies are as
 * declared, so nothing that validates or stores a value reads differently.
 */
export function localizePluginManifest(
  manifest: PluginManifest,
  catalog: AdminCatalog,
): PluginManifest {
  if (Object.keys(catalog).length === 0) {
    return manifest;
  }
  const say = (key: string, declared: string): string =>
    catalog[key] === undefined || catalog[key] === '' ? declared : catalog[key];
  const sayOptional = (
    key: string,
    declared: string | undefined,
  ): string | undefined =>
    catalog[key] === undefined || catalog[key] === '' ? declared : catalog[key];
  /** A field's label and help; a `group` too, when `groups` names one. */
  const word = <F extends Worded & { readonly group?: string | undefined }>(
    prefix: string,
    field: F,
    groups?: string,
  ): F => {
    const label = sayOptional(`${prefix}.label`, field.label);
    const help = sayOptional(`${prefix}.help`, field.help);
    const group =
      groups === undefined || field.group === undefined
        ? undefined
        : say(`${groups}.${field.group}`, field.group);
    return {
      ...field,
      ...(label === undefined ? {} : { label }),
      ...(help === undefined ? {} : { help }),
      ...(group === undefined ? {} : { group }),
    };
  };

  const description = sayOptional('description', manifest.description);
  return {
    ...manifest,
    name: say('name', manifest.name),
    ...(description === undefined ? {} : { description }),
    settings: Object.fromEntries(
      Object.entries(manifest.settings).map(([name, setting]) => [
        name,
        word(`settings.${name}`, setting, 'groups'),
      ]),
    ),
    secrets: Object.fromEntries(
      Object.entries(manifest.secrets).map(([name, secret]) => [
        name,
        { ...secret, label: say(`secrets.${name}.label`, secret.label) },
      ]),
    ),
    clientScripts: manifest.clientScripts.map((script) => ({
      ...script,
      purpose: say(`scripts.${script.src}.purpose`, script.purpose),
    })),
    panels: manifest.panels.map((panel) => {
      const p = `panels.${panel.id}`;
      const fields =
        panel.fields === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(panel.fields).map(([name, field]) => {
                const worded = word(
                  `${p}.fields.${name}`,
                  field,
                  `${p}.groups`,
                );
                if (worded.type !== 'rows') {
                  return [name, worded];
                }
                return [
                  name,
                  {
                    ...worded,
                    fields: Object.fromEntries(
                      Object.entries(worded.fields).map(([inner, f]) => [
                        inner,
                        word(`${p}.fields.${name}.fields.${inner}`, f),
                      ]),
                    ),
                  },
                ];
              }),
            );
      return {
        ...panel,
        label: say(`${p}.label`, panel.label),
        columns: panel.columns.map((column) => ({
          ...column,
          label: say(`${p}.columns.${column.field}`, column.label),
        })),
        ...(fields === undefined ? {} : { fields }),
        actions: panel.actions.map((action) => {
          const a = `${p}.actions.${action.id}`;
          return {
            ...action,
            label: say(`${a}.label`, action.label),
            ...(action.params === undefined
              ? {}
              : {
                  params: Object.fromEntries(
                    Object.entries(action.params).map(([name, field]) => [
                      name,
                      word(`${a}.params.${name}`, field),
                    ]),
                  ),
                }),
          };
        }),
        related: panel.related.map((related) => {
          const r = `${p}.related.${related.id}`;
          return {
            ...related,
            label: say(`${r}.label`, related.label),
            columns: related.columns.map((column) => ({
              ...column,
              label: say(`${r}.columns.${column.field}`, column.label),
            })),
          };
        }),
      };
    }),
  };
}
