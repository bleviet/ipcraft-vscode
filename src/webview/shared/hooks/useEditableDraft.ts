import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps a local draft of a controlled input value so the caret is not snapped
 * to the end of the text on every keystroke.
 *
 * The vscode-webview-ui-toolkit React wrapper re-applies the `value` property on
 * every render. When an edit round-trips (parse -> serialize -> re-parse) and
 * the value fed back differs from what the user just typed, the inner control's
 * value is rewritten and the caret jumps to the end. While the field is focused,
 * the returned `draft` is the source of truth; external `value` changes
 * (reloads, undo, programmatic edits) are adopted only when not editing.
 *
 * Wire `markFocused`/`markBlurred` into the input's focus/blur handlers and use
 * `draft` as the input's value; call `setDraft` from the input handler.
 */
export function useEditableDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!isFocusedRef.current && draft !== value) {
      setDraft(value);
    }
  }, [value, draft]);

  const markFocused = useCallback(() => {
    isFocusedRef.current = true;
  }, []);

  // Force the resync here rather than relying on the effect above: when the
  // edit was rejected (e.g. failed validation), onUpdate is never called, so
  // `value` never changes and no re-render occurs to run that effect — the
  // draft would otherwise stay stuck on the rejected text forever.
  const markBlurred = useCallback(() => {
    isFocusedRef.current = false;
    setDraft(valueRef.current);
  }, []);

  return { draft, setDraft, markFocused, markBlurred };
}
