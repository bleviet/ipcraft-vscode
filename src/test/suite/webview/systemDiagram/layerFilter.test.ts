import type { NetCategory } from '../../../../domain/systemGraph';
import {
  NO_HIDDEN_LAYERS,
  isSoloLayer,
  soloLayer,
  toggleLayer,
  withoutHiddenLayers,
} from '../../../../webview/systemDiagram/layerFilter';
import type { DiagramFlowEdge } from '../../../../webview/systemDiagram/layout/diagramTypes';

const ALL: NetCategory[] = ['aximm', 'axis', 'signal'];

describe('toggleLayer', () => {
  it('hides a category and shows it again', () => {
    const hidden = toggleLayer(NO_HIDDEN_LAYERS, 'axis');
    expect([...hidden]).toEqual(['axis']);
    expect(toggleLayer(hidden, 'axis').size).toBe(0);
    expect(NO_HIDDEN_LAYERS.size).toBe(0);
  });
});

describe('soloLayer', () => {
  it('hides every other category', () => {
    expect([...soloLayer(NO_HIDDEN_LAYERS, 'axis', ALL)].sort()).toEqual(['aximm', 'signal']);
  });

  it('moves the solo to another category', () => {
    const solo = soloLayer(NO_HIDDEN_LAYERS, 'axis', ALL);
    expect([...soloLayer(solo, 'signal', ALL)].sort()).toEqual(['aximm', 'axis']);
  });

  it('shows all again on the soloed category', () => {
    const solo = soloLayer(NO_HIDDEN_LAYERS, 'axis', ALL);
    expect(isSoloLayer(solo, 'axis', ALL)).toBe(true);
    expect(soloLayer(solo, 'axis', ALL).size).toBe(0);
  });

  it('solos a category that is itself hidden', () => {
    const hidden = toggleLayer(NO_HIDDEN_LAYERS, 'axis');
    expect([...soloLayer(hidden, 'axis', ALL)].sort()).toEqual(['aximm', 'signal']);
  });
});

describe('withoutHiddenLayers', () => {
  const edge = (id: string, category: NetCategory, bundled = false): DiagramFlowEdge =>
    ({
      id,
      data: { category, ...(bundled && { bundle: { key: id } }) },
    }) as unknown as DiagramFlowEdge;
  const layout = {
    nodes: [],
    edges: [edge('a', 'axis'), edge('b', 'axis', true), edge('c', 'signal')],
  };

  it('is the same layout when nothing is hidden', () => {
    expect(withoutHiddenLayers(layout, NO_HIDDEN_LAYERS)).toBe(layout);
  });

  it('drops the wires and bundles of a hidden category and keeps the nodes', () => {
    const drawn = withoutHiddenLayers(layout, toggleLayer(NO_HIDDEN_LAYERS, 'axis'));
    expect(drawn.edges.map((e) => e.id)).toEqual(['c']);
    expect(drawn.nodes).toBe(layout.nodes);
  });
});
