import type { SystemGraph } from '../../../../domain/systemGraph';
import { diffSystemGraphs } from '../../../../services/systemDiagram/diff/diffSystemGraphs';
import { changeDecor } from '../../../../webview/systemDiagram/changeDecor';
import { buildChangeMarks } from '../../../../webview/systemDiagram/changeMarks';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { zynqDiff, zynqGraph } from './compareFixtures';
import type { ChangeMarks } from '../../../../webview/systemDiagram/changeMarks';
import { fakeMeasure } from './fixtureGraph';
import { systemBd, twoClockGroups, withoutGpio0Net } from './systemBdEdit';

async function layoutOf(graph: SystemGraph, expanded: string[] = []) {
  const laidOut = await runElkLayout(
    buildElkInput(graph, '/', { measure: fakeMeasure, expanded: new Set(expanded) })
  );
  return toFlowElements(laidOut, graph, '/', fakeMeasure);
}

describe('changeDecor', () => {
  it('collects the marks by node, the kinds in display order, and the removed count of the level', async () => {
    const graph = zynqGraph('current');
    const marks = buildChangeMarks(zynqDiff(), graph);
    const decor = changeDecor(await layoutOf(graph), { marks, graph, levelPath: '/' });
    expect([...decor.nodes.keys()].sort()).toEqual(
      ['/axis_data_fifo_0', '/gpio_block', '/sys_ps7'].sort()
    );
    expect(decor.nodes.get('/gpio_block')).toEqual({ inside: 1 });
    expect(decor.nodes.get('/sys_ps7')).toEqual({
      status: 'changed',
      title: 'Changed: 1 parameter',
    });
    expect(decor.legend).toEqual({ kinds: ['added', 'changed'], newWire: true, removed: 2 });
    expect(decor.newEdgeIds.size).toBeGreaterThan(0);
  });

  it('adds the removed blocks of a hierarchy shown expanded in the level', async () => {
    const extra = systemBd((d) => {
      d.components.gpio_block.components.old_blk = { vlnv: 'xilinx.com:ip:axi_gpio:2.0' };
    });
    const graph = systemBd();
    const marks = buildChangeMarks(diffSystemGraphs(extra, graph), graph);
    const context = { marks, graph, levelPath: '/' };
    expect(changeDecor(await layoutOf(graph), context).legend.removed).toBe(0);
    expect(changeDecor(await layoutOf(graph, ['/gpio_block']), context).legend.removed).toBe(1);
  });

  it('marks the pins of a block and flags the new wire, and nothing without a change', async () => {
    const [base, graph] = [systemBd(withoutGpio0Net), systemBd()];
    const marks = buildChangeMarks(diffSystemGraphs(base, graph), graph);
    const decor = changeDecor(await layoutOf(graph), { marks, graph, levelPath: '/' });
    expect(decor.nodes.get('/axi_periph')?.pins).toEqual({ M00_AXI: { kind: 'added' } });
    expect([...decor.newEdgeIds]).toEqual(['/::periph_gpio0#1']);
    const same = buildChangeMarks(diffSystemGraphs(graph, graph), graph);
    const none = changeDecor(await layoutOf(graph), { marks: same, graph, levelPath: '/' });
    expect(none.nodes.size).toBe(0);
    expect(none.newEdgeIds.size).toBe(0);
    expect(none.legend).toEqual({ kinds: [], newWire: false, removed: 0 });
  });
});

describe('changeDecor details', () => {
  it('leaves the count out of an added hierarchy', async () => {
    const graph = zynqGraph('current');
    const marks = {
      blocks: new Map([['/gpio_block', { status: 'added', title: 'Added', pins: {}, inside: 3 }]]),
      ports: new Map(),
      removed: new Map(),
      gained: new Map(),
    } as unknown as ChangeMarks;
    const decor = changeDecor(await layoutOf(graph), { marks, graph, levelPath: '/' });
    expect(decor.nodes.get('/gpio_block')).toEqual({ status: 'added', title: 'Added' });
  });

  it('marks the boundary pins of the level of a hierarchy from its inside pins', async () => {
    const [base, graph] = [systemBd(twoClockGroups(false)), systemBd(twoClockGroups(true))];
    const marks = buildChangeMarks(diffSystemGraphs(base, graph), graph);
    const laidOut = await runElkLayout(
      buildElkInput(graph, '/gpio_block', { measure: fakeMeasure })
    );
    const layout = toFlowElements(laidOut, graph, '/gpio_block', fakeMeasure);
    const decor = changeDecor(layout, { marks, graph, levelPath: '/gpio_block' });
    expect(decor.nodes.get('/gpio_block::clk')).toEqual({
      status: 'changed',
      title: 'Connection inside changed',
    });
    expect(decor.nodes.has('/gpio_block::rst_n')).toBe(false);
  });
});
