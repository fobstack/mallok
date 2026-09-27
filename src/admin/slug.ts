/**
 * Normalisation for the editor's free-text slug field.
 *
 * `saveContent` refuses any slug that `slugify` would change, because an
 * export turns the slug into a directory name. The operator should never meet
 * that refusal: ordinary headings ("ASTM B265") are normalised here, in front
 * of them, before a request is made.
 */

import { slugify } from '../core/index.js';

/**
 * What the slug field should hold, and what to tell the operator.
 *
 * A value that cannot be used always carries a message: the operator has to be
 * told something, and the type is what guarantees it.
 */
export type SlugNormalization =
  | {
      /** The canonical value the field should hold. */
      readonly slug: string;
      readonly usable: true;
      /** Message for the operator, or `null` when nothing changed. */
      readonly notice: string | null;
    }
  | {
      /** The typed value, kept so it is not erased in front of the operator. */
      readonly slug: string;
      readonly usable: false;
      readonly notice: string;
    };

/** Canonicalises a typed slug, or explains why it cannot be one. */
export function normalizeSlugInput(typed: string): SlugNormalization {
  // Empty is meaningful: the server derives the slug from the title.
  if (typed === '') {
    return { slug: '', usable: true, notice: null };
  }
  const normalized = slugify(typed);
  if (normalized === typed) {
    return { slug: typed, usable: true, notice: null };
  }
  if (normalized === '') {
    return {
      slug: typed,
      usable: false,
      notice: `"${typed}" has no Latin letters or digits to build a slug from. Type one using Latin characters, or clear the field to derive it from the title.`,
    };
  }
  return {
    slug: normalized,
    usable: true,
    notice: `The slug became "${normalized}", because a slug is also a folder name in an export.`,
  };
}
