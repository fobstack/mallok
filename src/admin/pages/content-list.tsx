/**
 * All content, filterable by kind, locale and status (docs/ADMIN.md §4).
 *
 * Kinds a theme does not declare are marked rather than hidden: the content
 * and its URL survive a theme change, and the list has to say so
 * (docs/THEME_FORMAT.md §5.3).
 */

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
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
import { ContentLanguageSelect } from '../components/content-language.js';
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

/** A status as the list shows it; an unknown one is shown as stored. */
const STATUS_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  published: msg`Published`,
  draft: msg`Draft`,
  scheduled: msg`Scheduled`,
};

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

  return (
    <Page>
      <PageHeader
        title={t`Content`}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/media')}
            >
              <Trans>Media</Trans>
            </Button>
            <Button
              type="button"
              onClick={() => navigate(`/content/new?locale=${locale}`)}
            >
              <Trans>New</Trans>
            </Button>
          </>
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
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          <Trans>Nothing here yet.</Trans>
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-3">
                  <Trans>Title</Trans>
                </TableHead>
                <TableHead scope="col">
                  <Trans>Type</Trans>
                </TableHead>
                <TableHead scope="col">
                  <Trans>Status</Trans>
                </TableHead>
                <TableHead scope="col">
                  <Trans>Path</Trans>
                </TableHead>
                <TableHead scope="col" className="pr-3">
                  <Trans>Updated</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const known = active.kinds[item.kind] !== undefined;
                const statusLabel = STATUS_LABELS[item.status];
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
                            title={t`The active theme does not declare this type, so it renders with the page layout. The content and its URL are untouched.`}
                          >
                            <Trans>Not in theme</Trans>
                          </StatusBadge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={STATUS_TONE[item.status] ?? 'neutral'}>
                        {statusLabel === undefined
                          ? item.status
                          : i18n._(statusLabel)}
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
    </Page>
  );
}
