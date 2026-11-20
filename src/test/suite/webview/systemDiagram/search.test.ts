import {
  findSeed,
  groupMatches,
  initiallyCollapsed,
  insideBadgeText,
  matchCounter,
  matchesInside,
  resultsSummary,
  searchMatches,
  stepMatch,
  withAncestors,
} from '../../../../webview/systemDiagram/search';
import { loadFixtureGraph } from './fixtureGraph';
import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
} from '../../../../webview/systemDiagram/searchMatcher';

const query = (text: string) => compileSearch(text, DEFAULT_SEARCH_OPTIONS);

const graph = loadFixtureGraph();

describe('searchMatches', () => {
  it('lists matches of every level in outline order, a hierarchy before its children', () => {
    expect(searchMatches(graph, query('dsp_pipeline'))).toEqual(['/dsp_pipeline']);
    expect(searchMatches(graph, query('fifo'))).toEqual([
      '/dsp_pipeline/axis_data_fifo_0',
      '/dsp_pipeline/coeff_bank/config_fifo',
    ]);
    const all = searchMatches(graph, query('axi'));
    expect(all.indexOf('/axi_dma_0')).toBeLessThan(all.indexOf('/dsp_pipeline/axis_data_fifo_0'));
    expect(all).toContain('/dsp_pipeline/coeff_bank/config_fifo');
  });

  it('lists a matching hierarchy before its children', () => {
    expect(searchMatches(graph, query('coeff_bank'))).toEqual(['/dsp_pipeline/coeff_bank']);
    const matches = searchMatches(graph, query('p'));
    expect(matches.indexOf('/dsp_pipeline')).toBeLessThan(
      matches.indexOf('/dsp_pipeline/axis_data_fifo_0')
    );
  });

  it('returns nothing for a blank query', () => {
    expect(searchMatches(graph, query(''))).toEqual([]);
    expect(searchMatches(graph, query('   '))).toEqual([]);
  });
});

describe('searchMatches with options', () => {
  const found = (text: string, options: Partial<typeof DEFAULT_SEARCH_OPTIONS>) =>
    searchMatches(graph, compileSearch(text, { ...DEFAULT_SEARCH_OPTIONS, ...options }));

  it('respects match case', () => {
    expect(found('FIFO', {})).toHaveLength(2);
    expect(found('FIFO', { matchCase: true })).toEqual([]);
  });

  it('respects whole word, on the name and on the type', () => {
    expect(found('config_fifo', { wholeWord: true })).toEqual([
      '/dsp_pipeline/coeff_bank/config_fifo',
    ]);
    expect(found('fifo', { wholeWord: true })).toEqual([]);
    expect(found('axi_dma', { wholeWord: true })).toEqual(['/axi_dma_0']);
  });

  it('expands wildcards', () => {
    expect(found('config_*', { wholeWord: true })).toEqual([
      '/dsp_pipeline/coeff_bank/config_fifo',
    ]);
    // The type of both FIFOs is the whole word `axis_data_fifo`.
    expect(found('*_fifo', { wholeWord: true })).toHaveLength(2);
  });
});

describe('withAncestors', () => {
  it('adds every hierarchy above a match, and not the root level', () => {
    expect([...withAncestors(['/axi_dma_0', '/dsp_pipeline/coeff_bank/config_fifo'])]).toEqual([
      '/axi_dma_0',
      '/dsp_pipeline/coeff_bank/config_fifo',
      '/dsp_pipeline/coeff_bank',
      '/dsp_pipeline',
    ]);
    expect(withAncestors([]).size).toBe(0);
  });
});

describe('stepMatch', () => {
  const matches = ['a', 'b', 'c'];

  it('steps forward and back with wrap-around', () => {
    expect(stepMatch(matches, 'a', 1)).toBe('b');
    expect(stepMatch(matches, 'c', 1)).toBe('a');
    expect(stepMatch(matches, 'b', -1)).toBe('a');
    expect(stepMatch(matches, 'a', -1)).toBe('c');
  });

  it('starts at the first or last match when the current one is not a match', () => {
    expect(stepMatch(matches, 'x', 1)).toBe('a');
    expect(stepMatch(matches, undefined, 1)).toBe('a');
    expect(stepMatch(matches, 'x', -1)).toBe('c');
  });

  it('returns undefined without matches', () => {
    expect(stepMatch([], 'a', 1)).toBeUndefined();
  });
});

describe('matchCounter', () => {
  it('describes the results', () => {
    expect(matchCounter([], undefined)).toBe('No results');
    expect(matchCounter(['a'], undefined)).toBe('1 match');
    expect(matchCounter(['a', 'b'], 'x')).toBe('2 matches');
    expect(matchCounter(['a', 'b'], 'b')).toBe('2 of 2');
  });
});

