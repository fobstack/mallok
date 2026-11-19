import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { messages as en } from '../../src/admin/locales/en.po';
import { messages as zhCn } from '../../src/admin/locales/zh-CN.po';
import { SERVER_MESSAGES } from '../../src/admin/server-messages.catalog.js';
import { serverMessage } from '../../src/admin/server-messages.js';

/**
 * The Worker's errors in the interface language (docs/ADMIN_I18N_AND_UI.md,
 * D3): a code the admin knows is said in its language, one it does not is
 * left to the Worker's English.
 */

/** Every source file a Worker error can come from, as text. */
function workerSource(): string {
  return ['../../src/worker', '../../src/core', '../../src/plugins']
    .flatMap((directory) => {
      const root = join(import.meta.dirname, directory);
      return readdirSync(root, { recursive: true })
        .map(String)
        .filter((path) => path.endsWith('.ts'))
        .map((path) => readFileSync(join(root, path), 'utf8'));
    })
    .join('\n');
}

describe('serverMessage', () => {
  it('says a known code in English exactly as the Worker does', () => {
    i18n.loadAndActivate({ locale: 'en', messages: en });
    expect(serverMessage('auth.invalid_credentials', undefined)).toBe(
      'Invalid email or password.',
    );
    expect(serverMessage('account.password_short', { min: 12 })).toBe(
      'The new password must be at least 12 characters.',
    );
    // A save's warning is named the same way (`warningCode`).
    expect(serverMessage('content.saved_unrendered', { limitKb: 50 })).toBe(
      "Saved as a draft without rendering: this item's body is over 50 KB, " +
        "long enough that rendering it risks exceeding the Free plan's CPU " +
        'limit. Nothing was lost — shorten it and save again to publish.',
    );
  });

  it('says it in Chinese, with its parameters, when that is the language', () => {
    i18n.loadAndActivate({ locale: 'zh-CN', messages: zhCn });
    expect(serverMessage('auth.invalid_credentials', undefined)).toBe(
      '邮箱或密码不正确。',
    );
    expect(serverMessage('setup.starter_unknown', { starter: 'shop' })).toBe(
      '没有名为“shop”的示例内容。',
    );
  });

  it("leaves a code it does not know, or none, to the Worker's English", () => {
    expect(serverMessage('plugin.shop.out_of_stock', {})).toBeUndefined();
    expect(serverMessage(undefined, undefined)).toBeUndefined();
    expect(serverMessage('toString', undefined)).toBeUndefined();
    expect(serverMessage('Not a code', undefined)).toBeUndefined();
  });

  it('files every sentence under its code', () => {
    for (const [code, descriptor] of Object.entries(SERVER_MESSAGES)) {
      expect(descriptor.id, code).toBe(`server.${code}`);
    }
  });

  it('knows no code the Worker never sends', () => {
    const source = workerSource();
    for (const code of Object.keys(SERVER_MESSAGES)) {
      // A reason given with a suggestion is its code plus `_use`, added
      // where the suggestion is (`slugProblem`).
      const written = code.endsWith('_use') ? code.slice(0, -4) : code;
      expect(
        source.includes(`'${code}'`) || source.includes(`'${written}'`),
        code,
      ).toBe(true);
    }
  });
});
