/**
 * The three-pane content editor (docs/ADMIN.md §6).
 *
 * Two rules shape everything here:
 *
 * 1. **The Markdown is the truth.** The field form edits front matter; on
 *    save the block is re-serialised and joined back onto the body. Opening
 *    and closing an item without editing must leave `markdown` byte-identical
 *    (docs/ADMIN.md §6.2).
 * 2. **The preview is the real renderer.** It runs `src/core`, not a
 *    look-alike, so it cannot drift from what visitors get.
 */

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  buildPublicPath,
  joinFrontmatter,
  splitFrontmatter,
} from '../../core/index.js';
import { ApiError, api } from '../api.js';
import { MarkdownEditor } from '../components/markdown-editor.js';
import { MediaPicker } from '../components/media-library.js';
import { SavedNote } from '../components/saved-note.js';
import { SchemaForm } from '../form/form.js';
import { toSpecs } from '../form/types.js';
import { renderPreview } from '../preview.js';
import { navigate } from '../router.js';
import { activeLocale, notice, settings, theme } from '../state.js';
import type { MediaItem } from '../types.js';

/** One translation slot, whether or not it exists yet. */
interface TranslationSlot {
  readonly locale: string;
  readonly exists: boolean;
  readonly id?: string;
  readonly path?: string;
  readonly title?: string;
  readonly status?: string;
}

interface LoadedContent {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly path: string;
  readonly status: 'draft' | 'scheduled' | 'published';
  readonly translationGroup: string;
  readonly markdown: string;
  readonly assets: Readonly<Record<string, string>>;
  readonly translations: readonly TranslationSlot[];
}

const PREVIEW_DEBOUNCE_MS = 250;

