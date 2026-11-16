/**
 * The media library, usable both as a page and as a picker
 * (docs/ADMIN.md §8).
 *
 * As a picker it returns a **relative path**, never a URL: content that
 * stores URLs cannot be exported and moved (docs/CONTENT_FORMAT.md §4).
 */

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { Upload } from 'lucide-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '../api.js';
import { formatNumber } from '../format.js';
import { relativePathFor, type UploadProgress, uploadFile } from '../media.js';
import { messageOf, notify } from '../notice.js';
import { keys, useSettings, useTheme } from '../queries.js';
import type { MediaItem } from '../types.js';
import { EmptyState } from './empty-state.js';

export interface MediaLibraryProps {
  /** Restricts the list; a picker for an image field passes 'image'. */
  readonly kind?: 'image' | 'file';
  /** Present when used as a picker. */
  readonly onPick?: (path: string, item: MediaItem) => void;
  readonly onClose?: () => void;
}

/** What each stage of an upload is called while it runs. */
const STAGES: Readonly<Record<UploadProgress['stage'], MessageDescriptor>> = {
  hashing: msg`hashing`,
  checking: msg`checking`,
  converting: msg`converting`,
  uploading: msg`uploading`,
  done: msg`done`,
  skipped: msg`already stored, skipped`,
};

