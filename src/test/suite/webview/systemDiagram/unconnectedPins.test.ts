import type { SystemGraph } from '../../../../domain/systemGraph';
import {
  isPinListKnown,
  levelReviewSummary,
  nodeUnconnectedCount,
  uncheckedInstanceCount,
  unconnectedClass,
  unconnectedPins,
} from '../../../../webview/systemDiagram/unconnectedPins';
import { loadFixtureGraph, loadReviewFixtureGraph } from './fixtureGraph';

const BANK = '/dsp_pipeline/coeff_bank';

describe('unconnectedClass', () => {
  it.each([
    ['in', false, 'undriven'],
    ['slave', false, 'undriven'],
    ['out', false, 'unused'],
    ['master', false, 'unused'],
    ['inout', false, 'unused'],
    ['unknown', false, 'unused'],
    ['out', true, 'undriven'],
    ['in', true, 'unused'],
  ] as const)('classes %s (boundary %s) as %s', (direction, isBoundary, expected) => {
    expect(unconnectedClass({ direction }, isBoundary)).toBe(expected);
  });
});

describe('unconnectedPins', () => {
  it('reports nothing for a fixture whose pins all come from connections', () => {
    expect(unconnectedPins(loadFixtureGraph())).toEqual([]);
  });

  it('reports open pins of known blocks with their class', () => {
    const found = unconnectedPins(loadReviewFixtureGraph());
    const gpio = found.filter((finding) => finding.nodeId === '/axi_gpio_0');
    expect(gpio.map((finding) => [finding.pin.name, finding.cls])).toEqual([
      ['spare_in', 'undriven'],
      ['spare_out', 'unused'],
      ['spare_io', 'unused'],
    ]);
    expect(gpio[0]).toMatchObject({ level: '/', instance: '/axi_gpio_0' });
  });

  it('classes a root output port as undriven and names its node', () => {
    const port = unconnectedPins(loadReviewFixtureGraph()).find(
      (finding) => finding.pin.name === 'ext_out'
    );
    expect(port).toMatchObject({
      level: '/',
      nodeId: '/::ext_out',
      instance: null,
      cls: 'undriven',
    });
  });

  it('reports a hierarchy pin open on both sides at both levels', () => {
    const found = unconnectedPins(loadReviewFixtureGraph()).filter(
      (finding) => finding.pin.name === 'cfg_open'
    );
    expect(found.map((finding) => [finding.level, finding.nodeId, finding.cls])).toEqual([
      ['/dsp_pipeline', BANK, 'undriven'],
      [BANK, `${BANK}::cfg_open`, 'unused'],
    ]);
  });

  it('counts clock and reset nets as connections', () => {
    const graph = loadReviewFixtureGraph();
    const net = graph.nets.find(
      (candidate) => candidate.level === '/' && candidate.category === 'clock'
    )!;
    net.endpoints.push({ instance: '/axi_gpio_0', pin: 'spare_in' });
    const found = unconnectedPins(graph);
    expect(found.some((finding) => finding.pin.name === 'spare_in')).toBe(false);
  });

  it('lists undriven findings first, then unused, keeping graph order', () => {
    const found = unconnectedPins(loadReviewFixtureGraph());
    expect(found.map((finding) => finding.cls)).toEqual(
      [...found.map((finding) => finding.cls)].sort((a, b) =>
        a === b ? 0 : a === 'undriven' ? -1 : 1
      )
    );
    expect(found.map((finding) => finding.pin.name)).toEqual([
      'spare_in',
      'ext_out',
      'cfg_open',
      'spare_out',
      'spare_io',
      'cfg_open',
    ]);
  });
});

describe('pin list knowledge', () => {
  it('knows hierarchies and defined blocks only', () => {
    const graph = loadReviewFixtureGraph();
    expect(isPinListKnown(graph.instances['/axi_gpio_0'])).toBe(true);
    expect(isPinListKnown(graph.instances['/dsp_pipeline'])).toBe(true);
    expect(isPinListKnown(graph.instances['/axi_dma_0'])).toBe(false);
  });

  it('counts unchecked instances per level or in total', () => {
    const graph = loadReviewFixtureGraph();
    expect(uncheckedInstanceCount(graph)).toBe(11);
    expect(uncheckedInstanceCount(graph, '/')).toBe(7);
    expect(uncheckedInstanceCount(graph, BANK)).toBe(2);
  });
});

describe('nodeUnconnectedCount', () => {
  it('rolls nested levels up into a hierarchy block', () => {
    const graph = loadReviewFixtureGraph();
    const findings = unconnectedPins(graph);
    expect(nodeUnconnectedCount(findings, '/axi_gpio_0', graph)).toEqual({ all: 3, undriven: 1 });
    expect(nodeUnconnectedCount(findings, '/dsp_pipeline', graph)).toEqual({ all: 2, undriven: 1 });
    expect(nodeUnconnectedCount(findings, BANK, graph)).toEqual({ all: 2, undriven: 1 });
    expect(nodeUnconnectedCount(findings, '/::ext_out', graph)).toEqual({ all: 1, undriven: 1 });
  });
});

describe('levelReviewSummary', () => {
  it('words the level counts, nested findings, and unchecked blocks', () => {
    const graph = loadReviewFixtureGraph();
    const findings = unconnectedPins(graph);
    expect(levelReviewSummary(findings, graph, '/')).toBe(
      'This level: 2 undriven, 2 unused; 2 more inside nested hierarchies. 7 blocks (dashed) have no pin definition and were not checked.'
    );
  });

  it('omits the nested clause and uses the singular', () => {
    const graph = loadReviewFixtureGraph();
    const findings = unconnectedPins(graph);
    expect(levelReviewSummary(findings, graph, BANK)).toBe(
      'This level: 0 undriven, 1 unused. 2 blocks (dashed) have no pin definition and were not checked.'
    );
    const one: SystemGraph = {
      ...graph,
      levels: {
        ...graph.levels,
        [BANK]: { ...graph.levels[BANK], instances: [`${BANK}/config_fifo`] },
      },
    };
    expect(levelReviewSummary(findings, one, BANK)).toBe(
      'This level: 0 undriven, 1 unused. 1 block (dashed) has no pin definition and was not checked.'
    );
  });

  it('omits the not-checked sentence when every block was checked', () => {
    const graph = loadReviewFixtureGraph();
    const none: SystemGraph = {
      ...graph,
      levels: { ...graph.levels, [BANK]: { ...graph.levels[BANK], instances: [] } },
    };
    expect(levelReviewSummary(unconnectedPins(graph), none, BANK)).toBe(
      'This level: 0 undriven, 1 unused.'
    );
  });
});
