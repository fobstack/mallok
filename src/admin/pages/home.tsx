/**
 * Overview: what to do next, and what is new (docs/ADMIN_SIMPLE.md, D1).
 *
 * The first screen after sign-in used to be a table of every item. This
 * page says instead what is left to set up, what arrived in each plugin's
 * list (inquiries), and what was edited last — from what the admin already
 * loads, with no figure that needs counting. Each setup step is derived,
 * never stored: it disappears when its condition does, and the card with
 * the last one.
 */

import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleDashed } from 'lucide-react';
import type { JSX } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '../api.js';
import { ContentStatusBadge } from '../components/content-status.js';
import { Page, PageHeader } from '../components/page.js';
import { cell } from '../components/related-rows.js';
import { formatLastEdited } from '../format-relative.js';
import { useReportError } from '../notice.js';
import {
  keys,
  panelKey,
  pluginsQuery,
  useHealth,
  useSettings,
  useTheme,
} from '../queries.js';
import type { ContentListItem, PluginInfo, PluginPanel } from '../types.js';

/** How many rows of recent work each card shows. */
const RECENT = 5;

/** A step of setting up, and whether it is done. */
interface Step {
  readonly id: string;
  readonly done: boolean;
  readonly title: string;
  readonly why: string;
  readonly href: string;
  readonly action: string;
}

