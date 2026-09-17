/**
 * Portable paths used by site exports.
 *
 * An export is produced on one platform and may be unpacked on another. The
 * contract is therefore stricter than either POSIX or Windows alone, and it
 * treats case and canonical-Unicode aliases as the same destination.
 */

const MAX_SEGMENT_BYTES = 240;
const MAX_PATH_BYTES = 1024;
const RESERVED_WINDOWS_NAME =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\..*)?$/i;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasNonPortableCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      '<>:"|?*'.includes(character) ||
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return true;
    }
  }
  return false;
}

/** Returns why a relative export path is unsafe, or `null` when it is safe. */
export function exportPathProblem(path: string): string | null {
  if (path === '') {
    return 'is empty';
  }
  if (path.includes('\\')) {
    return 'contains a backslash';
  }
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) {
    return 'is absolute';
  }
  if (hasNonPortableCharacter(path)) {
    return 'contains a character that is not portable across filesystems';
  }
  if (utf8Length(path) > MAX_PATH_BYTES) {
    return `is longer than ${MAX_PATH_BYTES} UTF-8 bytes`;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '')) {
    return 'contains an empty segment';
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'contains a dot segment';
  }
  if (segments.some((segment) => /[ .]$/.test(segment))) {
    return 'contains a segment with a trailing dot or space';
  }
  if (segments.some((segment) => RESERVED_WINDOWS_NAME.test(segment))) {
    return 'contains a reserved Windows filename';
  }
  if (
    segments.some((segment) =>
      ['__proto__', 'prototype', 'constructor'].includes(segment.toLowerCase()),
    )
  ) {
    return 'contains a reserved archive key';
  }
  if (segments.some((segment) => utf8Length(segment) > MAX_SEGMENT_BYTES)) {
    return `contains a segment longer than ${MAX_SEGMENT_BYTES} UTF-8 bytes`;
  }
  return null;
}

/** Key used to reject case and canonical-Unicode aliases before writing. */
export function exportPathKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}
