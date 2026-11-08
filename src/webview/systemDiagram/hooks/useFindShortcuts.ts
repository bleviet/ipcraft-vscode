import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface FindShortcutsOptions {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  /** Text Ctrl+F puts in the search box; undefined keeps the query (see `findSeed`). */
  seed: string | undefined;
  onQueryChange: (query: string) => void;
  onStep: (direction: 1 | -1) => void;
}

/**
 * The VS Code find keys for the instance search, anywhere in the viewer:
 * Ctrl/Cmd+F focuses the search box with its text selected, after seeding it
 * from the selection; F3 and Shift+F3 go to the next and previous match.
 */
export function useFindShortcuts({
  inputRef,
  query,
  seed,
  onQueryChange,
  onStep,
}: FindShortcutsOptions): void {
  // Select the text once the seeded query is rendered, not the old one.
  const selectPending = useRef(false);
  useLayoutEffect(() => {
    if (selectPending.current) {
      selectPending.current = false;
      inputRef.current?.select();
    }
  }, [inputRef, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        input.focus();
        if (seed !== undefined) {
          selectPending.current = true;
          onQueryChange(seed);
        } else {
          input.select();
        }
      } else if (event.key === 'F3' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        onStep(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inputRef, query, seed, onQueryChange, onStep]);
}
