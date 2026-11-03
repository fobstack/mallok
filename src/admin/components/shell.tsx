/**
 * The frame every signed-in page sits in (docs/ADMIN_MIGRATION.md, D4).
 *
 * A collapsible sidebar holds the sections and, at its foot, the account
 * menu; on a narrow screen it becomes a sheet. The bar above the page says
 * where you are. Errors a page reports with `notify` appear as toasts;
 * the standing no-purge-token warning stays as an alert above the page,
 * because it is true until someone configures the token.
 */

import {
  ChevronsUpDown,
  FileText,
  Image,
  Mail,
  Palette,
  Plug,
  Settings2,
  Wrench,
} from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { lazy, Suspense, useState } from 'react';
import { Link, useLocation } from 'react-router';
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
import { clearNotice, useNotice } from '../notice.js';
import { useSession, useSettings } from '../queries.js';
import { PurgeNotice } from './saved-note.js';

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: typeof FileText;
  /** Whether the item is the current section for `path`. */
  readonly active: (path: string) => boolean;
}

const SITE: readonly NavItem[] = [
  {
    label: 'Content',
    href: '/',
    icon: FileText,
    active: (path) => path === '/' || path.startsWith('/content'),
  },
  {
    label: 'Media',
    href: '/media',
    icon: Image,
    active: (path) => path === '/media',
  },
  {
    label: 'Plugins',
    href: '/plugins',
    icon: Plug,
    active: (path) => path === '/plugins',
  },
];

const SETTINGS: readonly NavItem[] = [
  {
    label: 'Site',
    href: '/settings',
    icon: Settings2,
    active: (path) => path === '/settings',
  },
  {
    label: 'Appearance',
    href: '/settings/appearance',
    icon: Palette,
    active: (path) => path === '/settings/appearance',
  },
  {
    label: 'Email',
    href: '/settings/email',
    icon: Mail,
    active: (path) => path === '/settings/email',
  },
  {
    label: 'Advanced',
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
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = item.active(path);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={item.label}
                >
                  <AppLink
                    href={item.href}
                    {...(active ? { 'aria-current': 'page' as const } : {})}
                  >
                    <item.icon />
                    <span>{item.label}</span>
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
  return (
    <SidebarMenuButton
      size="lg"
      aria-label="Account menu"
      aria-haspopup="menu"
      {...(busy ? { 'aria-busy': true } : {})}
      onClick={onOpen}
    >
      <span className="truncate">{email === '' ? 'Account' : email}</span>
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
function crumbsFor(path: string): readonly {
  readonly label: string;
  readonly href?: string;
}[] {
  if (path === '/' || path === '/content') {
    return [{ label: 'Content' }];
  }
  if (path.startsWith('/content/')) {
    return [
      { label: 'Content', href: '/' },
      { label: path === '/content/new' ? 'New item' : 'Edit' },
    ];
  }
  const setting = SETTINGS.find((item) => item.href === path);
  if (setting !== undefined) {
    return [{ label: 'Settings', href: '/settings' }, { label: setting.label }];
  }
  const area = SITE.find((item) => item.href === path);
  if (area !== undefined) {
    return [{ label: area.label }];
  }
  if (path === '/account') {
    return [{ label: 'Account' }];
  }
  return [{ label: 'Not found' }];
}

function PageBreadcrumb({ path }: { readonly path: string }): JSX.Element {
  const crumbs = crumbsFor(path);
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => (
          <BreadcrumbItem key={crumb.label}>
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
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <NavGroup label="Site" items={SITE} path={path} />
            <NavGroup label="Settings" items={SETTINGS} path={path} />
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
            <PageBreadcrumb path={path} />
          </header>
          <PurgeNotice />
          <div className="mx-auto w-full max-w-[68rem] p-[clamp(1.2rem,3vw,2.2rem)]">
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
