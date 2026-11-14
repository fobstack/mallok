/**
 * The pieces every admin page is built from: a header, sections and status
 * badges, on shadcn/ui's card and badge (docs/ADMIN_MIGRATION.md, phase 3).
 *
 * Kept in one place so that the pages say what they show, not how it is
 * spaced, and so that a page heading is always an `h1` and a section's an
 * `h2` — the browser tests and screen readers find them by role.
 */

import { cn } from 'cn';
import type { FormEventHandler, JSX, ReactNode } from 'react';
import { useId } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * A page's column: header, then sections. It takes the shell's whole column,
 * so the notice above it, its header and its sections share one left edge
 * and one width (docs/ADMIN_I18N_AND_UI.md, U2); a form caps its own fields
 * instead (`Section`).
 */
export function Page({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex w-full flex-col gap-6', className)}>
      {children}
    </div>
  );
}

/** The page's title, what it is for, and actions that apply to all of it. */
export function PageHeader({
  title,
  lede,
  actions,
}: {
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {lede === undefined ? null : (
          <p className="max-w-prose text-sm text-muted-foreground">{lede}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/**
 * One block of a page, usually titled. `as="form"` wraps the card in the
 * form, so its footer's submit button submits it. A titled section is a
 * region named by its title, which is how a reader — or a test — finds it.
 */
export function Section({
  title,
  description,
  footer,
  children,
  as = 'section',
  onSubmit,
  className,
  id,
}: {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  readonly as?: 'section' | 'form';
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
  readonly className?: string;
  /** An anchor another page links to, such as `#diagnostics`. */
  readonly id?: string;
}): JSX.Element {
  const titleId = useId();
  const card = (
    <Card className={className}>
      {title === undefined && description === undefined ? null : (
        <CardHeader>
          {title === undefined ? null : (
            <CardTitle id={titleId} role="heading" aria-level={2}>
              {title}
            </CardTitle>
          )}
          {description === undefined ? null : (
            <CardDescription>{description}</CardDescription>
          )}
        </CardHeader>
      )}
      {children === undefined ? null : (
        // A field is capped at a readable width; the card spans the column.
        <CardContent className="flex flex-col gap-4 [&_[data-slot=field]]:max-w-2xl">
          {children}
        </CardContent>
      )}
      {footer === undefined ? null : (
        <CardFooter className="flex flex-wrap items-center gap-3">
          {footer}
        </CardFooter>
      )}
    </Card>
  );
  const named = {
    ...(title === undefined ? {} : { 'aria-labelledby': titleId }),
    ...(id === undefined ? {} : { id }),
  };
  return as === 'form' ? (
    <form {...named} onSubmit={onSubmit}>
      {card}
    </form>
  ) : (
    <section {...named}>{card}</section>
  );
}

/** "Saved", "Set", "Needs a key": a state, in the colour that says which. */
export function StatusBadge({
  tone,
  children,
  role,
  title,
}: {
  readonly tone: 'ok' | 'warn' | 'neutral';
  readonly children: ReactNode;
  readonly role?: 'status';
  readonly title?: string;
}): JSX.Element {
  return (
    <Badge
      variant="outline"
      role={role}
      title={title}
      className={cn(
        // A long status may wrap, but only where English would: `break-keep`
        // stops Chinese from breaking between any two characters, which in a
        // narrow table cell stacked "已发布" one character per line.
        'h-auto max-w-full whitespace-normal break-keep',
        tone === 'ok' && 'border-success/30 bg-success/10 text-success',
        tone === 'warn' && 'border-warning/30 bg-warning/10 text-warning',
      )}
    >
      {children}
    </Badge>
  );
}

/** A value that is code: a language tag, a path, a key. */
export function Code({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  );
}

/** Labelled facts, as a definition list: "Content types — page, article". */
export function Facts({
  items,
}: {
  readonly items: readonly (readonly [ReactNode, ReactNode])[];
}): JSX.Element {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
      {items.map(([term, value], index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, written in order by the page.
        <div className="contents" key={index}>
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
