/**
 * A password field whose text can be shown (docs/ADMIN_I18N_AND_UI.md, U17).
 *
 * The wizard asks for its password once, with no second field to confirm
 * it, so the person typing it needs a way to read back what they typed.
 */

import { useLingui } from '@lingui/react/macro';
import { cn } from 'cn';
import { Eye, EyeOff } from 'lucide-react';
import type { ComponentProps, JSX } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** An `Input` of type password, with a toggle that shows its text. */
export function PasswordInput(
  props: Omit<ComponentProps<typeof Input>, 'type'>,
): JSX.Element {
  const { t } = useLingui();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        className={cn('pr-9', props.className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground"
        // One name, its state said by `aria-pressed`, so a screen reader
        // hears "Show password, pressed" rather than a label that flips.
        aria-label={t`Show password`}
        aria-pressed={shown}
        {...(props.id === undefined ? {} : { 'aria-controls': props.id })}
        onClick={() => setShown((current) => !current)}
      >
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}
