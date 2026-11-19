/**
 * Normalisation for the editor's free-text slug field.
 *
 * `saveContent` refuses any slug that `slugify` would change, because an
 * export turns the slug into a directory name. The operator should never meet
 * that refusal: ordinary headings ("ASTM B265") are normalised here, in front
 * of them, before a request is made.
 */

import { t } from '@lingui/core/macro';
import {
  canonicalSlug,
  MAX_SLUG_SEGMENTS,
  slugify,
  slugProblem,
} from '../core/index.js';
import { serverMessage } from './server-messages.js';

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
  // A segment with nothing Latin in it would simply vanish in
  // `canonicalSlug` (`产品/x` to `x`): another address than the one typed.
  // Keep the value and say which segment, as for a one-segment slug.
  const segments = typed.split('/');
  if (segments.length > 1) {
    const lost = segments.findIndex(
      (segment) => segment.trim() !== '' && slugify(segment) === '',
    );
    if (lost !== -1) {
      const position = lost + 1;
      const segment = segments[lost] ?? '';
      return {
        slug: typed,
        usable: false,
        notice: t`Segment ${position} ("${segment}") has no Latin letters or digits to build a folder name from. Write it in Latin characters.`,
      };
    }
  }
  // Several segments, `crypto/crypto-quote`, are normalised one by one.
  const normalized = typed.includes('/')
    ? canonicalSlug(typed)
    : slugify(typed);
  // What normalising cannot fix, the server refuses whatever the spelling:
  // `page/2` is a list's second page. Say so before the request, in its words.
  const refused = normalized === '' ? null : slugProblem(normalized);
  if (refused !== null) {
    return {
      slug: typed,
      usable: false,
      // The core's reason, said as the Worker would say it, in the interface
      // language when the catalog has its code (D3).
      notice: serverMessage(refused.code, refused.params) ?? refused.message,
    };
  }
  if (normalized === typed) {
    return { slug: typed, usable: true, notice: null };
  }
  if (typed.split('/').length > MAX_SLUG_SEGMENTS && normalized !== '') {
    return {
      slug: normalized,
      usable: true,
      notice: t`The slug became "${normalized}": a slug has at most ${MAX_SLUG_SEGMENTS} segments.`,
    };
  }
  if (normalized === '') {
    return {
      slug: typed,
      usable: false,
      notice: t`"${typed}" has no Latin letters or digits to build a slug from. Type one using Latin characters, or clear the field to derive it from the title.`,
    };
  }
  return {
    slug: normalized,
    usable: true,
    notice: t`The slug became "${normalized}", because a slug is also a folder name in an export.`,
  };
}
