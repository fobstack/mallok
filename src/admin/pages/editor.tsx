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

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  buildPublicPath,
  joinFrontmatter,
  splitFrontmatter,
} from '../../core/index.js';
import { ApiError, api } from '../api.js';
import { MarkdownEditor } from '../components/markdown-editor.js';
import { MediaPicker } from '../components/media-library.js';
import { StatusBadge } from '../components/page.js';
import { PluginPanelView } from '../components/plugin-panel.js';
import { SavedNote } from '../components/saved-note.js';
import { SchemaForm } from '../form/form.js';
import { toSpecs } from '../form/types.js';
import { notify, useReportError } from '../notice.js';
import { renderPreview } from '../preview.js';
import { keys, pluginsQuery, useSettings, useTheme } from '../queries.js';
import { normalizeSlugInput } from '../slug.js';
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

/** What a new item starts from when it is a translation of another. */
interface NewItem {
  readonly locale: string | null;
  readonly group: string | null;
  readonly kind: string | null;
}

/**
 * The editor's route: `content/:id`, or `content/new` with the language,
 * translation group and kind a new translation belongs to in the address.
 * A different item, or a different new one, is a different editor.
 */
export function EditorRoute(): JSX.Element {
  const { id = 'new' } = useParams();
  const [search] = useSearchParams();
  const fresh: NewItem = {
    locale: search.get('locale'),
    group: search.get('group'),
    kind: search.get('kind'),
  };
  return (
    <EditorPage key={`${id}?${search.toString()}`} id={id} fresh={fresh} />
  );
}

