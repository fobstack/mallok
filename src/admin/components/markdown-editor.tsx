/**
 * The Markdown pane.
 *
 * CodeMirror loads on demand so it stays out of the first-load bundle
 * (docs/ADMIN.md §13); until it arrives a plain textarea holds the same
 * value, so the editor is usable from the first paint.
 *
 * The pane is a *view* of one document, not an owner of it: the field form
 * edits front matter and the result must appear here immediately
 * (docs/ADMIN.md §6.1). Incoming values are therefore pushed into the editor,
 * but only when they differ from what it already holds — otherwise every
 * keystroke would round-trip and reset the cursor.
 */

import type { DecorationSet } from '@codemirror/view';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

export interface MarkdownEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /**
   * Relative paths the body references but the bundle does not contain. Each
   * gets a marker on its own line — a missing file is a normal state, so it
   * is signposted rather than treated as an error (docs/ADMIN.md §6.4).
   */
  readonly missing?: readonly string[];
}

/** The subset of CodeMirror this component drives. */
interface EditorHandle {
  readonly destroy: () => void;
  readonly getValue: () => string;
  readonly setValue: (value: string) => void;
  readonly setMissing: (paths: readonly string[]) => void;
}

/**
 * CodeMirror drawn with the admin's tokens, so it follows the light and dark
 * schemes without a second theme: every colour is a CSS variable.
 */
function tokenTheme(
  editorView: typeof import('@codemirror/view').EditorView,
): ReturnType<typeof editorView.theme> {
  return editorView.theme({
    '&': {
      height: '100%',
      fontSize: '14px',
      color: 'var(--foreground)',
      backgroundColor: 'var(--background)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)' },
    '.cm-content': { caretColor: 'var(--foreground)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
    '.cm-gutters': {
      color: 'var(--muted-foreground)',
      backgroundColor: 'var(--muted)',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--accent)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
      },
    // A line referencing a file the bundle does not contain. Missing media
    // is a normal state, so this is a signpost, not an error
    // (docs/ADMIN.md §6.4).
    '.cm-missing-asset': {
      backgroundColor: 'color-mix(in oklch, var(--warning) 12%, transparent)',
      boxShadow: 'inset 3px 0 0 var(--warning)',
    },
  });
}

export function MarkdownEditor(props: MarkdownEditorProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const currentMissing = useRef<readonly string[]>([]);
  const [rich, setRich] = useState(false);

  // The newest props, so the mount effect never closes over stale values.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [view, state, lang, commands] = await Promise.all([
        import('@codemirror/view'),
        import('@codemirror/state'),
        import('@codemirror/lang-markdown'),
        import('@codemirror/commands'),
      ]);
      if (cancelled || host.current === null) {
        return;
      }

      // Marks a change the app pushed in, as opposed to one typed here.
      // The pane is a view of the document: when the item arrives, or the
      // field form rewrites the front matter, the new text is dispatched
      // into the editor. Without the mark that dispatch came back out
      // through the listener below as if it had been typed — an item nobody
      // touched showed "Unsaved", and one with CRLF line endings would have
      // been saved with every one of them rewritten, because the editor's
      // document holds `\n`.
      const pushed = state.Annotation.define<boolean>();

      // A state field holding the current missing paths, and a decoration
      // that marks every line mentioning one of them.
      const missingEffect = state.StateEffect.define<readonly string[]>();
      const missingField = state.StateField.define<DecorationSet>({
        create: () => view.Decoration.none,
        update(_previous, transaction) {
          const effect = transaction.effects.find((entry) =>
            entry.is(missingEffect),
          );
          const paths =
            effect === undefined ? currentMissing.current : effect.value;
          currentMissing.current = paths;
          if (paths.length === 0) {
            return view.Decoration.none;
          }
          const marks: { from: number; to: number }[] = [];
          const doc = transaction.state.doc;
          for (let line = 1; line <= doc.lines; line++) {
            const text = doc.line(line);
            if (paths.some((path) => text.text.includes(path))) {
              marks.push({ from: text.from, to: text.from });
            }
          }
          return view.Decoration.set(
            marks.map((mark) =>
              view.Decoration.line({ class: 'cm-missing-asset' }).range(
                mark.from,
              ),
            ),
          );
        },
        provide: (field) => view.EditorView.decorations.from(field),
      });
      const editor = new view.EditorView({
        parent: host.current,
        state: state.EditorState.create({
          doc: latest.current.value,
          extensions: [
            view.lineNumbers(),
            commands.history(),
            view.keymap.of([
              ...commands.defaultKeymap,
              ...commands.historyKeymap,
            ]),
            lang.markdown(),
            missingField,
            view.EditorView.lineWrapping,
            tokenTheme(view.EditorView),
            // CodeMirror's editable element is a `role="textbox"` with no
            // label of its own, so a screen reader announced the whole
            // Markdown pane as an unnamed text box. The fallback textarea
            // already carried this name; the rich editor has to as well.
            // `tabindex` changes nothing for the keyboard — a contenteditable
            // is in the tab order already — but axe does not count one as
            // focusable, and reported a long document's scroll area as one
            // the keyboard could not reach.
            view.EditorView.contentAttributes.of({
              'aria-label': 'Markdown source',
              tabindex: '0',
            }),
            view.EditorView.updateListener.of((update) => {
              if (
                update.docChanged &&
                !update.transactions.some(
                  (transaction) => transaction.annotation(pushed) === true,
                )
              ) {
                latest.current.onChange(update.state.doc.toString());
              }
            }),
          ],
        }),
      });
      handle.current = {
        destroy: () => editor.destroy(),
        getValue: () => editor.state.doc.toString(),
        setValue: (value) => {
          editor.dispatch({
            changes: {
              from: 0,
              to: editor.state.doc.length,
              insert: value,
            },
            annotations: pushed.of(true),
          });
        },
        setMissing: (paths) => {
          editor.dispatch({ effects: missingEffect.of(paths) });
        },
      };
      setRich(true);
      handle.current.setMissing(latest.current.missing ?? []);
    })();
    return () => {
      cancelled = true;
      handle.current?.destroy();
      handle.current = null;
    };
    // Mounted once; the sync effect below keeps the document current.
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rich is unread but is the signal that handle.current just became non-null.
  useEffect(() => {
    const editor = handle.current;
    if (editor === null) {
      return;
    }
    // Only when the value really differs: a keystroke that came *from* the
    // editor already matches, and replacing it would drop the cursor.
    if (editor.getValue() !== props.value) {
      editor.setValue(props.value);
    }
  }, [props.value, rich]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    handle.current?.setMissing(props.missing ?? []);
  }, [props.missing, rich]);

  return (
    <div className="flex min-w-0 flex-1">
      <div
        ref={host}
        className={rich ? 'min-w-0 flex-1 overflow-auto' : 'hidden'}
      />
      {rich ? null : (
        <textarea
          className="flex-1 resize-none border-0 bg-transparent p-3 font-mono text-sm outline-none"
          aria-label="Markdown source"
          value={props.value}
          spellCheck={false}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
    </div>
  );
}
