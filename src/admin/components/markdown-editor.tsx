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
import { useLingui } from '@lingui/react/macro';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * What a toolbar can do to the text: each acts on the selection, or at the
 * cursor, and changes nothing else (docs/ADMIN_SIMPLE.md, D5 option A).
 */
export interface MarkdownCommands {
  /** Puts `before` and `after` around the selection, or `placeholder`. */
  readonly wrap: (before: string, after: string, placeholder: string) => void;
  /** Starts every selected line with `prefix`; `1. ` counts up. */
  readonly prefixLines: (prefix: string) => void;
  /** Puts `text` at the cursor, on lines of its own when `block` is set. */
  readonly insert: (text: string, block?: boolean) => void;
}

export interface MarkdownEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /**
   * `prose` is for writing: a proportional face, no line numbers, and
   * headings and emphasis drawn as they will read. `source` is the whole
   * document as it is stored (docs/ADMIN_SIMPLE.md, D4 and D5).
   */
  readonly variant?: 'prose' | 'source';
  /** Called once the rich editor exists, with what a toolbar can ask of it. */
  readonly onReady?: (commands: MarkdownCommands) => void;
  /**
   * Files dropped or pasted into the text: uploaded by the caller, which
   * answers with the relative path of each image it stored, in order.
   */
  readonly onFiles?: (files: readonly File[]) => Promise<readonly string[]>;
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
  prose: boolean,
): ReturnType<typeof editorView.theme> {
  return editorView.theme({
    ...(prose
      ? {
          '.cm-scroller': {
            fontFamily: 'var(--font-sans)',
            lineHeight: '1.75',
          },
          '&': {
            height: '100%',
            fontSize: '16px',
            color: 'var(--foreground)',
            backgroundColor: 'var(--background)',
          },
          '.cm-content': {
            caretColor: 'var(--foreground)',
            padding: '12px 0 48px',
          },
          '.cm-line': { padding: '0 4px' },
          '.cm-md-h1': { fontSize: '1.6em', fontWeight: '700' },
          '.cm-md-h2': { fontSize: '1.35em', fontWeight: '700' },
          '.cm-md-h3, .cm-md-h4, .cm-md-h5, .cm-md-h6': {
            fontSize: '1.15em',
            fontWeight: '650',
          },
          '.cm-md-quote': {
            borderLeft: '3px solid var(--border)',
            paddingLeft: '12px',
            color: 'var(--muted-foreground)',
          },
          '.cm-md-strong': { fontWeight: '700' },
          '.cm-md-em': { fontStyle: 'italic' },
          '.cm-md-code': {
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9em',
            backgroundColor: 'var(--muted)',
            borderRadius: '4px',
          },
          '.cm-md-link': { color: 'var(--primary)' },
        }
      : {
          '&': {
            height: '100%',
            fontSize: '14px',
            color: 'var(--foreground)',
            backgroundColor: 'var(--background)',
          },
        }),
    '&.cm-focused': { outline: 'none' },
    ...(prose
      ? {}
      : {
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
          '.cm-content': { caretColor: 'var(--foreground)' },
        }),
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
  const { t } = useLingui();
  const prose = props.variant === 'prose';
  const label = prose ? t`Text` : t`Markdown source`;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const currentMissing = useRef<readonly string[]>([]);
  const [rich, setRich] = useState(false);

  // The newest props, so the mount effect never closes over stale values.
  const latest = useRef({ ...props, label });
  latest.current = { ...props, label };

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
      // Headings, quotes, emphasis, code and links drawn as they will read,
      // from the text alone: the `##` and `**` stay where they are typed.
      const proseField = state.StateField.define<DecorationSet>({
        create: (initial) => proseMarks(view, initial.doc.toString()),
        update: (previous, transaction) =>
          transaction.docChanged
            ? proseMarks(view, transaction.state.doc.toString())
            : previous,
        provide: (field) => view.EditorView.decorations.from(field),
      });
      const dropOrPaste = (
        files: readonly File[],
        at: number | null,
        editorView: import('@codemirror/view').EditorView,
      ): boolean => {
        const upload = latest.current.onFiles;
        if (upload === undefined || files.length === 0) {
          return false;
        }
        void upload(files).then((paths) => {
          if (paths.length === 0) {
            return;
          }
          const pos = at ?? editorView.state.selection.main.head;
          const text = paths.map((path) => `![](${path})`).join('\n\n');
          editorView.dispatch({
            changes: { from: pos, insert: `\n${text}\n` },
            selection: { anchor: pos + text.length + 2 },
          });
        });
        return true;
      };
      const editor = new view.EditorView({
        parent: host.current,
        state: state.EditorState.create({
          doc: latest.current.value,
          extensions: [
            ...(latest.current.variant === 'prose'
              ? [
                  proseField,
                  view.EditorView.domEventHandlers({
                    drop: (event, editorView) => {
                      const files = Array.from(event.dataTransfer?.files ?? []);
                      const at = editorView.posAtCoords({
                        x: event.clientX,
                        y: event.clientY,
                      });
                      if (dropOrPaste(files, at, editorView)) {
                        event.preventDefault();
                        return true;
                      }
                      return false;
                    },
                    paste: (event, editorView) => {
                      const files = Array.from(
                        event.clipboardData?.files ?? [],
                      );
                      if (dropOrPaste(files, null, editorView)) {
                        event.preventDefault();
                        return true;
                      }
                      return false;
                    },
                  }),
                ]
              : [view.lineNumbers()]),
            commands.history(),
            view.keymap.of([
              ...commands.defaultKeymap,
              ...commands.historyKeymap,
            ]),
            lang.markdown(),
            missingField,
            view.EditorView.lineWrapping,
            tokenTheme(view.EditorView, latest.current.variant === 'prose'),
            // CodeMirror's editable element is a `role="textbox"` with no
            // label of its own, so a screen reader announced the whole
            // Markdown pane as an unnamed text box. The fallback textarea
            // already carried this name; the rich editor has to as well.
            // `tabindex` changes nothing for the keyboard — a contenteditable
            // is in the tab order already — but axe does not count one as
            // focusable, and reported a long document's scroll area as one
            // the keyboard could not reach.
            view.EditorView.contentAttributes.of({
              // The language of the moment it mounted; an editor stays
              // open for one sitting, not across a change of language.
              'aria-label': latest.current.label,
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
      latest.current.onReady?.({
        wrap: (before, after, placeholder) => {
          const range = editor.state.selection.main;
          const selected = editor.state.sliceDoc(range.from, range.to);
          const inner = selected === '' ? placeholder : selected;
          editor.dispatch({
            changes: {
              from: range.from,
              to: range.to,
              insert: `${before}${inner}${after}`,
            },
            selection: {
              anchor: range.from + before.length,
              head: range.from + before.length + inner.length,
            },
          });
          editor.focus();
        },
        prefixLines: (prefix) => {
          const range = editor.state.selection.main;
          const first = editor.state.doc.lineAt(range.from).number;
          const last = editor.state.doc.lineAt(range.to).number;
          const changes = [];
          for (let number = first; number <= last; number++) {
            const line = editor.state.doc.line(number);
            const marker =
              prefix === '1. ' ? `${number - first + 1}. ` : prefix;
            changes.push({ from: line.from, insert: marker });
          }
          editor.dispatch({ changes });
          editor.focus();
        },
        insert: (text, block = false) => {
          const range = editor.state.selection.main;
          const line = editor.state.doc.lineAt(range.from);
          const before =
            block && range.from > line.from ? '\n\n' : block ? '' : '';
          const insert = block ? `${before}${text}\n` : text;
          editor.dispatch({
            changes: { from: range.from, to: range.to, insert },
            selection: { anchor: range.from + insert.length },
          });
          editor.focus();
        },
      });
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
          className={
            prose
              ? 'flex-1 resize-none border-0 bg-transparent p-3 text-base leading-7 outline-none'
              : 'flex-1 resize-none border-0 bg-transparent p-3 font-mono text-sm outline-none'
          }
          aria-label={label}
          value={props.value}
          spellCheck={false}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
    </div>
  );
}

/** Patterns marked inside a line, with the class each gets. */
const INLINE_MARKS: readonly [RegExp, string][] = [
  [/\*\*[^*\n]+\*\*|__[^_\n]+__/g, 'cm-md-strong'],
  [
    /(?<![*\w])\*[^*\s][^*\n]*\*(?![*\w])|(?<![_\w])_[^_\s][^_\n]*_(?![_\w])/g,
    'cm-md-em',
  ],
  [/`[^`\n]+`/g, 'cm-md-code'],
  [/!?\[[^\]\n]*\]\([^)\n]*\)/g, 'cm-md-link'],
];

/**
 * The decorations `prose` draws: a class per heading level and per quote
 * line, and marks for emphasis, code and links. Line by line and by
 * pattern, not a parse: it only draws, and a near miss costs nothing.
 */
function proseMarks(
  view: typeof import('@codemirror/view'),
  text: string,
): DecorationSet {
  const ranges: import('@codemirror/state').Range<
    import('@codemirror/view').Decoration
  >[] = [];
  let offset = 0;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
    } else if (!fenced) {
      const heading = /^(#{1,6})\s/.exec(line);
      if (heading?.[1] !== undefined) {
        ranges.push(
          view.Decoration.line({
            class: `cm-md-h${heading[1].length}`,
          }).range(offset),
        );
      } else if (/^>\s?/.test(line)) {
        ranges.push(
          view.Decoration.line({ class: 'cm-md-quote' }).range(offset),
        );
      }
      for (const [pattern, className] of INLINE_MARKS) {
        for (const match of line.matchAll(pattern)) {
          if (match.index !== undefined && match[0].length > 0) {
            ranges.push(
              view.Decoration.mark({ class: className }).range(
                offset + match.index,
                offset + match.index + match[0].length,
              ),
            );
          }
        }
      }
    }
    offset += line.length + 1;
  }
  return view.Decoration.set(ranges, true);
}
