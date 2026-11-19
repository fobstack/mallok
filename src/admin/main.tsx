/** Admin entry point. */

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { APP_BASE, createAdminRouter } from './app.js';
import { startInterfaceLanguage } from './i18n.js';
import { queryClient } from './queries.js';
import { startThemeMode } from './theme-mode.js';
import './styles.css';

/** The first-run wizard's own address (docs/ADMIN.md §5). */
const SETUP_PATH = '/_mallok/setup';

/**
 * The wizard runs before there is a session, outside the admin's routes and
 * their sign-in gate, so it is its own small app.
 */
const SetupPage = lazy(() =>
  import('./pages/setup.js').then((module) => ({ default: module.SetupPage })),
);

startThemeMode();

// The Worker serves the shell at `/_mallok/app` too; the router knows the
// admin by its address with the slash.
if (`${window.location.pathname}/` === APP_BASE) {
  window.history.replaceState(
    window.history.state,
    '',
    `${APP_BASE}${window.location.search}${window.location.hash}`,
  );
}

const inSetup =
  window.location.pathname === SETUP_PATH ||
  window.location.pathname.startsWith(`${SETUP_PATH}/`);

const root = document.getElementById('app');
// The interface language and its catalog come first, so nothing is ever
// painted in the wrong language. Not a top-level `await`: Rolldown splits an
// entry that has one into many small chunks, which costs the first load
// several KiB of gzip framing (docs/ADMIN_I18N_AND_UI.md §8).
void startInterfaceLanguage().then(() => {
  if (root === null) {
    return;
  }
  createRoot(root).render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        {inSetup ? (
          <Suspense fallback={null}>
            <SetupPage />
          </Suspense>
        ) : (
          <RouterProvider router={createAdminRouter()} />
        )}
      </QueryClientProvider>
    </I18nProvider>,
  );
});