describe('findSeed', () => {
  const dma = { kind: 'instance', id: '/axi_dma_0' } as const;

  it('seeds the name of the selected instance', () => {
    expect(findSeed(graph, query(''), dma)).toBe('axi_dma_0');
    expect(findSeed(graph, query('fifo'), dma)).toBe('axi_dma_0');
    expect(
      findSeed(graph, query('fifo'), { kind: 'instance', id: '/dsp_pipeline/coeff_bank' })
    ).toBe('coeff_bank');
  });

  it('keeps a query that already matches the selected instance', () => {
    expect(findSeed(graph, query('dma'), dma)).toBeUndefined();
    expect(findSeed(graph, query('AXI_DMA'), dma)).toBeUndefined();
  });

  it('keeps the query without a selected instance', () => {
    expect(findSeed(graph, query('fifo'), null)).toBeUndefined();
    expect(
      findSeed(graph, query('fifo'), { kind: 'net', id: '/axi_dma_0_M_AXIS_MM2S' })
    ).toBeUndefined();
    expect(findSeed(graph, query('fifo'), { kind: 'boundary', id: '/DDR' })).toBeUndefined();
    expect(findSeed(graph, query('fifo'), { kind: 'instance', id: '/gone' })).toBeUndefined();
  });
});

describe('matchesInside', () => {
  it('counts the matches below every hierarchy above them, nested ones included', () => {
    const inside = matchesInside(['/a/b/x', '/a/b/y', '/a/z', '/top']);
    expect(Object.fromEntries(inside)).toEqual({ '/a': 3, '/a/b': 2 });
  });

  it('never counts the root and counts a matching hierarchy only for its ancestors', () => {
    const inside = matchesInside(['/a', '/a/b']);
    expect(inside.has('/')).toBe(false);
    expect(Object.fromEntries(inside)).toEqual({ '/a': 1 });
    expect(matchesInside([]).size).toBe(0);
  });

  it('on the fixture, puts fir_compiler_0 inside dsp_pipeline', () => {
    expect(matchesInside(searchMatches(graph, query('fir'))).get('/dsp_pipeline')).toBe(1);
  });
});

describe('insideBadgeText', () => {
  it('caps the count at 99+', () => {
    expect(insideBadgeText(1)).toBe('1');
    expect(insideBadgeText(99)).toBe('99');
    expect(insideBadgeText(100)).toBe('99+');
  });
});

describe('groupMatches', () => {
  it('groups by level in order of first appearance, labelled by hierarchy path or design name', () => {
    const groups = groupMatches(graph, [
      '/a',
      '/dsp_pipeline/x',
      '/b',
      '/dsp_pipeline/coeff_bank/y',
      '/dsp_pipeline/z',
    ]);
    expect(groups).toEqual([
      { level: '/', label: graph.name, paths: ['/a', '/b'] },
      {
        level: '/dsp_pipeline',
        label: 'dsp_pipeline',
        paths: ['/dsp_pipeline/x', '/dsp_pipeline/z'],
      },
      {
        level: '/dsp_pipeline/coeff_bank',
        label: 'dsp_pipeline / coeff_bank',
        paths: ['/dsp_pipeline/coeff_bank/y'],
      },
    ]);
  });
});

describe('resultsSummary', () => {
  it('uses singular and plural forms', () => {
    expect(resultsSummary(groupMatches(graph, ['/a']))).toBe('1 match in 1 level');
    expect(resultsSummary(groupMatches(graph, ['/a', '/b', '/d/c']))).toBe('3 matches in 2 levels');
  });
});

describe('initiallyCollapsed', () => {
  const many = Array.from({ length: 21 }, (_, i) => `/g${i % 3}/n${i}`);
  const groups = groupMatches(graph, many);

  it('keeps everything open up to 20 matches', () => {
    expect(initiallyCollapsed(groupMatches(graph, many.slice(0, 20)), undefined).size).toBe(0);
  });

  it('collapses all groups but the current one beyond 20 matches', () => {
    expect([...initiallyCollapsed(groups, undefined)]).toEqual(['/g0', '/g1', '/g2']);
    expect([...initiallyCollapsed(groups, '/g1/n1')]).toEqual(['/g0', '/g2']);
  });
});

describe('the visible order of the results', () => {
  it('differs from the outline order when a top-level match follows a hierarchy with matches', () => {
    const matches = searchMatches(graph, query('p'));
    const visible = groupMatches(graph, matches).flatMap((group) => group.paths);
    expect([...visible].sort()).toEqual([...matches].sort());
    expect(visible).not.toEqual(matches);
  });
});
