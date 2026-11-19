/**
 * The interface-language control for the screens before a session: the
 * sign-in page and the setup wizard (docs/ADMIN_I18N_AND_UI.md, D7). Inside
 * the admin the same choice is in the account menu.
 *
 * A native `<select>`: these screens are on the first load, and a menu
 * component would cost more than the choice is worth.
 */

import { useLingui } from '@lingui/react/macro';
import { Languages } from 'lucide-react';
import type { JSX } from 'react';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  INTERFACE_LANGUAGES,
  type InterfaceLanguage,
  setInterfaceLanguage,
  useInterfaceLanguage,
} from '../i18n.js';

export function LanguagePicker({
  className,
}: {
  readonly className?: string;
}): JSX.Element {
  const language = useInterfaceLanguage();
  const { t } = useLingui();
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <Languages aria-hidden="true" className="size-4 text-muted-foreground" />
      <NativeSelect
        size="sm"
        aria-label={t`Interface language`}
        value={language}
        onChange={(event) =>
          void setInterfaceLanguage(event.target.value as InterfaceLanguage)
        }
      >
        {INTERFACE_LANGUAGES.map((option) => (
          <NativeSelectOption
            key={option.tag}
            value={option.tag}
            lang={option.tag}
          >
            {option.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
