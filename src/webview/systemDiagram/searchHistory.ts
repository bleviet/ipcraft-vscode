/** Pure search history for the Search instances box: remembered queries and Up/Down browsing. */

/** The most queries remembered; the oldest is dropped past it. */
export const SEARCH_HISTORY_LIMIT = 50;

/**
 * `history` (oldest first, newest last) with `query` trimmed and made the newest entry, moved
 * there if already present. The same array when the query is blank or already the newest.
 */
export function rememberQuery(history: readonly string[], query: string): readonly string[] {
  const trimmed = query.trim();
  if (trimmed === '' || history[history.length - 1] === trimmed) {
    return history;
  }
  const next = [...history.filter((entry) => entry !== trimmed), trimmed];
  return next.slice(-SEARCH_HISTORY_LIMIT);
}

/** Where browsing stands: the shown entry, and the text typed before browsing started. */
export interface HistoryCursor {
  index: number;
  draft: string;
}

/**
 * One Up (-1, older) or Down (1, newer) step through `history`. `cursor` is null when not
 * browsing: Down then does nothing, and Up goes to the newest entry, skipping it when it equals
 * the trimmed `current` text. Down past the newest entry restores the draft and ends browsing
 * (`cursor: null`). `undefined` when there is nothing to do.
 */
export function browseHistory(
  history: readonly string[],
  cursor: HistoryCursor | null,
  current: string,
  direction: -1 | 1
): { cursor: HistoryCursor | null; value: string } | undefined {
  if (cursor === null) {
    if (direction === 1 || history.length === 0) {
      return undefined;
    }
    let index = history.length - 1;
    if (history[index] === current.trim()) {
      index -= 1;
    }
    return index < 0 ? undefined : { cursor: { index, draft: current }, value: history[index] };
  }
  const index = cursor.index + direction;
  if (index < 0) {
    return undefined;
  }
  if (index >= history.length) {
    return { cursor: null, value: cursor.draft };
  }
  return { cursor: { index, draft: cursor.draft }, value: history[index] };
}
