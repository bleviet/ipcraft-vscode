import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
  type SearchOptions,
} from '../../../../webview/systemDiagram/searchMatcher';

const matches = (query: string, text: string, options: Partial<SearchOptions> = {}) =>
  compileSearch(query, { ...DEFAULT_SEARCH_OPTIONS, ...options })!(text);

describe('compileSearch', () => {
  it('is null for a blank query', () => {
    expect(compileSearch('', DEFAULT_SEARCH_OPTIONS)).toBeNull();
    expect(compileSearch('   ', DEFAULT_SEARCH_OPTIONS)).toBeNull();
  });

  it('matches the trimmed query anywhere, ignoring case', () => {
    expect(matches(' DMA ', 'axi_dma_0')).toBe(true);
    expect(matches('gpio', 'axi_dma_0')).toBe(false);
  });

  it('tells upper from lower case with match case', () => {
    expect(matches('Count', 'Count_0', { matchCase: true })).toBe(true);
    expect(matches('count', 'Count_0', { matchCase: true })).toBe(false);
  });

  it('matches only whole identifiers with whole word', () => {
    const wholeWord = { wholeWord: true };
    expect(matches('count', 'count', wholeWord)).toBe(true);
    expect(matches('count', 'user.org:ip:count:1.0', wholeWord)).toBe(true);
    expect(matches('count', 'count_0', wholeWord)).toBe(false);
    expect(matches('count', 'my_count', wholeWord)).toBe(false);
    expect(matches('count', 'counter', wholeWord)).toBe(false);
  });

  it('does not anchor a punctuation edge of a whole word query', () => {
    expect(matches(':7.1', 'xilinx.com:ip:axi_dma:7.1', { wholeWord: true })).toBe(true);
    expect(matches(':7', 'xilinx.com:ip:axi_dma:7.1', { wholeWord: true })).toBe(true);
    expect(matches(':7', 'xilinx.com:ip:axi_dma:71', { wholeWord: true })).toBe(false);
  });

  it('reads * as any run of characters and ? as one character', () => {
    expect(matches('axi*fifo', 'axis_data_fifo_0')).toBe(true);
    expect(matches('fifo*axi', 'axis_data_fifo_0')).toBe(false);
    expect(matches('fifo_?', 'fifo_0')).toBe(true);
    expect(matches('fifo_?', 'fifo_')).toBe(false);
  });

  it('anchors wildcards to whole identifiers with whole word', () => {
    const wholeWord = { wholeWord: true };
    expect(matches('count*', 'count_wr', wholeWord)).toBe(true);
    expect(matches('count*', 'my_count_wr', wholeWord)).toBe(false);
    expect(matches('*count', 'my_count', wholeWord)).toBe(true);
    expect(matches('*count', 'my_count_wr', wholeWord)).toBe(false);
    expect(matches('count_?', 'count_0', wholeWord)).toBe(true);
    expect(matches('count_?', 'count_10', wholeWord)).toBe(false);
  });

  it('reads other punctuation literally', () => {
    expect(matches('7.1', 'axi_dma:7.1')).toBe(true);
    expect(matches('7.1', 'axi_dma:721')).toBe(false);
    expect(matches('(a+b)[0]', 'x(a+b)[0]')).toBe(true);
  });
});
