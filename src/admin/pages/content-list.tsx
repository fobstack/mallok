/**
 * All content, filterable by kind, locale and status (docs/ADMIN.md §4).
 *
 * Kinds a theme does not declare are marked rather than hidden: the content
 * and its URL survive a theme change, and the list has to say so
 * (docs/THEME_FORMAT.md §5.3).
 */

import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '../api.js';
import { Page, PageHeader, StatusBadge } from '../components/page.js';
import { useReportError } from '../notice.js';
import { keys, useSettings, useTheme } from '../queries.js';
import type { ContentListItem } from '../types.js';

const PAGE = 25;

/** A status's badge colour: live is good, waiting is a caution. */
const STATUS_TONE: Readonly<Record<string, 'ok' | 'warn'>> = {
  published: 'ok',
  scheduled: 'warn',
};

export function ContentListPage(): JSX.Element {
  const site = useSettings();
  const active = useTheme();
  const navigate = useNavigate();
  // The filters live in the address: a reload, a link or Back keeps them,
  // and the language chosen here is the one a new item is written in.
  const [search, setSearch] = useSearchParams();
  const kind = search.get('kind') ?? '';
  const status = search.get('status') ?? '';
  const locale = search.get('locale') ?? site.defaultLocale;
  const offset = Number(search.get('offset') ?? 0) || 0;

  /** Changes one filter and goes back to the first page. */
  const filter = (name: string, value: string): void => {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (value === '') {
        next.delete(name);
      } else {
        next.set(name, value);
      }
      next.delete('offset');
      return next;
    });
  };
  const page = (to: number): void => {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (to === 0) {
        next.delete('offset');
      } else {
        next.set('offset', String(to));
      }
      return next;
    });
  };

  const query = new URLSearchParams({
    limit: String(PAGE),
    offset: String(offset),
    locale,
  });
  if (kind !== '') {
    query.set('kind', kind);
  }
  if (status !== '') {
    query.set('status', status);
  }
  const listed = useQuery({
    queryKey: [...keys.content, 'list', query.toString()],
    queryFn: () =>
      api<{ items: ContentListItem[]; hasNext: boolean }>(
        `/content?${query.toString()}`,
      ),
  });
  useReportError(listed.error, 'Could not load content.');
  const items = listed.data?.items ?? [];
  const hasNext = listed.data?.hasNext ?? false;
  const loading = listed.isPending;

  const kinds = Object.keys(site.kinds);

  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="Content"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/media')}
            >
              Media
            </Button>
            <Button
              type="button"
              onClick={() => navigate(`/content/new?locale=${locale}`)}
            >
              New
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-4">
        <Field className="w-auto">
          <FieldLabel htmlFor="filter-kind">Type</FieldLabel>
          <NativeSelect
            id="filter-kind"
            value={kind}
            onChange={(event) => filter('kind', event.currentTarget.value)}
          >
            <NativeSelectOption value="">All</NativeSelectOption>
            {kinds.map((entry) => (
              <NativeSelectOption key={entry} value={entry}>
                {active.kinds[entry]?.label ?? entry}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="filter-locale">Language</FieldLabel>
          <NativeSelect
            id="filter-locale"
            value={locale}
            onChange={(event) => filter('locale', event.currentTarget.value)}
          >
            {site.locales.map((entry) => (
              <NativeSelectOption key={entry} value={entry}>
                {entry}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="filter-status">Status</FieldLabel>
          <NativeSelect
            id="filter-status"
            value={status}
            onChange={(event) => filter('status', event.currentTarget.value)}
          >
            <NativeSelectOption value="">All</NativeSelectOption>
            <NativeSelectOption value="published">Published</NativeSelectOption>
            <NativeSelectOption value="draft">Draft</NativeSelectOption>
            <NativeSelectOption value="scheduled">Scheduled</NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-3">
                  Title
                </TableHead>
                <TableHead scope="col">Type</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Path</TableHead>
                <TableHead scope="col" className="pr-3">
                  Updated
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const known = active.kinds[item.kind] !== undefined;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="min-w-40 pl-3 whitespace-normal">
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        to={`/content/${item.id}`}
                      >
                        {item.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {item.kind}
                        {known ? null : (
                          <StatusBadge
                            tone="warn"
                            title="The active theme does not declare this type, so it renders with the page layout. The content and its URL are untouched."
                          >
                            Not in theme
                          </StatusBadge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={STATUS_TONE[item.status] ?? 'neutral'}>
                        {item.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="max-w-72 min-w-48 whitespace-normal">
                      <a
                        className="font-mono text-xs break-all text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        href={item.path}
                      >
                        {item.path}
                      </a>
                    </TableCell>
                    <TableCell className="pr-3 text-muted-foreground tabular-nums">
                      {item.updatedAt.slice(0, 10)}
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
          disabled={offset === 0}
          onClick={() => page(Math.max(0, offset - PAGE))}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!hasNext}
          onClick={() => page(offset + PAGE)}
        >
          Next
        </Button>
      </nav>
    </Page>
  );
}
