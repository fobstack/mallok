/**
 * A short row of choices that narrows a list — All, Published, Drafts — as
 * the tabs mainstream admins put above a table (docs/ADMIN_SIMPLE.md, D2
 * and §6.3). Each is a toggle button: one is pressed, and choosing another
 * filters the list below it, which is not what an ARIA tab panel does.
 */

import { cn } from 'cn';
import type { JSX } from 'react';

/** A choice and the words that name it. */
export interface FilterTab {
  readonly value: string;
  readonly label: string;
}

export function FilterTabs({
  label,
  tabs,
  value,
  onChange,
  className,
}: {
  /** What the choices are of, for assistive technology: "Status". */
  readonly label: string;
  readonly tabs: readonly FilterTab[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly className?: string;
}): JSX.Element {
  return (
    <fieldset
      aria-label={label}
      className={cn(
        'm-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0',
        className,
      )}
    >
      {tabs.map((tab) => {
        const pressed = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(tab.value)}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              pressed
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </fieldset>
  );
}
