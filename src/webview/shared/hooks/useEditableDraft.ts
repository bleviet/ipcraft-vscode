import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps a local draft of a controlled input value so the caret is not snapped
 * to the end of the text on every keystroke.
 *
 * Controlled inputs re-apply the `value` property on every render. When an edit
 * round-trips (parse -> serialize -> re-parse) and the value fed back differs
 * from what the user just typed, the control's value is rewritten and the caret
 * jumps to the end. The returned `draft` keeps the caret stable for typing.
 *
 * A focused field must still reflect `value` changes that did NOT come from the
 * user's current keystroke — undo, redo, external file edits, programmatic
 * changes. The local edit and the external edit both arrive as a plain `value`
 * change (both flow through the same optimistic re-parse), so they can only be
 * told apart by whether the user just typed. `setDraft` (called from the input
 * handler) marks a pending local edit; the resync effect then keeps the draft
 * for the optimistic echo of that edit but adopts any other `value` change.
 *
 * Wire `markFocused`/`markBlurred` into the input's focus/blur handlers and use
 * `draft` as the input's value; call `setDraft` from the input handler.
 */
export function useEditableDraft(value: string) {
  const [draft, setDraftState] = useState(value);
  const isFocusedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  // True between a user keystroke and the render that applies its optimistic
  // result. Distinguishes the user's own edit from an external `value` change.
  const pendingLocalEditRef = useRef(false);

  // Public setter for the input handler: every call is a user keystroke.
  const setDraft = useCallback((next: string) => {
    pendingLocalEditRef.current = true;
    setDraftState(next);
  }, []);

  useEffect(() => {
    if (draft === value) {
      pendingLocalEditRef.current = false;
      return;
    }
    if (!isFocusedRef.current) {
      // Not editing: external changes (reloads, undo, programmatic) win.
      setDraftState(value);
      return;
    }
    if (pendingLocalEditRef.current) {
      // The optimistic echo of the user's own keystroke (possibly normalized,
      // e.g. hex). Keep the draft so the caret does not jump; consume the flag
      // so the next non-keystroke `value` change is treated as external. React
      // 18 batches the keystroke's setDraft with the optimistic value update
      // into one render, so this branch observes the echo while still flagged.
      pendingLocalEditRef.current = false;
      return;
    }
    // External change while focused (undo/redo/programmatic): adopt it.
    setDraftState(value);
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
    pendingLocalEditRef.current = false;
    setDraftState(valueRef.current);
  }, []);

  return { draft, setDraft, markFocused, markBlurred };
}
