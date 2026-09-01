/**
 * Route table and the signed-in/signed-out split.
 */

import type { JSX } from 'preact';
import { lazyRoute } from './components/lazy.js';
import { Shell } from './components/shell.js';
import { AccountPage } from './pages/account.js';
import { ContentListPage } from './pages/content-list.js';
import { LoginPage } from './pages/login.js';
import { AdvancedPage } from './pages/settings-advanced.js';
import { AppearancePage } from './pages/settings-appearance.js';
import { SiteSettingsPage } from './pages/settings-site.js';
import { match, navigate, route } from './router.js';
import { ready, session } from './state.js';

/**
 * The editor and the media library load on demand: the editor carries the
 * rendering pipeline (its preview is the real renderer) and the library
 * carries the image conversion path. Neither belongs in the first paint.
 */
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

const SETTINGS_TABS = [
  { href: '/settings', label: 'Site' },
  { href: '/settings/appearance', label: 'Appearance' },
  { href: '/settings/advanced', label: 'Advanced' },
] as const;

function SettingsLayout({
  children,
}: {
  readonly children: JSX.Element;
}): JSX.Element {
  const path = route.value;
  return (
    <div class="with-tabs">
      <nav class="tabs" aria-label="Settings sections">
        {SETTINGS_TABS.map((tab) => (
          <a
            key={tab.href}
            href={`/_mallok/app${tab.href}`}
            {...(path === tab.href ? { 'aria-current': 'page' } : {})}
            onClick={(event) => {
              event.preventDefault();
              navigate(tab.href);
            }}
          >
            {tab.label}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}

function NotFound(): JSX.Element {
  return (
    <div class="page">
      <h1>Not found</h1>
      <p>
        <a
          href="/_mallok/app/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          Back to content
        </a>
      </p>
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

export function App(): JSX.Element {
  // The wizard runs before there is a session to restore, so it is checked
  // before the signed-in/signed-out split (docs/ADMIN.md §5).
  if (route.value === '/setup') {
    return <SetupPage />;
  }
  if (!ready.value) {
    return <div class="booting">Loading…</div>;
  }
  if (session.value === false) {
    return <LoginPage />;
  }
  return <Shell>{resolve(route.value)}</Shell>;
}
