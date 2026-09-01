/**
 * The two emails an inquiry produces: the notification to the site owner
 * and the buyer's automatic confirmation (docs/ARCHITECTURE.md §13).
 */

import { escapeHtml } from '../../core/index.js';
import type { EmailMessage } from '../types.js';

/** The fields an accepted inquiry carries into its emails. */
export interface InquiryEmailInput {
  readonly siteName: string;
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly phone: string;
  readonly message: string;
  readonly sourceUrl: string;
  readonly country: string;
  readonly locale: string;
}

/** The owner notification. Reply-To is the buyer, so replying just works. */
export function buildNotification(
  recipient: string,
  input: InquiryEmailInput,
): EmailMessage {
  const lines = [
    ['From', `${input.name} <${input.email}>`],
    ['Company', input.company],
    ['Phone / WhatsApp', input.phone],
    ['Country', input.country],
    ['Page', input.sourceUrl],
  ].filter(([, value]) => value !== '');
  const text = [
    `New inquiry on ${input.siteName}`,
    '',
    ...lines.map(([label, value]) => `${label}: ${value}`),
    '',
    input.message,
  ].join('\n');
  const html = [
    `<h2>New inquiry on ${escapeHtml(input.siteName)}</h2>`,
    '<table>',
    ...lines.map(
      ([label, value]) =>
        `<tr><td><strong>${escapeHtml(label ?? '')}</strong></td><td>${escapeHtml(value ?? '')}</td></tr>`,
    ),
    '</table>',
    `<p>${escapeHtml(input.message).replace(/\n/g, '<br>')}</p>`,
  ].join('\n');
  return {
    to: recipient,
    subject: `New inquiry from ${input.name}`,
    text,
    html,
    replyTo: input.email,
  };
}

interface AutoreplyStrings {
  readonly subject: (site: string) => string;
  readonly body: (name: string, site: string) => string;
}

const AUTOREPLY: Readonly<Record<string, AutoreplyStrings>> = {
  en: {
    subject: (site) => `We received your inquiry — ${site}`,
    body: (name, site) =>
      `Hello ${name},\n\nThank you for contacting ${site}. We received your message and will reply as soon as possible.\n\nThis is an automatic confirmation; you do not need to respond.`,
  },
  zh: {
    subject: (site) => `我们已收到您的询盘 — ${site}`,
    body: (name, site) =>
      `${name} 您好：\n\n感谢您联系 ${site}。我们已收到您的留言，会尽快回复。\n\n这是一封自动确认邮件，无需回复。`,
  },
};

/** Operator overrides, already rendered; empty strings fall back. */
export interface AutoreplyOverride {
  readonly subject: string;
  readonly body: string;
}

/**
 * The buyer's confirmation, in the language they inquired from. A non-empty
 * operator override (a rendered Liquid template) replaces the built-in text.
 */
export function buildAutoreply(
  input: InquiryEmailInput,
  override: AutoreplyOverride = { subject: '', body: '' },
): EmailMessage {
  const strings = AUTOREPLY[input.locale.split('-')[0] ?? ''] ?? AUTOREPLY.en;
  const fallback = AUTOREPLY.en as AutoreplyStrings;
  const chosen = strings ?? fallback;
  const subject =
    override.subject === '' ? chosen.subject(input.siteName) : override.subject;
  const body =
    override.body === ''
      ? chosen.body(input.name, input.siteName)
      : override.body;
  return {
    to: input.email,
    subject,
    text: body,
    html: `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`,
  };
}
