import type { SystemGraph } from '../../../../domain/systemGraph';
import type { SegmentChange, SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import { addressMapRows } from '../../../../webview/systemDiagram/addressMapRows';

const seg = (segment: string, offset?: string, range?: string, addressSpace = 'cpu/Data') => ({
  addressSpace,
  segment,
  masterInstance: '/cpu',
  slaveInstance: `/${segment}`,
  offset,
  range,
  line: 7,
});

const graphOf = (segments: ReturnType<typeof seg>[], format = 'vivado-bd') =>
  ({ source: { format }, addressSegments: segments }) as unknown as SystemGraph;

const diffOf = (segments: SegmentChange[], baseFormat = 'vivado-bd') =>
  ({ base: { name: 'b', format: baseFormat }, segments }) as unknown as SystemGraphDiff;

const changed = (
  segment: string,
  base: { offset?: string; range?: string },
  current: { offset?: string; range?: string },
  addressSpace = 'cpu/Data'
): SegmentChange => ({ addressSpace, segment, status: 'changed', base, current });

describe('addressMapRows', () => {
  it('lists the segments of the graph in order, unmarked, without a diff', () => {
    const graph = graphOf([seg('b', '0x10', '0x10'), seg('a', '0x0', '0x10')]);
    const rows = addressMapRows(graph);
    expect(rows.map((row) => row.segment.segment)).toEqual(['b', 'a']);
    expect(rows.every((row) => row.format === 'vivado-bd' && !row.change)).toBe(true);
    expect(rows[0].segment).toBe(graph.addressSegments[0]);
  });

  it('attaches the added and changed change to the segment with the same key', () => {
    const added: SegmentChange = {
      addressSpace: 'cpu/Data',
      segment: 'new',
      status: 'added',
      current: { offset: '0x20' },
    };
    const edit = changed('a', { offset: '0x0' }, { offset: '0x8' });
    const graph = graphOf([seg('a', '0x8'), seg('new', '0x20'), seg('same', '0x30')]);
    const rows = addressMapRows(graph, diffOf([edit, added]));
    expect(rows.map((row) => row.change)).toEqual([edit, added, undefined]);
    expect(rows).toHaveLength(3);
  });

  it('appends the removed segments with the base values and format, in diff order', () => {
    const gone = (segment: string): SegmentChange => ({
      addressSpace: 'cpu/Data',
      segment,
      status: 'removed',
      base: { offset: '0x40', range: '0x10' },
    });
    const graph = graphOf([seg('a', '0x0')], 'qsys');
    const rows = addressMapRows(graph, diffOf([gone('x'), gone('y')], 'vivado-bd'));
    expect(rows.map((row) => row.segment.segment)).toEqual(['a', 'x', 'y']);
    expect(rows[1]).toEqual({
      segment: {
        addressSpace: 'cpu/Data',
        segment: 'x',
        masterInstance: '',
        slaveInstance: '',
        offset: '0x40',
        range: '0x10',
      },
      format: 'vivado-bd',
      change: gone('x'),
    });
    expect(rows[0].format).toBe('qsys');
    expect(rows[1].segment.line).toBeUndefined();
  });

  it('flags the values that differ from the base, ignoring case', () => {
    const rows = addressMapRows(
      graphOf([
        seg('a', '0xAB', '0x20'),
        seg('b', '0x10', '0x20'),
        seg('c', '0x10', '0x40'),
        seg('d', '0x0', '0x2000'),
      ]),
      diffOf([
        changed('a', { offset: '0xab', range: '0x10' }, { offset: '0xAB', range: '0x20' }),
        changed('b', { offset: '0x0', range: '0x20' }, { offset: '0x10', range: '0x20' }),
        changed('c', { offset: '0x10', range: '0x20' }, { offset: '0x10', range: '0x40' }),
        // Both inputs move, the last address stays 0x1FFF.
        changed('d', { offset: '0x1000', range: '0x1000' }, { offset: '0x0', range: '0x2000' }),
      ])
    );
    expect(rows.map((row) => row.changedFields)).toEqual([
      { offset: false, range: true, high: true },
      { offset: true, range: false, high: true },
      { offset: false, range: true, high: true },
      { offset: true, range: true, high: false },
    ]);
    expect(rows[1].baseShown).toEqual({ offset: '0x0000', range: '0x0020', high: '0x0000_001F' });
  });

  it('shows the base values in the base format', () => {
    // A Platform Designer base writes an unknown range as `-`, a Vivado one as `auto`.
    const rows = addressMapRows(
      graphOf([seg('a', '0x8')]),
      diffOf([changed('a', { offset: '0x0' }, { offset: '0x8' })], 'qsys')
    );
    expect(rows[0].baseShown?.range).toBe('-');
  });

  it('matches a segment by its exact key: a key that differs only in case is another segment', () => {
    const graph = graphOf([seg('Reg', '0x8')]);
    const rows = addressMapRows(
      graph,
      diffOf([
        changed('reg', { offset: '0x0' }, { offset: '0x8' }),
        { addressSpace: 'cpu/Data', segment: 'reg', status: 'removed', base: { offset: '0x0' } },
      ])
    );
    // `Reg` has no change; the removed `reg` is another segment, listed after it.
    expect(rows.map((row) => [row.segment.segment, row.change?.status])).toEqual([
      ['Reg', undefined],
      ['reg', 'removed'],
    ]);
  });
});
