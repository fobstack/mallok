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
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

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
            view.EditorView.updateListener.of((update) => {
              if (update.docChanged) {
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

  useEffect(() => {
    handle.current?.setMissing(props.missing ?? []);
  }, [props.missing, rich]);

  return (
    <div class="markdown-pane">
      <div ref={host} class={rich ? 'cm-host' : 'cm-host hidden'} />
      {rich ? null : (
        <textarea
          class="markdown-fallback"
          aria-label="Markdown source"
          value={props.value}
          spellcheck={false}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
    </div>
  );
}
