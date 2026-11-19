/**
 * A content type's list — Products, Pages, News — or, with no type in the
 * address, every type's (docs/ADMIN.md §4, docs/ADMIN_SIMPLE.md §6.3).
 *
 * It reads like the lists of mainstream admins: the type is the sidebar
 * entry the operator chose, status and language are tabs above the table,
 * there is a search box, and a row's address is one "Copy address" away in
 * its menu instead of being the widest column (D2, D3, D8; G6, G8, G9).
 *
 * Kinds a theme does not declare are marked rather than hidden: the content
 * and its URL survive a theme change, and the list has to say so
 * (docs/THEME_FORMAT.md §5.3). A phone gets one row per item rather than a
 * table that scrolls sideways (docs/ADMIN_I18N_AND_UI.md, U6).
 */

import { i18n } from '@lingui/core';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, Search } from 'lucide-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '../api.js';
import { useShortLanguageNames } from '../components/content-language.js';
import {
  ContentStatusBadge,
  STATUS_LABELS,
} from '../components/content-status.js';
import { EmptyState } from '../components/empty-state.js';
import { FilterTabs } from '../components/filter-tabs.js';
import { Page, PageHeader, StatusBadge } from '../components/page.js';
import { formatLastEdited } from '../format-relative.js';
import { useReportError } from '../notice.js';
import { keys, useSettings, useTheme } from '../queries.js';
import type { ContentListItem } from '../types.js';

const PAGE = 25;

/** How long the search box waits after the last keystroke. */
const SEARCH_DELAY_MS = 300;

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
  const words = search.get('q') ?? '';
  const locale = search.get('locale') ?? site.defaultLocale;
  const offset = Number(search.get('offset') ?? 0) || 0;

  /** Changes one filter and goes back to the first page. */
  const filter = (name: string, value: string): void => {
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === '') {
          next.delete(name);
        } else {
          next.set(name, value);
        }
        next.delete('offset');
        return next;
      },
      // Typing in the search box is not a page to go Back to.
      { replace: name === 'q' },
    );
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

  // The box shows what is typed at once; the list follows a moment later.
  const [typed, setTyped] = useState(words);
  useEffect(() => {
    setTyped(words);
  }, [words]);
  // `filter` is a fresh closure each render; the words are what matter.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (typed.trim() === words) {
      return;
    }
    const timer = setTimeout(() => filter('q', typed.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, words]);

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
  if (words !== '') {
    query.set('q', words);
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

  /** A kind by the theme's label; one the theme lacks keeps its id. */
  const kindLabel = (id: string): string => active.kinds[id]?.label ?? id;
  const typeName = kind === '' ? '' : kindLabel(kind);
  const languageName = useShortLanguageNames(site.locales);
  const filtered = status !== '' || words !== '';

  // "Add" says what it makes: this list's type when it has one. The editor
  // opens in the list's language and type.
  const newQuery = new URLSearchParams({ locale });
  if (kind !== '') {
    newQuery.set('kind', kind);
  }
  const createNew = (): void => {
    void navigate(`/content/new?${newQuery.toString()}`);
  };
  const addLabel = kind === '' ? t`Add content` : t`Add ${typeName}`;
  const language = languageName(locale);

  // "Copy address" says it worked, or why not, where the operator is.
  const [copied, setCopied] = useState('');
  const copyAddress = (item: ContentListItem): void => {
    const address = new URL(item.path, window.location.origin).toString();
    void navigator.clipboard.writeText(address).then(
      () => setCopied(t`Copied ${address}`),
      () => setCopied(t`Could not copy. The address is ${address}`),
    );
  };

  const statusTabs = [
    { value: '', label: t`All` },
    ...Object.entries(STATUS_LABELS).map(([value, label]) => ({
      value,
      label: i18n._(label),
    })),
  ];
  // The main language first, unmarked; no tabs at all for one language.
  const languages = [
    site.defaultLocale,
    ...site.locales.filter((code) => code !== site.defaultLocale),
  ];

  return (
    <Page width="list">
      <PageHeader
        title={kind === '' ? t`All content` : typeName}
        actions={
          <Button type="button" onClick={createNew}>
            {addLabel}
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterTabs
            label={t`Status`}
            tabs={statusTabs}
            value={status}
            onChange={(value) => filter('status', value)}
          />
          <div className="relative ml-auto w-full sm:w-64">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.currentTarget.value)}
              aria-label={t`Search by title`}
              placeholder={kind === '' ? t`Search…` : t`Search ${typeName}…`}
              className="pl-8"
            />
          </div>
        </div>
        {languages.length < 2 ? null : (
          <FilterTabs
            label={t`Language`}
            tabs={languages.map((code) => ({
              value: code,
              label: languageName(code),
            }))}
            value={locale}
            onChange={(value) =>
              filter('locale', value === site.defaultLocale ? '' : value)
            }
          />
        )}
      </div>

      {copied === '' ? null : (
        <p className="text-sm text-muted-foreground" role="status">
          {copied}
        </p>
      )}

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
              onClick={() => {
                const next = new URLSearchParams();
                for (const keep of ['kind', 'locale']) {
                  const value = search.get(keep);
                  if (value !== null) {
                    next.set(keep, value);
                  }
                }
                setSearch(next);
              }}
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
              {kind === '' ? (
                <Trans>Create the first page</Trans>
              ) : (
                <Trans>Add the first {typeName}</Trans>
              )}
            </Button>
          }
        >
          {locale !== site.defaultLocale ? (
            <Trans>Nothing has been written in {language} yet.</Trans>
          ) : kind === '' ? (
            <Trans>This site has no content yet.</Trans>
          ) : (
            <Trans>There is no {typeName} yet.</Trans>
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
                {/* Only where types are mixed: inside a type's own list
                    the sidebar already says which it is. */}
                {kind === '' ? (
                  <TableHead scope="col" className="hidden md:table-cell">
                    <Trans>Type</Trans>
                  </TableHead>
                ) : null}
                <TableHead scope="col" className="hidden md:table-cell">
                  <Trans>Status</Trans>
                </TableHead>
                <TableHead scope="col" className="hidden md:table-cell">
                  <Trans>Last edited</Trans>
                </TableHead>
                <TableHead scope="col" className="w-10 pr-3">
                  <span className="sr-only">
                    <Trans>Actions</Trans>
                  </span>
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
                const edited = (
                  <time dateTime={item.updatedAt}>
                    {formatLastEdited(item.updatedAt)}
                  </time>
                );
                const editHref = `/content/${item.id}?kind=${encodeURIComponent(item.kind)}`;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="min-w-40 pl-3 whitespace-normal">
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        to={editHref}
                      >
                        {item.title}
                      </Link>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground md:hidden">
                        {kind === '' ? typeCell : null}
                        {statusBadge}
                        {edited}
                      </span>
                    </TableCell>
                    {kind === '' ? (
                      <TableCell className="hidden md:table-cell">
                        {typeCell}
                      </TableCell>
                    ) : null}
                    <TableCell className="hidden md:table-cell">
                      {statusBadge}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                      {edited}
                    </TableCell>
                    <TableCell className="pr-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t`Actions for ${item.title}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={editHref}>
                              <Trans>Edit</Trans>
                            </Link>
                          </DropdownMenuItem>
                          {item.status === 'published' ? (
                            <DropdownMenuItem asChild>
                              <a
                                href={item.path}
                                target="_blank"
                                rel="noopener"
                              >
                                <Trans>View on site</Trans>
                              </a>
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onSelect={() => copyAddress(item)}>
                            <Trans>Copy address</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
