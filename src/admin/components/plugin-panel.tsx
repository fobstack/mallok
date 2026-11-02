/**
 * A plugin's declarative panel (docs/PLUGIN_API.md §7.5).
 *
 * The plugin ships no UI code: this component reads `panels[]` out of its
 * manifest and builds the table, filters, search, sorting, detail view and
 * actions from it — and, for a `records` panel, the buttons that open the
 * create and edit form. That is what keeps the admin's size and security
 * boundary intact while still letting a plugin have a real interface.
 */

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, api, csrf } from '../api.js';
import { notice } from '../state.js';
import type { PluginPanel } from '../types.js';
import { lazyRoute } from './lazy.js';
import { Facts } from './page.js';
import { cell, RelatedRows } from './related-rows.js';

/**
 * The form arrives with the first record that is opened, not with the list:
 * most visits to a panel only read it.
 */
const RecordEditor = lazyRoute<{
  pluginId: string;
  panel: PluginPanel;
  recordId: string | null;
  onClose: (changed: boolean) => void;
  attachedTo?: string;
}>(() => import('./record-editor.js').then((module) => module.RecordEditor));

/** Asks for an action's parameters; shares the form's code, and its chunk. */
const ActionParams = lazyRoute<{
  pluginId: string;
  panel: PluginPanel;
  action: PluginPanel['actions'][number];
  ids: readonly string[];
  onClose: (done: boolean) => void;
}>(() =>
  import('./record-editor.js').then((module) => module.ActionParamsDialog),
);

type Row = Record<string, unknown>;

const PAGE = 20;

