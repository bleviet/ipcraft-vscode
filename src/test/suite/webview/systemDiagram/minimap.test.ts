import {
  MINIMAP_COLORS,
  MINIMAP_NODE_THRESHOLD,
  minimapColor,
  minimapShown,
} from '../../../../webview/systemDiagram/minimap';
import { archGraph } from './archGraph';

const graph = archGraph();
const block = (path: string, selected = false) =>
  ({ type: 'instance', selected, data: { instance: graph.instances[path] } }) as never;

describe('minimapShown', () => {
  it('shows by default only above 15 nodes, and obeys the user', () => {
    expect(MINIMAP_NODE_THRESHOLD).toBe(15);
    expect(minimapShown(undefined, 15)).toBe(false);
    expect(minimapShown(undefined, 16)).toBe(true);
    expect(minimapShown(false, 100)).toBe(false);
    expect(minimapShown(true, 2)).toBe(true);
  });
});

describe('minimapColor', () => {
  it('tints hierarchy blocks and leaves the others plain', () => {
    expect(minimapColor(block('/sub'), '')).toBe(MINIMAP_COLORS.hierarchy);
    expect(minimapColor(block('/src'), '')).toBe(MINIMAP_COLORS.block);
  });

  it('colors search matches, and a selected block over a match', () => {
    expect(minimapColor(block('/src'), 'src')).toBe(MINIMAP_COLORS.match);
    expect(minimapColor(block('/dst'), 'src')).toBe(MINIMAP_COLORS.block);
    expect(minimapColor(block('/src', true), 'src')).toBe(MINIMAP_COLORS.selected);
  });

  it('uses only theme variables', () => {
    for (const color of Object.values(MINIMAP_COLORS)) {
      expect(color).toContain('var(--vscode-');
    }
  });
});
