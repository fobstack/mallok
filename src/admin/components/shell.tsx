/**
 * The frame every signed-in page sits in (docs/ADMIN_MIGRATION.md, D4).
 *
 * A collapsible sidebar holds the sections and, at its foot, the account
 * menu; on a narrow screen it becomes a sheet. The bar above the page says
 * where you are. Errors a page reports with `notify` appear as toasts;
 * the standing no-purge-token warning stays as an alert above the page,
 * because it is true until someone configures the token.
 */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronsUpDown,
  Clock,
  ExternalLink,
  FileText,
  Image,
  List,
  Mail,
  Palette,
  Plug,
  Settings2,
  Wrench,
} from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { lazy, Suspense, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Alert, AlertTitle } from '@/components/ui/alert';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import {
  SIDEBAR_STORAGE_KEY,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { formatDuration } from '../format.js';
import { clearNotice, useNotice } from '../notice.js';
import {
  pluginsQuery,
  useLiveDelay,
  useSession,
  useSettings,
} from '../queries.js';
import type { PluginInfo } from '../types.js';

interface NavItem {
  /** Words the admin translates, or a plugin's label already in them. */
  readonly label: MessageDescriptor | string;
  readonly href: string;
  readonly icon: typeof FileText;
  /** Whether the item is the current section for `path`. */
  readonly active: (path: string) => boolean;
}

const SITE: readonly NavItem[] = [
  {
    label: msg`Content`,
    href: '/',
    icon: FileText,
    active: (path) => path === '/' || path.startsWith('/content'),
  },
  {
    label: msg`Media`,
    href: '/media',
    icon: Image,
    active: (path) => path === '/media',
  },
  {
    label: msg`Plugins`,
    href: '/plugins',
    icon: Plug,
    active: (path) => path === '/plugins',
  },
];

const SETTINGS: readonly NavItem[] = [
  {
    label: msg`Site`,
    href: '/settings',
    icon: Settings2,
    active: (path) => path === '/settings',
  },
  {
    label: msg`Appearance`,
    href: '/settings/appearance',
    icon: Palette,
    active: (path) => path === '/settings/appearance',
  },
  {
    label: msg`Email`,
    href: '/settings/email',
    icon: Mail,
    active: (path) => path === '/settings/email',
  },
  {
    label: msg`Advanced`,
    href: '/settings/advanced',
    icon: Wrench,
    active: (path) => path === '/settings/advanced',
  },
];

/** Whether the sidebar was left open in this browser; open by default. */
function sidebarWasOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** A link that moves inside the app without a reload. */
function AppLink({
  href,
  children,
  ...props
}: {
  readonly href: string;
  readonly children: ReactNode;
} & Omit<JSX.IntrinsicElements['a'], 'href'>): JSX.Element {
  return (
    <Link {...props} to={href}>
      {children}
    </Link>
  );
}

function NavGroup({
  label,
  items,
  path,
}: {
  readonly label: string;
  readonly items: readonly NavItem[];
  readonly path: string;
}): JSX.Element {
  const { i18n } = useLingui();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = item.active(path);
            const label =
              typeof item.label === 'string' ? item.label : i18n._(item.label);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={active} tooltip={label}>
                  <AppLink
                    href={item.href}
                    {...(active ? { 'aria-current': 'page' as const } : {})}
                  >
                    <item.icon />
                    <span>{label}</span>
                  </AppLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Loaded on the first click: a closed menu is a button and nothing more. */
const AccountMenu = lazy(() =>
  import('./account-menu.js').then((module) => ({
    default: module.AccountMenu,
  })),
);

/** The menu's trigger, before the menu itself has been asked for. */
function AccountButton({
  email,
  busy = false,
  onOpen,
}: {
  readonly email: string;
  readonly busy?: boolean;
  readonly onOpen?: () => void;
}): JSX.Element {
  const { t } = useLingui();
  return (
    <SidebarMenuButton
      size="lg"
      aria-label={t`Account menu`}
      aria-haspopup="menu"
      {...(busy ? { 'aria-busy': true } : {})}
      onClick={onOpen}
    >
      <span className="truncate">{email === '' ? t`Account` : email}</span>
      <ChevronsUpDown className="ml-auto" />
    </SidebarMenuButton>
  );
}

function AccountEntry(): JSX.Element {
  const [wanted, setWanted] = useState(false);
  const email = useSession().email ?? '';
  return wanted ? (
    <Suspense fallback={<AccountButton email="" busy />}>
      <AccountMenu email={email} />
    </Suspense>
  ) : (
    <AccountButton email={email} onOpen={() => setWanted(true)} />
  );
}

/** Loaded with the first toast: most sessions report no failure. */
const ToastHost = lazy(() =>
  import('./toast-host.js').then((module) => ({ default: module.ToastHost })),
);

/** Set once a page has reported something; the toasts stay loaded after. */
let toastsWanted = false;

/** Where the current page sits: a section, and the page within it. */
function crumbsFor(
  path: string,
  plugins: readonly PluginInfo[],
): readonly {
  readonly label: MessageDescriptor | string;
  readonly href?: string;
}[] {
  if (path === '/' || path === '/content') {
    return [{ label: msg`Content` }];
  }
  if (path.startsWith('/content/')) {
    return [
      { label: msg`Content`, href: '/' },
      { label: path === '/content/new' ? msg`New item` : msg`Edit` },
    ];
  }
  const setting = SETTINGS.find((item) => item.href === path);
  if (setting !== undefined) {
    return [
      { label: msg`Settings`, href: '/settings' },
      { label: setting.label },
    ];
  }
  const area = SITE.find((item) => item.href === path);
  if (area !== undefined) {
    return [{ label: area.label }];
  }
  if (path === '/account') {
    return [{ label: msg`Account` }];
  }
  const [, section, pluginId, panelId] = path.split('/');
  if (section === 'plugins' && panelId !== undefined) {
    const panel = plugins
      .find((plugin) => plugin.id === pluginId)
      ?.panels.find((entry) => entry.id === panelId);
    if (panel !== undefined) {
      return [
        { label: msg`Plugins`, href: '/plugins' },
        { label: panel.label },
      ];
    }
  }
  return [{ label: msg`Not found` }];
}

function PageBreadcrumb({
  path,
  plugins,
}: {
  readonly path: string;
  readonly plugins: readonly PluginInfo[];
}): JSX.Element {
  const { i18n } = useLingui();
  const crumbs = crumbsFor(path, plugins).map((crumb) => ({
    ...crumb,
    label: typeof crumb.label === 'string' ? crumb.label : i18n._(crumb.label),
  }));
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => (
          <BreadcrumbItem key={crumb.href ?? index}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            {crumb.href === undefined || index === crumbs.length - 1 ? (
              <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <AppLink href={crumb.href}>{crumb.label}</AppLink>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The site's sections with each plugin panel between Media and Plugins: a
 * list that is opened every day is a section, not the foot of a settings
 * page (docs/ADMIN_I18N_AND_UI.md, U3). A panel attached to a content kind
 * is in that kind's editor and is not listed.
 */
function siteItems(plugins: readonly PluginInfo[]): readonly NavItem[] {
  const panels: NavItem[] = plugins.flatMap((plugin) =>
    plugin.panels
      .filter((panel) => panel.attachTo === undefined)
      .map((panel) => {
        const href = `/plugins/${plugin.id}/${panel.id}`;
        return {
          label: panel.label,
          href,
          icon: List,
          active: (path: string) => path === href,
        };
      }),
  );
  const [content, media, ...rest] = SITE;
  return content === undefined || media === undefined
    ? SITE
    : [content, media, ...panels, ...rest];
}

export function Shell({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  // In-app, trailing slash or not: `/settings/` is the Site page too.
  const path = useLocation().pathname.replace(/\/+$/, '') || '/';
  // A page reports a failure with `notify`; it is shown as a toast.
  const message = useNotice();
  const siteName = useSettings().name;
  // Loaded with the shell (`loadShell`); empty only if that request failed.
  const plugins = useQuery(pluginsQuery).data?.plugins ?? [];
  const { t } = useLingui();
  if (message !== '') {
    toastsWanted = true;
  }

  return (
    // The collapsed sidebar names its icons with tooltips, and shadcn/ui's
    // tooltips need one provider above them.
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarWasOpen()}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" asChild>
                  <AppLink href="/">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-sm text-primary-foreground"
                      aria-hidden="true"
                    >
                      M
                    </span>
                    <span className="truncate font-medium">{siteName}</span>
                  </AppLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                {/* The public site, which the admin had no way to open (U3).
                    The Worker serving this admin serves the site at its
                    root, on whichever address the operator came in by. */}
                <SidebarMenuButton asChild tooltip={t`View site`}>
                  <a href="/" target="_blank" rel="noopener">
                    <ExternalLink />
                    <span>
                      <Trans>View site</Trans>
                    </span>
                    <span className="sr-only">
                      <Trans>(opens in a new tab)</Trans>
                    </span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <NavGroup label={t`Site`} items={siteItems(plugins)} path={path} />
            <NavGroup label={t`Settings`} items={SETTINGS} path={path} />
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <AccountEntry />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            {/* No transition: the sheet it opens takes the pointer, which ends the
                button's hover mid-fade, and a fade cut off that way is an
                aborted animation to anything waiting for the page to settle. */}
            <SidebarTrigger className="-ml-1 transition-none" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <PageBreadcrumb path={path} plugins={plugins} />
          </header>
          {/* The notice inside the column, not across the window: it, the
              page header and the page share one left edge (U2). The column
              starts beside the sidebar, never centred, and the page says how
              far it reaches (`Page width`, D7), the notice with it. */}
          <div className="flex w-full max-w-[56rem] flex-col gap-6 p-[clamp(1.2rem,3vw,2.2rem)] has-[[data-page-width=list]]:max-w-[90rem] has-[[data-page-width=home]]:max-w-[68rem] has-[[data-page-width=full]]:max-w-none">
            <PurgeNotice />
            {children}
          </div>
        </SidebarInset>
        {toastsWanted ? (
          <Suspense fallback={null}>
            <ToastHost message={message} onShown={clearNotice} />
          </Suspense>
        ) : null}
      </SidebarProvider>
    </TooltipProvider>
  );
}

/**
 * The standing note shown while no purge token is configured. It stays up
 * rather than appearing once, because the condition is permanent until
 * someone configures the token. One line, above every page: what it means
 * for the operator, and a link to the infrastructure detail, which belongs
 * on Advanced (docs/ADMIN.md §2; docs/ADMIN_I18N_AND_UI.md, U1).
 */
function PurgeNotice(): JSX.Element | null {
  const delay = useLiveDelay();
  if (delay.instant) {
    return null;
  }
  const within = formatDuration(delay.seconds);
  return (
    // A standing note, not an alert: it is true from the first render until
    // someone configures the token, and must not interrupt a screen reader.
    <Alert role="note" className="py-2">
      <Clock />
      <AlertTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-normal">
        <span className="font-medium">
          <Trans>Changes reach visitors within {within}</Trans>
        </span>
        <Link
          to="/settings/advanced#diagnostics"
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          <Trans>Why?</Trans>
        </Link>
      </AlertTitle>
    </Alert>
  );
}
