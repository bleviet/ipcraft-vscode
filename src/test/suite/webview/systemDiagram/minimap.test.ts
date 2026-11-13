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

describe('minimapColor for a comparison', () => {
  const marked = (node: DiagramFlowNode, status: string): DiagramFlowNode =>
    ({ ...node, data: { ...node.data, change: { status } } }) as unknown as DiagramFlowNode;

  it('colors a marked block with the color of its kind of change', () => {
    for (const status of ['added', 'changed', 'renamed', 'version'] as const) {
      expect(minimapColor(marked(instance('ip', 'dma'), status), null)).toBe(
        MINIMAP_COLORS[status]
      );
    }
    expect(minimapColor(marked(boundary, 'added'), null)).toBe(MINIMAP_COLORS.added);
    expect(minimapColor(marked(frame, 'changed'), null)).toBe(MINIMAP_COLORS.changed);
  });

  it('lets a selection and a search match win over the mark', () => {
    const changed = marked(instance('ip', 'dma', true), 'changed');
    expect(minimapColor(changed, null)).toBe(MINIMAP_COLORS.selected);
    expect(minimapColor(marked(instance('ip', 'dma'), 'changed'), query('dma'))).toBe(
      MINIMAP_COLORS.match
    );
    expect(minimapColor(marked(instance('ip', 'dma'), 'changed'), query('other'))).toBe(
      MINIMAP_COLORS.changed
    );
  });

  it('keeps a block with only changes inside its hierarchy tint', () => {
    const inside = {
      ...instance('hier', 'sub'),
      data: { ...instance('hier', 'sub').data, change: { inside: 2 } },
    } as unknown as DiagramFlowNode;
    expect(minimapColor(inside, null)).toBe(MINIMAP_COLORS.hierarchy);
  });
});
