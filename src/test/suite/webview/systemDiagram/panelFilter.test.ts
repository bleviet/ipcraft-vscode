import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type { PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import { changeRows } from '../../../../services/systemDiagram/diff/changeRows';
import { findingRows } from '../../../../services/systemDiagram/diff/findingRows';
import {
  changeTexts,
  crossingTexts,
  domainTexts,
  filterRows,
  comparedFindingTexts,
  findingTexts,
  resetTexts,
} from '../../../../webview/systemDiagram/panelFilter';
import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
} from '../../../../webview/systemDiagram/searchMatcher';
import type { UnconnectedPin } from '../../../../webview/systemDiagram/unconnectedPins';
import { renameDiff, zynqDiff } from './compareFixtures';
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

describe('changeTexts', () => {
  const rows = changeRows(zynqDiff(), { ignoreVersionOnly: false });
  const matching = (text: string) => filterRows(rows, filter(text), changeTexts);

  it('matches the kind of change, where, what, change and both values', () => {
    expect(matching('Removed')).toHaveLength(rows.filter((row) => row.sign === '−').length);
    expect(matching('External ports')).toHaveLength(1);
    expect(matching('/gpio_block')).toHaveLength(1);
    expect(matching('led_o')).toHaveLength(1);
    expect(matching('parameter CONFIG.*')).toHaveLength(1);
    expect(matching('0x41220000')).toHaveLength(1);
    expect(matching('FCLK_CLK1')).toHaveLength(1);
  });

  it('matches an address row by the change word the tab shows', () => {
    const words = (word: string) => matching(word).map((row) => row.section);
    expect(words('address changed')).toEqual(['address']);
    expect(words('removed')).toContain('address');
    expect(matching('added').some((row) => row.section === 'address')).toBe(false);
  });

  it('matches an address row by its address space and by its segment', () => {
    const address = rows.filter((row) => row.section === 'address');
    expect(address.length).toBeGreaterThan(0);
    expect(matching('sys_ps7/Data')).toHaveLength(address.length);
    expect(matching('gpio_block/axi_gpio_1/S_AXI/Reg').map((row) => row.section)).toEqual([
      'address',
    ]);
  });
});

describe('changeTexts of a renamed block', () => {
  const rows = changeRows(renameDiff(), { ignoreVersionOnly: false });
  const matching = (text: string) =>
    filterRows(rows, filter(text), changeTexts).filter((row) => row.sign === '→');

  it('matches the old and the new name and the word renamed', () => {
    expect(matching('axi_gpio_0')).toHaveLength(1);
    expect(matching('axi_gpio_main')).toHaveLength(1);
    expect(matching('renamed')).toHaveLength(1);
    expect(matching('Renamed')).toHaveLength(1);
    expect(matching('axi_gpio_1')).toHaveLength(0);
  });
});

describe('comparedFindingTexts', () => {
  const rows = findingRows({
    new: [
      {
        kind: 'dataCrossing',
        level: '/h',
        from: 'a/M',
        to: 'b/S',
        fromInstance: '/h/a',
        toInstance: '/h/b',
        fromClock: 'clkA',
        reason: 'no synchronizer',
      },
    ],
    resolved: [{ kind: 'unused', level: '/', instance: null, pin: 'led', label: 'led' }],
  });
  const matching = (text: string) => filterRows(rows, filter(text), comparedFindingTexts);

  it('matches the sign, the kind, the where and the detail', () => {
    expect(matching('Resolved')).toHaveLength(1);
    expect(matching('data crossing')).toHaveLength(1);
    expect(matching('a/M → b/S on level /h')).toHaveLength(1);
    expect(matching('unknown clock')).toHaveLength(1);
    expect(matching('no synchronizer')).toHaveLength(1);
    expect(matching('led')).toHaveLength(1);
    expect(matching('nothing')).toHaveLength(0);
  });
});