export function EditorPage({ id }: { readonly id: string }): JSX.Element {
  const site = settings.value;
  const active = theme.value;
  const isNew = id === 'new';

  const [loaded, setLoaded] = useState<LoadedContent | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [kind, setKind] = useState('page');
  const [slug, setSlug] = useState('');
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [media, setMedia] = useState<Record<string, MediaItem>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState('');
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [picker, setPicker] = useState<{
    kind: 'image' | 'file';
    resolve: (path: string | null) => void;
  } | null>(null);

  // --- load -----------------------------------------------------------
  useEffect(() => {
    void (async () => {
      if (isNew) {
        const firstKind = Object.keys(site?.kinds ?? { page: {} })[0] ?? 'page';
        setKind(firstKind);
        setMarkdown('---\ntitle: Untitled\n---\n\n');
        return;
      }
      try {
        const item = await api<LoadedContent>(`/content/${id}`);
        setLoaded(item);
        setMarkdown(item.markdown);
        setKind(item.kind);
        setSlug(item.slug);
        setAssets(item.assets);
        activeLocale.value = item.locale;
      } catch (caught) {
        notice.value =
          caught instanceof ApiError ? caught.message : 'Could not load.';
      }
    })();
  }, [id]);

  // Media rows for whatever the item references, so the preview can resolve
  // relative paths exactly as the server does.
  useEffect(() => {
    const hashes = [...new Set(Object.values(assets))];
    if (hashes.length === 0) {
      setMedia({});
      return;
    }
    void (async () => {
      const rows = await Promise.all(
        hashes.map((sha) => api<MediaItem>(`/media/${sha}`).catch(() => null)),
      );
      const map: Record<string, MediaItem> = {};
      for (const row of rows) {
        if (row !== null) {
          map[row.sha256] = row;
        }
      }
      setMedia(map);
    })();
  }, [assets]);

  // --- front matter <-> form ------------------------------------------
  const parsed = useMemo(() => splitFrontmatter(markdown), [markdown]);
  const frontmatter = parsed.data;

  const specs = useMemo(() => {
    const declared = active?.kinds[kind]?.fields ?? {};
    // The always-present fields come first, then whatever the theme declares
    // for this kind (docs/THEME_FORMAT.md §5.2).
    return [
      {
        name: 'title',
        field: { type: 'string' as const, label: 'Title', required: true },
      },
      {
        name: 'description',
        field: {
          type: 'text' as const,
          label: 'Description',
          required: false,
          help: 'Used as the meta description and in listings. Derived from the body when empty.',
        },
      },
      ...toSpecs(declared),
    ];
  }, [active, kind]);

  const setField = (name: string, value: unknown): void => {
    const next = { ...frontmatter };
    if (value === undefined || value === '' || value === null) {
      delete next[name];
    } else {
      next[name] = value;
    }
    // Re-serialising is a user edit, not a round trip, so rewriting the block
    // is allowed here (docs/ADMIN.md §6.2).
    setMarkdown(joinFrontmatter(next, parsed.body));
    setDirty(true);
  };

  // --- preview ---------------------------------------------------------
  const previewTimer = useRef<number>(0);
  useEffect(() => {
    if (site === null || active === null) {
      return;
    }
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await renderPreview({
            theme: active,
            settings: site,
            markdown,
            kind,
            locale: activeLocale.value,
            slug: slug === '' ? 'preview' : slug,
            path: loaded?.path ?? '/preview',
            assets,
            media,
          });
          setPreview(result.html);
          setMissing(result.missing);
        } catch (caught) {
          setPreview(
            `<p style="padding:1rem;color:#a11d33">Preview failed: ${
              caught instanceof Error ? caught.message : 'unknown error'
            }</p>`,
          );
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(previewTimer.current);
  }, [markdown, kind, slug, assets, media, site, active]);

  // Leaving with unsaved work must be deliberate (docs/ADMIN.md §13).
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent): void => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  if (site === null || active === null) {
    return <p>Loading…</p>;
  }

  const pickMedia = (mediaKind: 'image' | 'file'): Promise<string | null> =>
    new Promise((resolve) => setPicker({ kind: mediaKind, resolve }));

  const save = async (status: 'draft' | 'published'): Promise<void> => {
    setBusy(true);
    setSaved(false);
    try {
      const result = await api<{ id: string; path: string }>('/content', {
        method: 'POST',
        body: {
          ...(loaded === null ? {} : { id: loaded.id }),
          kind,
          locale: activeLocale.value,
          ...(slug === '' ? {} : { slug }),
          ...(loaded === null
            ? {}
            : { translationGroup: loaded.translationGroup }),
          markdown,
          assets,
          status,
        },
      });
      setDirty(false);
      setSaved(true);
      if (loaded === null) {
        navigate(`/content/${result.id}`, true);
      }
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
    } finally {
      setBusy(false);
    }
  };

  const kinds = Object.keys(site.kinds);
  const previewPath =
    loaded?.path ??
    buildPublicPath({
      kind,
      locale: activeLocale.value,
      defaultLocale: site.defaultLocale,
      slug: slug === '' ? 'preview' : slug,
      base: site.kinds[kind]?.base ?? '',
    });

  return (
    <div class="editor">
      <div class="editor-bar">
        <button type="button" class="ghost" onClick={() => navigate('/')}>
          ← All content
        </button>
        <label class="filter">
          <span>Type</span>
          <select
            value={kind}
            disabled={loaded !== null}
            onChange={(event) => {
              setKind(event.currentTarget.value);
              setDirty(true);
            }}
          >
            {kinds.map((entry) => (
              <option key={entry} value={entry}>
                {active.kinds[entry]?.label ?? entry}
              </option>
            ))}
          </select>
        </label>
        <label class="filter">
          <span>Slug</span>
          <input
            value={slug}
            placeholder="derived from the title"
            onInput={(event) => {
              setSlug(event.currentTarget.value);
              setDirty(true);
            }}
          />
        </label>
        <span class="grow" />
        {missing.length === 0 ? null : (
          <span class="pill warn" title={missing.join(', ')}>
            {missing.length} image{missing.length === 1 ? '' : 's'} missing
          </span>
        )}
        {dirty ? <span class="pill">Unsaved</span> : null}
        {saved && !dirty ? <SavedNote /> : null}
        <button
          type="button"
          class="ghost"
          disabled={busy}
          onClick={() => void save('draft')}
        >
          Save draft
        </button>
        <button
          type="button"
          class="primary"
          disabled={busy}
          onClick={() => void save('published')}
        >
          {busy ? 'Saving…' : 'Publish'}
        </button>
      </div>

      {loaded === null ? null : (
        <TranslationBar
          translations={loaded.translations}
          current={loaded.locale}
          group={loaded.translationGroup}
          kind={loaded.kind}
        />
      )}

      <div class="editor-panes">
        <aside class="pane pane-fields">
          <SchemaForm
            specs={specs}
            values={frontmatter}
            idPrefix="fm"
            onChange={setField}
            pickMedia={pickMedia}
            previewUrl={(path) => {
              const sha = assets[path];
              return sha === undefined ? null : (media[sha]?.url ?? null);
            }}
          />
        </aside>
        <section class="pane pane-source">
          <MarkdownEditor
            value={markdown}
            missing={missing}
            onChange={(value) => {
              setMarkdown(value);
              setDirty(true);
            }}
          />
        </section>
        <section class="pane pane-preview">
          {/*
            `allow-same-origin` **without** `allow-scripts` is the safe
            combination: the frame can load the theme's stylesheet (a fully
            sandboxed srcdoc document has an opaque origin and fetches
            nothing, so the preview rendered unstyled), while script
            execution stays forbidden — which is the actual attack the
            sandbox is there to stop. Granting both together would be the
            dangerous pairing. The body is sanitized before it gets here.
          */}
          <iframe
            title="Preview"
            class="preview-frame"
            sandbox="allow-same-origin"
            srcdoc={preview}
          />
          <p class="help preview-note">
            Rendered by the same code the site runs — {previewPath}
          </p>
        </section>
      </div>

      {picker === null ? null : (
        <MediaPicker
          kind={picker.kind}
          onPick={(path, item) => {
            setAssets((previous) => ({ ...previous, [path]: item.sha256 }));
            picker.resolve(path);
          }}
          onClose={() => {
            picker.resolve(null);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The language switcher. A translation is its own content row with its own
 * Markdown, status and slug (docs/ARCHITECTURE.md §9), so this navigates
 * between siblings rather than swapping a field.
 */
function TranslationBar(props: {
  readonly translations: readonly TranslationSlot[];
  readonly current: string;
  readonly group: string;
  readonly kind: string;
}): JSX.Element | null {
  if (props.translations.length < 2) {
    return null;
  }
  return (
    <nav class="translations" aria-label="Translations">
      {props.translations.map((slot) => {
        if (slot.locale === props.current) {
          return (
            <span key={slot.locale} class="pill ok">
              {slot.locale}
            </span>
          );
        }
        if (slot.exists && slot.id !== undefined) {
          return (
            <button
              key={slot.locale}
              type="button"
              class="ghost"
              onClick={() => navigate(`/content/${slot.id}`)}
            >
              {slot.locale}
            </button>
          );
        }
        return (
          <button
            key={slot.locale}
            type="button"
            class="ghost"
            onClick={() =>
              navigate(
                `/content/new?locale=${slot.locale}&group=${props.group}&kind=${props.kind}`,
              )
            }
          >
            Create {slot.locale}
          </button>
        );
      })}
    </nav>
  );
}
