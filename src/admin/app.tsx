/**
 * Route table and the signed-in/signed-out split.
 */

import type { JSX } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { lazyRoute } from './components/lazy.js';
import { Shell } from './components/shell.js';
import { match, navigate, route } from './router.js';
import { ready, session } from './state.js';

/**
 * The editor and the media library load on demand: the editor carries the
 * rendering pipeline (its preview is the real renderer) and the library
 * carries the image conversion path. Neither belongs in the first paint.
 */
// Every page loads with its route: the first load is the shell and the page
// you land on, not every page in the admin (docs/ADMIN_MIGRATION.md §8).
const AccountPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/account.js').then((module) => module.AccountPage),
);
const ContentListPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/content-list.js').then((module) => module.ContentListPage),
);
const LoginPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/login.js').then((module) => module.LoginPage),
);
const AdvancedPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/settings-advanced.js').then((module) => module.AdvancedPage),
);
const AppearancePage = lazyRoute<Record<string, never>>(() =>
  import('./pages/settings-appearance.js').then(
    (module) => module.AppearancePage,
  ),
);
const EmailSettingsPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/settings-email.js').then(
    (module) => module.EmailSettingsPage,
  ),
);
const SiteSettingsPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/settings-site.js').then((module) => module.SiteSettingsPage),
);
const EditorPage = lazyRoute<{ id: string }>(() =>
  import('./pages/editor.js').then((module) => module.EditorPage),
);
const MediaPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/media.js').then((module) => module.MediaPage),
);
const PluginsPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/plugins.js').then((module) => module.PluginsPage),
);
const SetupPage = lazyRoute<Record<string, never>>(() =>
  import('./pages/setup.js').then((module) => module.SetupPage),
);

/**
 * A settings page. The sections are in the sidebar now; this only keeps the
 * call sites below readable while the pages move (docs/ADMIN_MIGRATION.md).
 */
function SettingsLayout({
  children,
}: {
  readonly children: JSX.Element;
}): JSX.Element {
  return children;
}

function NotFound(): JSX.Element {
  return (
    <div className="page">
      <Card className="mx-auto mt-8 max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>Not found</h1>
          </CardTitle>
          <CardDescription>
            There is no page at this address in the admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a
              href="/_mallok/app/"
              onClick={(event) => {
                event.preventDefault();
                navigate('/');
              }}
            >
              Back to content
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function resolve(path: string): JSX.Element {
  if (path === '/' || path === '/content') {
    return <ContentListPage />;
  }
  if (path === '/settings') {
    return (
      <SettingsLayout>
        <SiteSettingsPage />
      </SettingsLayout>
    );
  }
  if (path === '/settings/appearance') {
    return (
      <SettingsLayout>
        <AppearancePage />
      </SettingsLayout>
    );
  }
  if (path === '/settings/email') {
    return (
      <SettingsLayout>
        <EmailSettingsPage />
      </SettingsLayout>
    );
  }
  if (path === '/settings/advanced') {
    return (
      <SettingsLayout>
        <AdvancedPage />
      </SettingsLayout>
    );
  }
  if (path === '/account') {
    return <AccountPage />;
  }
  if (path === '/media') {
    return <MediaPage />;
  }
  if (path === '/plugins') {
    return <PluginsPage />;
  }
  const editing = match('/content/:id', path);
  if (editing !== null) {
    return <EditorPage id={editing.id ?? 'new'} key={editing.id} />;
  }
  return <NotFound />;
}

/** What shows while the session and settings load: the shell's outline. */
function Booting(): JSX.Element {
  return (
    <div className="flex min-h-svh" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="hidden w-64 flex-col gap-3 border-r p-4 md:flex">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full max-w-4xl" />
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  // The wizard runs before there is a session to restore, so it is checked
  // before the signed-in/signed-out split (docs/ADMIN.md §5).
  if (route.value === '/setup') {
    return <SetupPage />;
  }
  if (!ready.value) {
    return <Booting />;
  }
  if (session.value === false) {
    return <LoginPage />;
  }
  return <Shell>{resolve(route.value)}</Shell>;
}
