import {
  SEARCH_HISTORY_LIMIT,
  browseHistory,
  rememberQuery,
} from '../../../../webview/systemDiagram/searchHistory';

describe('rememberQuery', () => {
  it('trims the query and ignores a blank one', () => {
    const history = ['a'];
    expect(rememberQuery(history, '  b ')).toEqual(['a', 'b']);
    expect(rememberQuery(history, '   ')).toBe(history);
  });

  it('moves a repeated query to the newest position', () => {
    expect(rememberQuery(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
  });

  it('returns the same reference when the query is already the newest', () => {
    const history = ['a', 'b'];
    expect(rememberQuery(history, ' b ')).toBe(history);
  });

  it('drops the oldest entry past the limit', () => {
    const full = Array.from({ length: SEARCH_HISTORY_LIMIT }, (_, i) => `q${i}`);
    const next = rememberQuery(full, 'new');
    expect(next).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(next[0]).toBe('q1');
    expect(next[next.length - 1]).toBe('new');
  });
});

describe('browseHistory', () => {
  const history = ['a', 'b', 'c'];

  it('does nothing on an empty history', () => {
    expect(browseHistory([], null, 'x', -1)).toBeUndefined();
  });

  it('goes from a draft to the newest entry on the first Up', () => {
    expect(browseHistory(history, null, 'dr', -1)).toEqual({
      cursor: { index: 2, draft: 'dr' },
      value: 'c',
    });
  });

  it('skips a newest entry equal to the current text', () => {
    expect(browseHistory(history, null, ' c ', -1)).toEqual({
      cursor: { index: 1, draft: ' c ' },
      value: 'b',
    });
    expect(browseHistory(['c'], null, 'c', -1)).toBeUndefined();
  });

  it('stops at the oldest entry', () => {
    expect(browseHistory(history, { index: 0, draft: 'd' }, 'a', -1)).toBeUndefined();
    expect(browseHistory(history, { index: 2, draft: 'd' }, 'c', -1)).toEqual({
      cursor: { index: 1, draft: 'd' },
      value: 'b',
    });
  });

  it('moves newer on Down and restores the draft past the newest', () => {
    expect(browseHistory(history, { index: 0, draft: 'd' }, 'a', 1)).toEqual({
      cursor: { index: 1, draft: 'd' },
      value: 'b',
    });
    expect(browseHistory(history, { index: 2, draft: 'd' }, 'c', 1)).toEqual({
      cursor: null,
      value: 'd',
    });
  });

  it('does nothing on Down when not browsing', () => {
    expect(browseHistory(history, null, 'x', 1)).toBeUndefined();
  });
});
