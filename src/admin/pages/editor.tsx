/**
 * The content editor (docs/ADMIN.md §6), writing first
 * (docs/ADMIN_SIMPLE.md, D4–D6).
 *
 * The main column is the title, the text with a toolbar, and then the
 * type's own fields as cards; beside it one panel holds what is not
 * writing — publishing, summary, cover, tags and the address. The preview
 * is a button away, and "Edit source" in the More menu shows the whole
 * stored document, front matter included. On a phone it is one column and
 * the save buttons stay on screen.
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

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import {
  Bold,
  Eye,
  EyeOff,
  Heading2,
  ImageIcon,
  Italic,
  Link2,
  List as ListIcon,
  ListOrdered,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Quote,
  Table2,
} from 'lucide-react';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useShortLanguageNames } from '../components/content-language.js';
import { ContentStatusBadge } from '../components/content-status.js';
import {
  type MarkdownCommands,
  MarkdownEditor,
} from '../components/markdown-editor.js';
import { MediaPicker } from '../components/media-library.js';
import { Page, StatusBadge } from '../components/page.js';
import { PluginPanelView } from '../components/plugin-panel.js';
import { SavedNote } from '../components/saved-note.js';
import { SchemaForm } from '../form/form.js';
import { type FieldSpec, toSpecs } from '../form/types.js';
import { formatDateTime } from '../format.js';
import { relativePathFor, uploadFile } from '../media.js';
import { notify, useReportError } from '../notice.js';
import { renderPreview } from '../preview.js';
import { keys, pluginsQuery, useSettings, useTheme } from '../queries.js';
import { serverMessage } from '../server-messages.js';
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
  readonly updatedAt: string;
  readonly translationGroup: string;
  readonly markdown: string;
  readonly assets: Readonly<Record<string, string>>;
  readonly translations: readonly TranslationSlot[];
}

const PREVIEW_DEBOUNCE_MS = 250;

/** Where the settings panel's closed state is remembered, per browser. */
const FIELDS_OPEN_KEY = 'mallok-editor-panel';

