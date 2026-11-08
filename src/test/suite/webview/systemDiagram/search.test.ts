import {
  findSeed,
  matchCounter,
  searchMatches,
  stepMatch,
} from '../../../../webview/systemDiagram/search';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();

describe('searchMatches', () => {
  it('lists matches of every level in outline order, a hierarchy before its children', () => {
    expect(searchMatches(graph, 'dsp_pipeline')).toEqual(['/dsp_pipeline']);
    expect(searchMatches(graph, 'fifo')).toEqual([
      '/dsp_pipeline/axis_data_fifo_0',
      '/dsp_pipeline/coeff_bank/config_fifo',
    ]);
    const all = searchMatches(graph, 'axi');
    expect(all.indexOf('/axi_dma_0')).toBeLessThan(all.indexOf('/dsp_pipeline/axis_data_fifo_0'));
    expect(all).toContain('/dsp_pipeline/coeff_bank/config_fifo');
  });

  it('lists a matching hierarchy before its children', () => {
    expect(searchMatches(graph, 'coeff_bank')).toEqual(['/dsp_pipeline/coeff_bank']);
    const matches = searchMatches(graph, 'p');
    expect(matches.indexOf('/dsp_pipeline')).toBeLessThan(
      matches.indexOf('/dsp_pipeline/axis_data_fifo_0')
    );
  });

  it('returns nothing for a blank query', () => {
    expect(searchMatches(graph, '')).toEqual([]);
    expect(searchMatches(graph, '   ')).toEqual([]);
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
    expect(findSeed(graph, '', dma)).toBe('axi_dma_0');
    expect(findSeed(graph, 'fifo', dma)).toBe('axi_dma_0');
    expect(findSeed(graph, 'fifo', { kind: 'instance', id: '/dsp_pipeline/coeff_bank' })).toBe(
      'coeff_bank'
    );
  });

  it('keeps a query that already matches the selected instance', () => {
    expect(findSeed(graph, 'dma', dma)).toBeUndefined();
    expect(findSeed(graph, 'AXI_DMA', dma)).toBeUndefined();
  });

  it('keeps the query without a selected instance', () => {
    expect(findSeed(graph, 'fifo', null)).toBeUndefined();
    expect(findSeed(graph, 'fifo', { kind: 'net', id: '/axi_dma_0_M_AXIS_MM2S' })).toBeUndefined();
    expect(findSeed(graph, 'fifo', { kind: 'boundary', id: '/DDR' })).toBeUndefined();
    expect(findSeed(graph, 'fifo', { kind: 'instance', id: '/gone' })).toBeUndefined();
  });
});
