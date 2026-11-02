/**
 * All content, filterable by kind, locale and status (docs/ADMIN.md §4).
 *
 * Kinds a theme does not declare are marked rather than hidden: the content
 * and its URL survive a theme change, and the list has to say so
 * (docs/THEME_FORMAT.md §5.3).
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
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
import { ApiError, api } from '../api.js';
import { Page, PageHeader, StatusBadge } from '../components/page.js';
import { navigate } from '../router.js';
import { activeLocale, notice, settings, theme } from '../state.js';
import type { ContentListItem } from '../types.js';

const PAGE = 25;

/** A status's badge colour: live is good, waiting is a caution. */
const STATUS_TONE: Readonly<Record<string, 'ok' | 'warn'>> = {
  published: 'ok',
  scheduled: 'warn',
};

export function ContentListPage(): JSX.Element {
  const site = settings.value;
  const active = theme.value;
  const [items, setItems] = useState<readonly ContentListItem[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const locale = activeLocale.value;

  // biome-ignore lint/correctness/useExhaustiveDependencies: locale is read below (query.set('locale', locale)).
  useEffect(() => {
    void (async () => {
      setLoading(true);
      const query = new URLSearchParams({
        limit: String(PAGE),
        offset: String(offset),
      });
      if (kind !== '') {
        query.set('kind', kind);
      }
      if (status !== '') {
        query.set('status', status);
      }
      if (locale !== '') {
        query.set('locale', locale);
      }
      try {
        const result = await api<{
          items: ContentListItem[];
          hasNext: boolean;
        }>(`/content?${query.toString()}`);
        setItems(result.items);
        setHasNext(result.hasNext);
      } catch (caught) {
        notice.value =
          caught instanceof ApiError
            ? caught.message
            : 'Could not load content.';
      } finally {
        setLoading(false);
      }
    })();
  }, [kind, status, locale, offset]);

  if (site === null || active === null) {
    return <p>Loading…</p>;
  }
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
            <Button type="button" onClick={() => navigate('/content/new')}>
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
            onChange={(event) => {
              setKind(event.currentTarget.value);
              setOffset(0);
            }}
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
            onChange={(event) => {
              activeLocale.value = event.currentTarget.value;
              setOffset(0);
            }}
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
            onChange={(event) => {
              setStatus(event.currentTarget.value);
              setOffset(0);
            }}
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
                      <a
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        href={`/_mallok/app/content/${item.id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/content/${item.id}`);
                        }}
                      >
                        {item.title}
                      </a>
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
          onClick={() => setOffset(Math.max(0, offset - PAGE))}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!hasNext}
          onClick={() => setOffset(offset + PAGE)}
        >
          Next
        </Button>
      </nav>
    </Page>
  );
}
