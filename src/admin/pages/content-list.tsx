/**
 * All content, filterable by kind, locale and status (docs/ADMIN.md §4).
 *
 * Kinds a theme does not declare are marked rather than hidden: the content
 * and its URL survive a theme change, and the list has to say so
 * (docs/THEME_FORMAT.md §5.3).
 *
 * Every value is shown as an operator reads it — a kind by the theme's
 * label, a status by name, a date in the interface language — and a phone
 * gets one row per item rather than a table that scrolls sideways
 * (docs/ADMIN_I18N_AND_UI.md, U4–U6).
 */

import { i18n } from '@lingui/core';
import { Trans, useLingui } from '@lingui/react/macro';
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
import {
  ContentLanguageSelect,
  useContentLanguageName,
} from '../components/content-language.js';
import {
  ContentStatusBadge,
  STATUS_LABELS,
} from '../components/content-status.js';
import { EmptyState } from '../components/empty-state.js';
import { Page, PageHeader, StatusBadge } from '../components/page.js';
import { formatDate } from '../format.js';
import { useReportError } from '../notice.js';
import { keys, useSettings, useTheme } from '../queries.js';
import type { ContentListItem } from '../types.js';

const PAGE = 25;

export function ContentListPage(): JSX.Element {
  const { t } = useLingui();
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
  useReportError(listed.error, t`Could not load content.`);
  const items = listed.data?.items ?? [];
  const hasNext = listed.data?.hasNext ?? false;
  const loading = listed.isPending;

  const kinds = Object.keys(site.kinds);
  const nameOf = useContentLanguageName();
  /** A kind by the theme's label; one the theme lacks keeps its id. */
  const kindLabel = (id: string): string => active.kinds[id]?.label ?? id;
  const filtered = kind !== '' || status !== '';

  // "New" says what it makes: the filtered kind when there is one. The
  // editor opens in the list's language and, when filtered, that kind.
  const newQuery = new URLSearchParams({ locale });
  if (kind !== '') {
    newQuery.set('kind', kind);
  }
  const createNew = (): void => {
    void navigate(`/content/new?${newQuery.toString()}`);
  };
  const filteredKind = kind === '' ? '' : kindLabel(kind);
  const newLabel = kind === '' ? t`New content` : t`New ${filteredKind}`;
  const language = nameOf(locale);

  return (
    <Page width="list">
      <PageHeader
        title={t`Content`}
        // No "Media" here: the sidebar has it one link away (U5).
        actions={
          <Button type="button" onClick={createNew}>
            {newLabel}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-4">
        <Field className="w-auto">
          <FieldLabel htmlFor="filter-kind">
            <Trans>Type</Trans>
          </FieldLabel>
          <NativeSelect
            id="filter-kind"
            value={kind}
            onChange={(event) => filter('kind', event.currentTarget.value)}
          >
            <NativeSelectOption value="">{t`All`}</NativeSelectOption>
            {kinds.map((entry) => (
              <NativeSelectOption key={entry} value={entry}>
                {active.kinds[entry]?.label ?? entry}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <ContentLanguageSelect
          id="filter-locale"
          value={locale}
          onChange={(value) => filter('locale', value)}
          locales={site.locales}
          defaultLocale={site.defaultLocale}
        />
        <Field className="w-auto">
          <FieldLabel htmlFor="filter-status">
            <Trans>Status</Trans>
          </FieldLabel>
          <NativeSelect
            id="filter-status"
            value={status}
            onChange={(event) => filter('status', event.currentTarget.value)}
          >
            <NativeSelectOption value="">{t`All`}</NativeSelectOption>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {i18n._(label)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : items.length === 0 && filtered ? (
        // A filter that matches nothing is not an empty site (U5).
        <EmptyState
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setSearch(
                  search.get('locale') === null
                    ? {}
                    : { locale: search.get('locale') ?? '' },
                )
              }
            >
              <Trans>Clear filters</Trans>
            </Button>
          }
        >
          <Trans>Nothing in {language} matches these filters.</Trans>
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState
          action={
            <Button type="button" onClick={createNew}>
              <Trans>Create the first page</Trans>
            </Button>
          }
        >
          {locale === site.defaultLocale ? (
            <Trans>This site has no content yet.</Trans>
          ) : (
            <Trans>Nothing has been written in {language} yet.</Trans>
          )}
        </EmptyState>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-3">
                  <Trans>Title</Trans>
                </TableHead>
                {/* Below `md` a row is the title with its type and status
                    under it; Path and Updated are left out on purpose (U6). */}
                <TableHead scope="col" className="hidden md:table-cell">
                  <Trans>Type</Trans>
                </TableHead>
                <TableHead scope="col" className="hidden md:table-cell">
                  <Trans>Status</Trans>
                </TableHead>
                <TableHead scope="col" className="hidden md:table-cell">
                  <Trans>Path</Trans>
                </TableHead>
                <TableHead scope="col" className="hidden pr-3 md:table-cell">
                  <Trans>Updated</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const known = active.kinds[item.kind] !== undefined;
                const typeCell = (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {kindLabel(item.kind)}
                    {known ? null : (
                      <StatusBadge
                        tone="warn"
                        title={t`The active theme does not declare this type, so it renders with the page layout. The content and its URL are untouched.`}
                      >
                        <Trans>Not in theme</Trans>
                      </StatusBadge>
                    )}
                  </span>
                );
                const statusBadge = <ContentStatusBadge status={item.status} />;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="min-w-40 pl-3 whitespace-normal">
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        to={`/content/${item.id}`}
                      >
                        {item.title}
                      </Link>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground md:hidden">
                        {typeCell}
                        {statusBadge}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {typeCell}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {statusBadge}
                    </TableCell>
                    <TableCell className="hidden max-w-72 min-w-48 whitespace-normal md:table-cell">
                      <a
                        className="font-mono text-xs break-all text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        href={item.path}
                      >
                        {item.path}
                      </a>
                    </TableCell>
                    <TableCell className="hidden pr-3 text-muted-foreground tabular-nums md:table-cell">
                      <time dateTime={item.updatedAt}>
                        {formatDate(item.updatedAt)}
                      </time>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Nothing to page through on a single page, so no pager (U5). */}
      {offset === 0 && !hasNext ? null : (
        <nav className="flex gap-2" aria-label={t`Pagination`}>
          <Button
            type="button"
            variant="outline"
            disabled={offset === 0}
            onClick={() => page(Math.max(0, offset - PAGE))}
          >
            <Trans>Previous</Trans>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hasNext}
            onClick={() => page(offset + PAGE)}
          >
            <Trans>Next</Trans>
          </Button>
        </nav>
      )}
    </Page>
  );
}
