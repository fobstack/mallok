/**
 * Theme option values written before options could be lists.
 *
 * Until theme API 1 allowed `string[]` and `keyvalue` options, a theme took
 * a list as one string with a syntax of its own: `a, b, c`, or
 * `value|label ;; value|label` (docs/ADMIN_SIMPLE.md, G14 and D10a). A site
 * that saved such a string keeps it in `site.theme_options`; these read it
 * as the list it meant, so the page renders as it did and the admin's form
 * shows the list. Dependency-free, so the admin can use it without the core
 * barrel (docs/ADMIN.md §13).
 */

/** `"a, b, c"` as `["a", "b", "c"]`; an empty item is dropped. */
export function legacyOptionList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * `"Bar|Precision stock ;; Plate|Versatile formats"` as
 * `{ Bar: "Precision stock", Plate: "Versatile formats" }`. A pair with no
 * key is dropped; a second `|` stays in the value.
 */
export function legacyOptionPairs(value: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const entry of value.split(';;')) {
    const [key = '', ...rest] = entry.split('|');
    if (key.trim() !== '') {
      pairs[key.trim()] = rest.join('|').trim();
    }
  }
  return pairs;
}

/**
 * An option's stored value in the shape its declared type expects: a string
 * saved for a `string[]` or `keyvalue` option is read as the list it meant;
 * anything else is returned as it is.
 */
export function readOptionValue(type: string, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (type === 'string[]') {
    return legacyOptionList(value);
  }
  if (type === 'keyvalue') {
    return legacyOptionPairs(value);
  }
  return value;
}
