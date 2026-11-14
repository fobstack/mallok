/**
 * Read-only child rows shown with one row of a plugin panel — the lines of
 * an order (docs/PLUGIN_API.md §7.5) — and the cell formatting every panel
 * table shares.
 */

import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, api } from '../api.js';
import { panelKey } from '../queries.js';
import type { PluginPanel } from '../types.js';
import { StatusBadge } from './page.js';

type Row = Record<string, unknown>;
type ColumnType = PluginPanel['columns'][number]['type'];

/**
 * The badge values that carry a colour. A plugin's own values ("active",
 * "shipped") are shown plain: only these words have a meaning the admin
 * knows.
 */
const BADGE_TONE: Readonly<Record<string, 'ok' | 'warn'>> = {
  ok: 'ok',
  published: 'ok',
  warn: 'warn',
  scheduled: 'warn',
};

/** Formats one cell by its declared column type. */
export function cell(value: unknown, type: ColumnType): JSX.Element | string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const text = String(value);
  if (type === 'email') {
    return (
      <a
        className="text-primary underline-offset-4 hover:underline"
        href={`mailto:${text}`}
      >
        {text}
      </a>
    );
  }
  if (type === 'datetime') {
    return text.slice(0, 16).replace('T', ' ');
  }
  if (type === 'badge') {
    return (
      <StatusBadge tone={BADGE_TONE[text] ?? 'neutral'}>{text}</StatusBadge>
    );
  }
  return text;
}

function RelatedTable({
  pluginId,
  panelId,
  related,
  parentId,
}: {
  readonly pluginId: string;
  readonly panelId: string;
  readonly related: PluginPanel['related'][number];
  readonly parentId: string;
}): JSX.Element {
  const { t } = useLingui();
  const loaded = useQuery({
    queryKey: panelKey(pluginId, panelId, 'related', related.id, parentId),
    queryFn: () =>
      api<{ rows: Row[]; hasMore: boolean }>(
        `/plugins/${pluginId}/panels/${panelId}/related/${related.id}?parent=${encodeURIComponent(parentId)}`,
      ),
  });
  const rows = loaded.data?.rows ?? null;
  const more = loaded.data?.hasMore ?? false;
  const failure =
    loaded.error === null
      ? ''
      : loaded.error instanceof ApiError
        ? loaded.error.message
        : t`Could not load.`;

  return (
    <section className="flex flex-col gap-2" aria-label={related.label}>
      <h3 className="font-heading text-sm font-semibold">{related.label}</h3>
      {failure !== '' ? (
        <p className="text-sm text-destructive" role="alert">
          {failure}
        </p>
      ) : rows === null ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>None.</Trans>
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {related.columns.map((column) => (
                  <TableHead
                    scope="col"
                    key={column.field}
                    className="first:pl-3 last:pr-3"
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                // Child rows are shown, never addressed: position is their key.
                // biome-ignore lint/suspicious/noArrayIndexKey: a read-only list that is replaced whole, never reordered.
                <TableRow key={index}>
                  {related.columns.map((column) => (
                    <TableCell
                      key={column.field}
                      className="first:pl-3 last:pr-3"
                    >
                      {cell(row[column.field], column.type)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {more ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Only the first rows are shown.</Trans>
        </p>
      ) : null}
    </section>
  );
}

/** Every related table a panel declares, for one of its rows. */
export function RelatedRows({
  pluginId,
  panel,
  parentId,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
  readonly parentId: string;
}): JSX.Element | null {
  if (panel.related.length === 0) {
    return null;
  }
  return (
    <>
      {panel.related.map((related) => (
        <RelatedTable
          key={related.id}
          pluginId={pluginId}
          panelId={panel.id}
          related={related}
          parentId={parentId}
        />
      ))}
    </>
  );
}
