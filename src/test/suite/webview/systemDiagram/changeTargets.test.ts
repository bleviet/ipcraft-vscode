import { changeRows } from '../../../../services/systemDiagram/diff/changeRows';
import { resolveTarget } from '../../../../webview/systemDiagram/changeTargets';
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
