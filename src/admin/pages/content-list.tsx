/**
 * All content, filterable by kind, locale and status (docs/ADMIN.md §4).
 *
 * Kinds a theme does not declare are marked rather than hidden: the content
 * and its URL survive a theme change, and the list has to say so
 * (docs/THEME_FORMAT.md §5.3).
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { navigate } from '../router.js';
import { activeLocale, notice, settings, theme } from '../state.js';
import type { ContentListItem } from '../types.js';

const PAGE = 25;

export function ContentListPage(): JSX.Element {
  const site = settings.value;
  const active = theme.value;
  const [items, setItems] = useState<readonly ContentListItem[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const locale = activeLocale.value;

  // biome-ignore lint/correctness/useExhaustiveDependencies: locale is read below (query.set('locale', locale)).
  useEffect(() => {
    void (async () => {
      setLoading(true);
      const query = new URLSearchParams({
        limit: String(PAGE),
        offset: String(offset),
      });
      if (kind !== '') {
        query.set('kind', kind);
      }
      if (status !== '') {
        query.set('status', status);
      }
      if (locale !== '') {
        query.set('locale', locale);
      }
      try {
        const result = await api<{
          items: ContentListItem[];
          hasNext: boolean;
        }>(`/content?${query.toString()}`);
        setItems(result.items);
        setHasNext(result.hasNext);
      } catch (caught) {
        notice.value =
          caught instanceof ApiError
            ? caught.message
            : 'Could not load content.';
      } finally {
        setLoading(false);
      }
    })();
  }, [kind, status, locale, offset]);

  if (site === null || active === null) {
    return <p>Loading…</p>;
  }
  const kinds = Object.keys(site.kinds);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Content</h1>
        <div className="head-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => navigate('/media')}
          >
            Media
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => navigate('/content/new')}
          >
            New
          </button>
        </div>
      </header>

      <div className="filters">
        <label className="filter">
          <span>Type</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.currentTarget.value);
              setOffset(0);
            }}
          >
            <option value="">All</option>
            {kinds.map((entry) => (
              <option key={entry} value={entry}>
                {active.kinds[entry]?.label ?? entry}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>Language</span>
          <select
            value={locale}
            onChange={(event) => {
              activeLocale.value = event.currentTarget.value;
              setOffset(0);
            }}
          >
            {site.locales.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.currentTarget.value);
              setOffset(0);
            }}
          >
            <option value="">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty">Nothing here yet.</p>
      ) : (
        <table className="rows-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Path</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const known = active.kinds[item.kind] !== undefined;
              return (
                <tr key={item.id}>
                  <td>
                    <a
                      href={`/_mallok/app/content/${item.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/content/${item.id}`);
                      }}
                    >
                      {item.title}
                    </a>
                  </td>
                  <td>
                    {item.kind}
                    {known ? null : (
                      <span
                        className="pill warn"
                        title="The active theme does not declare this type, so it renders with the page layout. The content and its URL are untouched."
                      >
                        Not in theme
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${item.status}`}>{item.status}</span>
                  </td>
                  <td>
                    <a className="code" href={item.path}>
                      {item.path}
                    </a>
                  </td>
                  <td>{item.updatedAt.slice(0, 10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <nav className="pager" aria-label="Pagination">
        <button
          type="button"
          className="ghost"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE))}
        >
          Previous
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!hasNext}
          onClick={() => setOffset(offset + PAGE)}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