export function HomePage(): JSX.Element {
  const { t } = useLingui();
  const site = useSettings();
  const health = useHealth();
  const theme = useTheme();
  const navigate = useNavigate();
  const plugins = useQuery(pluginsQuery).data?.plugins ?? [];
  const kindLabel = (id: string): string => theme.kinds[id]?.label ?? id;

  const recent = useQuery({
    queryKey: [...keys.content, 'list', `limit=${RECENT}`],
    queryFn: () =>
      api<{ items: ContentListItem[] }>(`/content?limit=${RECENT}`),
  });
  useReportError(recent.error, t`Could not load content.`);
  const items = recent.data?.items ?? [];

  /**
   * The four steps of a new site, each read from what the admin already
   * loads (D1): a plugin setting that is required and empty — an inquiry
   * form with nowhere to send to —, a custom domain, email sending, and
   * content edited since setup.
   */
  const setupSteps = (recent: readonly ContentListItem[]): readonly Step[] => {
    const steps: Step[] = [];
    for (const plugin of plugins.filter((entry) => entry.enabled)) {
      const missing = Object.entries(plugin.settings).filter(
        ([name, field]) =>
          field.required &&
          (plugin.values[name] === undefined ||
            plugin.values[name] === null ||
            plugin.values[name] === ''),
      );
      const pluginName = plugin.name;
      for (const [name, field] of missing) {
        const label = field.label ?? name;
        steps.push({
          id: `plugin-${plugin.id}-${name}`,
          done: false,
          title: t`${pluginName}: fill in ${label}`,
          why: t`It is required, and ${pluginName} cannot work without it.`,
          href: `/plugins#plugin-${plugin.id}`,
          action: t`Fill in`,
        });
      }
    }
    steps.push({
      id: 'domain',
      done: health.customDomain !== null && health.customDomain !== '',
      title: t`Connect your domain`,
      why: t`Visitors still see a preview address, and search engines are asked not to list the site.`,
      href: '/settings',
      action: t`Set up`,
    });
    steps.push({
      id: 'email',
      done: site.email.resendConfigured && site.email.fromAddress !== '',
      title: t`Set up email sending`,
      why: t`Without it, no email reaches you or your visitors.`,
      href: '/settings/email',
      action: t`Set up`,
    });
    const setupAt = site.setupCompletedAt;
    const edited =
      setupAt !== null &&
      recent.some(
        (item) =>
          new Date(item.updatedAt).getTime() >
          new Date(setupAt).getTime() + 60_000,
      );
    steps.push({
      id: 'content',
      done: edited,
      title: t`Make the example pages your own`,
      why: t`The pages the site started with are examples; edit or replace them.`,
      href: '/content?kind=page',
      action: t`Open pages`,
    });
    // Steps a fresh site has not done come first; the done ones stay listed
    // underneath, so the count adds up.
    return [...steps.filter((s) => !s.done), ...steps.filter((s) => s.done)];
  };

  const steps = setupSteps(items);
  const open = steps.filter((step) => !step.done);
  const done = steps.length - open.length;
  const total = steps.length;

  // Each plugin's own lists — Inquiries — newest first, as they are listed
  // in the sidebar. A records panel is a catalogue, not an inbox.
  const inboxes = plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      plugin.panels
        .filter(
          (panel) => panel.type === 'table' && panel.attachTo === undefined,
        )
        .map((panel) => ({ plugin, panel })),
    );

  return (
    <Page width="home">
      <PageHeader
        title={t`Overview`}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button">
                <Trans>Add</Trans>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {Object.keys(site.kinds).map((kind) => (
                <DropdownMenuItem
                  key={kind}
                  onSelect={() =>
                    navigate(`/content/new?kind=${encodeURIComponent(kind)}`)
                  }
                >
                  {kindLabel(kind)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {open.length === 0 ? null : (
        <section
          aria-labelledby="home-setup"
          className="rounded-xl border bg-card p-4 text-card-foreground"
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="home-setup" className="font-semibold">
              <Trans>Finish setting up</Trans>
            </h2>
            <span className="text-sm text-muted-foreground">
              <Trans>
                {done} of {total} done
              </Trans>
            </span>
          </div>
          <ul className="flex flex-col divide-y">
            {steps.map((step) => (
              <li
                key={step.id}
                className="flex flex-wrap items-center gap-3 py-2.5"
              >
                {step.done ? (
                  <CircleCheck
                    aria-hidden="true"
                    className="size-5 shrink-0 text-emerald-600"
                  />
                ) : (
                  <CircleDashed
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      step.done ? 'text-muted-foreground line-through' : ''
                    }
                  >
                    {step.title}
                    {step.done ? (
                      <span className="sr-only">
                        {' '}
                        <Trans>(done)</Trans>
                      </span>
                    ) : null}
                  </p>
                  {step.done ? null : (
                    <p className="text-sm text-muted-foreground">{step.why}</p>
                  )}
                </div>
                {step.done ? null : (
                  <Button asChild variant="outline" size="sm">
                    <Link to={step.href}>{step.action}</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {inboxes.map(({ plugin, panel }) => (
        <Inbox key={`${plugin.id}/${panel.id}`} plugin={plugin} panel={panel} />
      ))}

      <section
        aria-labelledby="home-recent"
        className="rounded-xl border bg-card p-4 text-card-foreground"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="home-recent" className="font-semibold">
            <Trans>Recently edited</Trans>
          </h2>
          <Link
            to="/content"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            <Trans>All content</Trans>
          </Link>
        </div>
        {recent.isPending ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Nothing has been written yet.</Trans>
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
              >
                <Link
                  to={`/content/${item.id}?kind=${encodeURIComponent(item.kind)}`}
                  className="min-w-0 flex-1 font-medium text-primary underline-offset-4 hover:underline"
                >
                  {item.title}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {kindLabel(item.kind)}
                </span>
                <ContentStatusBadge status={item.status} />
                <time
                  dateTime={item.updatedAt}
                  className="text-sm text-muted-foreground tabular-nums"
                >
                  {formatLastEdited(item.updatedAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

/** One plugin list's newest rows, by the panel's own columns. */
function Inbox({
  plugin,
  panel,
}: {
  readonly plugin: PluginInfo;
  readonly panel: PluginPanel;
}): JSX.Element {
  const { t } = useLingui();
  const rows = useQuery({
    queryKey: panelKey(plugin.id, panel.id, 'rows', `limit=${RECENT}`),
    queryFn: () =>
      api<{ rows: Record<string, unknown>[] }>(
        `/plugins/${plugin.id}/panels/${panel.id}?limit=${RECENT}&offset=0`,
      ),
  });
  const label = panel.label;
  useReportError(rows.error, t`Could not load rows.`);
  const list = rows.data?.rows ?? [];
  // The first three columns say who and what; a time, if there is one, last.
  const shown = panel.columns
    .filter((column) => column.type !== 'datetime')
    .slice(0, 3);
  const when = panel.columns.find((column) => column.type === 'datetime');
  const href = `/plugins/${plugin.id}/${panel.id}`;
  return (
    <section
      aria-label={label}
      className="rounded-xl border bg-card p-4 text-card-foreground"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{label}</h2>
        <Link
          to={href}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          <Trans>All {label}</Trans>
        </Link>
      </div>
      {rows.isPending ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {panel.empty ?? <Trans>Nothing has arrived yet.</Trans>}
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {list.map((row, index) => (
            <li
              key={String(row.id ?? index)}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              {shown.map((column) => (
                <span
                  key={column.field}
                  className="min-w-0 first:flex-1 first:font-medium"
                >
                  {cell(
                    row[column.field],
                    column.type,
                    panel.values?.[column.field],
                  )}
                </span>
              ))}
              {when === undefined ? null : (
                <span className="text-muted-foreground tabular-nums">
                  {typeof row[when.field] === 'string'
                    ? formatLastEdited(row[when.field] as string)
                    : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