export function PluginPanelView({
  pluginId,
  panel,
  attachedTo,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
  /**
   * The translation group of the content item this panel is shown for, when
   * it is shown in the editor: only that item's records are listed, and new
   * ones belong to it.
   */
  readonly attachedTo?: string;
}): JSX.Element {
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{
    field: string;
    descending: boolean;
  } | null>(null);
  /** The record form: `undefined` closed, `null` a new record, else its id. */
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const editable = panel.type === 'records';
  /** The action whose parameters are being asked for, if any. */
  const [asking, setAsking] = useState<PluginPanel['actions'][number] | null>(
    null,
  );

  const base = `/plugins/${pluginId}/panels/${panel.id}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters and sort are new objects every render; their stringified form is the real "did it change" check.
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    const query = new URLSearchParams({
      limit: String(PAGE),
      offset: String(offset),
    });
    for (const [field, value] of Object.entries(filters)) {
      if (value !== '') {
        query.set(field, value);
      }
    }
    if (attachedTo !== undefined) {
      query.set('attached', attachedTo);
    }
    if (search.trim() !== '') {
      query.set('q', search.trim());
    }
    if (sort !== null) {
      query.set('sort', sort.field);
      query.set('dir', sort.descending ? 'desc' : 'asc');
    }
    try {
      const result = await api<{ rows: Row[]; hasNext: boolean }>(
        `${base}?${query.toString()}`,
      );
      setRows(result.rows);
      setHasNext(result.hasNext);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not load rows.';
    } finally {
      setLoading(false);
    }
  }, [
    offset,
    base,
    JSON.stringify(filters),
    search,
    JSON.stringify(sort),
    attachedTo,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Stable, because the form's loading effect depends on it.
  const closeEditor = useCallback(
    (changed: boolean): void => {
      setEditing(undefined);
      if (changed) {
        void reload();
      }
    },
    [reload],
  );

  const runAction = async (
    action: PluginPanel['actions'][number],
  ): Promise<void> => {
    if (action.type === 'download') {
      // A download needs the raw response, not parsed JSON.
      const response = await fetch(`/_mallok/api${base}/actions/${action.id}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'x-mallok-csrf': csrf(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ids: selected }),
      });
      if (!response.ok) {
        notice.value = `"${action.label}" failed.`;
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        response.headers
          .get('content-disposition')
          ?.match(/filename="([^"]+)"/)?.[1] ?? `${panel.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (selected.length === 0) {
      notice.value = 'Select at least one row first.';
      return;
    }
    if (action.params !== undefined) {
      // The action needs something from whoever runs it; ask first.
      setAsking(action);
      return;
    }
    try {
      await api(`${base}/actions/${action.id}`, {
        method: 'POST',
        body: { ids: selected },
      });
      setSelected([]);
      await reload();
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'The action failed.';
    }
  };

  const titleId = `panel-${pluginId}-${panel.id}`;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <h3
          id={titleId}
          className="mr-auto self-center font-heading text-sm font-semibold"
        >
          {panel.label}
        </h3>
        {panel.filters.map((field) => (
          <Field key={field} className="w-40">
            <FieldLabel
              htmlFor={`${titleId}-filter-${field}`}
              className="capitalize"
            >
              {field.replace(/_/g, ' ')}
            </FieldLabel>
            <Input
              id={`${titleId}-filter-${field}`}
              value={filters[field] ?? ''}
              placeholder="any"
              onChange={(event) => {
                setOffset(0);
                setFilters((previous) => ({
                  ...previous,
                  [field]: event.currentTarget.value,
                }));
              }}
            />
          </Field>
        ))}
        {panel.search.length === 0 ? null : (
          <Field className="w-56">
            <FieldLabel htmlFor={`${titleId}-search`}>Search</FieldLabel>
            <Input
              id={`${titleId}-search`}
              type="search"
              value={search}
              placeholder={panel.search
                .map((field) => field.replace(/_/g, ' '))
                .join(', ')}
              onChange={(event) => {
                setOffset(0);
                setSearch(event.currentTarget.value);
              }}
            />
          </Field>
        )}
        {editable ? (
          <Button type="button" onClick={() => setEditing(null)}>
            New
          </Button>
        ) : null}
        {panel.actions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            onClick={() => void runAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-10 pl-3">
                  <span className="sr-only">Select</span>
                </TableHead>
                {panel.columns.map((column) => {
                  const sorted = sort?.field === column.field;
                  return (
                    <TableHead
                      scope="col"
                      key={column.field}
                      {...(sorted
                        ? {
                            'aria-sort': sort.descending
                              ? ('descending' as const)
                              : ('ascending' as const),
                          }
                        : {})}
                    >
                      {column.sortable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-2.5 font-medium"
                          onClick={() => {
                            setOffset(0);
                            setSort({
                              field: column.field,
                              descending: sorted && !sort.descending,
                            });
                          }}
                        >
                          {column.label}
                          {sorted ? (
                            sort.descending ? (
                              <ArrowDown aria-hidden="true" />
                            ) : (
                              <ArrowUp aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown
                              aria-hidden="true"
                              className="text-muted-foreground"
                            />
                          )}
                        </Button>
                      ) : (
                        column.label
                      )}
                    </TableHead>
                  );
                })}
                <TableHead scope="col" className="pr-3">
                  <span className="sr-only">Details</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const id = String(row.id ?? '');
                return (
                  <TableRow
                    key={id}
                    data-state={selected.includes(id) ? 'selected' : undefined}
                  >
                    <TableCell className="pl-3">
                      <Checkbox
                        aria-label={`Select ${id}`}
                        checked={selected.includes(id)}
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked === true
                              ? [...selected, id]
                              : selected.filter((entry) => entry !== id),
                          )
                        }
                      />
                    </TableCell>
                    {panel.columns.map((column) => (
                      <TableCell key={column.field}>
                        {cell(row[column.field], column.type)}
                      </TableCell>
                    ))}
                    <TableCell className="pr-3 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={
                          editable
                            ? `Edit ${String(row[panel.columns[0]?.field ?? 'id'] ?? id)}`
                            : `Open ${id}`
                        }
                        onClick={() =>
                          editable ? setEditing(id) : setOpen(row)
                        }
                      >
                        {editable ? 'Edit' : 'Open'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <nav className="flex gap-2" aria-label="Pagination">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE))}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasNext}
          onClick={() => setOffset(offset + PAGE)}
        >
          Next
        </Button>
      </nav>

      {open === null ? null : (
        <RowDetail
          pluginId={pluginId}
          panel={panel}
          row={open}
          onClose={() => setOpen(null)}
        />
      )}
      {asking === null ? null : (
        <ActionParams
          key={asking.id}
          pluginId={pluginId}
          panel={panel}
          action={asking}
          ids={selected}
          onClose={(done) => {
            setAsking(null);
            if (done) {
              setSelected([]);
              void reload();
            }
          }}
        />
      )}
      {editing === undefined ? null : (
        <RecordEditor
          // A different record is a different form, not the same one with
          // new props: its typed-in state must not carry over.
          key={editing ?? 'new'}
          pluginId={pluginId}
          panel={panel}
          recordId={editing}
          onClose={closeEditor}
          {...(attachedTo === undefined ? {} : { attachedTo })}
        />
      )}
    </section>
  );
}

function RowDetail({
  pluginId,
  panel,
  row,
  onClose,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
  readonly row: Row;
  readonly onClose: () => void;
}): JSX.Element {
  const fields = [
    ...panel.columns.map((column) => column.field),
    ...panel.detail,
  ];
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <SheetContent
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl"
        // The dialog keeps the name it had: the panel's label is the title,
        // and "detail" says which view of it this is.
        aria-labelledby={undefined}
        aria-label={`${panel.label} detail`}
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle>{panel.label}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-4">
          <Facts
            items={fields.map((field) => [
              <span key="t" className="capitalize">
                {field.replace(/_/g, ' ')}
              </span>,
              String(row[field] ?? '—'),
            ])}
          />
          <RelatedRows
            pluginId={pluginId}
            panel={panel}
            parentId={String(row.id ?? '')}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