function readFieldsOpen(): boolean {
  try {
    return localStorage.getItem(FIELDS_OPEN_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function writeFieldsOpen(open: boolean): void {
  try {
    localStorage.setItem(FIELDS_OPEN_KEY, open ? 'open' : 'closed');
  } catch {
    // A convenience only: without storage the pane opens each time.
  }
}

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
  const { t } = useLingui();
  const item = useQuery({
    queryKey: [...keys.content, 'item', id],
    queryFn: () => api<LoadedContent>(`/content/${id}`),
    enabled: !isNew,
    // Opened to be edited: always as stored now, never as last seen.
    gcTime: 0,
  });
  useReportError(item.error, t`Could not load.`);
  if (!isNew && item.data === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>Loading…</Trans>
      </p>
    );
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
  const { t } = useLingui();

  const [markdown, setMarkdown] = useState(
    loaded?.markdown ?? '---\ntitle: Untitled\n---\n\n',
  );
  const [kind, setKind] = useState(
    loaded?.kind ??
      (fresh.kind !== null && site.kinds[fresh.kind] !== undefined
        ? fresh.kind
        : (Object.keys(site.kinds)[0] ?? 'page')),
  );
  /** This type's list, named as the sidebar names it. */
  const listName = active.kinds[kind]?.label ?? kind;
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
  // How the last save went out: a draft is saved but no visitor sees it.
  const [saved, setSaved] = useState<'draft' | 'published' | null>(null);
  // The status the server last stored, which decides what the buttons say:
  // an item on the site is updated or taken off it, never quietly turned
  // back into a draft by a button that reads "Save draft" (ADMIN_SIMPLE.md,
  // G1 and D6).
  const [stored, setStored] = useState<LoadedContent['status'] | null>(
    loaded?.status ?? null,
  );
  const live = stored === 'published' || stored === 'scheduled';
  const [preview, setPreview] = useState('');
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [panelOpen, setPanelOpen] = useState(readFieldsOpen);
  const [previewOpen, setPreviewOpen] = useState(false);
  // The whole stored document instead of the text alone (D4 option C).
  const [source, setSource] = useState(false);
  const [commands, setCommands] = useState<MarkdownCommands | null>(null);
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

  // What every item has, in the panel; what the theme declares for this
  // type, as cards under the text (docs/THEME_FORMAT.md §5.2). A common key
  // the theme declares itself is the theme's, in its card.
  const { panelSpecs, typeSpecs } = useMemo(() => {
    const declared = active.kinds[kind]?.fields ?? {};
    const common: FieldSpec[] = [
      {
        name: 'description',
        field: {
          type: 'text' as const,
          label: t`Summary`,
          required: false,
          help: t`Shown in lists and in search results. Empty uses the start of the text.`,
        },
      },
      {
        name: 'date',
        field: {
          type: 'date' as const,
          label: t`Publish date`,
          required: false,
          help: t`A date in the future publishes it then.`,
        },
      },
      {
        name: 'cover',
        field: {
          type: 'image' as const,
          label: t`Cover image`,
          required: false,
        },
      },
      {
        name: 'tags',
        field: { type: 'string[]' as const, label: t`Tags`, required: false },
      },
    ];
    return {
      panelSpecs: common.filter((spec) => declared[spec.name] === undefined),
      typeSpecs: toSpecs(declared),
    };
  }, [active, kind, t]);

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

  // --- the text alone ---------------------------------------------------
  // The front matter is kept as the very text it was, and only the body is
  // shown; an edit to the body joins the two back without touching the
  // block, so an item opened and closed stays byte-identical (§6.2, D4).
  const head = markdown.slice(0, markdown.length - parsed.body.length);
  const lead = parsed.body.startsWith('\r\n')
    ? '\r\n'
    : parsed.body.startsWith('\n')
      ? '\n'
      : '';
  const bodyText = parsed.body.slice(lead.length);
  const setBody = (value: string): void => {
    setMarkdown(`${head}${head === '' ? '' : lead || '\n'}${value}`);
    setDirty(true);
  };
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : '';

  // Images dropped or pasted into the text are uploaded as the media page
  // would, and referenced by their relative path (D5 option A).
  const uploadInto = async (
    files: readonly File[],
  ): Promise<readonly string[]> => {
    const paths: string[] = [];
    for (const file of files) {
      try {
        const item = await uploadFile(file, {
          widths: active.imageWidths,
          maxEdge: site.maxImageEdge,
        });
        const path = relativePathFor(item);
        setAssets((previous) => ({ ...previous, [path]: item.sha256 }));
        paths.push(path);
      } catch (caught) {
        notify(
          caught instanceof Error ? caught.message : t`The upload failed.`,
        );
      }
    }
    void client.invalidateQueries({ queryKey: keys.media });
    return paths;
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
          const reason =
            caught instanceof Error ? caught.message : t`unknown error`;
          setPreview(
            `<p style="padding:1rem;color:#a11d33">${t`Preview failed: ${reason}`}</p>`,
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
    setSaved(null);
    try {
      const result = await api<{
        id: string;
        path: string;
        status: string;
        warning?: string;
        warningCode?: string;
        warningParams?: Record<string, unknown>;
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
      // As stored, not as asked: a body too long to render safely is kept
      // as a draft, and a draft reaches no visitor.
      setSaved(result.status === 'draft' ? 'draft' : 'published');
      if (
        result.status === 'draft' ||
        result.status === 'published' ||
        result.status === 'scheduled'
      ) {
        setStored(result.status);
      }
      // Every list it appears in, and its own record, are out of date.
      void client.invalidateQueries({ queryKey: keys.content });
      // The save still succeeded — this is the server saying it skipped
      // rendering and stored a draft instead, not a failure to report as one.
      if (result.warning !== undefined) {
        notify(
          serverMessage(result.warningCode, result.warningParams) ??
            result.warning,
        );
      }
      if (loaded === null) {
        navigate(`/content/${result.id}?kind=${encodeURIComponent(kind)}`, {
          replace: true,
        });
      }
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : t`Could not save.`);
    } finally {
      setBusy(false);
    }
  };

  /** This type's list, in this item's language. */
  const listHref = `/content?kind=${encodeURIComponent(kind)}${
    locale === site.defaultLocale ? '' : `&locale=${locale}`
  }`;

  // Taking a page off the site, or out of the site, says first what a
  // visitor will see (D6). What a delete keeps was read from the route:
  // the row and its rendered copy go; images stay in Media, other language
  // versions stay, and no redirect is written.
  const unpublish = (): void => {
    if (
      window.confirm(
        t`Take this off the site? It stays here as a draft, and visitors no longer see it.`,
      )
    ) {
      void save('draft');
    }
  };
  const remove = async (): Promise<void> => {
    if (loaded === null) {
      return;
    }
    if (
      !window.confirm(
        t`Delete "${title}"? Visitors get "page not found" at its address. Its other language versions and its images stay. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/content/${loaded.id}`, { method: 'DELETE' });
      setDirty(false);
      await client.invalidateQueries({ queryKey: keys.content });
      navigate(listHref);
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : t`Could not delete.`,
      );
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

  const togglePanel = (): void => {
    setPanelOpen((open) => {
      writeFieldsOpen(!open);
      return !open;
    });
  };
  const typeName = active.kinds[kind]?.label ?? kind;
  const previewUrl = (path: string): string | null => {
    const sha = assets[path];
    return sha === undefined ? null : (media[sha]?.url ?? null);
  };
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const addressPrefix = `${origin}${previewPath.slice(
    0,
    previewPath.length - (slug === '' ? 'preview' : slug).length,
  )}`;

  // Drawn twice — in the bar on a wide screen, pinned to the bottom on a
  // phone — with CSS showing one, so the buttons never scroll away (U9).
  const actions = (
    <>
      {attached.map(({ plugin, panel }) => (
        <Badge variant="outline" asChild key={`${plugin.id}/${panel.id}`}>
          <a href="#attached-panels">{panel.label} ↓</a>
        </Badge>
      ))}
      {missing.length === 0 ? null : (
        <StatusBadge tone="warn" title={missing.join(', ')}>
          <Plural
            value={missing.length}
            one="# image missing"
            other="# images missing"
          />
        </StatusBadge>
      )}
      {dirty ? (
        <StatusBadge tone="neutral">
          <Trans>Unsaved</Trans>
        </StatusBadge>
      ) : null}
      {saved !== null && !dirty ? (
        <SavedNote draft={saved === 'draft'} />
      ) : null}
      <Button
        type="button"
        variant="outline"
        aria-pressed={previewOpen}
        onClick={() => setPreviewOpen((open) => !open)}
      >
        {previewOpen ? <EyeOff /> : <Eye />}
        <Trans>Preview</Trans>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t`More actions`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Not back to the button: "Edit source" opens a text the operator
          // starts typing in, and focus returned after the menu closed took
          // the keystrokes away from it.
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {loaded?.status === 'published' ? (
            <DropdownMenuItem asChild>
              <a href={loaded.path} target="_blank" rel="noopener">
                <Trans>View on site</Trans>
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setSource((open) => !open)}>
            {source ? (
              <Trans>Back to writing</Trans>
            ) : (
              <Trans>Edit source (Markdown)</Trans>
            )}
          </DropdownMenuItem>
          {live || loaded !== null ? <DropdownMenuSeparator /> : null}
          {live ? (
            <DropdownMenuItem disabled={busy} onSelect={unpublish}>
              <Trans>Unpublish</Trans>
            </DropdownMenuItem>
          ) : null}
          {loaded === null ? null : (
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onSelect={() => void remove()}
            >
              <Trans>Delete</Trans>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {live ? null : (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void save('draft')}
        >
          <Trans>Save draft</Trans>
        </Button>
      )}
      <Button
        type="button"
        disabled={busy}
        onClick={() => void save('published')}
      >
        {busy ? t`Saving…` : live ? t`Update` : t`Publish`}
      </Button>
    </>
  );

  const updated = loaded === null ? '' : formatDateTime(loaded.updatedAt);

  const toolbar: readonly {
    readonly label: string;
    readonly icon: typeof Bold;
    readonly run: (commands: MarkdownCommands) => void;
  }[] = [
    {
      label: t`Heading`,
      icon: Heading2,
      run: (c) => c.prefixLines('## '),
    },
    { label: t`Bold`, icon: Bold, run: (c) => c.wrap('**', '**', t`bold`) },
    {
      label: t`Italic`,
      icon: Italic,
      run: (c) => c.wrap('*', '*', t`italic`),
    },
    {
      label: t`Bulleted list`,
      icon: ListIcon,
      run: (c) => c.prefixLines('- '),
    },
    {
      label: t`Numbered list`,
      icon: ListOrdered,
      run: (c) => c.prefixLines('1. '),
    },
    { label: t`Quote`, icon: Quote, run: (c) => c.prefixLines('> ') },
    {
      label: t`Link`,
      icon: Link2,
      run: (c) => c.wrap('[', '](https://)', t`link text`),
    },
    {
      label: t`Image`,
      icon: ImageIcon,
      run: (c) => {
        void pickMedia('image').then((path) => {
          setPicker(null);
          if (path !== null) {
            c.insert(`![](${path})`, true);
          }
        });
      },
    },
    {
      label: t`Table`,
      icon: Table2,
      run: (c) =>
        c.insert(
          `| ${t`Column`} | ${t`Column`} |\n| --- | --- |\n|  |  |`,
          true,
        ),
    },
  ];

  const settingsPanel = (
    <aside
      id="editor-settings"
      aria-label={t`Page settings`}
      className={cn(
        'flex min-w-0 flex-col gap-5 bg-muted/20 p-4 lg:min-h-0 lg:overflow-auto lg:border-l',
        !panelOpen && 'lg:hidden',
        previewOpen && 'max-lg:hidden lg:max-[1599px]:hidden',
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          <Trans>Page settings</Trans>
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden lg:inline-flex"
          aria-expanded={true}
          aria-controls="editor-settings"
          onClick={togglePanel}
        >
          <PanelRightClose />
          <Trans>Hide settings</Trans>
        </Button>
      </div>
      {loaded === null ? (
        // Fixed once saved; a list's "Add" already chose it (D2).
        <Field>
          <FieldLabel htmlFor="editor-kind">
            <Trans>Type</Trans>
          </FieldLabel>
          <NativeSelect
            id="editor-kind"
            value={kind}
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
      ) : null}
      <SchemaForm
        specs={panelSpecs}
        control={fieldsForm.control}
        idPrefix="fm"
        // The Worker checks front matter on save; the form only shows it.
        validateHere={false}
        onFieldChange={setField}
        pickMedia={pickMedia}
        previewUrl={previewUrl}
      />
      {/* The address, closed until wanted: a new item opens it, since
          a title in Chinese gives no address to start from (D3). */}
      <details
        className="group rounded-lg border bg-background p-3"
        open={loaded === null}
      >
        <summary className="cursor-pointer text-sm font-medium">
          <Trans>Search and address</Trans>
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs break-all text-muted-foreground">
            {addressPrefix}
            <span className="font-medium text-foreground">
              {slug === '' ? '…' : slug}
            </span>
          </p>
          <Field>
            <FieldLabel htmlFor="editor-slug">
              <Trans>URL slug</Trans>
            </FieldLabel>
            <Input
              id="editor-slug"
              value={slug}
              placeholder={t`derived from the title`}
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
        </div>
      </details>
    </aside>
  );

  return (
    // The whole width of the window: the text and its panel need it (U7).
    <Page width="full">
      <div className="flex flex-col rounded-xl border bg-card lg:h-[calc(100svh-8rem)] lg:min-h-[36rem] lg:overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 p-3">
          <Button
            type="button"
            variant="ghost"
            // Back to this type's list, in this item's language (D2).
            onClick={() => navigate(listHref)}
          >
            ← {listName}
          </Button>
          {/* What state the stored item is in, and where to see it (U8). */}
          {loaded === null ? (
            <span className="text-sm text-muted-foreground">
              <Trans>Not saved yet</Trans>
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ContentStatusBadge status={stored ?? loaded.status} />
              <span className="text-muted-foreground">
                <Trans>
                  Updated <time dateTime={loaded.updatedAt}>{updated}</time>
                </Trans>
              </span>
              {loaded.status === 'published' ? (
                <a
                  className="text-primary underline-offset-4 hover:underline max-sm:hidden"
                  href={loaded.path}
                  target="_blank"
                  rel="noopener"
                >
                  <Trans>View on site</Trans>
                </a>
              ) : null}
            </div>
          )}
          <div className="ml-auto hidden flex-wrap items-center gap-2 lg:flex">
            {actions}
          </div>
        </div>

        {loaded === null ? null : (
          <TranslationBar
            translations={loaded.translations}
            current={loaded.locale}
            group={loaded.translationGroup}
            kind={loaded.kind}
            locales={site.locales}
          />
        )}

        <section
          className={cn(
            'grid min-h-0 flex-1',
            previewOpen
              ? panelOpen
                ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[1600px]:grid-cols-[minmax(0,1fr)_20rem_minmax(0,1fr)]'
                : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
              : panelOpen
                ? 'lg:grid-cols-[minmax(0,1fr)_22rem]'
                : 'lg:grid-cols-[minmax(0,1fr)_2.75rem]',
          )}
          aria-label={t`Editor`}
        >
          <div
            className={cn(
              'flex min-w-0 flex-col gap-4 p-4 lg:min-h-0 lg:overflow-auto lg:p-6',
              previewOpen && 'max-lg:hidden',
            )}
          >
            {source ? (
              <>
                <p className="text-sm text-muted-foreground" role="note">
                  <Trans>
                    The whole document as it is stored, settings at the top.
                    Change it here only if you know Markdown.
                  </Trans>{' '}
                  <button
                    type="button"
                    className="text-primary underline underline-offset-4"
                    onClick={() => setSource(false)}
                  >
                    <Trans>Back to writing</Trans>
                  </button>
                </p>
                <div className="flex min-h-[60svh] rounded-lg border lg:min-h-0 lg:flex-1">
                  <MarkdownEditor
                    value={markdown}
                    missing={missing}
                    onChange={(value) => {
                      setMarkdown(value);
                      setDirty(true);
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="fm-title"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    <Trans>Title</Trans>
                  </label>
                  <input
                    id="fm-title"
                    value={title}
                    onChange={(event) =>
                      setField('title', event.currentTarget.value)
                    }
                    className="w-full border-0 border-b bg-transparent pb-2 text-2xl font-semibold outline-none focus-visible:border-primary"
                  />
                </div>
                <div className="flex flex-col rounded-lg border bg-background">
                  <div
                    role="toolbar"
                    aria-label={t`Formatting`}
                    className="flex flex-wrap gap-0.5 border-b p-1"
                  >
                    {toolbar.map((tool) => (
                      <Button
                        key={tool.label}
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={tool.label}
                        title={tool.label}
                        disabled={commands === null}
                        onClick={() => {
                          if (commands !== null) {
                            tool.run(commands);
                          }
                        }}
                      >
                        <tool.icon />
                      </Button>
                    ))}
                  </div>
                  <div className="flex min-h-[50svh] px-3">
                    <MarkdownEditor
                      variant="prose"
                      value={bodyText}
                      missing={missing}
                      onChange={setBody}
                      onReady={setCommands}
                      onFiles={uploadInto}
                    />
                  </div>
                </div>
                {typeSpecs.length === 0 ? null : (
                  <section
                    aria-label={typeName}
                    className="rounded-lg border bg-background p-4"
                  >
                    <h2 className="mb-3 text-sm font-semibold">{typeName}</h2>
                    <SchemaForm
                      specs={typeSpecs}
                      control={fieldsForm.control}
                      idPrefix="fm"
                      validateHere={false}
                      onFieldChange={setField}
                      pickMedia={pickMedia}
                      previewUrl={previewUrl}
                    />
                  </section>
                )}
              </>
            )}
          </div>

          {panelOpen ? null : (
            // Closed: a rail that opens the panel again.
            <div
              className={cn(
                'hidden border-l bg-muted/20 p-1.5 lg:block',
                previewOpen && 'lg:hidden',
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-expanded={false}
                aria-controls="editor-settings"
                aria-label={t`Show settings`}
                title={t`Show settings`}
                onClick={togglePanel}
              >
                <PanelRightOpen />
              </Button>
            </div>
          )}
          {settingsPanel}

          <section
            aria-label={t`Preview`}
            className={cn(
              'flex min-h-[70svh] min-w-0 flex-col bg-muted lg:min-h-0 lg:border-l',
              !previewOpen && 'hidden',
            )}
          >
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
              title={t`Preview`}
              // A theme's page is designed on white; the frame keeps it so in
              // the admin's dark scheme too.
              className="w-full flex-1 border-0 bg-white"
              sandbox="allow-same-origin"
              srcDoc={preview}
            />
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              <Trans>
                Rendered by the same code the site runs — {previewPath}
              </Trans>
            </p>
          </section>
        </section>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t bg-card p-3 lg:hidden">
          {actions}
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
      {/*
        Below the editor, not inside it: the editor fills the window, and a
        panel squeezed into it would take the room from the text being
        written. The bar above links down to these.
      */}
      {loaded === null || attached.length === 0 ? null : (
        <div className="flex flex-col gap-4" id="attached-panels">
          {attached.map(({ plugin, panel }) => {
            const pluginName = plugin.name;
            return (
              <section
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground"
                key={`${plugin.id}/${panel.id}`}
              >
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    From the {pluginName} plugin. Shared by every language of
                    this item, and saved on its own — not with Publish.
                  </Trans>
                </p>
                <PluginPanelView
                  pluginId={plugin.id}
                  panel={panel}
                  attachedTo={loaded.translationGroup}
                />
              </section>
            );
          })}
        </div>
      )}
    </Page>
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
  /** The site's languages, for naming each by its name alone (D8). */
  readonly locales: readonly string[];
}): JSX.Element | null {
  const navigate = useNavigate();
  const { t } = useLingui();
  const nameOf = useShortLanguageNames(props.locales);
  if (props.translations.length < 2) {
    return null;
  }
  return (
    <nav
      className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
      aria-label={t`Translations`}
    >
      <span className="text-xs font-medium text-muted-foreground">
        <Trans>Language versions</Trans>
      </span>
      {props.translations.map((slot) => {
        const slotLanguage = nameOf(slot.locale);
        if (slot.locale === props.current) {
          // The one open, marked as such rather than in a status colour:
          // green is what "Published" looks like.
          return (
            <span
              key={slot.locale}
              aria-current="page"
              className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              {slotLanguage}
            </span>
          );
        }
        if (slot.exists && slot.id !== undefined) {
          return (
            <Button
              key={slot.locale}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                navigate(
                  `/content/${slot.id}?kind=${encodeURIComponent(props.kind)}`,
                )
              }
            >
              {slotLanguage}
            </Button>
          );
        }
        return (
          <Button
            key={slot.locale}
            type="button"
            variant="outline"
            size="sm"
            aria-label={t`Add the ${slotLanguage} version`}
            onClick={() =>
              navigate(
                `/content/new?locale=${slot.locale}&group=${props.group}&kind=${props.kind}`,
              )
            }
          >
            + {slotLanguage}
          </Button>
        );
      })}
    </nav>
  );
}
