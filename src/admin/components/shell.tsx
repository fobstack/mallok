/**
 * The signed-in frame: three top-level areas plus a user menu
 * (docs/ADMIN.md §4). New pages must belong to one of the three; if a page
 * fits nowhere, that is a sign it is internal complexity leaking out.
 */

import type { JSX, ReactNode } from 'react';
import { navigate, route } from '../router.js';
import { notice, session, settings, signOut } from '../state.js';
import { PurgeNotice } from './saved-note.js';

interface NavItem {
  readonly label: string;
  readonly href: string;
  /** Also active for any route under this prefix. */
  readonly prefix: string;
}

const AREAS: readonly NavItem[] = [
  { label: 'Content', href: '/', prefix: '/content' },
  { label: 'Settings', href: '/settings', prefix: '/settings' },
  { label: 'Plugins', href: '/plugins', prefix: '/plugins' },
];

function isActive(item: NavItem, path: string): boolean {
  if (item.href === '/') {
    return path === '/' || path.startsWith('/content');
  }
  return path === item.href || path.startsWith(`${item.prefix}/`);
}

export function Shell({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const path = route.value;
  const current = session.value;
  const email =
    current === false || current === null ? '' : (current.email ?? '');
  return (
    <div className="shell">
      <header className="topbar">
        <a
          className="brand"
          href="/_mallok/app/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <span className="mark" aria-hidden="true">
            M
          </span>
          <span>{settings.value?.name ?? 'Mallok'}</span>
        </a>
        <nav aria-label="Sections">
          {AREAS.map((item) => (
            <a
              key={item.href}
              href={`/_mallok/app${item.href}`}
              {...(isActive(item, path) ? { 'aria-current': 'page' } : {})}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.href);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="user">
          <a
            href="/_mallok/app/account"
            onClick={(event) => {
              event.preventDefault();
              navigate('/account');
            }}
          >
            {email === '' ? 'Account' : email}
          </a>
          <button
            type="button"
            className="ghost"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </header>
      <PurgeNotice />
      {notice.value === '' ? null : (
        <div className="banner" role="alert">
          <span>{notice.value}</span>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              notice.value = '';
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <main>{children}</main>
    </div>
  );
}
