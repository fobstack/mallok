/**
 * The account menu at the foot of the sidebar, loaded on the first click
 * (`shell.tsx`). It opens as it arrives, since a click is what asked for it.
 */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { ChevronsUpDown } from 'lucide-react';
import { type JSX, useId } from 'react';
import { useNavigate } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import {
  INTERFACE_LANGUAGES,
  type InterfaceLanguage,
  setInterfaceLanguage,
  useInterfaceLanguage,
} from '../i18n.js';
import { signOut } from '../queries.js';
import {
  setThemeMode,
  THEME_MODES,
  type ThemeMode,
  useThemeMode,
} from '../theme-mode.js';

const SCHEME_LABELS: Readonly<Record<ThemeMode, MessageDescriptor>> = {
  system: msg`Same as the system`,
  light: msg`Light`,
  dark: msg`Dark`,
};

export function AccountMenu({
  email,
}: {
  readonly email: string;
}): JSX.Element {
  const scheme = useThemeMode();
  const language = useInterfaceLanguage();
  const navigate = useNavigate();
  const { t, i18n } = useLingui();
  // The menu holds two radio groups; each is named by its label, so neither a
  // screen reader nor a test has to guess which one a choice belongs to.
  const schemeLabel = useId();
  const languageLabel = useId();
  return (
    // Not modal: a modal menu marks the rest of the page `aria-hidden` while
    // it is open, which the accessibility gate rightly flags, and a menu has
    // no need to trap the page.
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" aria-label={t`Account menu`}>
          <span className="truncate">{email === '' ? t`Account` : email}</span>
          <ChevronsUpDown className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-56">
        <DropdownMenuItem onSelect={() => navigate('/account')}>
          <Trans>Account and API tokens</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel id={schemeLabel}>
          <Trans>Colour scheme</Trans>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-labelledby={schemeLabel}
          value={scheme}
          onValueChange={(value) => setThemeMode(value as ThemeMode)}
        >
          {THEME_MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {i18n._(SCHEME_LABELS[mode])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* Always called this, and each language in its own name; a content
            language is never chosen here (docs/ADMIN_I18N_AND_UI.md, D7). */}
        <DropdownMenuLabel id={languageLabel}>
          <Trans>Interface language</Trans>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-labelledby={languageLabel}
          value={language}
          onValueChange={(value) =>
            void setInterfaceLanguage(value as InterfaceLanguage)
          }
        >
          {INTERFACE_LANGUAGES.map((option) => (
            <DropdownMenuRadioItem
              key={option.tag}
              value={option.tag}
              lang={option.tag}
            >
              {option.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <Trans>Sign out</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
