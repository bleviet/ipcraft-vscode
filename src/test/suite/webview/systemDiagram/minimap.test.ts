import { MINIMAP_COLORS, minimapColor } from '../../../../webview/systemDiagram/minimap';
import type { DiagramFlowNode } from '../../../../webview/systemDiagram/layout/diagramTypes';
import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
} from '../../../../webview/systemDiagram/searchMatcher';

const query = (text: string) => compileSearch(text, DEFAULT_SEARCH_OPTIONS);

function instance(kind: 'ip' | 'hier', name: string, selected = false): DiagramFlowNode {
  return {
    id: name,
    type: 'instance',
    selected,
    position: { x: 0, y: 0 },
    data: { instance: { path: `/${name}`, name, parent: '/', kind, vlnv: `v:l:${name}:1` } },
  } as unknown as DiagramFlowNode;
}

const boundary = {
  id: 'b',
  type: 'boundary',
  position: { x: 0, y: 0 },
  data: { pin: { name: 'clk_in' } },
} as unknown as DiagramFlowNode;

const frame = {
  id: 'f',
  type: 'frame',
  position: { x: 0, y: 0 },
  data: { instance: { path: '/f', name: 'frame_a', parent: '/', kind: 'hier' } },
} as unknown as DiagramFlowNode;

describe('minimapColor', () => {
  it('colors a selected block with the focus color, even when it matches', () => {
    expect(minimapColor(instance('ip', 'dma', true), query('dma'))).toBe(MINIMAP_COLORS.selected);
  });

  it('colors a matching instance and a matching boundary port', () => {
    expect(minimapColor(instance('ip', 'dma'), query('dma'))).toBe(MINIMAP_COLORS.match);
    expect(minimapColor(boundary, query('clk'))).toBe(MINIMAP_COLORS.match);
    expect(minimapColor(boundary, query('zzz'))).toBe(MINIMAP_COLORS.block);
  });

  it('tints a hierarchy instance and a frame', () => {
    expect(minimapColor(instance('hier', 'sub'), query(''))).toBe(MINIMAP_COLORS.hierarchy);
    expect(minimapColor(frame, query(''))).toBe(MINIMAP_COLORS.hierarchy);
  });

  it('keeps a plain block plain, with a blank query matching nothing', () => {
    expect(minimapColor(instance('ip', 'dma'), query(''))).toBe(MINIMAP_COLORS.block);
    expect(minimapColor(instance('ip', 'dma'), query('   '))).toBe(MINIMAP_COLORS.block);
    expect(minimapColor(instance('ip', 'dma'), query('other'))).toBe(MINIMAP_COLORS.block);
  });
});
