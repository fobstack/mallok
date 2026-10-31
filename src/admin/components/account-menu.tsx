/**
 * The account menu at the foot of the sidebar, loaded on the first click
 * (`shell.tsx`). It opens as it arrives, since a click is what asked for it.
 */

import { ChevronsUpDown } from 'lucide-react';
import type { JSX } from 'react';
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
import { navigate } from '../router.js';
import { signOut } from '../state.js';
import {
  setThemeMode,
  THEME_MODES,
  type ThemeMode,
  useThemeMode,
} from '../theme-mode.js';

const SCHEME_LABELS: Readonly<Record<ThemeMode, string>> = {
  system: 'Same as the system',
  light: 'Light',
  dark: 'Dark',
};

export function AccountMenu({
  email,
}: {
  readonly email: string;
}): JSX.Element {
  const scheme = useThemeMode();
  return (
    // Not modal: a modal menu marks the rest of the page `aria-hidden` while
    // it is open, which the accessibility gate rightly flags, and a menu has
    // no need to trap the page.
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" aria-label="Account menu">
          <span className="truncate">{email === '' ? 'Account' : email}</span>
          <ChevronsUpDown className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-56">
        <DropdownMenuItem onSelect={() => navigate('/account')}>
          Account and API tokens
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Colour scheme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scheme}
          onValueChange={(value) => setThemeMode(value as ThemeMode)}
        >
          {THEME_MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {SCHEME_LABELS[mode]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
