/**
 * Serialising a `HeadDescriptor` into markup.
 *
 * Pages describe the head as data and never write tags themselves, so the
 * escaping lives here in one place. JSON-LD gets the stricter treatment: a
 * `<` inside a JSON string would otherwise end the script element early, so
 * it is escaped as `<` the way every serialiser that has been burned by
 * this does it.
 */

import type { HeadDescriptor } from './types.js';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for an attribute value or a text node. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] as string);
}

/** Escapes a JSON payload so it cannot break out of a `<script>` element. */
export function escapeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function attributes(pairs: Readonly<Record<string, string>>): string {
  return Object.entries(pairs)
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(' ');
}

/** Renders the head tags a page described, in a stable order. */
export function renderHead(head: HeadDescriptor): string {
  const lines: string[] = [];
  if (head.title !== undefined) {
    lines.push(`<title>${escapeHtml(head.title)}</title>`);
  }
  if (head.description !== undefined) {
    lines.push(
      `<meta name="description" content="${escapeHtml(head.description)}">`,
    );
  }
  if (head.canonical !== undefined) {
    lines.push(`<link rel="canonical" href="${escapeHtml(head.canonical)}">`);
  }
  for (const [locale, href] of Object.entries(head.alternates ?? {})) {
    lines.push(
      `<link rel="alternate" hreflang="${escapeHtml(locale)}" href="${escapeHtml(href)}">`,
    );
  }
  for (const [name, content] of Object.entries(head.meta ?? {})) {
    lines.push(
      `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`,
    );
  }
  for (const [property, content] of Object.entries(head.property ?? {})) {
    lines.push(
      `<meta property="${escapeHtml(property)}" content="${escapeHtml(content)}">`,
    );
  }
  for (const link of head.links ?? []) {
    lines.push(`<link ${attributes(link)}>`);
  }
  for (const block of head.jsonLd ?? []) {
    lines.push(
      `<script type="application/ld+json">${escapeJson(block)}</script>`,
    );
  }
  return lines.join('\n');
}
