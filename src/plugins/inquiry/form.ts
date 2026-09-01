/**
 * The inquiry form markup that `afterRender` swaps in for the
 * `<p>[[inquiry]]</p>` marker (docs/ARCHITECTURE.md §13).
 *
 * Injection happens at stage two because stage one's sanitizer strips
 * `<form>` from content on purpose: content is untrusted, the form is not —
 * it comes from this trusted plugin, not from Markdown.
 */

import { escapeHtml } from '../../core/index.js';

/** The exact paragraph an author writes to place the form. */
export const INQUIRY_MARKER = '<p>[[inquiry]]</p>';

/** Labels the form renders, per language. */
interface FormStrings {
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly phone: string;
  readonly message: string;
  readonly submit: string;
}

const STRINGS: Readonly<Record<string, FormStrings>> = {
  en: {
    name: 'Your name',
    email: 'Email',
    company: 'Company',
    phone: 'Phone / WhatsApp',
    message: 'Message',
    submit: 'Send inquiry',
  },
  zh: {
    name: '姓名',
    email: '邮箱',
    company: '公司',
    phone: '电话 / WhatsApp',
    message: '留言',
    submit: '发送询盘',
  },
};

/** Inputs of {@link buildInquiryForm}. */
export interface InquiryFormInput {
  readonly locale: string;
  readonly path: string;
  readonly contentId: string | null;
  /** Turnstile site key; empty renders the form without the widget. */
  readonly sitekey: string;
}

/** Builds the form HTML. Pure; safe to cache with the page. */
export function buildInquiryForm(input: InquiryFormInput): string {
  const strings = STRINGS[input.locale.split('-')[0] ?? ''] ?? STRINGS.en;
  if (strings === undefined) {
    return '';
  }
  const turnstile =
    input.sitekey === ''
      ? ''
      : `    <div class="cf-turnstile" data-sitekey="${escapeHtml(input.sitekey)}"></div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
`;
  return `<form class="mallok-inquiry" method="post" action="/_mallok/p/inquiry/submit">
  <input type="hidden" name="content_id" value="${escapeHtml(input.contentId ?? '')}">
  <input type="hidden" name="locale" value="${escapeHtml(input.locale)}">
  <input type="hidden" name="source_path" value="${escapeHtml(input.path)}">
  <p class="mallok-inquiry-trap" aria-hidden="true" style="position:absolute;left:-9999px;top:auto;height:1px;overflow:hidden">
    <label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
  </p>
  <p><label>${escapeHtml(strings.name)}<br><input type="text" name="name" required maxlength="200" autocomplete="name"></label></p>
  <p><label>${escapeHtml(strings.email)}<br><input type="email" name="email" required maxlength="320" autocomplete="email"></label></p>
  <p><label>${escapeHtml(strings.company)}<br><input type="text" name="company" maxlength="200" autocomplete="organization"></label></p>
  <p><label>${escapeHtml(strings.phone)}<br><input type="text" name="phone" maxlength="60" autocomplete="tel"></label></p>
  <p><label>${escapeHtml(strings.message)}<br><textarea name="message" required rows="6" maxlength="5000"></textarea></label></p>
${turnstile}  <p><button type="submit">${escapeHtml(strings.submit)}</button></p>
</form>`;
}
