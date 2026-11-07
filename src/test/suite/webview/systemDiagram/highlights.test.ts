import {
  applyHighlight,
  hasAnyHighlight,
  highlightCount,
  highlightCss,
  highlightedNetIds,
  isHighlightColor,
  netHighlightColor,
  nodeHighlightColor,
  parseSelectionKey,
  pruneHighlights,
  selectionKey,
} from '../../../../webview/systemDiagram/highlights';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();

describe('highlights', () => {
  it('round-trips selection keys for instances, boundary pins, and nets', () => {
    const inst = { kind: 'instance', id: '/axi_dma_0' } as const;
    const port = { kind: 'boundary', id: boundaryId('/', 'DDR') } as const;
    const net = { kind: 'net', id: '/::axi_dma_0_M_AXIS_MM2S' } as const;

    expect(selectionKey(inst)).toBe('instance:/axi_dma_0');
    expect(selectionKey(port)).toBe('boundary:/::DDR');
    expect(selectionKey(net)).toBe('net:/::axi_dma_0_M_AXIS_MM2S');

    expect(parseSelectionKey(selectionKey(inst))).toEqual(inst);
    expect(parseSelectionKey(selectionKey(port))).toEqual(port);
    expect(parseSelectionKey(selectionKey(net))).toEqual(net);
  });

  it('rejects malformed selection keys', () => {
    expect(parseSelectionKey('')).toBeUndefined();
    expect(parseSelectionKey('instance:')).toBeUndefined();
    expect(parseSelectionKey('unknown:/axi_dma_0')).toBeUndefined();
    expect(parseSelectionKey('/axi_dma_0')).toBeUndefined();
    expect(parseSelectionKey(':id')).toBeUndefined();
  });

  it('validates highlight colors and resolves their CSS variables', () => {
    expect(isHighlightColor('red')).toBe(true);
    expect(isHighlightColor('cyan')).toBe(true);
    expect(isHighlightColor('purple')).toBe(false);
    expect(isHighlightColor(42)).toBe(false);

    expect(highlightCss('red')).toBe('var(--vscode-charts-red)');
    expect(highlightCss('magenta')).toBe('var(--vscode-terminal-ansiMagenta)');
    expect(highlightCss(undefined)).toBeUndefined();
  });

  it('prunes invalid keys, invalid colors, and vanished selections from a highlight map', () => {
    expect(pruneHighlights(graph, null)).toEqual({});
    expect(pruneHighlights(graph, 'bad')).toEqual({});

    const raw = {
      'instance:/axi_dma_0': 'red',
      'boundary:/::DDR': 'green',
      'net:/::axi_dma_0_M_AXIS_MM2S': 'cyan',
      'instance:/vanished': 'yellow',
      'boundary:/::NOPE': 'orange',
      'net:/::vanished_net': 'magenta',
      'instance:/axi_gpio_0': 'not-a-color',
      'bad-key': 'red',
    };
    expect(pruneHighlights(graph, raw)).toEqual({
      'instance:/axi_dma_0': 'red',
      'boundary:/::DDR': 'green',
      'net:/::axi_dma_0_M_AXIS_MM2S': 'cyan',
    });
  });

  it('applies, counts, and clears highlights across multiple targets', () => {
    const dma = { kind: 'instance', id: '/axi_dma_0' } as const;
    const gpio = { kind: 'instance', id: '/axi_gpio_0' } as const;
    const net = { kind: 'net', id: '/::axi_dma_0_M_AXIS_MM2S' } as const;

    const first = applyHighlight({}, [dma, net], 'orange');
    expect(first).toEqual({
      'instance:/axi_dma_0': 'orange',
      'net:/::axi_dma_0_M_AXIS_MM2S': 'orange',
    });
    expect(highlightCount(first)).toBe(2);
    expect(hasAnyHighlight(first, [gpio])).toBe(false);
    expect(hasAnyHighlight(first, [gpio, dma])).toBe(true);

    const second = applyHighlight(first, [dma], null);
    expect(second).toEqual({
      'net:/::axi_dma_0_M_AXIS_MM2S': 'orange',
    });
    expect(highlightCount(second)).toBe(1);
  });

  it('looks up node and net highlight colors and collects highlighted net ids', () => {
    const map = {
      'instance:/axi_dma_0': 'red' as const,
      'boundary:/::DDR': 'yellow' as const,
      'net:/::axi_dma_0_M_AXIS_MM2S': 'cyan' as const,
      'net:/dsp_pipeline::Conn1': 'magenta' as const,
    };

    expect(nodeHighlightColor(map, '/axi_dma_0')).toBe('var(--vscode-charts-red)');
    expect(nodeHighlightColor(map, '/::DDR')).toBe('var(--vscode-charts-yellow)');
    expect(nodeHighlightColor(map, '/axi_gpio_0')).toBeUndefined();

    expect(netHighlightColor(map, '/::axi_dma_0_M_AXIS_MM2S')).toBe(
      'var(--vscode-terminal-ansiCyan)'
    );
    expect(netHighlightColor(map, '/::other')).toBeUndefined();

    expect([...highlightedNetIds(map)]).toEqual([
      '/::axi_dma_0_M_AXIS_MM2S',
      '/dsp_pipeline::Conn1',
    ]);
  });
});
