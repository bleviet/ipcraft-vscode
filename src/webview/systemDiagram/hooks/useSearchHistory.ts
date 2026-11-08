import { useCallback, useEffect, useRef, useState } from 'react';
import { browseHistory, rememberQuery, type HistoryCursor } from '../searchHistory';

/**
 * Session history for the search box. `remember` records the current query and ends browsing;
 * `browse` shows an older (-1) or newer (1) remembered query and returns whether it changed the
 * query. A query that is not the one browsing last set (typing, Ctrl+F, Escape) starts browsing
 * afresh.
 */
export function useSearchHistory(
  query: string,
  onQueryChange: (query: string) => void
): { remember: () => void; browse: (direction: -1 | 1) => boolean } {
  const [history, setHistory] = useState<readonly string[]>([]);
  const cursor = useRef<HistoryCursor | null>(null);
  const lastSet = useRef<string | null>(null);

  // Any change not made by browsing (typing, Ctrl+F, Escape) ends browsing.
  useEffect(() => {
    if (query !== lastSet.current) {
      cursor.current = null;
      lastSet.current = null;
    }
  }, [query]);

  const remember = useCallback(() => {
    setHistory((previous) => rememberQuery(previous, query));
    cursor.current = null;
  }, [query]);

  const browse = useCallback(
    (direction: -1 | 1) => {
      const active = query === lastSet.current ? cursor.current : null;
      const step = browseHistory(history, active, query, direction);
      if (!step) {
        return false;
      }
      cursor.current = step.cursor;
      lastSet.current = step.value;
      onQueryChange(step.value);
      return true;
    },
    [history, query, onQueryChange]
  );

  return { remember, browse };
}
