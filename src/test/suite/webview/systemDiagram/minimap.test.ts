import { MINIMAP_COLORS, minimapColor } from '../../../../webview/systemDiagram/minimap';
import type { DiagramFlowNode } from '../../../../webview/systemDiagram/layout/diagramTypes';

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
    expect(minimapColor(instance('ip', 'dma', true), 'dma')).toBe(MINIMAP_COLORS.selected);
  });

  it('colors a matching instance and a matching boundary port', () => {
    expect(minimapColor(instance('ip', 'dma'), 'dma')).toBe(MINIMAP_COLORS.match);
    expect(minimapColor(boundary, 'clk')).toBe(MINIMAP_COLORS.match);
    expect(minimapColor(boundary, 'zzz')).toBe(MINIMAP_COLORS.block);
  });

  it('tints a hierarchy instance and a frame', () => {
    expect(minimapColor(instance('hier', 'sub'), '')).toBe(MINIMAP_COLORS.hierarchy);
    expect(minimapColor(frame, '')).toBe(MINIMAP_COLORS.hierarchy);
  });

  it('keeps a plain block plain, with a blank query matching nothing', () => {
    expect(minimapColor(instance('ip', 'dma'), '')).toBe(MINIMAP_COLORS.block);
    expect(minimapColor(instance('ip', 'dma'), '   ')).toBe(MINIMAP_COLORS.block);
    expect(minimapColor(instance('ip', 'dma'), 'other')).toBe(MINIMAP_COLORS.block);
  });
});
