import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type { PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import {
  crossingTexts,
  domainTexts,
  filterRows,
  findingTexts,
  resetTexts,
} from '../../../../webview/systemDiagram/panelFilter';
import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
} from '../../../../webview/systemDiagram/searchMatcher';
import type { UnconnectedPin } from '../../../../webview/systemDiagram/unconnectedPins';
import { loadClockFixtureGraph } from './fixtureGraph';

const filter = (text: string) => compileSearch(text, DEFAULT_SEARCH_OPTIONS);
const graph = loadClockFixtureGraph();
const clocks = analyzeClocks(graph);

describe('filterRows', () => {
  const rows = [['alpha', undefined], ['beta', 'Alphabet'], ['gamma']];
  const texts = (row: (string | undefined)[]) => row;

  it('keeps every row, as the same array, without a filter', () => {
    expect(filterRows(rows, null, texts)).toBe(rows);
  });

  it('keeps the rows with a matching cell', () => {
    expect(filterRows(rows, filter('alpha'), texts)).toEqual([rows[0], rows[1]]);
    expect(filterRows(rows, filter('g*a'), texts)).toEqual([rows[2]]);
    expect(filterRows(rows, filter('zzz'), texts)).toEqual([]);
  });
});

describe('row texts', () => {
  it('finds a clock domain by its name and its frequency', () => {
    const [domain] = clocks.domains;
    expect(filterRows(clocks.domains, filter(domain.name), domainTexts)).toContain(domain);
    expect(domainTexts(domain)).toContain('125 MHz');
  });

  it('finds a reset source by its label', () => {
    const [reset] = clocks.resets;
    expect(filterRows(clocks.resets, filter(reset.label), resetTexts)).toContain(reset);
  });

  it('finds a crossing by either end', () => {
    const [crossing] = clocks.crossings.filter(
      (item): item is PinCrossing => item.kind !== 'block'
    );
    expect(crossingTexts(crossing)).toEqual(
      expect.arrayContaining([crossing.from.label, crossing.to.label])
    );
  });

  it('finds an unconnected pin by its name, block and class', () => {
    const instance = Object.values(graph.instances).find((item) => item.kind !== 'hier')!;
    const finding: UnconnectedPin = {
      nodeId: instance.path,
      instance: instance.path,
      level: instance.parent,
      pin: instance.pins[0],
      cls: 'undriven',
    };
    expect(findingTexts(graph, finding)).toEqual(
      expect.arrayContaining([finding.pin.name, instance.name, 'undriven'])
    );
  });
});
