import { changeRows } from '../../../../services/systemDiagram/diff/changeRows';
import type { SystemGraph } from '../../../../domain/systemGraph';
import type { CrossingFinding, Finding, SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import {
  findingTarget,
  isTargetSelected,
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

describe('findingTarget', () => {
  const graph = {
    instances: { '/a': {}, '/b': {}, '/h': {} },
    levels: { '/': { boundaryPins: [{ name: 'led_o' }] } },
  } as unknown as SystemGraph;
  const pin = (level: string, instance: string | null, name: string): Finding => ({
    kind: 'undriven',
    level,
    instance,
    pin: name,
    label: instance === null ? name : `${instance.slice(1)}/${name}`,
  });
  const crossing = (fromInstance: string | null, toInstance: string | null): CrossingFinding => ({
    kind: 'dataCrossing',
    level: '/',
    from: 'a/x',
    to: toInstance === null ? 'led_o' : 'b/y',
    fromInstance,
    toInstance,
    reason: 'r',
  });

  it('selects the block of an unconnected pin when the graph has it', () => {
    expect(findingTarget(graph, pin('/', '/a', 'clk'))).toEqual({ kind: 'instance', path: '/a' });
    expect(findingTarget(graph, pin('/', '/gone', 'clk'))).toBeUndefined();
  });

  it('selects the external port of a boundary pin of the root level', () => {
    expect(findingTarget(graph, pin('/', null, 'led_o'))).toEqual({ kind: 'port', name: 'led_o' });
    expect(findingTarget(graph, pin('/', null, 'gone'))).toBeUndefined();
  });

  it('selects the hierarchy block of a boundary pin of a level', () => {
    expect(findingTarget(graph, pin('/h', null, 'p'))).toEqual({ kind: 'instance', path: '/h' });
    expect(findingTarget(graph, pin('/gone', null, 'p'))).toBeUndefined();
  });

  it('selects the sink block of a crossing, else its source block', () => {
    expect(findingTarget(graph, crossing('/a', '/b'))).toEqual({ kind: 'instance', path: '/b' });
    expect(findingTarget(graph, crossing('/a', '/gone'))).toEqual({ kind: 'instance', path: '/a' });
    expect(findingTarget(graph, crossing(null, '/b'))).toEqual({ kind: 'instance', path: '/b' });
  });

  it('selects the external port a crossing ends at, when no block is there', () => {
    expect(findingTarget(graph, crossing('/gone', null))).toEqual({ kind: 'port', name: 'led_o' });
    expect(findingTarget(graph, { ...crossing(null, null), to: 'gone' })).toBeUndefined();
  });

  it('selects the external port a crossing starts at when its sink block is gone', () => {
    const fromPort = { ...crossing(null, '/gone'), from: 'led_o' };
    expect(findingTarget(graph, fromPort)).toEqual({ kind: 'port', name: 'led_o' });
    expect(findingTarget(graph, { ...fromPort, from: 'gone' })).toBeUndefined();
  });

  it('gives nothing when the blocks of a crossing are gone', () => {
    expect(findingTarget(graph, crossing('/gone', '/gone2'))).toBeUndefined();
  });
});

describe('isTargetSelected', () => {
  it('matches a block by its path and a port by its boundary id', () => {
    expect(isTargetSelected({ kind: 'instance', path: '/a' }, { kind: 'instance', id: '/a' })).toBe(
      true
    );
    expect(isTargetSelected({ kind: 'instance', path: '/a' }, { kind: 'instance', id: '/b' })).toBe(
      false
    );
    expect(isTargetSelected(undefined, { kind: 'instance', id: '/a' })).toBe(false);
    expect(isTargetSelected({ kind: 'port', name: 'p' }, null)).toBe(false);
  });
});
