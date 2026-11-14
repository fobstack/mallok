/**
 * The route table (React Router, data mode) and the signed-in/signed-out
 * split.
 *
 * The root route's loader settles who is signed in, and for a signed-in
 * operator loads the workspace, before anything renders; the skeleton shows
 * meanwhile. Signed out, every address shows the sign-in form, and after
 * signing in the operator is on the page they asked for.
 */

import { Trans } from '@lingui/react/macro';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ComponentType, JSX } from 'react';
import { lazy, Suspense } from 'react';
import {
  createBrowserRouter,
  isRouteErrorResponse,
  Link,
  Outlet,
  useRouteError,
} from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Shell } from './components/shell.js';
import { loadShell, sessionQuery } from './queries.js';

/**
 * Where Static Assets serves the admin from. The trailing slash is kept on
 * purpose: React Router then writes the admin's home as `/_mallok/app/`,
 * the address every link and bookmark has always used.
 */
export const APP_BASE = '/_mallok/app/';

/**
 * A page whose code loads when it is first visited: the first load is the
 * shell and the page you land on, not every page in the admin
 * (docs/ADMIN_MIGRATION.md §8). The editor carries the rendering pipeline
 * and the media library the image conversion path; neither belongs in the
 * first paint.
 *
 * `React.lazy` inside the route's element rather than the route's own
 * `lazy`: React Router holds the previous page on screen until a lazy
 * route's code has arrived, so a click on "New" left the list up, live, for
 * as long as the editor took to load. The admin moves at once and shows the
 * page's outline meanwhile, as it always has. A chunk that fails to load
 * still reaches the route's error element.
 */
function page(load: () => Promise<ComponentType>): JSX.Element {
  const Page = lazy(async () => ({ default: await load() }));
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}

/**
 * A page's outline while its code arrives. Still, not pulsing: it is up for
 * a moment, and an endless animation that is then cut off mid-cycle is what
 * anything waiting for the page to settle sees as an aborted one.
 */
function PageLoading(): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-4xl" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="mt-6 h-40 w-full rounded-md bg-muted" />
    </div>
  );
}

/**
 * Creates the admin's router. A function, not a module constant: creating
 * one starts its loaders, and the setup wizard, which has no session to
 * load, must not.
 */
export function createAdminRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: loadShell,
        // The shell's data is loaded once; after that the queries keep it
        // current, and a navigation must not wait on it.
        shouldRevalidate: () => false,
        element: <Root />,
        hydrateFallbackElement: <Booting />,
        errorElement: <RouteError />,
        children: [
          {
            // A page that fails says so inside the shell, which keeps working.
            errorElement: <RouteError />,
            children: [
              {
                index: true,
                element: page(() =>
                  import('./pages/content-list.js').then(
                    (module) => module.ContentListPage,
                  ),
                ),
              },
              {
                path: 'content',
                element: page(() =>
                  import('./pages/content-list.js').then(
                    (module) => module.ContentListPage,
                  ),
                ),
              },
              {
                path: 'content/:id',
                element: page(() =>
                  import('./pages/editor.js').then(
                    (module) => module.EditorRoute,
                  ),
                ),
              },
              {
                path: 'media',
                element: page(() =>
                  import('./pages/media.js').then((module) => module.MediaPage),
                ),
              },
              {
                path: 'plugins',
                element: page(() =>
                  import('./pages/plugins.js').then(
                    (module) => module.PluginsPage,
                  ),
                ),
              },
              {
                path: 'settings',
                element: page(() =>
                  import('./pages/settings-site.js').then(
                    (module) => module.SiteSettingsPage,
                  ),
                ),
              },
              {
                path: 'settings/appearance',
                element: page(() =>
                  import('./pages/settings-appearance.js').then(
                    (module) => module.AppearancePage,
                  ),
                ),
              },
              {
                path: 'settings/email',
                element: page(() =>
                  import('./pages/settings-email.js').then(
                    (module) => module.EmailSettingsPage,
                  ),
                ),
              },
              {
                path: 'settings/advanced',
                element: page(() =>
                  import('./pages/settings-advanced.js').then(
                    (module) => module.AdvancedPage,
                  ),
                ),
              },
              {
                path: 'account',
                element: page(() =>
                  import('./pages/account.js').then(
                    (module) => module.AccountPage,
                  ),
                ),
              },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
    { basename: APP_BASE },
  );
}

/** Signed in, the shell around the page; signed out, the sign-in form. */
function Root(): JSX.Element {
  const session = useSuspenseQuery(sessionQuery).data;
  if (session === null) {
    return <LoginRoute />;
  }
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/**
 * The sign-in form, loaded the first time it is needed. Not a route of its
 * own: that would move the address away from the page the operator asked
 * for.
 */
const LoginPage = lazy(() =>
  import('./pages/login.js').then((module) => ({ default: module.LoginPage })),
);

function LoginRoute(): JSX.Element {
  return (
    <Suspense fallback={<Booting />}>
      <LoginPage />
    </Suspense>
  );
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

function NotFound(): JSX.Element {
  return (
    <div className="w-full">
      <Card className="mx-auto mt-8 max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>
              <Trans>Not found</Trans>
            </h1>
          </CardTitle>
          <CardDescription>
            <Trans>There is no page at this address in the admin.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/">
              <Trans>Back to content</Trans>
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A route that failed: its code did not arrive, or it threw while loading
 * or rendering. Said plainly, with the way out.
 */
function RouteError(): JSX.Element {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '';
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <p className="text-sm text-destructive" role="alert">
        This part of the admin could not be loaded. Check your connection and
        reload.
      </p>
      {detail === '' ? null : (
        <p className="mt-2 font-mono text-xs text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}
