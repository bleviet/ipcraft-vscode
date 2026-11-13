import { changeRows } from '../../../../services/systemDiagram/diff/changeRows';
import type { SystemGraph } from '../../../../domain/systemGraph';
import type { SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import {
  resolveTarget,
  segmentOwners,
  segmentTextOwner,
} from '../../../../webview/systemDiagram/changeTargets';
import { zynqDiff, zynqGraph } from './compareFixtures';

const rows = changeRows(zynqDiff(), { ignoreVersionOnly: false });
const segment = (name: string) =>
  rows.find((r) => r.section === 'address' && r.change[0][0].text === name)!;

describe('resolveTarget', () => {
  const graph = zynqGraph('current');

  it('gives the slave block of a segment of the graph', () => {
    const slave = graph.addressSegments.find(
      (s) => s.segment === 'gpio_block/axi_gpio_1/S_AXI/Reg'
    )!.slaveInstance;
    expect(resolveTarget(graph, segment('gpio_block/axi_gpio_1/S_AXI/Reg'))).toEqual({
      kind: 'instance',
      path: slave,
    });
  });

  it('gives nothing for a segment the graph does not have, or whose slave is gone', () => {
    const copy = { ...graph, addressSegments: [] };
    expect(resolveTarget(copy, segment('gpio_block/axi_gpio_1/S_AXI/Reg'))).toBeUndefined();
    const noSlave = { ...graph, instances: {} };
    expect(resolveTarget(noSlave, segment('gpio_block/axi_gpio_1/S_AXI/Reg'))).toBeUndefined();
  });

  it('gives nothing for a removed segment', () => {
    expect(resolveTarget(graph, segment('axi_gpio_0/S_AXI/Reg'))).toBeUndefined();
  });

  it('passes block and port targets through', () => {
    const block = rows.find((r) => r.target?.kind === 'instance')!;
    expect(resolveTarget(graph, block)).toBe(block.target);
  });
});

describe('segmentTextOwner', () => {
  const graph = { instances: { '/h': {}, '/new': {}, '/new/c': {} } } as unknown as SystemGraph;
  const diff = {
    instances: [
      { path: '/h/gone', status: 'removed' },
      { path: '/new', status: 'renamed', basePath: '/old' },
    ],
  } as unknown as SystemGraphDiff;
  const owners = segmentOwners(graph, diff);

  it('takes the longest block, and a removed one owns the text, not its surviving parent', () => {
    expect(segmentTextOwner(owners, 'h/other/S/Reg')).toBe('/h');
    expect(segmentTextOwner(owners, 'h/gone/S/Reg')).toBeUndefined();
    expect(segmentTextOwner(owners, 'new/c.S')).toBe('/new/c');
  });

  it('maps the base spelling of a renamed block, and the blocks below it, to the current ones', () => {
    expect(segmentTextOwner(owners, 'old/S/Reg')).toBe('/new');
    expect(segmentTextOwner(owners, 'old/c/S/Reg')).toBe('/new/c');
    expect(segmentTextOwner(owners, 'nowhere/S')).toBeUndefined();
  });
});
