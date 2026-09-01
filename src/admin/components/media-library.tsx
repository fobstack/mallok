/**
 * The media library, usable both as a page and as a picker
 * (docs/ADMIN.md §8).
 *
 * As a picker it returns a **relative path**, never a URL: content that
 * stores URLs cannot be exported and moved (docs/CONTENT_FORMAT.md §4).
 */

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, api } from '../api.js';
import { relativePathFor, type UploadProgress, uploadFile } from '../media.js';
import { notice, settings, theme } from '../state.js';
import type { MediaItem } from '../types.js';

export interface MediaLibraryProps {
  /** Restricts the list; a picker for an image field passes 'image'. */
  readonly kind?: 'image' | 'file';
  /** Present when used as a picker. */
  readonly onPick?: (path: string, item: MediaItem) => void;
  readonly onClose?: () => void;
}

export function MediaLibrary(props: MediaLibraryProps): JSX.Element {
  const [items, setItems] = useState<readonly MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState('');
  const active = theme.value;
  const site = settings.value;

  const reload = async (): Promise<void> => {
    setLoading(true);
    try {
      const query = props.kind === undefined ? '' : `?kind=${props.kind}`;
      const result = await api<{ items: MediaItem[] }>(`/media${query}`);
      setItems(result.items);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not load media.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [props.kind]);

  const onFiles = async (files: FileList | null): Promise<void> => {
    if (files === null || active === null) {
      return;
    }
    setError('');
    for (const file of Array.from(files)) {
      try {
        await uploadFile(file, {
          widths: active.imageWidths,
          maxEdge: site?.maxImageEdge ?? null,
          onProgress: setProgress,
        });
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'The upload failed.',
        );
      }
    }
    setProgress(null);
    await reload();
  };

  const remove = async (item: MediaItem): Promise<void> => {
    if (item.refCount > 0) {
      notice.value = `"${item.originalName}" is used by ${item.refCount} item${item.refCount === 1 ? '' : 's'}. Remove the references first.`;
      return;
    }
    try {
      await api(`/media/${item.sha256}`, { method: 'DELETE' });
      await reload();
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not delete.';
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
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not save.';
    }
  };

  return (
    <div class="media-library">
      <div class="uploader">
        {/* The drop handlers live on the label, which is a real form control,
            rather than on a bare div with no keyboard path to the same
            action — the file input inside it is that path. */}
        <label
          class={dragging ? 'upload-drop dragging' : 'upload-drop'}
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
          <input
            type="file"
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
          <span>
            {dragging ? 'Drop to upload' : 'Choose files, or drop them here'}
          </span>
        </label>
        <p class="help">
          Images are converted to WebP in your browser and uploaded at{' '}
          {active?.imageWidths.join(', ') ?? ''} pixels wide. SVG is not
          accepted — it can carry script.
        </p>
        {progress === null ? null : (
          <p class="help" role="status">
            {progress.file}: {progress.stage}
          </p>
        )}
        {error === '' ? null : (
          <p class="error" role="alert">
            {error}
          </p>
        )}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p class="empty">No media yet.</p>
      ) : (
        <ul class="media-grid">
          {items.map((item) => (
            <li key={item.sha256} class="media-card">
              {item.kind === 'image' ? (
                <img src={item.url} alt={item.alt ?? ''} loading="lazy" />
              ) : (
                <span class="file-badge">{item.ext.toUpperCase()}</span>
              )}
              <div class="media-meta">
                <span class="name" title={item.originalName}>
                  {item.originalName}
                </span>
                <span class="help">
                  {item.width === null
                    ? `${Math.round(item.bytes / 1024)} KB`
                    : `${item.width}×${item.height}`}
                  {item.refCount === 0
                    ? ' · unused'
                    : ` · used ${item.refCount}×`}
                </span>
                {item.kind !== 'image' ? null : editing === item.sha256 ? (
                  <div class="list-row">
                    <input
                      aria-label="Alt text"
                      placeholder="Describe the image"
                      value={altDraft}
                      onInput={(event) =>
                        setAltDraft(event.currentTarget.value)
                      }
                    />
                    <button
                      type="button"
                      class="ghost"
                      onClick={() => void saveAlt(item)}
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    class="alt-button"
                    onClick={() => {
                      setEditing(item.sha256);
                      setAltDraft(item.alt ?? '');
                    }}
                  >
                    {item.alt === null || item.alt === ''
                      ? 'Add alt text'
                      : `Alt: ${item.alt}`}
                  </button>
                )}
              </div>
              <div class="media-actions">
                {props.onPick === undefined ? null : (
                  <button
                    type="button"
                    class="ghost"
                    onClick={() => props.onPick?.(relativePathFor(item), item)}
                  >
                    Use
                  </button>
                )}
                <button
                  type="button"
                  class="ghost"
                  disabled={item.refCount > 0}
                  title={
                    item.refCount > 0
                      ? 'In use. Remove the references first.'
                      : 'Delete permanently'
                  }
                  onClick={() => void remove(item)}
                >
                  Delete
                </button>
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
 * A native `<dialog>` rather than a hand-rolled overlay: it brings focus
 * trapping, Escape-to-close and inertness for the rest of the page, which a
 * `div` with a click handler does not (docs/ADMIN.md §13).
 */
export function MediaPicker(props: {
  readonly kind: 'image' | 'file';
  readonly onPick: (path: string, item: MediaItem) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      class="modal"
      aria-label={props.kind === 'image' ? 'Choose an image' : 'Choose a file'}
      onClose={props.onClose}
      onCancel={props.onClose}
    >
      <header class="modal-head">
        <h2>Choose {props.kind === 'image' ? 'an image' : 'a file'}</h2>
        <button
          type="button"
          class="ghost"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </header>
      <MediaLibrary
        kind={props.kind}
        onPick={(path, item) => {
          props.onPick(path, item);
          dialog.current?.close();
        }}
      />
    </dialog>
  );
}