/** Loads the item, then opens the editor on it. */
function EditorPage({
  id,
  fresh,
}: {
  readonly id: string;
  readonly fresh: NewItem;
}): JSX.Element {
  const isNew = id === 'new';
  const item = useQuery({
    queryKey: [...keys.content, 'item', id],
    queryFn: () => api<LoadedContent>(`/content/${id}`),
    enabled: !isNew,
    // Opened to be edited: always as stored now, never as last seen.
    gcTime: 0,
  });
  useReportError(item.error, 'Could not load.');
  if (!isNew && item.data === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  return <Editor loaded={item.data ?? null} fresh={fresh} />;
}

function Editor({
  loaded,
  fresh,
}: {
  /** The stored item, or `null` for a new one. */
  readonly loaded: LoadedContent | null;
  readonly fresh: NewItem;
}): JSX.Element {
  const site = useSettings();
  const active = useTheme();
  const navigate = useNavigate();
  const client = useQueryClient();

  const [markdown, setMarkdown] = useState(
    loaded?.markdown ?? '---\ntitle: Untitled\n---\n\n',
  );
  const [kind, setKind] = useState(
    loaded?.kind ??
      (fresh.kind !== null && site.kinds[fresh.kind] !== undefined
        ? fresh.kind
        : (Object.keys(site.kinds)[0] ?? 'page')),
  );
  /** The language this item is written in. */
  const locale =
    loaded?.locale ??
    (fresh.locale !== null && site.locales.includes(fresh.locale)
      ? fresh.locale
      : site.defaultLocale);
  /** The group a new translation joins; a stored item already has its own. */
  const group = loaded?.translationGroup ?? fresh.group;
  const [slug, setSlug] = useState(loaded?.slug ?? '');
  const [assets, setAssets] = useState<Record<string, string>>(
    loaded === null ? {} : { ...loaded.assets },
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState('');
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [picker, setPicker] = useState<{
    kind: 'image' | 'file';
    resolve: (path: string | null) => void;
  } | null>(null);

  // The plugins, for the panels they attach to this kind of content. Asked
  // for once the item exists: an attached record needs an item to belong
  // to. The editor works without them; the panels are simply not shown.
  const plugins =
    useQuery({ ...pluginsQuery, enabled: loaded !== null }).data?.plugins ?? [];

  // Media rows for whatever the item references, so the preview can resolve
  // relative paths exactly as the server does. One that cannot be loaded is
  // left out, and the preview marks its path missing.
  const hashes = [...new Set(Object.values(assets))].sort();
  const media = useQueries({
    queries: hashes.map((sha) => ({
      queryKey: [...keys.media, 'item', sha],
      queryFn: () => api<MediaItem>(`/media/${sha}`),
    })),
    combine: (results) => {
      const map: Record<string, MediaItem> = {};
      for (const result of results) {
        if (result.data !== undefined) {
          map[result.data.sha256] = result.data;
        }
      }
      return map;
    },
  });

  // --- front matter <-> form ------------------------------------------
  const parsed = useMemo(() => splitFrontmatter(markdown), [markdown]);
  const frontmatter = parsed.data;
  // The form is a view of the front matter, as the Markdown pane is of the
  // whole document: `values` resets it whenever the text changes underneath
  // it, and every field edit is written back into the text by `setField`.
  // Whether the item is unsaved is the text's question, not the form's.
  const fieldsForm = useForm<FieldValues>({ values: frontmatter });

  const specs = useMemo(() => {
    const declared = active.kinds[kind]?.fields ?? {};
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: `media` is a new object whenever any of its queries settles; its rows are what matter.
  useEffect(() => {
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await renderPreview({
            theme: active,
            settings: site,
            markdown,
            kind,
            locale,
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
  }, [
    markdown,
    kind,
    slug,
    assets,
    JSON.stringify(Object.keys(media)),
    site,
    active,
    locale,
    loaded?.path,
  ]);

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

  const pickMedia = (mediaKind: 'image' | 'file'): Promise<string | null> =>
    new Promise((resolve) => setPicker({ kind: mediaKind, resolve }));

  const save = async (status: 'draft' | 'published'): Promise<void> => {
    // A keyboard save never passes through the field's blur, and a slug loaded
    // from an older item may predate this rule. Either way the server would
    // refuse it, so settle it here instead of spending the request.
    const canonical = normalizeSlugInput(slug);
    if (canonical.slug !== slug) {
      setSlug(canonical.slug);
    }
    if (!canonical.usable) {
      notify(canonical.notice);
      return;
    }

    setBusy(true);
    setSaved(false);
    try {
      const result = await api<{
        id: string;
        path: string;
        warning?: string;
      }>('/content', {
        method: 'POST',
        body: {
          ...(loaded === null ? {} : { id: loaded.id }),
          kind,
          locale,
          // `canonical`, not `slug`: `setSlug` above has not landed yet.
          ...(canonical.slug === '' ? {} : { slug: canonical.slug }),
          ...(group === null || group === ''
            ? {}
            : { translationGroup: group }),
          markdown,
          assets,
          status,
        },
      });
      setDirty(false);
      setSaved(true);
      // Every list it appears in, and its own record, are out of date.
      void client.invalidateQueries({ queryKey: keys.content });
      // The save still succeeded — this is the server saying it skipped
      // rendering and stored a draft instead, not a failure to report as one.
      if (result.warning !== undefined) {
        notify(result.warning);
      }
      if (loaded === null) {
        navigate(`/content/${result.id}`, { replace: true });
      }
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const kinds = Object.keys(site.kinds);
  const previewPath =
    loaded?.path ??
    buildPublicPath({
      kind,
      locale,
      defaultLocale: site.defaultLocale,
      prefixDefaultLocale: site.prefixDefaultLocale,
      slug: slug === '' ? 'preview' : slug,
      base: site.kinds[kind]?.base ?? '',
    });

  // Panels plugins attach to this kind of content (docs/PLUGIN_API.md §7.5).
  const attached =
    loaded === null
      ? []
      : plugins
          .filter((plugin) => plugin.enabled)
          .flatMap((plugin) =>
            plugin.panels
              .filter((panel) => panel.attachTo?.kind === loaded.kind)
              .map((panel) => ({ plugin, panel })),
          );

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-xl border bg-card lg:h-[calc(100svh-8rem)] lg:min-h-[36rem]">
        <div className="flex flex-wrap items-end gap-3 border-b bg-muted/40 p-3">
          <Button
            type="button"
            variant="ghost"
            // Back to the list in this item's language, as it was left.
            onClick={() =>
              navigate(
                locale === site.defaultLocale ? '/' : `/?locale=${locale}`,
              )
            }
          >
            ← All content
          </Button>
          <Field className="w-auto">
            <FieldLabel htmlFor="editor-kind">Type</FieldLabel>
            <NativeSelect
              id="editor-kind"
              className="min-w-32"
              value={kind}
              disabled={loaded !== null}
              onChange={(event) => {
                setKind(event.currentTarget.value);
                setDirty(true);
              }}
            >
              {kinds.map((entry) => (
                <NativeSelectOption key={entry} value={entry}>
                  {active.kinds[entry]?.label ?? entry}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor="editor-slug">Slug</FieldLabel>
            <Input
              id="editor-slug"
              className="min-w-40"
              value={slug}
              placeholder="derived from the title"
              onInput={(event) => {
                setSlug(event.currentTarget.value);
                setDirty(true);
              }}
              // Canonicalised on the way out of the field rather than per
              // keystroke, so a trailing dash can still be typed through.
              onBlur={(event) => {
                const result = normalizeSlugInput(event.currentTarget.value);
                if (result.notice === null) {
                  return;
                }
                setSlug(result.slug);
                notify(result.notice);
              }}
            />
          </Field>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {attached.map(({ plugin, panel }) => (
              <Badge variant="outline" asChild key={`${plugin.id}/${panel.id}`}>
                <a href="#attached-panels">{panel.label} ↓</a>
              </Badge>
            ))}
            {missing.length === 0 ? null : (
              <StatusBadge tone="warn" title={missing.join(', ')}>
                {missing.length} image{missing.length === 1 ? '' : 's'} missing
              </StatusBadge>
            )}
            {dirty ? <StatusBadge tone="neutral">Unsaved</StatusBadge> : null}
            {saved && !dirty ? <SavedNote /> : null}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void save('draft')}
            >
              Save draft
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void save('published')}
            >
              {busy ? 'Saving…' : 'Publish'}
            </Button>
          </div>
        </div>

        {loaded === null ? null : (
          <TranslationBar
            translations={loaded.translations}
            current={loaded.locale}
            group={loaded.translationGroup}
            kind={loaded.kind}
          />
        )}

        <section
          className="grid min-h-0 flex-1 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)_minmax(0,1fr)]"
          aria-label="Fields, Markdown and preview"
        >
          <aside className="min-h-0 min-w-0 overflow-auto border-b bg-muted/20 p-4 lg:border-r lg:border-b-0">
            <SchemaForm
              specs={specs}
              control={fieldsForm.control}
              idPrefix="fm"
              // The Worker checks front matter on save; the form only shows it.
              validateHere={false}
              onFieldChange={setField}
              pickMedia={pickMedia}
              previewUrl={(path) => {
                const sha = assets[path];
                return sha === undefined ? null : (media[sha]?.url ?? null);
              }}
            />
          </aside>
          <section className="flex min-h-96 min-w-0 overflow-hidden border-b lg:min-h-0 lg:border-r lg:border-b-0">
            <MarkdownEditor
              value={markdown}
              missing={missing}
              onChange={(value) => {
                setMarkdown(value);
                setDirty(true);
              }}
            />
          </section>
          <section className="flex min-h-96 min-w-0 flex-col bg-muted lg:min-h-0">
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
              // A theme's page is designed on white; the frame keeps it so in
              // the admin's dark scheme too.
              className="w-full flex-1 border-0 bg-white"
              sandbox="allow-same-origin"
              srcDoc={preview}
            />
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              Rendered by the same code the site runs — {previewPath}
            </p>
          </section>
        </section>

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
      {/*
        Below the editor, not inside it: the editor fills the window, and a
        panel squeezed into it would take the room from the text being
        written. The bar above links down to these.
      */}
      {loaded === null || attached.length === 0 ? null : (
        <div className="mt-6 flex flex-col gap-4" id="attached-panels">
          {attached.map(({ plugin, panel }) => (
            <section
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground"
              key={`${plugin.id}/${panel.id}`}
            >
              <p className="text-sm text-muted-foreground">
                From the {plugin.name} plugin. Shared by every language of this
                item, and saved on its own — not with Publish.
              </p>
              <PluginPanelView
                pluginId={plugin.id}
                panel={panel}
                attachedTo={loaded.translationGroup}
              />
            </section>
          ))}
        </div>
      )}
    </>
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
  const navigate = useNavigate();
  if (props.translations.length < 2) {
    return null;
  }
  return (
    <nav
      className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
      aria-label="Translations"
    >
      {props.translations.map((slot) => {
        if (slot.locale === props.current) {
          return (
            <StatusBadge key={slot.locale} tone="ok">
              {slot.locale}
            </StatusBadge>
          );
        }
        if (slot.exists && slot.id !== undefined) {
          return (
            <Button
              key={slot.locale}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate(`/content/${slot.id}`)}
            >
              {slot.locale}
            </Button>
          );
        }
        return (
          <Button
            key={slot.locale}
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              navigate(
                `/content/new?locale=${slot.locale}&group=${props.group}&kind=${props.kind}`,
              )
            }
          >
            Create {slot.locale}
          </Button>
        );
      })}
    </nav>
  );
}
