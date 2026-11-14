/**
 * Where the shell's toasts render, loaded with the first one
 * (docs/ADMIN_MIGRATION.md §8): most sessions report no failure, and the
 * toast library is not worth its weight on every first load.
 */

import { useLingui } from '@lingui/react/macro';
import type { JSX } from 'react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';

export function ToastHost({
  message,
  onShown,
}: {
  readonly message: string;
  readonly onShown: () => void;
}): JSX.Element {
  const { t } = useLingui();
  // The Toaster below is a child, so its effects — subscribing to toasts —
  // have run by the time this one shows the message.
  useEffect(() => {
    if (message !== '') {
      toast.error(message);
      onShown();
    }
  }, [message, onShown]);
  // Sonner adds its keyboard shortcut after this label.
  return (
    <Toaster position="bottom-right" containerAriaLabel={t`Notifications`} />
  );
}