export function MediaLibrary(props: MediaLibraryProps): JSX.Element {
  const { t } = useLingui();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState('');
  const active = useTheme();
  const site = useSettings();
  const client = useQueryClient();
  // A conjunction list, not a `unit` one: Chinese joins a unit list with no
  // separator at all, so 480, 960 and 1440 read as "4809601440". Pixel widths
  // are not grouped, like the numbers in a srcset.
  const widths = new Intl.ListFormat(i18n.locale, {
    type: 'conjunction',
  }).format(
    active.imageWidths.map((width) =>
      formatNumber(width, { useGrouping: false }),
    ),
  );

  const listed = useQuery({
    queryKey: [...keys.media, 'list', props.kind ?? 'all'],
    queryFn: () =>
      api<{ items: MediaItem[] }>(
        `/media${props.kind === undefined ? '' : `?kind=${props.kind}`}`,
      ),
  });
  const items = listed.data?.items ?? [];
  const loading = listed.isPending;
  const loadError =
    listed.error === null
      ? ''
      : messageOf(listed.error, t`Could not load media.`);
  /** The library changed: every list of it, and every item's row. */
  const reload = (): Promise<void> =>
    client.invalidateQueries({ queryKey: keys.media });

  const onFiles = async (files: FileList | null): Promise<void> => {
    if (files === null) {
      return;
    }
    setError('');
    for (const file of Array.from(files)) {
      try {
        await uploadFile(file, {
          widths: active.imageWidths,
          maxEdge: site.maxImageEdge,
          onProgress: setProgress,
        });
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : t`The upload failed.`,
        );
      }
    }
    setProgress(null);
    await reload();
  };

  const remove = async (item: MediaItem): Promise<void> => {
    if (item.refCount > 0) {
      const name = item.originalName;
      notify(
        plural(item.refCount, {
          one: `"${name}" is used by # item. Remove the reference first.`,
          other: `"${name}" is used by # items. Remove the references first.`,
        }),
      );
      return;
    }
    try {
      await api(`/media/${item.sha256}`, { method: 'DELETE' });
      await reload();
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : t`Could not delete.`,
      );
    }
  };

  const saveAlt = async (item: MediaItem): Promise<void> => {
    try {
      await api(`/media/${item.sha256}`, {
        method: 'PATCH',
        body: { alt: altDraft },
      });
      setEditing(null);
      await reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : t`Could not save.`);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* The drop handlers live on the label, which is a real form control,
            rather than on a bare div with no keyboard path to the same
            action — the file input inside it is that path. */}
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground transition-colors hover:border-ring hover:bg-muted/50 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
            dragging && 'border-primary bg-primary/5 text-foreground',
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void onFiles(event.dataTransfer?.files ?? null);
          }}
        >
          <Upload className="size-5" aria-hidden="true" />
          <input
            type="file"
            className="sr-only"
            multiple
            accept={
              props.kind === 'file'
                ? '.pdf,.xlsx,.docx,.zip'
                : 'image/jpeg,image/png,image/gif,image/webp,image/avif'
            }
            onChange={(event) => {
              void onFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
          <span className="font-medium text-foreground">
            {dragging ? (
              <Trans>Drop to upload</Trans>
            ) : (
              <Trans>Choose files, or drop them here</Trans>
            )}
          </span>
        </label>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Images are converted to WebP in your browser and uploaded at{' '}
            {widths} pixels wide. SVG is not accepted — it can carry script.
          </Trans>
        </p>
        {progress === null ? null : (
          <p className="text-sm text-muted-foreground" role="status">
            {progress.file}: {i18n._(STAGES[progress.stage])}
          </p>
        )}
        {error === '' && loadError === '' ? null : (
          <p className="text-sm text-destructive" role="alert">
            {error === '' ? loadError : error}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : items.length === 0 ? (
        // The drop zone above is the action that fills it (U19).
        <EmptyState>
          <Trans>Nothing has been uploaded yet.</Trans>
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
          {items.map((item) => (
            <li
              key={item.sha256}
              className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground"
            >
              {item.kind === 'image' ? (
                <img
                  className="aspect-[4/3] w-full bg-muted object-cover"
                  src={item.url}
                  alt={item.alt ?? ''}
                  loading="lazy"
                />
              ) : (
                <span className="flex aspect-[4/3] items-center justify-center bg-muted font-mono text-sm font-medium text-muted-foreground">
                  {item.ext.toUpperCase()}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                <span
                  className="truncate text-sm font-medium"
                  title={item.originalName}
                >
                  {item.originalName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.width === null
                    ? `${Math.round(item.bytes / 1024)} KB`
                    : `${item.width}×${item.height}`}
                  {' · '}
                  {item.refCount === 0 ? t`unused` : t`used ${item.refCount}×`}
                </span>
                {item.kind !== 'image' ? null : editing === item.sha256 ? (
                  <div className="flex gap-1.5">
                    <Input
                      className="h-7 text-xs"
                      aria-label={t`Alt text`}
                      placeholder={t`Describe the image`}
                      value={altDraft}
                      onInput={(event) =>
                        setAltDraft(event.currentTarget.value)
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void saveAlt(item)}
                    >
                      <Trans>Save</Trans>
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="h-auto justify-start px-0 text-left whitespace-normal"
                    onClick={() => {
                      setEditing(item.sha256);
                      setAltDraft(item.alt ?? '');
                    }}
                  >
                    {item.alt === null || item.alt === ''
                      ? t`Add alt text`
                      : t`Alt: ${item.alt}`}
                  </Button>
                )}
              </div>
              <div className="flex gap-2 border-t p-2">
                {props.onPick === undefined ? null : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => props.onPick?.(relativePathFor(item), item)}
                  >
                    <Trans>Use</Trans>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={item.refCount > 0}
                  title={
                    item.refCount > 0
                      ? t`In use. Remove the references first.`
                      : t`Delete permanently`
                  }
                  onClick={() => void remove(item)}
                >
                  <Trans>Delete</Trans>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The library as a modal picker.
 *
 * shadcn/ui's dialog (Radix) brings focus trapping, Escape-to-close and
 * inertness for the rest of the page, which a `div` with a click handler
 * does not (docs/ADMIN.md §13). It is mounted only while it is open, so it
 * is always open here; closing it, by any route, is `onClose`.
 */
export function MediaPicker(props: {
  readonly kind: 'image' | 'file';
  readonly onPick: (path: string, item: MediaItem) => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-4xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {props.kind === 'image' ? (
              <Trans>Choose an image</Trans>
            ) : (
              <Trans>Choose a file</Trans>
            )}
          </DialogTitle>
        </DialogHeader>
        <MediaLibrary
          kind={props.kind}
          onPick={(path, item) => {
            props.onPick(path, item);
            props.onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
